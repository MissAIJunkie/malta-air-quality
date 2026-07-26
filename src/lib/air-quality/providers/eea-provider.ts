/**
 * EEA European AQI dissemination provider — the verified live source.
 *
 * Endpoint structure and semantics are documented in docs/DATA_SOURCE.md §3–§5.
 * Two facts drive most of the logic here:
 *
 *   1. Each `current/<code>.json` carries ~10 days of history AND ~48 hours of
 *      CAMS forecast. The newest key is in the FUTURE.
 *   2. `modelled_* == 1` marks a value as modelled — which happens both for
 *      forecast hours and for gap-filled hours in the past.
 *
 * So a station's `measuredAt` is the newest hour with a genuinely measured
 * value, never the newest key. Getting this wrong would present a forecast as a
 * live reading.
 */

import { POLLUTANT_CODES, type PollutantCode } from '@/config/pollutants';
import { STATIONS, findStation } from '@/config/stations';
import { getEnv } from '@/config/env';
import { assertAllowedUrl } from '@/lib/security/allowlist';
import { logger } from '@/lib/monitoring/logger';
import {
  upstreamContentIndexSchema,
  upstreamStationListSchema,
  upstreamStationSeriesSchema,
  type UpstreamHourly,
} from '../schemas';
import { buildPollutantReading, calculateOverall } from '../calculate-index';
import {
  ageInHours,
  classifyFreshness,
  isForecastPoint,
  latestObservedTimestamp,
} from '../freshness';
import type {
  AirQualityProvider,
  AirQualityStation,
  HistoricalReading,
  HistoryOptions,
  PollutantReading,
  StationReading,
} from '../types';

const FETCH_TIMEOUT_MS = 10_000;

function baseUrl(): string {
  const url = getEnv().EEA_AIR_QUALITY_URL;
  return url.endsWith('/') ? url : `${url}/`;
}

/** Fetch + validate JSON from an allowlisted host, with a hard timeout. */
async function fetchJson<T>(url: string, schema: { parse: (v: unknown) => T }, label: string): Promise<T> {
  const safe = assertAllowedUrl(url);
  const started = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(safe, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      // The route handler owns caching (Redis + revalidate); Next's fetch cache
      // would add a second, harder-to-reason-about layer.
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`upstream responded ${response.status}`);
    }

    const json: unknown = await response.json();
    const parsed = schema.parse(json);

    logger.info('upstream.fetch', {
      label,
      host: safe.hostname,
      status: response.status,
      durationMs: Date.now() - started,
    });

    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the current station master filename.
 *
 * The stamp in `raw_stations.json.<stamp>` changes whenever the EEA republishes
 * the list, so it is always read from `content/index.json` and never hardcoded.
 */
async function resolveStationListUrl(): Promise<string> {
  const index = await fetchJson(
    `${baseUrl()}content/index.json`,
    upstreamContentIndexSchema,
    'content-index',
  );
  const filename = index.contents[index.contents.length - 1];
  return `${baseUrl()}content/${filename}`;
}

function toPollutantReadings(hour: UpstreamHourly): {
  readings: Partial<Record<PollutantCode, PollutantReading>>;
  hasMeasuredValue: boolean;
} {
  const readings: Partial<Record<PollutantCode, PollutantReading>> = {};
  let hasMeasuredValue = false;

  for (const code of POLLUTANT_CODES) {
    const raw = hour[`val_${code}`];
    const modelledFlag = hour[`modelled_${code}`];

    // Absent or null means NOT MEASURED. It is skipped entirely rather than
    // recorded as zero.
    if (raw === null || raw === undefined) continue;

    const value = typeof raw === 'number' ? raw : null;
    if (value === null) continue;

    const modelled = modelledFlag === 1;
    const reading = buildPollutantReading(code, value, { modelled });

    // A value we could not classify (implausible negative) is not a measurement.
    if (reading.value === null) continue;

    readings[code] = reading;
    if (!modelled) hasMeasuredValue = true;
  }

  return { readings, hasMeasuredValue };
}

type ParsedSeries = {
  points: Array<{
    measuredAt: string;
    readings: Partial<Record<PollutantCode, PollutantReading>>;
    hasMeasuredValue: boolean;
  }>;
};

function parseSeries(raw: Record<string, UpstreamHourly>, stationId: string): ParsedSeries {
  const points: ParsedSeries['points'] = [];
  let dropped = 0;

  for (const [measuredAt, hour] of Object.entries(raw)) {
    if (!Number.isFinite(Date.parse(measuredAt))) {
      dropped += 1;
      continue;
    }
    const { readings, hasMeasuredValue } = toPollutantReadings(hour);
    if (Object.keys(readings).length === 0) continue;
    points.push({ measuredAt, readings, hasMeasuredValue });
  }

  if (dropped > 0) {
    logger.warn('upstream.unparseable_hours', { stationId, dropped });
  }

  points.sort((a, b) => Date.parse(a.measuredAt) - Date.parse(b.measuredAt));
  return { points };
}

async function fetchStationSeries(stationId: string): Promise<ParsedSeries> {
  const raw = await fetchJson(
    `${baseUrl()}current/${stationId}.json`,
    upstreamStationSeriesSchema,
    `station:${stationId}`,
  );
  return parseSeries(raw as Record<string, UpstreamHourly>, stationId);
}

export class EeaAirQualityProvider implements AirQualityProvider {
  readonly name = 'EEA' as const;

