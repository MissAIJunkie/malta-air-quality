import { describe, it, expect } from 'vitest';

import sample from '../../../../fixtures/upstream-station-sample.json';
import {
  FRESHNESS_THRESHOLDS,
  UPSTREAM_CADENCE_MINUTES,
  UPSTREAM_PUBLICATION_LAG_MINUTES,
  ageInHours,
  classifyFreshness,
  hoursBetween,
  isForecastPoint,
  isStale,
  latestObservedTimestamp,
  nextExpectedUpdate,
  worstFreshness,
} from '../freshness';
import type { FreshnessState } from '../types';

const NOW = '2026-07-26T12:00:00.000Z';

/** `NOW` shifted back by `hours`, so each case reads as an age. */
function agedBy(hours: number): string {
  return new Date(Date.parse(NOW) - hours * 3_600_000).toISOString();
}

describe('classifyFreshness — boundaries', () => {
  const { freshMaxHours, delayedMaxHours, staleMaxHours } = FRESHNESS_THRESHOLDS;

  it.each([
    [0, 'fresh'],
    [1, 'fresh'],
    // The boundaries are inclusive: exactly two hours old is still normal
    // operation, because upstream publishes hourly with a ~58-minute lag.
    [freshMaxHours, 'fresh'],
    [freshMaxHours + 0.001, 'delayed'],
    [3, 'delayed'],
    [delayedMaxHours, 'delayed'],
    [delayedMaxHours + 0.001, 'stale'],
    [8, 'stale'],
    [staleMaxHours, 'stale'],
    [staleMaxHours + 0.001, 'unavailable'],
    [72, 'unavailable'],
  ] as Array<[number, FreshnessState]>)('%s hours old is %s', (hours, expected) => {
    expect(classifyFreshness(agedBy(hours), NOW)).toBe(expected);
  });

  it('treats a future timestamp as fresh rather than as an error', () => {
    // Forecast points legitimately sit ahead of now. Freshness answers "how old
    // is this?"; whether a point is an observation is carried separately, by
    // `isForecastPoint`. Conflating the two here would make every forecast row
    // look broken.
    expect(classifyFreshness(agedBy(-48), NOW)).toBe('fresh');
    expect(classifyFreshness(agedBy(-1), NOW)).toBe('fresh');
  });
});

describe('classifyFreshness — failing safe', () => {
  it.each([null, undefined, '', 'not-a-timestamp', 'yesterday', '2026-13-45T99:00:00Z'])(
    'returns unavailable for %o rather than assuming the reading is current',
    (value) => {
      // An unknown age must never be presented as live. Every one of these is a
      // shape the upstream, a cache or a database column could plausibly hand us.
      expect(classifyFreshness(value as string | null | undefined, NOW)).toBe('unavailable');
    },
  );

  it('returns unavailable when "now" itself is unparseable', () => {
    expect(classifyFreshness(agedBy(1), 'not-a-timestamp')).toBe('unavailable');
  });

  it('accepts an offset timestamp, not only Z', () => {
    // 14:00+02:00 is Malta local for 12:00Z — the same instant, so zero hours old.
    expect(classifyFreshness('2026-07-26T14:00:00+02:00', NOW)).toBe('fresh');
    expect(ageInHours('2026-07-26T14:00:00+02:00', NOW)).toBe(0);
  });
});

