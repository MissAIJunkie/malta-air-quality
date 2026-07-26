/**
 * Relevance to Malta and Gozo.
 *
 * The context list is short and sits beside a health-relevant number, so its
 * job is to surface the two or three conditions a reader here should actually
 * know about. Everything else is noise competing for the same attention.
 *
 * Four factors, each bounded, combined by weighted sum:
 *
 *   - **Geography** — does this describe the islands, the sea around them, or
 *     somewhere further off?
 *   - **Time** — is it happening now, soon, or already over?
 *   - **Confidence** — how firmly does the source state it?
 *   - **Consequence** — a condition that may worsen air quality is more
 *     actionable than one that may improve it.
 *
 * Pure and deterministic: `now` is a parameter and nothing here fetches.
 * Relevance ranks events; it never alters them, and it never touches a
 * measurement.
 */

import { foldForComparison } from './deduplicate';
import type {
  ContextConfidence,
  EnrichedContextEvent,
  EnvironmentalContextEvent,
  EnvironmentalContextEventType,
  GeographicalScope,
  ImpactDirection,
} from './types';

/** Factor weights. They sum to 1, so the score is directly a 0–1 fraction. */
export const RELEVANCE_WEIGHTS = {
  geography: 0.4,
  temporal: 0.3,
  confidence: 0.2,
  consequence: 0.1,
} as const;

/**
 * Below this, an event is not shown by default.
 *
 * Set so that a low-confidence, regional-scope condition several days away
 * falls out, while a merely uncertain local one survives — under-reporting a
 * nearby dust plume is the worse error.
 */
export const RELEVANCE_THRESHOLD = 0.35;

const GEOGRAPHY_SCORE: Record<GeographicalScope, number> = {
  Malta: 1,
  Gozo: 1,
  'Maltese Islands': 1,
  // Malta is 80 km from Sicily and 290 km from Tunisia; conditions over the
  // surrounding sea reach the islands routinely, so this is high, not marginal.
  'Central Mediterranean': 0.75,
  Regional: 0.45,
};

const CONFIDENCE_SCORE: Record<ContextConfidence, number> = {
  high: 1,
  medium: 0.65,
  low: 0.35,
};

const CONSEQUENCE_SCORE: Record<ImpactDirection, number> = {
  worsening: 1,
  unclear: 0.6,
  improving: 0.5,
  neutral: 0.3,
};

/**
 * Types that matter disproportionately here.
 *
 * Not a general ranking of severity — a modifier for local geography. Malta is
 * on the Saharan dust track, is surrounded by sea on every side, and has one of
 * the densest road networks in the EU, so dust, marine aerosol and
 * dispersion-limiting conditions carry extra weight.
 *
 * It is applied to the geography and consequence terms only, deliberately. Type
 * says something about *what a thing is and where it matters*; it says nothing
 * about whether a particular forecast is near in time or firmly stated. Letting
 * it scale those too would let "it is dust" promote a low-confidence plume
 * three days out past the display threshold — which is precisely the noise the
 * threshold exists to remove.
 */
const TYPE_MODIFIER: Partial<Record<EnvironmentalContextEventType, number>> = {
  saharan_dust: 1.15,
  temperature_inversion: 1.1,
  low_wind: 1.1,
  ozone_risk: 1.05,
  sea_salt: 0.95,
  regional_pollution: 0.95,
  heavy_rain: 0.9,
};

/** Hours after which a finished event carries no further relevance. */
export const RELEVANCE_PAST_HORIZON_HOURS = 12;
/** Hours ahead beyond which an event is too distant to lead with. */
export const RELEVANCE_FUTURE_HORIZON_HOURS = 72;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Proximity of an event's window to now, in [0, 1].
 *
 * An event under way scores 1. One that has ended decays over
 * `RELEVANCE_PAST_HORIZON_HOURS`; one still ahead decays over
 * `RELEVANCE_FUTURE_HORIZON_HOURS`. The past decays faster on purpose: a dust
 * plume that cleared last night still explains yesterday's chart, but it is no
 * longer something to plan around.
 */
