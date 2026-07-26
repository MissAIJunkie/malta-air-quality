/**
 * Builds the minimal, de-identified payload the model is allowed to see.
 *
 * Two jobs, both privacy-critical:
 *
 *   1. Send the LEAST data that still supports a useful explanation. Nothing
 *      about the person asking ever crosses the boundary — no IP, no session,
 *      no analytics id, no user agent, no free text they typed. The endpoint
 *      accepts a station id, so there is nothing personal to leak by
 *      construction; this module keeps it that way as the payload grows.
 *   2. Scrub anything personal that arrives from OUTSIDE maqua.app. Context
 *      events come from third-party feeds and may carry emails, addresses,
 *      tracking parameters or precise coordinates in their prose.
 *
 * Station coordinates are deliberately omitted even though they are public.
 * They add nothing to an explanation, and a model that has them will start
 * writing about "the site at 35.8955° N", which reads like surveillance and
 * invites the model to invent geography.
 *
 * The payload also carries the two allowlists the validator needs — the source
 * ids that may be cited and the numbers that may be quoted — so that "what the
 * model was told" and "what the model may say" are derived from one place and
 * cannot drift apart.
 */

import { POLLUTANTS, type PollutantCode } from '@/config/pollutants';
import { MALTA_TIMEZONE, findStation, type StationDefinition } from '@/config/stations';
import type { AirQualityCategory } from '@/config/thresholds';
import { PROMPT_VERSION } from '@/config/openrouter';
import { compareToThresholds } from '@/lib/air-quality/calculate-index';
import type { FreshnessState, ProviderSource, StationReading } from '@/lib/air-quality/types';
import type { ContextEvent, ExplanationLocale } from './schemas';

/* -------------------------------------------------------------------------- */
/*  Redaction                                                                 */
/* -------------------------------------------------------------------------- */

const REDACTED = '[removed]';

/**
 * Patterns stripped from every free-text field before it is sent anywhere.
 *
 * Order matters: URLs are cleaned before bare identifiers, so a tracking
 * parameter inside a link is caught as part of the link rather than left behind
 * as an orphaned fragment.
 */
const REDACTION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Email addresses.
  { pattern: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, replacement: REDACTED },
  // IPv4, including the ones hiding in a port suffix.
  { pattern: /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/g, replacement: REDACTED },
  // IPv6.
  { pattern: /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/gi, replacement: REDACTED },
  // UUID-shaped identifiers: session ids, analytics ids, device ids.
  {
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    replacement: REDACTED,
  },
  // Tracking and analytics query parameters.
  {
    pattern: /\b(?:utm_[a-z]+|gclid|fbclid|_ga|_gid|msclkid|mc_eid)=[^\s&"']+/gi,
    replacement: REDACTED,
  },
  // Decimal coordinate pairs at surveying precision.
  {
    pattern: /\b-?\d{1,3}\.\d{4,}\s*[,;]\s*-?\d{1,3}\.\d{4,}\b/g,
    replacement: REDACTED,
  },
  // Single coordinates written with a hemisphere, e.g. "35.8955° N".
  { pattern: /\b-?\d{1,3}\.\d{4,}\s*°\s*[NSEW]\b/gi, replacement: REDACTED },
  // Telephone numbers in international form.
  { pattern: /\+\d{1,3}[\s-]?\d{4,}/g, replacement: REDACTED },
];

/**
 * Strip personal and tracking data from a string.
 *
 * Conservative by design: it over-removes rather than risk a leak. A redacted
 * event headline is a small loss; a leaked address is not recoverable.
 */
export function redactText(input: string): string {
  let out = input;
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  // Collapse the whitespace the substitutions leave behind.
  return out.replace(/\s{2,}/g, ' ').trim();
}

/* -------------------------------------------------------------------------- */
/*  Payload shape                                                             */
/* -------------------------------------------------------------------------- */

export type ExplainSourceKind = 'station' | 'observation' | 'threshold' | 'event' | 'methodology';

export type ExplainSource = {
  id: string;
  kind: ExplainSourceKind;
  /** Human-readable description of what this id refers to. */
  label: string;
};

export type ExplainComparison = {
  sourceId: string;
  kind: 'eu-limit' | 'who-guideline';
  threshold: number;
  unit: string;
  averagingPeriod: string;
  reference: string;
  /**
   * Whether ONE hourly reading can establish a breach of this threshold.
   * False for every annual and 24-hour value — the model is told so explicitly.
   */
  conclusive: boolean;
};

export type ExplainPollutantFact = {
  sourceId: string;
  code: PollutantCode;
  label: string;
  value: number;
  unit: string;
  category: AirQualityCategory;
  averagingPeriod: string;
  /** Modelled or gap-filled rather than directly measured. */
  estimated: boolean;
  /** This pollutant determined the station's overall category. */
  dominant: boolean;
  /** Only thresholds this value is numerically above. */
  exceededThresholds: ExplainComparison[];
};

