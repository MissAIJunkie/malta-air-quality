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
/** Observed lag between the measurement hour and its publication. */
export const UPSTREAM_PUBLICATION_LAG_MINUTES = 55;

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
 * Whether a timestamp is in the future relative to `now` — i.e. a forecast
 * rather than an observation. Used to keep the two visually distinct.
 */
export function isForecastPoint(measuredAtIso: string, nowIso: string): boolean {
  const t = Date.parse(measuredAtIso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(t) || !Number.isFinite(now)) return false;
  return t > now;
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
