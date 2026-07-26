/**
 * The pollutant filter's value, and the rules for resolving it.
 *
 * Deliberately a plain module rather than part of `pollutant-filter.tsx`: that
 * file is a client component, and every export of a `'use client'` module
 * becomes a client reference, so a server component could not call these
 * functions. The map, the station list and the filter itself all need them, and
 * only one of those is a client component.
 */

import { POLLUTANT_CODES, type PollutantCode } from '@/config/pollutants';
import type { AirQualityCategory } from '@/config/thresholds';
import type { PollutantReading, StationReading } from '@/lib/air-quality/types';

/** The "no single pollutant" option: colour by the station's overall band. */
export const OVERALL_FILTER = 'overall';

export type PollutantFilterValue = typeof OVERALL_FILTER | PollutantCode;

export function isPollutantFilterValue(value: unknown): value is PollutantFilterValue {
  return (
    value === OVERALL_FILTER ||
    (typeof value === 'string' && (POLLUTANT_CODES as readonly string[]).includes(value))
  );
}

/**
 * The reading a filter selects, or `null` when the station did not report it.
 *
 * `null` is returned both when the pollutant is absent from the payload and
 * when it is present without a value. Callers must render either case as
 * unavailable — never as zero and never as the station's overall band.
 */
export function pollutantReadingFor(
  reading: StationReading | null | undefined,
  pollutant: PollutantCode,
): PollutantReading | null {
  return reading?.pollutants[pollutant] ?? null;
}

/**
 * The category a filtered view should colour by.
 *
 * Under a pollutant filter this is that pollutant's own category, never the
 * station's overall band — showing the overall colour while a filter is active
 * would attribute one pollutant's severity to another.
 */
export function categoryForFilter(
  reading: StationReading | null | undefined,
  filter: PollutantFilterValue,
): AirQualityCategory | null {
  if (!reading) return null;
  if (filter === OVERALL_FILTER) return reading.overallCategory;
  return pollutantReadingFor(reading, filter)?.category ?? null;
}

/** The continuous sub-index matching `categoryForFilter`. `null` when absent. */
export function subIndexForFilter(
  reading: StationReading | null | undefined,
  filter: PollutantFilterValue,
): number | null {
  if (!reading) return null;
  if (filter === OVERALL_FILTER) return reading.overallSubIndex;
  return pollutantReadingFor(reading, filter)?.subIndex ?? null;
}

/**
 * Pollutants that at least one station actually reported a value for.
 *
 * Drives which filter options are offered. A pollutant present in the payload
 * with `value: null` everywhere does not count: there would be nothing to
 * colour by, so the option is disabled and says why.
 */
export function availablePollutants(readings: readonly StationReading[]): PollutantCode[] {
  return POLLUTANT_CODES.filter((code) =>
    readings.some((reading) => {
      const pollutant = reading.pollutants[code];
      return pollutant !== undefined && pollutant.value !== null;
    }),
  );
}