export type ExplainEventFact = {
  sourceId: string;
  kind: ContextEvent['kind'];
  headline: string;
  detail?: string;
  startsAt?: string;
  endsAt?: string;
  sourceName: string;
};

export type ExplainInput = {
  promptVersion: string;
  locale: ExplanationLocale;
  station: {
    sourceId: string;
    id: string;
    name: string;
    locality: string;
    island: 'Malta' | 'Gozo';
    /** Background / Traffic / Industrial — what the site is sited to measure. */
    stationType: string;
    areaClassification: string;
    operator: string;
  };
  reading: {
    measuredAt: string;
    /** Same instant rendered in Malta local time, for prose. */
    measuredAtLocal: string;
    timezone: typeof MALTA_TIMEZONE;
    ageHours: number;
    freshness: FreshnessState;
    provisional: boolean;
    partial: boolean;
    source: ProviderSource;
    overallCategory: AirQualityCategory | null;
    dominantPollutant: PollutantCode | null;
  };
  pollutants: ExplainPollutantFact[];
  /** Expected but not reported this hour. Never rendered as zero. */
  unavailablePollutants: Array<{ code: PollutantCode; label: string }>;
  events: ExplainEventFact[];
  /** Every id the model may cite. Anything else is rejected. */
  sources: ExplainSource[];
  sourceIds: string[];
  /**
   * Every number the model may quote.
   *
   * Explicit rather than derived by walking the payload: a walk would sweep up
   * the digits inside timestamps and quietly authorise most small integers,
   * which is exactly the range a fabricated concentration hides in.
   */
  numericAllowlist: number[];
  /** Categories named anywhere in the input. Naming any other contradicts the data. */
  allowedCategories: AirQualityCategory[];
  /**
   * True only when a single hourly reading genuinely crosses a single-hour
   * public-information threshold. Gates all exceedance language.
   */
  hasConclusiveExceedance: boolean;
};

/* -------------------------------------------------------------------------- */
/*  Construction                                                              */
/* -------------------------------------------------------------------------- */

