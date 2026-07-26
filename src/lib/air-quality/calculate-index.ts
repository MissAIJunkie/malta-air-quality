/**
 * European Air Quality Index calculation.
 *
 * Deterministic and pure. No AI, no network, no clock. Every number comes from
 * `src/config/thresholds.ts`.
 *
 * The two rules that matter most, both from the brief's engineering rules:
 *   - A missing value is never treated as zero.
 *   - A station's overall category is the WORST of its reported pollutants.
 */

import { POLLUTANTS, type PollutantCode } from '@/config/pollutants';
import {
  AQI_BREAKPOINTS,
  BAND_ID_TO_CATEGORY,
  EU_LIMIT_VALUES,
  SUB_INDEX_FRACTION_CAP,
  WHO_GUIDELINES,
  categoryRank,
  type AirQualityCategory,
  type Breakpoint,
} from '@/config/thresholds';
import type { PollutantReading } from './types';

/**
 * Continuous sub-index for one concentration.
 *
 * Implements the European AQI exactly as the EEA computes it:
 *
 *   1. Round the concentration to the nearest whole µg/m³.
 *   2. Find the band whose inclusive integer range contains it.
 *   3. `subIndex = bandId + min(0.99, max(0, (v - lo) / (hi - lo)))`.
 *
 * The rounding in step 1 is not cosmetic — it decides the category for any value
 * within half a unit of a boundary. The 0.99 cap in step 3 keeps
 * `Math.floor(subIndex)` inside the correct band when a value lands exactly on a
 * ceiling.
 *
 * Verified against all 6,760 observed Malta (concentration, sub-index) pairs
 * with zero mismatches (docs/AQI_METHODOLOGY.md §3).
 *
 * @returns `null` for missing, non-finite, or negative input — never 0.
 */
export function calculateSubIndex(pollutant: PollutantCode, value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;

  const rounded = Math.round(value);

  // Analysers routinely report small negative concentrations when a pollutant is
  // near or below the detection limit — SO2 at Għarb produces values like
  // -0.02 µg/m³. Rounded, those are 0: a genuine measurement of very clean air,
  // and the upstream classifies them as Good. A value that rounds to a negative
  // whole number is a different thing entirely — an instrument fault, not a
  // measurement — and is rejected rather than flattered into Good.
  if (rounded < 0) return null;
  const { breakpoints } = AQI_BREAKPOINTS[pollutant];

  for (const bp of breakpoints) {
    if (rounded > bp.max) continue;

    const span = bp.max - bp.min;
    if (span <= 0) return bp.bandId;

    const fraction = (rounded - bp.min) / span;
    return bp.bandId + Math.min(SUB_INDEX_FRACTION_CAP, Math.max(0, fraction));
  }

  // Above the top band's ceiling: saturate at the worst category rather than
  // extrapolating off the published scale.
  const top = breakpoints[breakpoints.length - 1];
  return top.bandId + SUB_INDEX_FRACTION_CAP;
}

/** Category for one concentration. `null` when unavailable. */
export function calculateCategory(
  pollutant: PollutantCode,
  value: number | null | undefined,
): AirQualityCategory | null {
  const subIndex = calculateSubIndex(pollutant, value);
  if (subIndex === null) return null;
  return BAND_ID_TO_CATEGORY[Math.floor(subIndex)] ?? null;
}

/**
 * Category from an upstream continuous sub-index, using the upstream's own
 * rule (`BandId = Math.floor(aqi)`). Band 0 means "no index", not "Good".
 */
export function categoryFromSubIndex(subIndex: number | null | undefined): AirQualityCategory | null {
  if (subIndex === null || subIndex === undefined) return null;
  if (!Number.isFinite(subIndex) || subIndex < 1) return null;
  return BAND_ID_TO_CATEGORY[Math.floor(subIndex)] ?? null;
}

/** Build a normalised reading. Returns a reading with `value: null` when absent. */
export function buildPollutantReading(
  pollutant: PollutantCode,
  value: number | null | undefined,
  options: { modelled?: boolean } = {},
): PollutantReading {
  const thresholds = AQI_BREAKPOINTS[pollutant];
  const finite = value === null || value === undefined || !Number.isFinite(value) ? null : value;
  const subIndex = calculateSubIndex(pollutant, finite);
  // A finite number we could not classify is an implausible reading, not a
  // measurement — surface it as missing rather than printing a bogus figure.
  const normalised = subIndex === null ? null : finite;

  return {
    pollutant,
    value: normalised,
    unit: thresholds.unit,
    category: subIndex === null ? null : (BAND_ID_TO_CATEGORY[Math.floor(subIndex)] ?? null),
    subIndex,
    averagingPeriod: thresholds.averagingPeriod,
    thresholdReference: thresholds.reference,
    modelled: options.modelled ?? false,
  };
}

