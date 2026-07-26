/**
 * Event deduplication.
 *
 * Two providers describing the same dust intrusion must produce ONE entry in
 * the UI, not two. But collapsing them must not lose either citation: an event
 * corroborated by two independent sources is more trustworthy than one, and
 * hiding the second source would throw that signal away.
 *
 * So duplicates are *merged*, not dropped. The merge keeps the widest time
 * window, the highest confidence, the union of affected pollutants, and every
 * contributing citation.
 *
 * Detection runs cheapest-first:
 *   1. identical id                    — same event, same provider, re-fetched
 *   2. identical canonical URL         — same report, different link decoration
 *   3. same type + overlapping time + compatible geography + similar title
 *
 * Pure and deterministic: no clock, no network, no randomness. The same input
 * list always yields the same output list in the same order.
 */

import type {
  EnrichedContextEvent,
  EnvironmentalContextEventType,
  EventCitation,
  GeographicalScope,
  ContextConfidence,
} from './types';
import type { PollutantCode } from '@/config/pollutants';

/* -------------------------------------------------------------------------- */
/*  Stable hashing                                                            */
/* -------------------------------------------------------------------------- */

/**
 * FNV-1a, 32-bit, rendered as 8 hex characters.
 *
 * Deliberately not a crypto hash: this must run identically in Node, on the
 * edge and in a test with no imports, and it is used for identity, not for
 * security. Collisions are possible in principle; the inputs are short, highly
 * structured fingerprints, so in practice a collision would require two events
 * of the same type, geography and hour — which the merge rules would join
 * anyway.
 */
export function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply, expressed with shifts to stay inside int32.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/* -------------------------------------------------------------------------- */
/*  Normalisation                                                             */
/* -------------------------------------------------------------------------- */

/** Query parameters that identify a campaign, not a document. */
const TRACKING_PARAMS = /^(utm_|ga_|mc_|pk_|piwik_)|^(fbclid|gclid|msclkid|igshid|ref|source)$/i;

/**
 * Canonical form of a URL, for identity comparison only.
 *
 * Lowercases the host, drops `www.`, removes tracking parameters, sorts the
 * survivors, drops the fragment, and strips a trailing slash. The result is
 * never rendered or fetched — `sourceUrl` keeps the original — so lossy
 * normalisation is safe here and only here.
 */
export function canonicalUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Not a URL: fall back to the trimmed string so two identical malformed
    // values still compare equal.
    return raw.trim().toLowerCase();
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');

  const params: Array<[string, string]> = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (TRACKING_PARAMS.test(key)) continue;
    params.push([key, value]);
  }
  params.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));

  const query = params.map(([k, v]) => `${k}=${v}`).join('&');
  const path = url.pathname.replace(/\/+$/, '');

  return `${host}${path}${query ? `?${query}` : ''}`;
}

/** Words carrying no distinguishing weight in a weather or aerosol headline. */
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'may',
  'of',
  'on',
  'or',
  'over',
  'the',
  'to',
  'with',
]);

/**
 * Maltese letters that Unicode normalisation cannot fold.
 *
 * NFD decomposes a letter into a base plus combining marks, which handles
 * ċ, ġ and ż — but **not** ħ. A stroke is part of the glyph rather than a
 * combining mark, so U+0127 has no canonical decomposition and survives NFD
 * intact, whereupon the ASCII filter deletes it outright: "Għarb" would reduce
 * to "g arb" and never match the upstream's "Gharb". This map is what makes
 * Maltese orthography comparable with the feeds' unaccented ASCII.
 *
 * Exported because `relevance.ts` folds text for the same reason and must not
 * drift from this map.
 */
export const MALTESE_FOLD_PATTERN = /[\u0127\u0126\u010b\u010a\u0121\u0120\u017c\u017b]/g;