describe('hoursBetween', () => {
  it('measures forwards and backwards', () => {
    expect(hoursBetween(agedBy(3), NOW)).toBeCloseTo(3, 10);
    expect(hoursBetween(NOW, agedBy(3))).toBeCloseTo(-3, 10);
  });

  it('is infinite when either end is unparseable, so callers can detect it', () => {
    expect(hoursBetween('nonsense', NOW)).toBe(Number.POSITIVE_INFINITY);
    expect(hoursBetween(NOW, 'nonsense')).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('ageInHours', () => {
  it('floors to whole hours', () => {
    expect(ageInHours(agedBy(3.9), NOW)).toBe(3);
    expect(ageInHours(agedBy(0.99), NOW)).toBe(0);
  });

  it('clamps a future timestamp to zero rather than reporting a negative age', () => {
    // "-48 hours old" is meaningless in a UI. A forecast point is zero hours old.
    expect(ageInHours(agedBy(-48), NOW)).toBe(0);
  });

  it('returns null — never 0 — when the age cannot be determined', () => {
    // 0 would render as "just now", which is the opposite of the truth.
    expect(ageInHours(null, NOW)).toBeNull();
    expect(ageInHours(undefined, NOW)).toBeNull();
    expect(ageInHours('not-a-timestamp', NOW)).toBeNull();
  });
});

describe('isStale', () => {
  it('treats anything beyond fresh as unfit to be called live', () => {
    expect(isStale('fresh')).toBe(false);
    // `delayed` is deliberately included: the brief forbids describing data
    // outside the normal cadence as live, even when it is only mildly late.
    expect(isStale('delayed')).toBe(true);
    expect(isStale('stale')).toBe(true);
    expect(isStale('unavailable')).toBe(true);
  });
});

describe('nextExpectedUpdate', () => {
  it('adds one publication cycle plus the observed lag', () => {
    const expected = new Date(
      Date.parse('2026-07-26T06:00:00.000Z') +
        (UPSTREAM_CADENCE_MINUTES + UPSTREAM_PUBLICATION_LAG_MINUTES) * 60_000,
    ).toISOString();
    expect(nextExpectedUpdate('2026-07-26T06:00:00.000Z')).toBe(expected);
    expect(expected).toBe('2026-07-26T07:58:00.000Z');
  });

  it('returns null rather than a guess when there is no measurement time', () => {
    expect(nextExpectedUpdate(null)).toBeNull();
    expect(nextExpectedUpdate(undefined)).toBeNull();
    expect(nextExpectedUpdate('not-a-timestamp')).toBeNull();
  });
});

describe('worstFreshness', () => {
  it('returns the most degraded state in the set', () => {
    expect(worstFreshness(['fresh', 'delayed', 'fresh'])).toBe('delayed');
    expect(worstFreshness(['fresh', 'unavailable', 'stale'])).toBe('unavailable');
    expect(worstFreshness(['stale', 'delayed'])).toBe('stale');
  });

  it('never flatters a set that contains one bad station', () => {
    expect(worstFreshness(['fresh', 'fresh', 'fresh', 'fresh', 'stale'])).toBe('stale');
  });

  it('is fresh for an empty set', () => {
    // Nothing to degrade. Callers that have no readings at all decide their own
    // wording; this function only ranks states it is given.
    expect(worstFreshness([])).toBe('fresh');
  });
});

/* -------------------------------------------------------------------------- */
/*  Observation versus forecast                                               */
/* -------------------------------------------------------------------------- */

type Point = { measuredAt: string; hasMeasuredValue: boolean };

/**
 * The shape that made these two functions necessary.
 *
 * A real `current/<CODE>.json` carries ~10 days of history AND ~48 hours of CAMS
 * forecast, so its newest key is roughly two days in the FUTURE. It also
 * gap-fills hours in the PAST with modelled values. Neither the wall clock nor
 * the key order can separate observation from estimate — only `modelled_*` can.
 */
const MIXED_SERIES: Point[] = [
  { measuredAt: '2026-07-16T04:00:00.000Z', hasMeasuredValue: true },
  // A gap-filled hour in the middle of the observed block.
  { measuredAt: '2026-07-16T05:00:00.000Z', hasMeasuredValue: false },
  { measuredAt: '2026-07-16T06:00:00.000Z', hasMeasuredValue: true },
  // Another past gap-fill, this one AFTER the newest real measurement.
  { measuredAt: '2026-07-16T07:00:00.000Z', hasMeasuredValue: false },
  // Forecast tail, ending ~48 hours ahead of the newest measurement.
  { measuredAt: '2026-07-17T12:00:00.000Z', hasMeasuredValue: false },
  { measuredAt: '2026-07-18T06:00:00.000Z', hasMeasuredValue: false },
];

const NEWEST_KEY = '2026-07-18T06:00:00.000Z';

describe('latestObservedTimestamp', () => {
  it('picks the newest genuinely measured hour, never the newest key', () => {
    // This is the whole point. `NEWEST_KEY` is ~48 hours in the future and, in
    // combination with `classifyFreshness` calling future timestamps fresh,
    // using it as `measuredAt` would advertise a CAMS forecast as a live
    // observation on the front page.
    const latest = latestObservedTimestamp(MIXED_SERIES);
    expect(latest).toBe('2026-07-16T06:00:00.000Z');
    expect(latest).not.toBe(NEWEST_KEY);
  });

  it('ignores modelled gap-fills that sit after the newest measurement', () => {
    // 07:00 is in the past and modelled. A "newest key" or "latest non-forecast
    // by wall clock" rule would wrongly select it.
    expect(latestObservedTimestamp(MIXED_SERIES)).not.toBe('2026-07-16T07:00:00.000Z');
  });

  it('is insensitive to input order', () => {
    const shuffled = [...MIXED_SERIES].reverse();
    expect(latestObservedTimestamp(shuffled)).toBe('2026-07-16T06:00:00.000Z');
  });

  it('returns null when every point is modelled', () => {
    // A station publishing nothing but gap-fills has no current observation, and
    // must be reported as having none rather than borrowing an estimate.
    expect(latestObservedTimestamp(MIXED_SERIES.filter((p) => !p.hasMeasuredValue))).toBeNull();
    expect(latestObservedTimestamp([])).toBeNull();
  });

  it('skips unparseable keys instead of letting one poison the result', () => {
    expect(
      latestObservedTimestamp([
        { measuredAt: 'not-a-timestamp', hasMeasuredValue: true },
        { measuredAt: '2026-07-16T04:00:00.000Z', hasMeasuredValue: true },
      ]),
    ).toBe('2026-07-16T04:00:00.000Z');
  });

  it('holds against the real captured payload', () => {
    const raw = sample as Record<string, Record<string, number | string | null>>;
    const keys = Object.keys(raw).sort();
    const points: Point[] = keys.map((measuredAt) => ({
      measuredAt,
      // A real measurement is a non-null value whose `modelled_*` flag is 0.
      hasMeasuredValue: ['PM2.5', 'PM10', 'NO2', 'O3', 'SO2'].some(
        (code) =>
          typeof raw[measuredAt][`val_${code}`] === 'number' &&
          raw[measuredAt][`modelled_${code}`] === 0,
      ),
    }));

    const newestKey = keys[keys.length - 1];
    const latest = latestObservedTimestamp(points);

    expect(latest).not.toBeNull();
    expect(latest).not.toBe(newestKey);
    // The captured payload's newest key really is in the future relative to the
    // newest measurement, by roughly the CAMS forecast horizon.
    expect(Date.parse(newestKey)).toBeGreaterThan(Date.parse(latest as string));

    // Derived from the fixture rather than pinned to a literal: the capture can
    // be refreshed, and the property under test is "the newest MEASURED hour",
    // not one particular timestamp.
    const expected = keys
      .filter((k) => points.find((pt) => pt.measuredAt === k)?.hasMeasuredValue)
      .pop();
    expect(latest).toBe(expected);
  });
});

describe('isForecastPoint', () => {
  const latestObserved = '2026-07-16T06:00:00.000Z';

  it('calls everything after the newest observation a forecast', () => {
    expect(isForecastPoint('2026-07-16T07:00:00.000Z', latestObserved)).toBe(true);
    expect(isForecastPoint(NEWEST_KEY, latestObserved)).toBe(true);
  });

  it('does not call a past gap-fill a forecast', () => {
    // 05:00 is modelled but historic. It is an estimate of the past, not a
    // prediction, and the UI labels the two differently.
    expect(isForecastPoint('2026-07-16T05:00:00.000Z', latestObserved)).toBe(false);
  });

  it('treats the newest observation itself as an observation', () => {
    expect(isForecastPoint(latestObserved, latestObserved)).toBe(false);
  });

  it('claims nothing when there is no observed anchor', () => {
    // Without an anchor we cannot tell, and silently labelling everything as
    // forecast would be as wrong as labelling nothing.
    expect(isForecastPoint(NEWEST_KEY, null)).toBe(false);
  });

  it('claims nothing when either timestamp is unparseable', () => {
    expect(isForecastPoint('not-a-timestamp', latestObserved)).toBe(false);
    expect(isForecastPoint(NEWEST_KEY, 'not-a-timestamp')).toBe(false);
  });

  it('partitions the mixed series into 3 observed-or-historic and 3 forecast points', () => {
    const anchor = latestObservedTimestamp(MIXED_SERIES);
    const forecast = MIXED_SERIES.filter((p) => isForecastPoint(p.measuredAt, anchor));
    expect(forecast.map((p) => p.measuredAt)).toEqual([
      '2026-07-16T07:00:00.000Z',
      '2026-07-17T12:00:00.000Z',
      '2026-07-18T06:00:00.000Z',
    ]);
  });
});