export function temporalRelevance(event: EnvironmentalContextEvent, nowIso: string): number {
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) return 0;

  const start = event.startsAt ? Date.parse(event.startsAt) : Date.parse(event.publishedAt);
  if (!Number.isFinite(start)) return 0;

  const end = event.endsAt ? Date.parse(event.endsAt) : start;
  const finish = Number.isFinite(end) ? Math.max(start, end) : start;

  if (now >= start && now <= finish) return 1;

  if (now > finish) {
    const hoursSince = (now - finish) / 3_600_000;
    return clamp01(1 - hoursSince / RELEVANCE_PAST_HORIZON_HOURS);
  }

  const hoursUntil = (start - now) / 3_600_000;
  return clamp01(1 - hoursUntil / RELEVANCE_FUTURE_HORIZON_HOURS);
}

/**
 * Whether free text refers to the Maltese Islands.
 *
 * Used for sources that carry no structured geography — a regional bulletin
 * naming Malta in its body is more relevant than one that does not. Matching is
 * word-bounded so "Malta" does not match "Maltase".
 *
 * Folding goes through `foldForComparison`, shared with the deduplicator. NFD
 * alone is not enough: ħ has no canonical decomposition, so "Għawdex" would
 * never reach the `ghawdex` alternative below and a Maltese-language bulletin
 * about Gozo would score as unplaceable.
 */
export function mentionsMaltaOrGozo(text: string): boolean {
  return /\b(malta|maltese|gozo|ghawdex|comino|kemmuna|valletta)\b/.test(foldForComparison(text));
}

/**
 * Geographic relevance, in [0, 1].
 *
 * Falls back to a text scan when `geographicalScope` is absent, and to a
 * cautious 0.5 when neither signal exists — an unplaceable event is neither
 * promoted nor silently discarded.
 */
export function geographicRelevance(event: EnvironmentalContextEvent): number {
  if (event.geographicalScope) return GEOGRAPHY_SCORE[event.geographicalScope];
  if (mentionsMaltaOrGozo(`${event.title} ${event.summary}`)) return 0.85;
  return 0.5;
}

export type RelevanceBreakdown = {
  score: number;
  geography: number;
  temporal: number;
  confidence: number;
  consequence: number;
  typeModifier: number;
};

/**
 * Score one event, returning the components as well as the total.
 *
 * The breakdown is returned because an opaque ranking is not reviewable: when
 * the wrong event leads the list, this is what makes the reason visible.
 */
export function scoreRelevance(
  event: EnvironmentalContextEvent,
  nowIso: string,
): RelevanceBreakdown {
  const geography = geographicRelevance(event);
  const temporal = temporalRelevance(event, nowIso);
  const confidence = CONFIDENCE_SCORE[event.confidence];
  const consequence = CONSEQUENCE_SCORE[event.impactDirection];
  const typeModifier = TYPE_MODIFIER[event.type] ?? 1;

  // Only the "what and where" half is modified by type; see TYPE_MODIFIER.
  const placed =
    (geography * RELEVANCE_WEIGHTS.geography + consequence * RELEVANCE_WEIGHTS.consequence) *
    typeModifier;

  const stated = temporal * RELEVANCE_WEIGHTS.temporal + confidence * RELEVANCE_WEIGHTS.confidence;

  return {
    score: clamp01(placed + stated),
    geography,
    temporal,
    confidence,
    consequence,
    typeModifier,
  };
}

/** Attach a score to each event. Does not sort or filter. */
export function withRelevance(
  events: EnrichedContextEvent[],
  nowIso: string,
): EnrichedContextEvent[] {
  return events.map((event) => ({ ...event, relevance: scoreRelevance(event, nowIso).score }));
}

export function isRelevantToMalta(
  event: EnvironmentalContextEvent,
  nowIso: string,
  threshold = RELEVANCE_THRESHOLD,
): boolean {
  return scoreRelevance(event, nowIso).score >= threshold;
}

/**
 * Rank by relevance, most relevant first.
 *
 * Ties break on event id so the order is stable across refreshes — a list that
 * reshuffles between two identical fetches looks broken.
 */
export function rankByRelevance(events: EnrichedContextEvent[]): EnrichedContextEvent[] {
  return [...events].sort((a, b) =>
    b.relevance === a.relevance ? a.id.localeCompare(b.id) : b.relevance - a.relevance,
  );
}
