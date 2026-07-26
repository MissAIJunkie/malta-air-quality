/**
 * Fixture provider — deterministic local data for development, CI and E2E.
 *
 * Backed by REAL captured upstream payloads (`fixtures/upstream-station-sample.json`,
 * retrieved 2026-07-26), not invented numbers. That matters: fixtures that share
 * the upstream's quirks — nulls, modelled flags, a station with no O₃ — exercise
 * the same code paths production does.
 *
 * Timestamps are rebased onto the current hour so the app looks live in
 * development without any clock trickery in the UI.
 *
 * This provider is NEVER a fallback for a failing live provider. Selecting it
 * requires `AIR_QUALITY_PROVIDER=fixture`, and `meta.source` reports `FIXTURE`
 * so fixture data can never be mistaken for production readings.
 */

import sample from '../../../../fixtures/upstream-station-sample.json';
import { POLLUTANT_CODES, type PollutantCode } from '@/config/pollutants';
import { STATIONS, findStation } from '@/config/stations';
import { buildPollutantReading, calculateOverall } from '../calculate-index';
import { ageInHours, classifyFreshness, isForecastPoint, latestObservedTimestamp } from '../freshness';
import type {
  AirQualityProvider,
  AirQualityStation,
  HistoricalReading,
  HistoryOptions,
  PollutantReading,
  StationReading,
} from '../types';

type RawHour = Record<string, number | string | null | undefined>;

const RAW = sample as Record<string, RawHour>;
const RAW_HOURS = Object.keys(RAW).sort();

/**
 * Deterministic per-station variation.
 *
 * Real stations differ; a fixture where all five read identically would hide
 * bugs in dominant-pollutant selection and marker colouring. The offset is
 * derived from the station id so runs are reproducible.
 */
function stationOffset(stationId: string): number {
  let hash = 0;
  for (const ch of stationId) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return 0.75 + (hash % 60) / 100;
}

function currentHourMs(): number {
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  return now.getTime();
}

type Point = {
  measuredAt: string;
  readings: Partial<Record<PollutantCode, PollutantReading>>;
  hasMeasuredValue: boolean;
};

/**
 * Rebase the captured window onto the present.
 *
 * The newest captured hour becomes "two hours ago", leaving a couple of
 * forecast hours ahead — mirroring production, where the series always extends
 * into the future.
 */
function buildPoints(stationId: string): Point[] {
  const station = findStation(stationId);
  const factor = stationOffset(stationId);
  const anchor = currentHourMs() + 2 * 3_600_000;
  const newestRaw = Date.parse(RAW_HOURS[RAW_HOURS.length - 1]);

  const points: Point[] = [];

  for (const key of RAW_HOURS) {
    const shifted = new Date(Date.parse(key) - newestRaw + anchor);
    const measuredAt = shifted.toISOString();
    const isFuture = shifted.getTime() > currentHourMs();
    const row = RAW[key];

    const readings: Partial<Record<PollutantCode, PollutantReading>> = {};
    let hasMeasuredValue = false;

    for (const code of POLLUTANT_CODES) {
      // Msida genuinely reports no ozone; preserving that keeps the
      // "unavailable pollutant" path exercised.
      if (station && !station.expectedPollutants.includes(code)) continue;

      const raw = row[`val_${code}`];
      if (raw === null || raw === undefined || typeof raw !== 'number') continue;

      const modelled = isFuture || row[`modelled_${code}`] === 1;
      const reading = buildPollutantReading(code, Math.max(0, raw * factor), { modelled });
      if (reading.value === null) continue;

      readings[code] = reading;
      if (!modelled) hasMeasuredValue = true;
    }

    if (Object.keys(readings).length === 0) continue;
    points.push({ measuredAt, readings, hasMeasuredValue });
  }

  return points;
}

export class FixtureAirQualityProvider implements AirQualityProvider {
  readonly name = 'FIXTURE' as const;

  async getStations(): Promise<AirQualityStation[]> {
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
      active: station.active,
    }));
  }

  async getLatestReadings(): Promise<StationReading[]> {
    const fetchedAt = new Date().toISOString();

    return STATIONS.map((station) => {
      const points = buildPoints(station.id);
      const measuredAt = latestObservedTimestamp(points) ?? fetchedAt;
      const point = points.find((p) => p.measuredAt === measuredAt);

      const measuredOnly: Partial<Record<PollutantCode, PollutantReading>> = {};
      for (const [code, reading] of Object.entries(point?.readings ?? {}) as Array<
        [PollutantCode, PollutantReading]
      >) {
        if (!reading.modelled) measuredOnly[code] = reading;
      }

      const overall = calculateOverall(measuredOnly);

      return {
        stationId: station.id,
        measuredAt,
        fetchedAt,
        timezone: 'Europe/Malta' as const,
        overallCategory: overall.category,
        overallSubIndex: overall.subIndex,
        dominantPollutant: overall.dominantPollutant,
        pollutants: measuredOnly,
        provisional: true,
        freshness: classifyFreshness(measuredAt, fetchedAt),
        ageHours: ageInHours(measuredAt, fetchedAt) ?? 0,
        partial: Object.keys(measuredOnly).length < station.expectedPollutants.length,
        source: 'FIXTURE' as const,
      };
    });
  }

  async getStationHistory(stationId: string, options: HistoryOptions = {}): Promise<HistoricalReading[]> {
    const station = findStation(stationId);
    if (!station) return [];

    const points = buildPoints(station.id);
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

export const fixtureProvider = new FixtureAirQualityProvider();