  /**
   * Station list.
   *
   * Coordinates come from `src/config/stations.ts`, which was populated from
   * this same upstream and is reviewed in version control. We still fetch the
   * live list to detect drift — a station going non-operational, or a new one
   * appearing — but we do not silently adopt upstream geometry at runtime.
   */
  async getStations(): Promise<AirQualityStation[]> {
    let operational = new Set(STATIONS.map((s) => s.id));

    try {
      const listUrl = await resolveStationListUrl();
      const all = await fetchJson(listUrl, upstreamStationListSchema, 'station-list');
      const maltese = all.filter((s) => s.code.startsWith('MT'));

      operational = new Set(maltese.filter((s) => s.operational === 1).map((s) => s.code));

      const known = new Set(STATIONS.map((s) => s.id));
      const unexpected = maltese.filter((s) => s.operational === 1 && !known.has(s.code));
      if (unexpected.length > 0) {
        // Surfaced, not auto-adopted: a new station needs a reviewed commit with
        // its verified coordinates and correct Maltese name.
        logger.warn('stations.unknown_upstream_station', {
          codes: unexpected.map((s) => s.code),
        });
      }

      for (const station of STATIONS) {
        const upstream = maltese.find((s) => s.code === station.id);
        if (!upstream) continue;
        const drift =
          Math.abs(upstream.lat - station.latitude) > 1e-4 ||
          Math.abs(upstream.lon - station.longitude) > 1e-4;
        if (drift) {
          logger.warn('stations.coordinate_drift', {
            stationId: station.id,
            configured: [station.latitude, station.longitude],
            upstream: [upstream.lat, upstream.lon],
          });
        }
      }
    } catch (error) {
      // Station geometry is static enough that a metadata outage must not take
      // the map down.
      logger.warn('stations.metadata_unavailable', { error: String(error) });
    }

    return STATIONS.map((station) => ({
      id: station.id,
      slug: station.slug,
      name: station.name,
      locality: station.locality,
      island: station.island,
      latitude: station.latitude,
      longitude: station.longitude,
      altitudeMetres: station.altitudeMetres,
      stationType: station.stationType,
      areaClassification: station.areaClassification,
      pollutantsMeasured: station.expectedPollutants,
      operator: station.operator,
      sourceUrl: station.sourceUrl,
      active: station.active && operational.has(station.id),
    }));
  }

  async getLatestReadings(): Promise<StationReading[]> {
    const fetchedAt = new Date().toISOString();

    const settled = await Promise.allSettled(
      STATIONS.map(async (station) => {
        const series = await fetchStationSeries(station.id);
        return { station, series };
      }),
    );

    const readings: StationReading[] = [];

    for (const [index, result] of settled.entries()) {
      const station = STATIONS[index];

      if (result.status === 'rejected') {
        // One station failing must not blank the others. It is simply absent
        // from the response, and `meta.partial` tells the client.
        logger.error('upstream.station_fetch_failed', {
          stationId: station.id,
          error: String(result.reason),
        });
        continue;
      }

      const { points } = result.value.series;

      const measuredAt = latestObservedTimestamp(points);
      if (!measuredAt) {
        logger.warn('upstream.no_measured_values', { stationId: station.id });
        continue;
      }

      const point = points.find((p) => p.measuredAt === measuredAt);
      if (!point) continue;

      // Only directly measured pollutants describe the CURRENT state. Modelled
      // gap-fills within the same hour are excluded so the headline category is
      // never driven by an estimate presented as an observation.
      const measuredOnly: Partial<Record<PollutantCode, PollutantReading>> = {};
      for (const [code, reading] of Object.entries(point.readings) as Array<
        [PollutantCode, PollutantReading]
      >) {
        if (!reading.modelled) measuredOnly[code] = reading;
      }

      const overall = calculateOverall(measuredOnly);
      const freshness = classifyFreshness(measuredAt, fetchedAt);

      readings.push({
        stationId: station.id,
        measuredAt,
        fetchedAt,
        timezone: 'Europe/Malta',
        overallCategory: overall.category,
        overallSubIndex: overall.subIndex,
        dominantPollutant: overall.dominantPollutant,
        pollutants: measuredOnly,
        // E2a is unverified data by definition.
        provisional: true,
        freshness,
        ageHours: ageInHours(measuredAt, fetchedAt) ?? 0,
        partial: Object.keys(measuredOnly).length < station.expectedPollutants.length,
        source: 'EEA',
      });
    }

    return readings;
  }

  async getStationHistory(stationId: string, options: HistoryOptions = {}): Promise<HistoricalReading[]> {
    const station = findStation(stationId);
    if (!station) return [];

    const { points } = await fetchStationSeries(station.id);
    const latestObserved = latestObservedTimestamp(points);

    const from = options.from ? Date.parse(options.from) : Number.NEGATIVE_INFINITY;
    const to = options.to ? Date.parse(options.to) : Number.POSITIVE_INFINITY;

    const out: HistoricalReading[] = [];

    for (const point of points) {
      const t = Date.parse(point.measuredAt);
      if (t < from || t >= to) continue;

      const forecast = isForecastPoint(point.measuredAt, latestObserved);
      if (forecast && !options.includeForecast) continue;

      const overall = calculateOverall(point.readings);

      out.push({
        stationId: station.id,
        measuredAt: point.measuredAt,
        pollutants: point.readings,
        overallCategory: overall.category,
        dominantPollutant: overall.dominantPollutant,
        forecast,
      });
    }

    return out;
  }
}

export const eeaProvider = new EeaAirQualityProvider();