function slugifyThreshold(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function pollutantSourceId(code: PollutantCode): string {
  return `obs.${POLLUTANTS[code].slug}`;
}

/**
 * Malta-local rendering of an instant.
 *
 * Uses `Intl` directly rather than the i18n formatter: this string goes to a
 * model, not to a screen, so it must not depend on the presentation layer's
 * locale or its load order.
 */
function formatMaltaLocal(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown time';

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: MALTA_TIMEZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/** Numbers appearing in a specific, bounded string — timestamps and nothing else. */
function numbersIn(text: string): number[] {
  const matches = text.match(/\d+(?:\.\d+)?/g);
  if (!matches) return [];
  return matches.map(Number).filter(Number.isFinite);
}

export type BuildExplainInputOptions = {
  locale?: ExplanationLocale;
  /** Third-party context. Redacted here; there is no trusted producer. */
  events?: ContextEvent[];
  /** Overrides the station lookup, for tests and for stations not in the registry. */
  station?: StationDefinition;
};

/**
 * Assemble the model payload from a deterministic reading.
 *
 * Everything here is already computed: categories come from
 * `calculate-index.ts`, freshness from `freshness.ts`, thresholds from
 * `config/thresholds.ts`. The model is given conclusions, never asked to reach
 * them — which is why a wrong or missing model response can always be replaced
 * by the deterministic fallback without changing a single fact.
 */
export function buildExplainInput(
  reading: StationReading,
  options: BuildExplainInputOptions = {},
): ExplainInput {
  const locale = options.locale ?? 'en';
  const station = options.station ?? findStation(reading.stationId);

  const sources: ExplainSource[] = [];
  const numbers = new Set<number>();
  const categories = new Set<AirQualityCategory>();

  const addNumber = (value: number | null | undefined) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return;
    numbers.add(value);
    numbers.add(Math.round(value));
  };

  const stationSourceId = `station.${station?.slug ?? reading.stationId.toLowerCase()}`;
  sources.push({
    id: stationSourceId,
    kind: 'station',
    label: `${station?.name ?? reading.stationId} monitoring station, operated by ERA`,
  });
  sources.push({
    id: 'method.european-aqi',
    kind: 'methodology',
    label: 'European Air Quality Index band definitions (European Environment Agency)',
  });

  /* Pollutants -------------------------------------------------------------- */

  const pollutants: ExplainPollutantFact[] = [];
  const unavailable: Array<{ code: PollutantCode; label: string }> = [];
  let hasConclusiveExceedance = false;

  const expected = new Set<PollutantCode>([
    ...(station?.expectedPollutants ?? []),
    ...(Object.keys(reading.pollutants) as PollutantCode[]),
  ]);

  for (const code of expected) {
    const measurement = reading.pollutants[code];
    const definition = POLLUTANTS[code];

    // A null value is an absence of information. It is listed as unavailable and
    // never given a number — the single rule this whole layer exists to protect.
    if (!measurement || measurement.value === null || measurement.category === null) {
      unavailable.push({ code, label: definition.label });
      continue;
    }

    const sourceId = pollutantSourceId(code);
    const exceeded: ExplainComparison[] = [];

    for (const comparison of compareToThresholds(code, measurement.value)) {
      if (!comparison.above) continue;
      const thresholdSourceId = `threshold.${definition.slug}.${slugifyThreshold(
        `${comparison.kind}-${comparison.averagingPeriod}-${comparison.threshold}`,
      )}`;

      exceeded.push({
        sourceId: thresholdSourceId,
        kind: comparison.kind,
        threshold: comparison.threshold,
        unit: comparison.unit,
        averagingPeriod: comparison.averagingPeriod,
        reference: comparison.reference,
        conclusive: comparison.conclusive,
      });

      sources.push({
        id: thresholdSourceId,
        kind: 'threshold',
        label: `${definition.label} ${comparison.averagingPeriod} ${
          comparison.kind === 'eu-limit' ? 'EU limit value' : 'WHO guideline'
        } of ${comparison.threshold} ${comparison.unit} (${comparison.reference})`,
      });

      addNumber(comparison.threshold);
      // "24 hours" and "8-hour mean" are quoted verbatim in honest phrasing, so
      // the digits inside an averaging period are authorised alongside the
      // threshold itself.
      for (const value of numbersIn(comparison.averagingPeriod)) numbers.add(value);
      if (comparison.conclusive) hasConclusiveExceedance = true;
    }

    sources.push({
      id: sourceId,
      kind: 'observation',
      label: `${definition.label} measurement at ${station?.name ?? reading.stationId} for ${reading.measuredAt}`,
    });

    addNumber(measurement.value);
    categories.add(measurement.category);

    pollutants.push({
      sourceId,
      code,
      label: definition.label,
      value: measurement.value,
      unit: measurement.unit,
      category: measurement.category,
      averagingPeriod: measurement.averagingPeriod,
      estimated: measurement.modelled,
      dominant: reading.dominantPollutant === code,
      exceededThresholds: exceeded.slice(0, 3),
    });
  }

  // Worst first: the pollutant that decided the category should lead the prose.
  pollutants.sort((a, b) => Number(b.dominant) - Number(a.dominant) || b.value - a.value);

  if (reading.overallCategory) categories.add(reading.overallCategory);

  /* Events ------------------------------------------------------------------ */

  const events: ExplainEventFact[] = (options.events ?? []).slice(0, 5).map((event) => {
    const sourceId = `event.${event.id}`;
    sources.push({
      id: sourceId,
      kind: 'event',
      label: redactText(`${event.headline} (${event.sourceName})`),
    });

    return {
      sourceId,
      kind: event.kind,
      headline: redactText(event.headline),
      ...(event.detail ? { detail: redactText(event.detail) } : {}),
      ...(event.startsAt ? { startsAt: event.startsAt } : {}),
      ...(event.endsAt ? { endsAt: event.endsAt } : {}),
      sourceName: redactText(event.sourceName),
    };
  });

  /* Timestamps and counts --------------------------------------------------- */

  const measuredAtLocal = formatMaltaLocal(reading.measuredAt);
  // The model will legitimately quote the hour, the date and the age of the
  // reading, so those digits are authorised explicitly.
  for (const value of numbersIn(measuredAtLocal)) numbers.add(value);
  for (const value of numbersIn(reading.measuredAt)) numbers.add(value);
  addNumber(reading.ageHours);
  addNumber(pollutants.length);
  addNumber(unavailable.length);

  return {
    promptVersion: PROMPT_VERSION,
    locale,
    station: {
      sourceId: stationSourceId,
      id: reading.stationId,
      name: station?.name ?? reading.stationId,
      locality: station?.locality ?? 'Malta',
      island: station?.island ?? 'Malta',
      stationType: station?.stationType ?? 'Unknown',
      areaClassification: station?.areaClassification ?? 'Unknown',
      operator: station?.operator ?? 'Environment & Resources Authority (ERA)',
    },
    reading: {
      measuredAt: reading.measuredAt,
      measuredAtLocal,
      timezone: MALTA_TIMEZONE,
      ageHours: reading.ageHours,
      freshness: reading.freshness,
      provisional: reading.provisional,
      partial: reading.partial,
      source: reading.source,
      overallCategory: reading.overallCategory,
      dominantPollutant: reading.dominantPollutant,
    },
    pollutants,
    unavailablePollutants: unavailable,
    events,
    sources,
    sourceIds: sources.map((s) => s.id),
    numericAllowlist: [...numbers],
    allowedCategories: [...categories],
    hasConclusiveExceedance,
  };
}
