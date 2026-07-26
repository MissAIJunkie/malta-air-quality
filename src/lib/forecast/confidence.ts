/**
 * Forecast confidence.
 *
 * A band, not a probability. Nobody has verified CAMS skill over Malta against
 * ERA's stations, so publishing "78 % confident" would imply a calibration this
 * project has not done. Three bands, each with a stated reason, are honest
 * about what is actually known.
 *
 * The horizon tiers follow the shape of chemical-transport-model skill rather
 * than taste: the first half-day is largely determined by the initial state and
 * by conditions already in place; skill then falls off through the second day
 * as the meteorology driving dispersion becomes the dominant uncertainty.
 *
 * On top of the horizon, confidence degrades when the *inputs* are thin:
 *   - few forecast hours published,
 *   - the station is reporting only some of its pollutants,
 *   - the modelled hours cover only part of the pollutant set.
 *
 * Pure, clock-injectable and free of imports beyond its own types, so it is
 * directly unit-testable.
 */

import type { ForecastConfidence } from './types';

export const FORECAST_HORIZONS = {
  /** Roughly the next half-day. */
  highMaxHours: 12,
  /** Out to a day and a half. */
  mediumMaxHours: 36,
} as const;

/**
 * Fewer published hours than this counts as a sparse series.
 *
 * Six hours is the point below which the outlook stops being a plan for the day
 * and becomes a note about the next few hours.
 */
export const MIN_DENSE_FORECAST_HOURS = 6;

/** Below this fraction of the expected span, coverage is treated as thin. */
export const MIN_HORIZON_COVERAGE = 0.25;

/** Below this fraction of a station's pollutants, the picture is incomplete. */
export const MIN_POLLUTANT_COVERAGE = 0.5;

const ORDER: ForecastConfidence[] = ['high', 'medium', 'low'];

/** Hours between two instants. `null` when either cannot be parsed. */
export function horizonHours(forecastAtIso: string, referenceIso: string): number | null {
  const target = Date.parse(forecastAtIso);
  const reference = Date.parse(referenceIso);
  if (!Number.isFinite(target) || !Number.isFinite(reference)) return null;
  return (target - reference) / 3_600_000;
}

/**
 * Confidence from lead time alone.
 *
 * An unknown horizon is `low`, never `high`: an unparseable timestamp must fail
 * safe. A horizon in the past is treated as immediate — a forecast hour that
 * has already arrived is as well determined as this method gets.
 */
export function confidenceForHorizon(hours: number | null): ForecastConfidence {
  if (hours === null || !Number.isFinite(hours)) return 'low';
  const lead = Math.max(0, hours);
  if (lead <= FORECAST_HORIZONS.highMaxHours) return 'high';
  if (lead <= FORECAST_HORIZONS.mediumMaxHours) return 'medium';
  return 'low';
}

/** Move `steps` bands towards `low`. Never goes below it. */
export function degradeConfidence(confidence: ForecastConfidence, steps = 1): ForecastConfidence {
  if (steps <= 0) return confidence;
  const index = Math.min(ORDER.length - 1, ORDER.indexOf(confidence) + steps);
  return ORDER[index];
}

/** The least confident of a set — a summary must not flatter its parts. */
export function worstConfidence(levels: ForecastConfidence[]): ForecastConfidence {
  let worst: ForecastConfidence = 'high';
  for (const level of levels) {
    if (ORDER.indexOf(level) > ORDER.indexOf(worst)) worst = level;
  }
  return worst;
}

export type ConfidenceInputs = {
  /** Lead time in hours, or `null` when it cannot be determined. */
  horizonHours: number | null;
  /** Forecast hours actually published. */
  availableHours: number;
  /** Hours the upstream normally publishes — the denominator for coverage. */
  expectedHours: number;
  /** True when the station is not reporting all the pollutants it usually does. */
  stationPartial: boolean;
  /** Fraction of the station's expected pollutants present in the modelled hours, 0–1. */
  pollutantCoverage: number;
  /**
   * True when every published forecast hour already lies in the past.
   *
   * Real failure mode, not a theoretical one: if a station stops reporting, the
   * newest measured hour stops advancing and the modelled hours behind it
   * gradually age out of relevance. An outlook made entirely of hours that have
   * already happened is not an outlook, and must say so.
   */
  fullyElapsed?: boolean;
};

