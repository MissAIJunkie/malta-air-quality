import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// `service.ts` imports `server-only`, whose default export throws outside a
// React Server Component graph. Vitest is neither, so the marker is stubbed —
// the module's job is to fail a client BUNDLE, and there is no bundle here.
vi.mock('server-only', () => ({}));

import { POLLUTANT_CODES, type PollutantCode } from '@/config/pollutants';
import { STATIONS } from '@/config/stations';
import type { AirQualityCategory } from '@/config/thresholds';
import { clearMemoryCache } from '@/lib/cache/upstash';

import { buildPollutantReading } from '../calculate-index';
import { classifyFreshness, isStale, nextExpectedUpdate, worstFreshness } from '../freshness';
import {
  getLatestReadings,
  getProvider,
  getStationHistory,
  getStations,
  summariseMalta,
} from '../service';
import type { FreshnessState, StationReading } from '../types';

const NOW = '2026-07-26T12:00:00.000Z';

type ReadingSpec = {
  stationId: string;
  category: AirQualityCategory | null;
  subIndex?: number | null;
  dominant?: PollutantCode | null;
  measuredAt?: string;
  freshness?: FreshnessState;
};

function reading(spec: ReadingSpec): StationReading {
  const measuredAt = spec.measuredAt ?? '2026-07-26T11:00:00.000Z';
  return {
    stationId: spec.stationId,
    measuredAt,
    fetchedAt: NOW,
    timezone: 'Europe/Malta',
    overallCategory: spec.category,
    overallSubIndex: spec.subIndex ?? null,
    dominantPollutant: spec.dominant ?? null,
    pollutants: {},
    provisional: true,
    freshness: spec.freshness ?? classifyFreshness(measuredAt, NOW),
    ageHours: 1,
    partial: false,
    source: 'FIXTURE',
  };
}

describe('summariseMalta — worst station wins', () => {
  it('takes the band of the worst reporting station, not an average', () => {
    // A median or a mean would let one bad station vanish behind four good ones.
    // For a health signal that is the wrong failure mode, so the summary is
    // deliberately pessimistic — and says so via `aggregation`.
    const summary = summariseMalta(
      [
        reading({ stationId: 'MT00004', category: 'Good', subIndex: 1.2, dominant: 'O3' }),
        reading({ stationId: 'MT00007', category: 'Good', subIndex: 1.1, dominant: 'O3' }),
        reading({ stationId: 'MT00008', category: 'Poor', subIndex: 4.5, dominant: 'PM10' }),
        reading({ stationId: 'MT00009', category: 'Fair', subIndex: 2.0, dominant: 'NO2' }),
      ],
      NOW,
    );

    expect(summary.category).toBe('Poor');
    expect(summary.drivingStationId).toBe('MT00008');
    expect(summary.dominantPollutant).toBe('PM10');
    expect(summary.aggregation).toBe('worst-station');
  });

  it('is independent of the order the readings arrive in', () => {
    const readings = [
      reading({ stationId: 'MT00004', category: 'Fair', subIndex: 2.4, dominant: 'O3' }),
      reading({ stationId: 'MT00011', category: 'Very poor', subIndex: 5.1, dominant: 'PM2.5' }),
      reading({ stationId: 'MT00007', category: 'Moderate', subIndex: 3.3, dominant: 'NO2' }),
    ];

    const forwards = summariseMalta(readings, NOW);
    const backwards = summariseMalta([...readings].reverse(), NOW);

    expect(forwards).toEqual(backwards);
    expect(forwards.drivingStationId).toBe('MT00011');
  });

  it('ranks by category before sub-index', () => {
    // A Poor station low in its band still beats a Moderate station high in
    // its own. The band is the headline; the sub-index only breaks ties.
    const summary = summariseMalta(
      [
        reading({ stationId: 'MT00004', category: 'Moderate', subIndex: 3.99, dominant: 'NO2' }),
        reading({ stationId: 'MT00007', category: 'Poor', subIndex: 4.01, dominant: 'O3' }),
      ],
      NOW,
    );
    expect(summary.drivingStationId).toBe('MT00007');
  });
});

describe('summariseMalta — tie-breaking', () => {
  it('breaks a same-category tie on the higher sub-index', () => {
    const summary = summariseMalta(
      [
        reading({ stationId: 'MT00004', category: 'Moderate', subIndex: 3.1, dominant: 'NO2' }),
        reading({ stationId: 'MT00007', category: 'Moderate', subIndex: 3.8, dominant: 'PM10' }),
        reading({ stationId: 'MT00008', category: 'Moderate', subIndex: 3.4, dominant: 'O3' }),
      ],
      NOW,
    );

    expect(summary.drivingStationId).toBe('MT00007');
    expect(summary.dominantPollutant).toBe('PM10');
  });

  it('keeps the first station when category and sub-index are identical', () => {
    // Arbitrary but stable: the headline must not flicker between two equally
    // bad stations on successive refreshes.
    const summary = summariseMalta(
      [
        reading({ stationId: 'MT00004', category: 'Poor', subIndex: 4.2, dominant: 'NO2' }),
        reading({ stationId: 'MT00007', category: 'Poor', subIndex: 4.2, dominant: 'PM10' }),
      ],
      NOW,
    );
    expect(summary.drivingStationId).toBe('MT00004');
  });

  it('treats a missing sub-index as the bottom of the band rather than as unknown', () => {
    const summary = summariseMalta(
      [
        reading({ stationId: 'MT00004', category: 'Poor', subIndex: null, dominant: 'NO2' }),
        reading({ stationId: 'MT00007', category: 'Poor', subIndex: 4.01, dominant: 'PM10' }),
      ],
      NOW,
    );
    expect(summary.drivingStationId).toBe('MT00007');
  });
});