/** Fold Maltese letters and combining diacritics to comparable ASCII. */
export function foldForComparison(text: string): string {
  return text
    .replace(MALTESE_FOLD_PATTERN, (char) => MALTESE_FOLD[char] ?? char)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
export const MALTESE_FOLD: Record<string, string> = {
  ħ: 'h',
  Ħ: 'h',
  ċ: 'c',
  Ċ: 'c',
  ġ: 'g',
  Ġ: 'g',
  ż: 'z',
  Ż: 'z',
};

/**
 * Comparable token form of a title.
 *
 * Diacritics are folded so "Għarb" and "Gharb" match — the upstream feeds use
 * unaccented ASCII while maqua.app displays correct Maltese orthography, and a
 * comparison that treats those as different titles would never dedupe a Gozo
 * event.
 */
export function normaliseTitle(title: string): string[] {
  return foldForComparison(title)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

/** Jaccard similarity of two token sets, in [0, 1]. */
export function titleSimilarity(a: string, b: string): number {
  const left = new Set(normaliseTitle(a));
  const right = new Set(normaliseTitle(b));
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;

  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/* -------------------------------------------------------------------------- */
/*  Overlap rules                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Scopes that describe overlapping ground.
 *
 * `Maltese Islands` contains Malta and Gozo; `Central Mediterranean` and
 * `Regional` contain everything. A national dust warning and a Gozo-specific
 * one describe the same air, so they are candidates for merging.
 */
const SCOPE_CONTAINS: Record<GeographicalScope, GeographicalScope[]> = {
  Malta: ['Malta', 'Maltese Islands', 'Central Mediterranean', 'Regional'],
  Gozo: ['Gozo', 'Maltese Islands', 'Central Mediterranean', 'Regional'],
  'Maltese Islands': ['Malta', 'Gozo', 'Maltese Islands', 'Central Mediterranean', 'Regional'],
  'Central Mediterranean': [
    'Malta',
    'Gozo',
    'Maltese Islands',
    'Central Mediterranean',
    'Regional',
  ],
  Regional: ['Malta', 'Gozo', 'Maltese Islands', 'Central Mediterranean', 'Regional'],
};

export function scopesOverlap(
  a: GeographicalScope | undefined,
  b: GeographicalScope | undefined,
): boolean {
  // An unstated scope is treated as compatible: refusing to merge on missing
  // metadata would leave visible duplicates, which is the worse outcome.
  if (!a || !b) return true;
  return SCOPE_CONTAINS[a].includes(b);
}

/** Hours either side of a window within which two events count as concurrent. */
export const TEMPORAL_SLACK_HOURS = 6;

function windowOf(event: EnrichedContextEvent): { start: number; end: number } {
  const start = event.startsAt ? Date.parse(event.startsAt) : Date.parse(event.publishedAt);
  const end = event.endsAt ? Date.parse(event.endsAt) : start;
  if (!Number.isFinite(start)) return { start: Number.NaN, end: Number.NaN };
  return { start, end: Number.isFinite(end) ? Math.max(start, end) : start };
}

export function windowsOverlap(a: EnrichedContextEvent, b: EnrichedContextEvent): boolean {
  const left = windowOf(a);
  const right = windowOf(b);
  // An undatable event cannot be proven concurrent, so it is never merged on
  // time alone.
  if (!Number.isFinite(left.start) || !Number.isFinite(right.start)) return false;

  const slack = TEMPORAL_SLACK_HOURS * 3_600_000;
  return left.start - slack <= right.end && right.start - slack <= left.end;
}

/** Token overlap at or above which two titles describe the same thing. */
export const TITLE_SIMILARITY_THRESHOLD = 0.6;

export function isDuplicate(a: EnrichedContextEvent, b: EnrichedContextEvent): boolean {
  if (a.id === b.id) return true;

  const sameUrl = canonicalUrl(a.sourceUrl) === canonicalUrl(b.sourceUrl);
  if (sameUrl && a.type === b.type) return true;

  if (a.type !== b.type) return false;
  if (!scopesOverlap(a.geographicalScope, b.geographicalScope)) return false;
  if (!windowsOverlap(a, b)) return false;

  // Same type, same place, same time — from one source that is one event. From
  // two sources it is corroboration, and the titles decide.
  return sameUrl || titleSimilarity(a.title, b.title) >= TITLE_SIMILARITY_THRESHOLD;
}

/* -------------------------------------------------------------------------- */
/*  Merging                                                                   */
/* -------------------------------------------------------------------------- */

const CONFIDENCE_RANK: Record<ContextConfidence, number> = { low: 0, medium: 1, high: 2 };

const SCOPE_SPECIFICITY: Record<GeographicalScope, number> = {
  Malta: 3,
  Gozo: 3,
  'Maltese Islands': 2,
  'Central Mediterranean': 1,
  Regional: 0,
};

export function citationOf(event: EnrichedContextEvent): EventCitation {
  return {
    sourceName: event.sourceName,
    sourceUrl: event.sourceUrl,
    canonicalUrl: canonicalUrl(event.sourceUrl),
    publishedAt: event.publishedAt,
  };
}

function mergeCitations(existing: EventCitation[], incoming: EventCitation[]): EventCitation[] {
  const seen = new Map<string, EventCitation>();
  for (const citation of [...existing, ...incoming]) {
    const key = `${citation.sourceName}|${citation.canonicalUrl}`;
    if (!seen.has(key)) seen.set(key, citation);
  }
  return [...seen.values()].sort((a, b) => a.sourceName.localeCompare(b.sourceName));
}

function earliest(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

function latest(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/**
 * Combine two events describing the same condition.
 *
 * `primary` supplies the prose and identity; `secondary` widens the facts. The
 * time window is widened rather than intersected because an event corroborated
 * over a longer span is genuinely longer — narrowing it would understate the
 * period a reader should care about.
 */
export function mergeEvents(
  primary: EnrichedContextEvent,
  secondary: EnrichedContextEvent,
): EnrichedContextEvent {
  const pollutants = new Set<PollutantCode>([
    ...(primary.affectedPollutants ?? []),
    ...(secondary.affectedPollutants ?? []),
  ]);

  const scope =
    primary.geographicalScope && secondary.geographicalScope
      ? SCOPE_SPECIFICITY[primary.geographicalScope] >=
        SCOPE_SPECIFICITY[secondary.geographicalScope]
        ? primary.geographicalScope
        : secondary.geographicalScope
      : (primary.geographicalScope ?? secondary.geographicalScope);

  const startsAt = earliest(primary.startsAt, secondary.startsAt);
  const endsAt = latest(primary.endsAt, secondary.endsAt);

  return {
    ...primary,
    confidence:
      CONFIDENCE_RANK[secondary.confidence] > CONFIDENCE_RANK[primary.confidence]
        ? secondary.confidence
        : primary.confidence,
    // An event confirmed by measurement outranks one only modelled.
    observedOrForecast:
      primary.observedOrForecast === 'observed' || secondary.observedOrForecast === 'observed'
        ? 'observed'
        : 'forecast',
    ...(startsAt ? { startsAt } : {}),
    ...(endsAt ? { endsAt } : {}),
    publishedAt: earliest(primary.publishedAt, secondary.publishedAt) ?? primary.publishedAt,
    ...(pollutants.size > 0 ? { affectedPollutants: [...pollutants] } : {}),
    ...(scope ? { geographicalScope: scope } : {}),
    relevance: Math.max(primary.relevance, secondary.relevance),
    citations: mergeCitations(primary.citations, secondary.citations),
  };
}

/**
 * Collapse a list of events, preserving every citation.
 *
 * Order is preserved: the first occurrence of each distinct event keeps its
 * position, so a caller that has already sorted by relevance keeps that order.
 */
export function deduplicateEvents(events: EnrichedContextEvent[]): EnrichedContextEvent[] {
  const merged: EnrichedContextEvent[] = [];

  for (const event of events) {
    const seeded: EnrichedContextEvent =
      event.citations.length > 0 ? event : { ...event, citations: [citationOf(event)] };

    const index = merged.findIndex((candidate) => isDuplicate(candidate, seeded));
    if (index === -1) {
      merged.push(seeded);
      continue;
    }
    merged[index] = mergeEvents(merged[index], seeded);
  }

  return merged;
}

/**
 * Content fingerprint for an event.
 *
 * Used by the classifiers to mint ids that survive a refresh: the same
 * condition, detected again an hour later, must keep the same id so the UI does
 * not treat it as new. Hourly buckets are used rather than exact instants
 * because model output shifts a run's edges slightly between cycles.
 */
export function eventFingerprint(input: {
  type: EnvironmentalContextEventType;
  scope?: GeographicalScope;
  startsAt?: string;
  sourceName: string;
}): string {
  const bucket = input.startsAt
    ? new Date(Math.floor(Date.parse(input.startsAt) / 3_600_000) * 3_600_000).toISOString()
    : 'unbounded';
  return `${input.type}|${input.scope ?? 'unscoped'}|${bucket}|${input.sourceName}`;
}

/** `<type>-<hash>`: readable in logs, stable across refreshes. */
export function eventId(input: {
  type: EnvironmentalContextEventType;
  scope?: GeographicalScope;
  startsAt?: string;
  sourceName: string;
}): string {
  return `${input.type}-${stableHash(eventFingerprint(input))}`;
}