export type ConfidenceAssessment = {
  confidence: ForecastConfidence;
  /** Plain-English reasons, in the order they were applied. */
  reasons: string[];
  /** Matching i18n keys; see the note on dual emission in `types.ts`. */
  reasonKeys: string[];
};

/**
 * Assess confidence from lead time and input quality.
 *
 * Degradations accumulate, so a 40-hour forecast from a partially reporting
 * station with a two-hour series lands firmly at `low` rather than being
 * rescued by any single favourable factor.
 */
export function assessConfidence(inputs: ConfidenceInputs): ConfidenceAssessment {
  const base = confidenceForHorizon(inputs.horizonHours);
  const reasons: string[] = [];
  const reasonKeys: string[] = [];

  const lead = inputs.horizonHours === null ? null : Math.max(0, Math.round(inputs.horizonHours));
  if (lead === null) {
    reasons.push('The lead time for this forecast could not be determined.');
    reasonKeys.push('forecast.confidence.reason.unknownHorizon');
  } else if (lead === 0) {
    reasons.push('Describes the current hour, where the official model is most reliable.');
    reasonKeys.push('forecast.confidence.reason.currentHour');
  } else if (base === 'high') {
    reasons.push(
      `Covers roughly the next ${lead === 1 ? 'hour' : `${lead} hours`}, where the official model is most reliable.`,
    );
    reasonKeys.push('forecast.confidence.reason.shortLead');
  } else if (base === 'medium') {
    reasons.push(`Looks ${lead} hours ahead, where the official model becomes less certain.`);
    reasonKeys.push('forecast.confidence.reason.mediumLead');
  } else {
    reasons.push(`Looks ${lead} hours ahead, beyond the range where this model is dependable.`);
    reasonKeys.push('forecast.confidence.reason.longLead');
  }

  let steps = 0;

  if (inputs.fullyElapsed) {
    // Two steps, not one: this is not a thin forecast, it is not a forecast.
    steps += 2;
    reasons.push(
      'Every published forecast hour has already passed. This outlook has not been refreshed upstream.',
    );
    reasonKeys.push('forecast.confidence.reason.elapsed');
  }

  if (inputs.availableHours < MIN_DENSE_FORECAST_HOURS) {
    steps += 1;
    reasons.push(
      `Only ${inputs.availableHours} forecast ${inputs.availableHours === 1 ? 'hour has' : 'hours have'} been published for this station.`,
    );
    reasonKeys.push('forecast.confidence.reason.fewHours');
  } else if (
    inputs.expectedHours > 0 &&
    inputs.availableHours / inputs.expectedHours < MIN_HORIZON_COVERAGE
  ) {
    steps += 1;
    reasons.push('The published forecast covers only part of the usual outlook period.');
    reasonKeys.push('forecast.confidence.reason.shortSeries');
  }

  if (inputs.stationPartial) {
    steps += 1;
    reasons.push(
      'This station is currently measuring only some of the pollutants it normally reports.',
    );
    reasonKeys.push('forecast.confidence.reason.partialStation');
  }

  if (inputs.pollutantCoverage < MIN_POLLUTANT_COVERAGE) {
    steps += 1;
    reasons.push('The forecast covers fewer pollutants than this station normally measures.');
    reasonKeys.push('forecast.confidence.reason.thinPollutantCoverage');
  }

  return { confidence: degradeConfidence(base, steps), reasons, reasonKeys };
}

/** Keys `assessConfidence` can emit. Exported so the dictionary can be completed. */
export const FORECAST_CONFIDENCE_I18N_KEYS: readonly string[] = [
  'forecast.confidence.reason.unknownHorizon',
  'forecast.confidence.reason.currentHour',
  'forecast.confidence.reason.elapsed',
  'forecast.confidence.reason.shortLead',
  'forecast.confidence.reason.mediumLead',
  'forecast.confidence.reason.longLead',
  'forecast.confidence.reason.fewHours',
  'forecast.confidence.reason.shortSeries',
  'forecast.confidence.reason.partialStation',
  'forecast.confidence.reason.thinPollutantCoverage',
];