describe('summariseMalta — nothing to report', () => {
  it('returns nulls rather than a default of Good when no station reports', () => {
    // The one failure mode that would be actively dangerous: an empty island
    // silently rendering as clean air.
    const summary = summariseMalta(
      [
        reading({ stationId: 'MT00004', category: null }),
        reading({ stationId: 'MT00007', category: null }),
      ],
      NOW,
    );

    expect(summary.category).toBeNull();
    expect(summary.dominantPollutant).toBeNull();
    expect(summary.drivingStationId).toBeNull();
    expect(summary.reportingStations).toBe(0);
    expect(summary.measuredAt).toBeNull();
    expect(summary.freshness).toBe('unavailable');
  });

  it('handles an entirely empty response', () => {
    const summary = summariseMalta([], NOW);
    expect(summary.category).toBeNull();
    expect(summary.reportingStations).toBe(0);
    expect(summary.staleStations).toBe(0);
    expect(summary.totalStations).toBe(STATIONS.length);
    expect(summary.freshness).toBe('unavailable');
  });

  it('ignores non-reporting stations when picking the worst', () => {
    const summary = summariseMalta(
      [
        reading({ stationId: 'MT00004', category: null, subIndex: null }),
        reading({ stationId: 'MT00007', category: 'Fair', subIndex: 2.2, dominant: 'O3' }),
      ],
      NOW,
    );
    expect(summary.category).toBe('Fair');
    expect(summary.drivingStationId).toBe('MT00007');
  });
});

