/**
 * Freshness classification.
 *
 * Thresholds derive from the OBSERVED upstream cadence, not from taste: the
 * EEA dissemination layer republishes hourly, with a ~51-minute publication lag
 * measured on 2026-07-26 (docs/DATA_SOURCE.md §6). So a reading up to two hours
 * old is simply normal operation, not a fault.
 *
 * Pure and clock-injectable — `now` is always a parameter so tests never depend
 * on wall time.
 */

import type { FreshnessState } from './types';

export const FRESHNESS_THRESHOLDS = {
  /** Normal operation given hourly publication plus lag. */
  freshMaxHours: 2,
  /** Late, but plausibly a delayed publication. */
  delayedMaxHours: 4,
  /** Old enough that it must not be presented as current. */
  staleMaxHours: 12,
} as const;

/** Upstream publishes hourly. */
export const UPSTREAM_CADENCE_MINUTES = 60;
/**
 * Observed lag between a measurement hour and its publication.
 *
 * Measured directly on 2026-07-26: the newest genuinely measured hour across
 * all five Malta stations was 06:00Z, published at 06:57Z. Not inferred from the
 * EEA's general "2 to 5 hours" guidance — Malta is at the fast end of it.
 */
export const UPSTREAM_PUBLICATION_LAG_MINUTES = 58;

export function hoursBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return Number.POSITIVE_INFINITY;
  return (to - from) / 3_600_000;
}

/**
 * Classify a measurement timestamp.
 *
 * An unparseable or absent timestamp is `unavailable`, never `fresh` — an
 * unknown age must fail safe.
 *
 * Future timestamps are `fresh`: forecast points are legitimately ahead of now,
 * and the forecast/observation distinction is carried separately rather than
 * being smuggled into freshness.
 */
export function classifyFreshness(
  measuredAtIso: string | null | undefined,
  nowIso: string,
): FreshnessState {
  if (!measuredAtIso) return 'unavailable';

  const age = hoursBetween(measuredAtIso, nowIso);
  if (!Number.isFinite(age)) return 'unavailable';
  if (age < 0) return 'fresh';

  const { freshMaxHours, delayedMaxHours, staleMaxHours } = FRESHNESS_THRESHOLDS;
  if (age <= freshMaxHours) return 'fresh';
  if (age <= delayedMaxHours) return 'delayed';
  if (age <= staleMaxHours) return 'stale';
  return 'unavailable';
}

/** Whole hours old, floored at 0. `null` when the age cannot be determined. */
export function ageInHours(measuredAtIso: string | null | undefined, nowIso: string): number | null {
  if (!measuredAtIso) return null;
  const age = hoursBetween(measuredAtIso, nowIso);
  if (!Number.isFinite(age)) return null;
  return Math.max(0, Math.floor(age));
}

/**
 * True when data must not be described as live.
 *
 * `delayed` counts as stale for labelling purposes: the brief requires that
 * anything beyond normal cadence is never called live.
 */
export function isStale(state: FreshnessState): boolean {
  return state !== 'fresh';
}

/** Next hourly publication after the given measurement, in ISO-8601 UTC. */
export function nextExpectedUpdate(measuredAtIso: string | null | undefined): string | null {
  if (!measuredAtIso) return null;
  const measured = Date.parse(measuredAtIso);
  if (!Number.isFinite(measured)) return null;
  const next =
    measured + UPSTREAM_CADENCE_MINUTES * 60_000 + UPSTREAM_PUBLICATION_LAG_MINUTES * 60_000;
  return new Date(next).toISOString();
}

/**
 * Whether a point is a forecast rather than an observation.
 *
 * Deliberately NOT `timestamp > now`. The upstream series carries roughly 48
 * hours of forecast beyond the present, and it also gap-fills *past* hours with
 * modelled values — a point eleven days old can still be estimated. The wall
 * clock cannot tell those apart.
 *
 * The reliable discriminator is the data itself: anything after the newest hour
 * that contains a real measurement is forecast. Pass the timestamp returned by
 * `latestObservedTimestamp`.
 */
export function isForecastPoint(measuredAtIso: string, latestObservedIso: string | null): boolean {
  if (!latestObservedIso) return false;
  const t = Date.parse(measuredAtIso);
  const latest = Date.parse(latestObservedIso);
  if (!Number.isFinite(t) || !Number.isFinite(latest)) return false;
  return t > latest;
}

/**
 * Newest timestamp that carries at least one directly measured value.
 *
 * This — never the newest key in the payload — is a station's `measuredAt`.
 * The newest key sits ~48 hours in the future, and because `classifyFreshness`
 * treats future timestamps as fresh, using it would report a forecast as live
 * measured data.
 */
export function latestObservedTimestamp(
  points: Array<{ measuredAt: string; hasMeasuredValue: boolean }>,
): string | null {
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    if (!point.hasMeasuredValue) continue;
    const ms = Date.parse(point.measuredAt);
    if (!Number.isFinite(ms) || ms <= latestMs) continue;
    latestMs = ms;
    latest = point.measuredAt;
  }

  return latest;
}

/** Worst (most degraded) freshness across a set — the summary must not flatter. */
export function worstFreshness(states: FreshnessState[]): FreshnessState {
  const order: FreshnessState[] = ['fresh', 'delayed', 'stale', 'unavailable'];
  let worst: FreshnessState = 'fresh';
  for (const s of states) {
    if (order.indexOf(s) > order.indexOf(worst)) worst = s;
  }
  return worst;
}