export type OverallResult = {
  category: AirQualityCategory | null;
  subIndex: number | null;
  dominantPollutant: PollutantCode | null;
};

/**
 * Overall station result: the worst reported pollutant wins.
 *
 * Pollutants without a value are skipped entirely — they neither improve nor
 * worsen the result. If nothing is reportable the result is `null` throughout,
 * which the UI renders as "no data" rather than as a category.
 *
 * Ties are broken by the higher continuous sub-index, then by a stable
 * pollutant ordering, so the dominant pollutant never flickers between equals.
 */
export function calculateOverall(
  readings: Partial<Record<PollutantCode, PollutantReading>>,
): OverallResult {
  let best: { code: PollutantCode; reading: PollutantReading } | null = null;

  for (const code of Object.keys(POLLUTANTS) as PollutantCode[]) {
    const reading = readings[code];
    if (!reading || reading.category === null || reading.subIndex === null) continue;

    if (best === null) {
      best = { code, reading };
      continue;
    }

    const bestCat = best.reading.category as AirQualityCategory;
    const rankDelta = categoryRank(reading.category) - categoryRank(bestCat);
    if (rankDelta > 0) {
      best = { code, reading };
      continue;
    }
    if (rankDelta === 0) {
      const bestSub = best.reading.subIndex ?? 0;
      if ((reading.subIndex ?? 0) > bestSub) best = { code, reading };
    }
  }

  if (!best) return { category: null, subIndex: null, dominantPollutant: null };

  return {
    category: best.reading.category,
    subIndex: best.reading.subIndex,
    dominantPollutant: best.code,
  };
}

/* -------------------------------------------------------------------------- */
/*  Limit and guideline comparison                                            */
/* -------------------------------------------------------------------------- */

export type ThresholdComparison = {
  pollutant: PollutantCode;
  value: number;
  threshold: number;
  unit: string;
  averagingPeriod: string;
  reference: string;
  kind: 'eu-limit' | 'who-guideline';
  /** The reading is numerically above the threshold value. */
  above: boolean;
  /**
   * Whether a single hourly reading can establish a breach at all.
   *
   * False for every long-averaging limit. The UI must phrase those as "above
   * the level of the annual limit value" — an observation about one hour — and
   * never as a legal exceedance.
   */
  conclusive: boolean;
};

/**
 * Compare a reading against EU limits and WHO guidelines.
 *
 * This deliberately does NOT return a verdict. It returns facts plus the
 * `conclusive` flag, leaving the caller to phrase things correctly. Conflating
 * a single hourly value with an annual legal limit is one of the explicit
 * failure modes the brief forbids.
 */
export function compareToThresholds(
  pollutant: PollutantCode,
  value: number | null,
): ThresholdComparison[] {
  if (value === null || !Number.isFinite(value)) return [];

  const out: ThresholdComparison[] = [];

  for (const limit of EU_LIMIT_VALUES) {
    if (limit.pollutant !== pollutant) continue;
    out.push({
      pollutant,
      value,
      threshold: limit.value,
      unit: limit.unit,
      averagingPeriod: limit.averagingPeriod,
      reference: limit.reference,
      kind: 'eu-limit',
      above: value > limit.value,
      conclusive: limit.assessableFromSingleReading,
    });
  }

  for (const guideline of WHO_GUIDELINES) {
    if (guideline.pollutant !== pollutant) continue;
    out.push({
      pollutant,
      value,
      threshold: guideline.value,
      unit: guideline.unit,
      averagingPeriod: guideline.averagingPeriod,
      reference: guideline.reference,
      kind: 'who-guideline',
      above: value > guideline.value,
      conclusive: guideline.assessableFromSingleReading,
    });
  }

  return out;
}

/**
 * Single-hour thresholds that genuinely warrant immediate public information —
 * currently only the ozone information and alert thresholds.
 */
export function findConclusiveExceedances(
  pollutant: PollutantCode,
  value: number | null,
): ThresholdComparison[] {
  return compareToThresholds(pollutant, value).filter((c) => c.above && c.conclusive);
}

export function breakpointsFor(pollutant: PollutantCode): Breakpoint[] {
  return AQI_BREAKPOINTS[pollutant].breakpoints;
}
