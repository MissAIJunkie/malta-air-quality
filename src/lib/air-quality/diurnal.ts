/**
 * Observed daily shape, computed per station from its own history.
 *
 * ## Why this exists
 *
 * The five station pages were 65–88% textually identical to one another, with
 * chrome excluded. Everything on them that differed was the place name and a
 * handful of live numbers, because everything else was one template. That is
 * the shape of a machine-generated page, and it is a large part of why AdSense
 * classified the site as low value.
 *
 * A chart would not have fixed it: numbers drawn into an SVG client-side are
 * not text, and nothing reading the page for content sees them. What this
 * produces is a *sentence* — "nitrogen dioxide at Msida is typically highest
 * around 08:00 and lowest around 03:00" — derived from that station's own
 * measurements. Five stations with genuinely different daily rhythms then read
 * as five genuinely different pages, which they are.
 *
 * ## What it is allowed to use
 *
 * Measured hours only. Forecast points and modelled gap-fills are both
 * excluded, because this is presented as the station's observed behaviour and
 * folding model output into it would be exactly the substitution this project
 * refuses everywhere else. A profile with too few real hours behind it is not
 * reported at all rather than reported weakly.
 *
 * ## What it must never become
 *
 * This is a description of a sample, not a climatology. The upstream feed
 * carries roughly ten days of hourly history, and with no database configured
 * that is the whole window available. Ten days cannot describe a season, so
 * every value here travels with the sample size and the window that produced
 * it, and the wording on the page says "over the last N days" rather than
 * "typically in autumn".
 */

import type { PollutantCode } from '@/config/pollutants';
import type { HistoricalReading } from '@/lib/air-quality/types';
import { MaltaDate } from '@/lib/i18n';

/** Hours of real, measured data required before a profile is reported at all. */
export const MIN_OBSERVED_HOURS = 48;

/**
 * Distinct hours-of-day that must be covered before the peak and trough are
 * reported. A profile built from only the daytime hours would name a "lowest"
 * hour that is merely the earliest hour anyone happened to measure.
 */
export const MIN_COVERED_HOURS_OF_DAY = 18;

export type HourOfDayMean = {
  /** 0–23, Malta wall-clock time — not UTC. */
  hour: number;
  mean: number;
  samples: number;
};

export type DiurnalProfile = {
  pollutant: PollutantCode;
  /** One entry per hour-of-day that has at least one measured sample, ascending. */
  byHour: HourOfDayMean[];
  /** Total measured hours behind the whole profile. */
  samples: number;
  /** Span of the underlying window, in whole days, rounded up. */
  windowDays: number;
  peak: HourOfDayMean;
  trough: HourOfDayMean;
  /** Mean across every measured hour, regardless of hour-of-day. */
  overallMean: number;
  /**
   * `peak.mean / trough.mean`. How pronounced the daily cycle is, which is the
   * part that genuinely distinguishes a traffic site from a rural one: a
   * roadside nitrogen dioxide series swings hard, a regional dust signal
   * barely swings at all.
   */
  amplitudeRatio: number;
};

/**
 * Compute the observed daily shape of one pollutant at one station.
 *
 * Returns `null` — rather than a weak profile — when the sample cannot support
 * the claim: too few measured hours, too little coverage across the day, or a
 * trough of zero, which would make `amplitudeRatio` meaningless.
 */
export function diurnalProfile(
  history: readonly HistoricalReading[],
  pollutant: PollutantCode,
): DiurnalProfile | null {
  const sums = new Map<number, { total: number; count: number }>();
  let samples = 0;
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  let overallTotal = 0;

  for (const point of history) {
    // A forecast is not an observation, and a gap-fill is not a measurement.
    if (point.forecast) continue;

    const reading = point.pollutants[pollutant];
    if (!reading || reading.value === null || reading.modelled) continue;

    const at = new MaltaDate(point.measuredAt);
    const hour = at.getHours();
    if (!Number.isFinite(hour)) continue;

    const bucket = sums.get(hour) ?? { total: 0, count: 0 };
    bucket.total += reading.value;
    bucket.count += 1;
    sums.set(hour, bucket);

    samples += 1;
    overallTotal += reading.value;

    const ms = at.getTime();
    if (ms < earliest) earliest = ms;
    if (ms > latest) latest = ms;
  }

  if (samples < MIN_OBSERVED_HOURS) return null;
  if (sums.size < MIN_COVERED_HOURS_OF_DAY) return null;

  const byHour: HourOfDayMean[] = [...sums.entries()]
    .map(([hour, { total, count }]) => ({ hour, mean: total / count, samples: count }))
    .sort((a, b) => a.hour - b.hour);

  /*
   * Ties broken by the earlier hour, deliberately and consistently for both
   * ends. Two hours with an identical mean is common at a quiet station with
   * coarse values, and picking arbitrarily would make the sentence on the page
   * change between requests for no reason a reader could see.
   */
  const peak = byHour.reduce((best, entry) => (entry.mean > best.mean ? entry : best), byHour[0]!);
  const trough = byHour.reduce((low, entry) => (entry.mean < low.mean ? entry : low), byHour[0]!);

  if (trough.mean <= 0) return null;

  const spanMs = latest - earliest;
  const windowDays = Math.max(1, Math.ceil(spanMs / (24 * 60 * 60 * 1000)));

  return {
    pollutant,
    byHour,
    samples,
    windowDays,
    peak,
    trough,
    overallMean: overallTotal / samples,
    amplitudeRatio: peak.mean / trough.mean,
  };
}

/**
 * How pronounced a daily cycle is, as a word.
 *
 * Thresholds are deliberately coarse. The sample behind a profile is ten days
 * at best, which supports "pronounced" or "flat" and does not support a
 * sharper claim than that.
 */
export function describeAmplitude(ratio: number): 'flat' | 'moderate' | 'pronounced' {
  if (ratio < 1.5) return 'flat';
  if (ratio < 2.5) return 'moderate';
  return 'pronounced';
}

/** `7` → `07:00`, in Malta wall-clock time. */
export function formatHourOfDay(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}