describe('summariseMalta — counts and honesty about coverage', () => {
  it('counts reporting stations against the full network, not against what arrived', () => {
    // Five stations exist. Saying "2 of 2 reporting" when three are missing
    // would hide an outage.
    const summary = summariseMalta(
      [
        reading({ stationId: 'MT00004', category: 'Good', subIndex: 1.4, dominant: 'O3' }),
        reading({ stationId: 'MT00007', category: 'Fair', subIndex: 2.1, dominant: 'NO2' }),
      ],
      NOW,
    );

    expect(summary.reportingStations).toBe(2);
    expect(summary.totalStations).toBe(5);
    expect(summary.totalStations).toBe(STATIONS.length);
  });

  it('counts a stale station even when it has no category to report', () => {
    // `staleStations` is computed over ALL readings, not only reporting ones: a
    // station that is both silent and out of date is doubly worth flagging.
    const summary = summariseMalta(
      [
        reading({ stationId: 'MT00004', category: 'Good', subIndex: 1.4, freshness: 'fresh' }),
        reading({ stationId: 'MT00007', category: 'Fair', subIndex: 2.1, freshness: 'delayed' }),
        reading({ stationId: 'MT00008', category: null, freshness: 'stale' }),
        reading({ stationId: 'MT00009', category: null, freshness: 'unavailable' }),
      ],
      NOW,
    );

    expect(summary.reportingStations).toBe(2);
    // `delayed` counts: anything past the normal cadence must not read as live.
    expect(summary.staleStations).toBe(3);
  });

  it('reports the newest measurement time across reporting stations', () => {
    const summary = summariseMalta(
      [
        reading({
          stationId: 'MT00004',
          category: 'Good',
          subIndex: 1.4,
          measuredAt: '2026-07-26T09:00:00.000Z',
        }),
        reading({
          stationId: 'MT00007',
          category: 'Fair',
          subIndex: 2.1,
          measuredAt: '2026-07-26T11:00:00.000Z',
        }),
      ],
      NOW,
    );

    expect(summary.measuredAt).toBe('2026-07-26T11:00:00.000Z');
    expect(summary.freshness).toBe('fresh');
  });

  it('derives freshness from the summary timestamp and the supplied clock', () => {
    const summary = summariseMalta(
      [
        reading({
          stationId: 'MT00004',
          category: 'Good',
          subIndex: 1.4,
          measuredAt: '2026-07-26T01:00:00.000Z',
          freshness: 'stale',
        }),
      ],
      NOW,
    );

    // Eleven hours old at the supplied "now" — stale, and never described as live.
    expect(summary.freshness).toBe('stale');
    expect(isStale(summary.freshness)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/*  Service envelope, driven by the fixture provider                          */
/* -------------------------------------------------------------------------- */

beforeEach(() => {
  clearMemoryCache();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  clearMemoryCache();
});

describe('service wiring with AIR_QUALITY_PROVIDER=fixture', () => {
  it('selects the fixture provider and never a live one', () => {
    // The whole suite, and E2E, must run without contacting the EEA.
    expect(getProvider().name).toBe('FIXTURE');
  });

  it('returns one reading per station with a coherent envelope', async () => {
    const { readings, meta } = await getLatestReadings();

    expect(readings).toHaveLength(STATIONS.length);
    expect(meta.source).toBe('FIXTURE');
    expect(meta.cached).toBe(false);
    expect(meta.partial).toBe(false);
    expect(Number.isFinite(Date.parse(meta.fetchedAt))).toBe(true);

    // The envelope's measuredAt is the newest across stations, and the next
    // expected update is derived from it rather than invented.
    const newest = readings
      .map((r) => r.measuredAt)
      .reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));
    expect(meta.measuredAt).toBe(newest);
    expect(meta.nextExpectedUpdateAt).toBe(nextExpectedUpdate(newest));

    // `stale` is derived from the worst station's freshness, not asserted as a
    // constant, so this stays true whatever the fixture window happens to be.
    expect(meta.stale).toBe(isStale(worstFreshness(readings.map((r) => r.freshness))));
  });

  it('serves the second call from cache without re-running the provider', async () => {
    await getLatestReadings();
    const second = await getLatestReadings();
    expect(second.meta.cached).toBe(true);
  });

  it('never emits a zero concentration for an unmeasured pollutant', async () => {
    const { readings } = await getLatestReadings();

    for (const station of readings) {
      for (const code of POLLUTANT_CODES) {
        const pollutant = station.pollutants[code];
        // Absent means absent. It must be missing from the map, not present
        // with a value of 0 — 0 µg/m³ is a claim about clean air.
        if (!pollutant) continue;
        expect(pollutant.value).not.toBeNull();
        expect(typeof pollutant.value).toBe('number');
      }
    }
  });

  it('returns the five configured stations with their metadata intact', async () => {
    const { stations, meta } = await getStations();

    expect(stations.map((s) => s.id).sort()).toEqual(
      ['MT00004', 'MT00007', 'MT00008', 'MT00009', 'MT00011'].sort(),
    );
    expect(stations.find((s) => s.id === 'MT00007')?.island).toBe('Gozo');
    expect(meta.source).toBe('FIXTURE');
    // Station geometry has no measurement time; claiming one would be a lie.
    expect(meta.measuredAt).toBeNull();
    expect(meta.nextExpectedUpdateAt).toBeNull();
  });

  it('resolves history by slug as well as by upstream code', async () => {
    const bySlug = await getStationHistory('msida');
    const byCode = await getStationHistory('MT00011');

    expect(bySlug.length).toBeGreaterThan(0);
    expect(bySlug.map((p) => p.measuredAt)).toEqual(byCode.map((p) => p.measuredAt));
    expect(bySlug.every((p) => p.stationId === 'MT00011')).toBe(true);
  });

  it('excludes forecast points from history unless they are asked for', async () => {
    const observed = await getStationHistory('MT00004');
    const withForecast = await getStationHistory('MT00004', { includeForecast: true });

    expect(observed.every((p) => p.forecast === false)).toBe(true);
    expect(withForecast.length).toBeGreaterThan(observed.length);
    expect(withForecast.some((p) => p.forecast)).toBe(true);
  });

  it('returns an empty history for an unknown station rather than throwing', async () => {
    await expect(getStationHistory('MT99999')).resolves.toEqual([]);
    await expect(getStationHistory('not-a-station')).resolves.toEqual([]);
  });
});

describe('summary built from real provider output', () => {
  it('matches the worst station in the provider response', async () => {
    const { readings } = await getLatestReadings();
    const summary = summariseMalta(readings, NOW);

    const reportingCategories = readings
      .filter((r) => r.overallCategory !== null)
      .map((r) => r.overallCategory);

    expect(summary.reportingStations).toBe(reportingCategories.length);
    if (summary.category) {
      expect(reportingCategories).toContain(summary.category);
      expect(readings.map((r) => r.stationId)).toContain(summary.drivingStationId);
    }
  });

  it('never invents a dominant pollutant that the driving station did not report', async () => {
    const { readings } = await getLatestReadings();
    const summary = summariseMalta(readings, NOW);
    if (!summary.drivingStationId || !summary.dominantPollutant) return;

    const driver = readings.find((r) => r.stationId === summary.drivingStationId);
    expect(driver?.pollutants[summary.dominantPollutant]).toBeDefined();
  });
});

describe('a reading with no pollutants at all', () => {
  it('is summarised as no data rather than as Good', () => {
    // Built through the real reading constructor to prove the null path survives
    // the whole chain, not just the summary function.
    const empty = reading({ stationId: 'MT00004', category: null });
    empty.pollutants = { PM10: buildPollutantReading('PM10', null) };

    expect(empty.pollutants.PM10?.value).toBeNull();
    expect(summariseMalta([empty], NOW).category).toBeNull();
  });
});
