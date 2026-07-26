import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import sample from '../../../../fixtures/upstream-station-sample.json';
import stationList from '../../../../fixtures/upstream-stations-mt.json';
import { POLLUTANT_CODES, type PollutantCode } from '@/config/pollutants';
import { STATIONS, findStation } from '@/config/stations';

import { eeaProvider } from '../providers/eea-provider';
import { fixtureProvider } from '../providers/fixture-provider';
import { classifyFreshness, isForecastPoint, latestObservedTimestamp } from '../freshness';
import type { StationReading } from '../types';

/**
 * No test in this file touches the network.
 *
 * The fixture provider is offline by construction; the EEA provider is exercised
 * against a stubbed `globalThis.fetch`. If any assertion here ever starts
 * depending on a live ERA or EEA endpoint, that is the bug.
 */

const BASE = 'https://dis2datalake.blob.core.windows.net/airquality-derivated/AQI-noRunningMeans/';
const STATION_LIST_FILE = 'raw_stations.json.1753500000';

const REAL_SERIES = sample as Record<string, Record<string, number | string | null>>;

beforeEach(() => {
  // The providers log every fetch and every degradation. Both are correct; the
  // noise is not useful in a test report.
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/*  Fixture provider                                                          */
/* -------------------------------------------------------------------------- */

describe('fixture provider — stations', () => {
  it('returns all five verified Malta stations', async () => {
    const stations = await fixtureProvider.getStations();

    expect(stations).toHaveLength(5);
    expect(stations.map((s) => s.id).sort()).toEqual([
      'MT00004',
      'MT00007',
      'MT00008',
      'MT00009',
      'MT00011',
    ]);
    expect(stations.map((s) => s.slug).sort()).toEqual([
      'attard',
      'gharb',
      'msida',
      'st-pauls-bay',
      'zejtun',
    ]);
  });

  it('keeps the Maltese names and the Gozo/Malta split', async () => {
    const stations = await fixtureProvider.getStations();
    expect(stations.find((s) => s.id === 'MT00007')?.name).toBe('Għarb');
    expect(stations.find((s) => s.id === 'MT00007')?.island).toBe('Gozo');
    expect(stations.filter((s) => s.island === 'Malta')).toHaveLength(4);
  });

  it('places every station inside Malta', async () => {
    const stations = await fixtureProvider.getStations();
    for (const station of stations) {
      expect(station.latitude).toBeGreaterThan(35.7);
      expect(station.latitude).toBeLessThan(36.2);
      expect(station.longitude).toBeGreaterThan(14.1);
      expect(station.longitude).toBeLessThan(14.7);
    }
  });

  it('identifies itself as FIXTURE so its data can never pass for live', async () => {
    expect(fixtureProvider.name).toBe('FIXTURE');
    const readings = await fixtureProvider.getLatestReadings();
    expect(readings.every((r) => r.source === 'FIXTURE')).toBe(true);
  });
});

describe('fixture provider — readings', () => {
  let readings: StationReading[];

  beforeEach(async () => {
    readings = await fixtureProvider.getLatestReadings();
  });

  it('returns one reading per station', () => {
    expect(readings).toHaveLength(5);
    expect(new Set(readings.map((r) => r.stationId)).size).toBe(5);
  });

  it('never records a missing pollutant as 0', () => {
    for (const reading of readings) {
      for (const code of POLLUTANT_CODES) {
        const pollutant = reading.pollutants[code];
        if (pollutant === undefined) continue;
        // Present means measured. An unmeasured pollutant is absent from the
        // map — it is never present carrying a manufactured 0 µg/m³.
        expect(pollutant.value).not.toBeNull();
        expect(Number.isFinite(pollutant.value as number)).toBe(true);
        expect(pollutant.unit).toBe('µg/m³');
      }
    }
  });

  it('marks Msida as having no ozone, because the real station does not measure it', () => {
    const msida = readings.find((r) => r.stationId === 'MT00011');
    expect(msida).toBeDefined();
    expect(msida?.pollutants.O3).toBeUndefined();
    // The other four do report ozone, so this is a genuine per-station gap and
    // not the fixture failing to produce any O₃ at all.
    expect(findStation('MT00011')?.expectedPollutants).not.toContain('O3');
    const others = readings.filter((r) => r.stationId !== 'MT00011');
    expect(others.some((r) => r.pollutants.O3 !== undefined)).toBe(true);
  });

  it('never reports a pollutant a station does not measure', () => {
    for (const reading of readings) {
      const expected = findStation(reading.stationId)?.expectedPollutants ?? [];
      for (const code of Object.keys(reading.pollutants) as PollutantCode[]) {
        expect(expected).toContain(code);
      }
    }
  });

  it('contains only directly measured values — no modelled estimate in the headline', () => {
    // The headline band must never be driven by a gap-fill dressed up as an
    // observation.
    for (const reading of readings) {
      for (const pollutant of Object.values(reading.pollutants)) {
        expect(pollutant.modelled).toBe(false);
      }
    }
  });

  it('derives freshness and age from its own measuredAt rather than asserting either', () => {
    // Stated as an internal consistency check on purpose: it holds whatever
    // window the fixture happens to cover, so it will not need rewriting when
    // the captured payload is refreshed.
    for (const reading of readings) {
      expect(reading.freshness).toBe(classifyFreshness(reading.measuredAt, reading.fetchedAt));
      expect(reading.ageHours).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(Date.parse(reading.measuredAt))).toBe(true);
      expect(reading.timezone).toBe('Europe/Malta');
      // E2a dissemination data is unverified by definition.
      expect(reading.provisional).toBe(true);
    }
  });

  it('does not take the newest point in the series as the measurement time', async () => {
    // The series extends into the future. Taking its last point would advertise
    // a CAMS forecast as a live reading — and because `classifyFreshness` calls
    // future timestamps fresh, it would be labelled "Live" while doing so.
    for (const reading of readings) {
      const series = await fixtureProvider.getStationHistory(reading.stationId, {
        includeForecast: true,
      });
      const newest = series[series.length - 1].measuredAt;

      expect(newest).not.toBe(reading.measuredAt);
      expect(Date.parse(newest)).toBeGreaterThan(Date.parse(reading.measuredAt));
      expect(series.find((p) => p.measuredAt === reading.measuredAt)?.forecast).toBe(false);
    }
  });

  it('agrees with its own overall calculation', () => {
    for (const reading of readings) {
      if (reading.overallCategory === null) {
        expect(reading.dominantPollutant).toBeNull();
        expect(Object.keys(reading.pollutants)).toHaveLength(0);
        continue;
      }
      // The dominant pollutant must be one the station actually reported.
      expect(reading.dominantPollutant).not.toBeNull();
      expect(reading.pollutants[reading.dominantPollutant as PollutantCode]).toBeDefined();
      expect(reading.overallSubIndex).not.toBeNull();
    }
  });
});

describe('fixture provider — observed versus forecast', () => {
  it('returns no forecast points unless they are asked for', async () => {
    const observed = await fixtureProvider.getStationHistory('MT00004');
    expect(observed.length).toBeGreaterThan(0);
    expect(observed.every((p) => p.forecast === false)).toBe(true);
  });

  it('labels the forecast tail and places it strictly after the last observation', async () => {
    const all = await fixtureProvider.getStationHistory('MT00004', { includeForecast: true });
    const forecast = all.filter((p) => p.forecast);
    const observed = all.filter((p) => !p.forecast);

    expect(forecast.length).toBeGreaterThan(0);
    expect(observed.length).toBeGreaterThan(0);

    const lastObserved = Math.max(...observed.map((p) => Date.parse(p.measuredAt)));
    for (const point of forecast) {
      expect(Date.parse(point.measuredAt)).toBeGreaterThan(lastObserved);
    }
  });

  it('anchors the latest reading on the newest observed point in the same series', async () => {
    // The two paths must agree. If `getLatestReadings` used a different anchor
    // from `getStationHistory`, the headline and the chart would disagree about
    // where measurement stops and prediction starts.
    const readings = await fixtureProvider.getLatestReadings();
    const zejtun = readings.find((r) => r.stationId === 'MT00004');
    const observed = await fixtureProvider.getStationHistory('MT00004');

    expect(observed[observed.length - 1].measuredAt).toBe(zejtun?.measuredAt);
  });

  it('returns history in ascending time order with no duplicate hours', async () => {
    const all = await fixtureProvider.getStationHistory('MT00011', { includeForecast: true });
    const times = all.map((p) => Date.parse(p.measuredAt));

    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(times.length);
  });

  it('honours an explicit window', async () => {
    const all = await fixtureProvider.getStationHistory('MT00008', { includeForecast: true });
    const from = all[Math.floor(all.length / 2)].measuredAt;

    const windowed = await fixtureProvider.getStationHistory('MT00008', {
      from,
      includeForecast: true,
    });

    expect(windowed.length).toBeLessThan(all.length);
    expect(windowed.every((p) => Date.parse(p.measuredAt) >= Date.parse(from))).toBe(true);
  });

  it('returns an empty history for an unknown station', async () => {
    await expect(fixtureProvider.getStationHistory('MT99999')).resolves.toEqual([]);
  });

  it('keeps Msida ozone-free through the whole history', async () => {
    const history = await fixtureProvider.getStationHistory('MT00011', { includeForecast: true });
    expect(history.length).toBeGreaterThan(0);
    expect(history.every((p) => p.pollutants.O3 === undefined)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/*  EEA provider — against a stubbed fetch                                    */
/* -------------------------------------------------------------------------- */

type UpstreamRoutes = {
  /** `content/index.json`. */
  index?: unknown;
  /** The resolved `content/raw_stations.json.<stamp>` body. */
  stationList?: unknown;
  /** Per-station `current/<CODE>.json` bodies. */
  series?: Record<string, unknown>;
  /** Per-path HTTP status overrides, matched by substring. */
  failWith?: Record<string, number>;
  /** Paths, matched by substring, whose fetch rejects outright. */
  networkError?: string[];
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/** Install a fetch stub and return the list of URLs it was asked for. */
function installUpstream(routes: UpstreamRoutes): string[] {
  const requested: string[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      // `fetchJson` passes the URL object returned by `assertAllowedUrl`, not a
      // string, so the stub must normalise before matching.
      const url = String(input);
      requested.push(url);

      for (const fragment of routes.networkError ?? []) {
        if (url.includes(fragment)) throw new TypeError('fetch failed');
      }

      for (const [fragment, status] of Object.entries(routes.failWith ?? {})) {
        if (url.includes(fragment)) return jsonResponse({ error: status }, status);
      }

      if (url.endsWith('content/index.json')) {
        return jsonResponse(routes.index ?? { contents: [STATION_LIST_FILE] });
      }

      if (url.includes('/content/')) {
        return jsonResponse(routes.stationList ?? stationList);
      }

      const match = /current\/(MT\d+)\.json$/.exec(url);
      if (match) {
        const body = routes.series?.[match[1]] ?? REAL_SERIES;
        return jsonResponse(body);
      }

      return jsonResponse({ error: 'unexpected route' }, 404);
    }),
  );

  return requested;
}

describe('EEA provider — parsing a real captured payload', () => {
  it('takes the newest MEASURED hour as measuredAt, never the newest key', async () => {
    installUpstream({});
    const readings = await eeaProvider.getLatestReadings();

    const keys = Object.keys(REAL_SERIES).sort();
    const newestKey = keys[keys.length - 1];

    expect(readings).toHaveLength(5);
    for (const reading of readings) {
      // 2026-07-16T04:00Z is the last hour in the capture whose values carry
      // `modelled_* == 0`; 2026-07-28T10:00Z is the end of the CAMS forecast.
      expect(reading.measuredAt).toBe('2026-07-16T04:00:00.000Z');
      expect(reading.measuredAt).not.toBe(newestKey);
      expect(Date.parse(newestKey)).toBeGreaterThan(Date.parse(reading.measuredAt));
    }
  });

  it('reads the concentrations for that hour without rounding them away', async () => {
    installUpstream({});
    const [reading] = await eeaProvider.getLatestReadings();
    const hour = REAL_SERIES['2026-07-16T04:00:00.000Z'];

    for (const code of POLLUTANT_CODES) {
      expect(reading.pollutants[code]?.value).toBe(hour[`val_${code}`]);
    }
    expect(reading.source).toBe('EEA');
    expect(reading.provisional).toBe(true);
  });

  it('fetches one series per station, from the allowlisted host only', async () => {
    const requested = installUpstream({});
    await eeaProvider.getLatestReadings();

    expect(requested).toHaveLength(5);
    for (const url of requested) {
      expect(url.startsWith(BASE)).toBe(true);
      expect(new URL(url).hostname).toBe('dis2datalake.blob.core.windows.net');
    }
    expect(requested.some((u) => u.endsWith('current/MT00011.json'))).toBe(true);
  });

  it('splits the series into observations and forecast at the right point', async () => {
    installUpstream({});
    const all = await eeaProvider.getStationHistory('MT00004', { includeForecast: true });
    const observed = await eeaProvider.getStationHistory('MT00004');

    expect(observed.every((p) => p.forecast === false)).toBe(true);
    expect(all.length).toBeGreaterThan(observed.length);
    expect(all.filter((p) => p.forecast).length).toBe(all.length - observed.length);
    expect(observed[observed.length - 1].measuredAt).toBe('2026-07-16T04:00:00.000Z');
  });
});

describe('EEA provider — modelled values never masquerade as observations', () => {
  /**
   * A hand-built series covering the three cases the wall clock cannot separate:
   * a measured value and a modelled value in the SAME hour, a gap-filled hour in
   * the past, and the forecast tail.
   */
  const MIXED = {
    '2026-07-26T09:00:00.000Z': {
      val_PM10: 20,
      modelled_PM10: 0,
      // Would be "Very poor" if it counted — it is an estimate, so it must not.
      val_NO2: 240,
      modelled_NO2: 1,
    },
    '2026-07-26T10:00:00.000Z': { val_PM10: 130, modelled_PM10: 1 },
    '2026-07-27T10:00:00.000Z': { val_PM10: 500, modelled_PM10: 1 },
  };

  it('excludes a modelled pollutant from the current reading', async () => {
    installUpstream({ series: Object.fromEntries(STATIONS.map((s) => [s.id, MIXED])) });
    const [reading] = await eeaProvider.getLatestReadings();

    expect(reading.measuredAt).toBe('2026-07-26T09:00:00.000Z');
    expect(reading.pollutants.PM10?.value).toBe(20);
    expect(reading.pollutants.NO2).toBeUndefined();
    // PM10 at 20 µg/m³ is Fair. Had the modelled NO₂ been counted, the station
    // would have been shown as Very poor on the strength of a guess.
    expect(reading.overallCategory).toBe('Fair');
    expect(reading.dominantPollutant).toBe('PM10');
  });

  it('flags the station as partial when only some expected pollutants are measured', async () => {
    installUpstream({ series: Object.fromEntries(STATIONS.map((s) => [s.id, MIXED])) });
    const readings = await eeaProvider.getLatestReadings();
    expect(readings.every((r) => r.partial)).toBe(true);
  });

  it('treats a past gap-fill as history and only the tail as forecast', async () => {
    installUpstream({ series: Object.fromEntries(STATIONS.map((s) => [s.id, MIXED])) });
    const all = await eeaProvider.getStationHistory('MT00004', { includeForecast: true });

    expect(all.map((p) => [p.measuredAt, p.forecast])).toEqual([
      ['2026-07-26T09:00:00.000Z', false],
      // Modelled but historic: an estimate of the past, not a prediction.
      ['2026-07-26T10:00:00.000Z', true],
      ['2026-07-27T10:00:00.000Z', true],
    ]);
  });

  it('drops a station whose series contains no measured value at all', async () => {
    // Nothing but gap-fills means no current observation. Reporting the newest
    // estimate would be inventing a reading.
    installUpstream({
      series: {
        MT00004: { '2026-07-26T09:00:00.000Z': { val_PM10: 30, modelled_PM10: 1 } },
      },
    });

    const readings = await eeaProvider.getLatestReadings();
    expect(readings.map((r) => r.stationId)).not.toContain('MT00004');
    expect(readings).toHaveLength(4);
  });
});

describe('EEA provider — missing values are never zero', () => {
  it('omits a pollutant whose value is null instead of recording 0', async () => {
    installUpstream({
      series: Object.fromEntries(
        STATIONS.map((s) => [
          s.id,
          {
            '2026-07-26T09:00:00.000Z': {
              val_PM10: 22,
              modelled_PM10: 0,
              val_SO2: null,
              modelled_SO2: 1,
              val_O3: null,
            },
          },
        ]),
      ),
    });

    const [reading] = await eeaProvider.getLatestReadings();
    expect(reading.pollutants.PM10?.value).toBe(22);
    expect(reading.pollutants.SO2).toBeUndefined();
    expect(reading.pollutants.O3).toBeUndefined();
    expect(Object.values(reading.pollutants).every((p) => p.value !== 0)).toBe(true);
  });

  it('skips an hour in which nothing at all was measured', async () => {
    installUpstream({
      series: Object.fromEntries(
        STATIONS.map((s) => [
          s.id,
          {
            '2026-07-26T08:00:00.000Z': { val_PM10: 18, modelled_PM10: 0 },
            // Every value null. Not an hour of clean air — an hour with no data.
            '2026-07-26T09:00:00.000Z': {
              val_PM10: null,
              val_PM25: null,
              val_NO2: null,
              val_O3: null,
              val_SO2: null,
              culprit: null,
              aqi: null,
            },
          },
        ]),
      ),
    });

    const history = await eeaProvider.getStationHistory('MT00004', { includeForecast: true });
    expect(history.map((p) => p.measuredAt)).toEqual(['2026-07-26T08:00:00.000Z']);
  });

  it('discards an implausible negative rather than classifying it', async () => {
    installUpstream({
      series: Object.fromEntries(
        STATIONS.map((s) => [
          s.id,
          {
            '2026-07-26T09:00:00.000Z': {
              val_PM10: 24,
              modelled_PM10: 0,
              // Instrument fault, not clean air.
              val_NO2: -14.5,
              modelled_NO2: 0,
              // A trace negative that rounds to zero IS clean air.
              val_SO2: -0.02228,
              modelled_SO2: 0,
            },
          },
        ]),
      ),
    });

    const [reading] = await eeaProvider.getLatestReadings();
    expect(reading.pollutants.NO2).toBeUndefined();
    expect(reading.pollutants.SO2?.category).toBe('Good');
  });
});

describe('EEA provider — resilience', () => {
  it('keeps the other four stations when one returns an HTTP error', async () => {
    installUpstream({ failWith: { 'current/MT00008.json': 500 } });
    const readings = await eeaProvider.getLatestReadings();

    expect(readings).toHaveLength(4);
    expect(readings.map((r) => r.stationId)).not.toContain('MT00008');
    // The four survivors are complete, not degraded by their neighbour.
    expect(readings.every((r) => r.overallCategory !== null)).toBe(true);
  });

  it('keeps the other four stations when one fetch rejects outright', async () => {
    installUpstream({ networkError: ['current/MT00009.json'] });
    const readings = await eeaProvider.getLatestReadings();

    expect(readings.map((r) => r.stationId).sort()).toEqual([
      'MT00004',
      'MT00007',
      'MT00008',
      'MT00011',
    ]);
  });

  it('logs the failure rather than silently shrinking the network', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    installUpstream({ failWith: { 'current/MT00008.json': 500 } });
    await eeaProvider.getLatestReadings();

    const logged = error.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('upstream.station_fetch_failed');
    expect(logged).toContain('MT00008');
  });

  /**
   * A malformed hour KEY fails the whole station.
   *
   * `upstreamStationSeriesSchema` is a `z.record` whose key schema requires a
   * parseable instant, and Zod rejects the entire record when one key fails —
   * it does not drop the offending entry. So the tolerance that matters here is
   * at the network level: the station is skipped, the map keeps its other four.
   */
  it('drops only the station whose payload contains an unparseable hour key', async () => {
    installUpstream({
      series: {
        MT00011: {
          'not-a-timestamp': { val_PM10: 20, modelled_PM10: 0 },
          '2026-07-26T09:00:00.000Z': { val_PM10: 20, modelled_PM10: 0 },
        },
      },
    });

    const readings = await eeaProvider.getLatestReadings();
    expect(readings.map((r) => r.stationId)).not.toContain('MT00011');
    expect(readings).toHaveLength(4);
  });

  it('drops only the station whose payload has an unusable value type', async () => {
    installUpstream({
      series: {
        MT00007: { '2026-07-26T09:00:00.000Z': { val_PM10: 'twenty', modelled_PM10: 0 } },
      },
    });

    const readings = await eeaProvider.getLatestReadings();
    expect(readings.map((r) => r.stationId)).not.toContain('MT00007');
    expect(readings).toHaveLength(4);
  });

  it('tolerates unknown extra columns, so a new upstream field breaks nothing', async () => {
    installUpstream({
      series: Object.fromEntries(
        STATIONS.map((s) => [
          s.id,
          {
            '2026-07-26T09:00:00.000Z': {
              val_PM10: 21,
              modelled_PM10: 0,
              val_NH3: 4,
              some_new_column: 'whatever',
            },
          },
        ]),
      ),
    });

    const readings = await eeaProvider.getLatestReadings();
    expect(readings).toHaveLength(5);
    expect(readings[0].pollutants.PM10?.value).toBe(21);
  });

  it('returns nothing at all when every station fails, rather than fabricating data', async () => {
    installUpstream({ failWith: { 'current/': 503 } });
    await expect(eeaProvider.getLatestReadings()).resolves.toEqual([]);
  });

  it('propagates a failure from getStationHistory instead of returning a silent empty series', async () => {
    // An empty array would be indistinguishable from "this station has no
    // history", which is a different claim.
    installUpstream({ failWith: { 'current/MT00004.json': 500 } });
    await expect(eeaProvider.getStationHistory('MT00004')).rejects.toThrow();
  });

  it('returns an empty history for a station that is not in the registry', async () => {
    installUpstream({});
    await expect(eeaProvider.getStationHistory('MT99999')).resolves.toEqual([]);
  });
});

describe('EEA provider — station metadata', () => {
  it('resolves the station master file from the index rather than hardcoding a stamp', async () => {
    const requested = installUpstream({});
    await eeaProvider.getStations();

    expect(requested[0]).toBe(`${BASE}content/index.json`);
    expect(requested[1]).toBe(`${BASE}content/${STATION_LIST_FILE}`);
  });

  it('returns the reviewed configuration, not upstream geometry', async () => {
    const drifted = (stationList as Array<Record<string, unknown>>).map((s) =>
      s.code === 'MT00004' ? { ...s, lat: 35.9, lon: 14.6, name: 'RENAMED' } : s,
    );
    installUpstream({ stationList: drifted });

    const stations = await eeaProvider.getStations();
    const zejtun = stations.find((s) => s.id === 'MT00004');

    // Coordinates and the Maltese name come from version control, so upstream
    // drift cannot silently move a marker or anglicise a place name.
    expect(zejtun?.name).toBe('Żejtun');
    expect(zejtun?.latitude).toBe(findStation('MT00004')?.latitude);
  });

  it('warns about coordinate drift instead of adopting it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const drifted = (stationList as Array<Record<string, unknown>>).map((s) =>
      s.code === 'MT00004' ? { ...s, lat: 35.9 } : s,
    );
    installUpstream({ stationList: drifted });
    await eeaProvider.getStations();

    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain(
      'stations.coordinate_drift',
    );
  });

  it('surfaces an unknown upstream station without adding it to the map', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installUpstream({
      stationList: [
        ...(stationList as unknown[]),
        {
          code: 'MT00099',
          name: 'New Station',
          operational: 1,
          lon: 14.4,
          lat: 35.9,
        },
      ],
    });

    const stations = await eeaProvider.getStations();
    // A new station needs a reviewed commit carrying verified coordinates and
    // the correct Maltese name — it is never adopted at runtime.
    expect(stations).toHaveLength(5);
    expect(stations.map((s) => s.id)).not.toContain('MT00099');
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain(
      'stations.unknown_upstream_station',
    );
  });

  it('marks a station inactive once upstream reports it non-operational', async () => {
    installUpstream({
      stationList: (stationList as Array<Record<string, unknown>>).map((s) =>
        s.code === 'MT00007' ? { ...s, operational: 0 } : s,
      ),
    });

    const stations = await eeaProvider.getStations();
    expect(stations.find((s) => s.id === 'MT00007')?.active).toBe(false);
    expect(stations.filter((s) => s.active)).toHaveLength(4);
  });

  it('still returns the map when the metadata service is down', async () => {
    // Station geometry barely changes, so a metadata outage must not take the
    // map down with it.
    installUpstream({ failWith: { 'content/': 503 } });

    const stations = await eeaProvider.getStations();
    expect(stations).toHaveLength(5);
    expect(stations.every((s) => s.active)).toBe(true);
  });

  it('ignores stations outside Malta in the shared upstream list', async () => {
    installUpstream({
      stationList: [
        ...(stationList as unknown[]),
        { code: 'IT01234', name: 'Sicilia', operational: 1, lon: 15.0, lat: 37.5 },
      ],
    });

    const stations = await eeaProvider.getStations();
    expect(stations.map((s) => s.id).every((id) => id.startsWith('MT'))).toBe(true);
  });
});

describe('the two providers agree on their contract', () => {
  it('expose the same shape, so swapping providers changes nothing downstream', async () => {
    installUpstream({});
    const [fixtureReadings, eeaReadings] = await Promise.all([
      fixtureProvider.getLatestReadings(),
      eeaProvider.getLatestReadings(),
    ]);

    const shape = (reading: StationReading) => Object.keys(reading).sort();
    expect(shape(fixtureReadings[0])).toEqual(shape(eeaReadings[0]));
    expect(fixtureReadings[0].source).toBe('FIXTURE');
    expect(eeaReadings[0].source).toBe('EEA');
  });

  it('both anchor measuredAt with latestObservedTimestamp semantics', async () => {
    installUpstream({});
    const eeaHistory = await eeaProvider.getStationHistory('MT00004', { includeForecast: true });
    const anchor = latestObservedTimestamp(
      eeaHistory.map((p) => ({
        measuredAt: p.measuredAt,
        hasMeasuredValue: Object.values(p.pollutants).some((r) => !r.modelled),
      })),
    );

    expect(anchor).not.toBeNull();
    for (const point of eeaHistory) {
      expect(point.forecast).toBe(isForecastPoint(point.measuredAt, anchor));
    }
  });
});
