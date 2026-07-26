/**
 * Air-quality service — the single entry point every route handler uses.
 *
 * Owns provider selection, caching, the Malta-wide summary, and the response
 * envelope. Route handlers stay thin: no route talks to a provider directly, and
 * no browser ever reaches upstream.
 */

import 'server-only';

import { getEnv } from '@/config/env';
import { STATIONS, findStation } from '@/config/stations';
import { categoryRank } from '@/config/thresholds';
import { cached } from '@/lib/cache/upstash';
import { cacheKeys, cachePolicy } from '@/lib/cache/keys';
import { eeaProvider } from './providers/eea-provider';
import { eraProvider } from './providers/era-provider';
import { fixtureProvider } from './providers/fixture-provider';
import { classifyFreshness, isStale, nextExpectedUpdate, worstFreshness } from './freshness';
import type {
  AirQualityProvider,
  AirQualityStation,
  HistoricalReading,
  HistoryOptions,
  MaltaSummary,
  ResponseMeta,
  StationReading,
} from './types';

export function getProvider(): AirQualityProvider {
  switch (getEnv().AIR_QUALITY_PROVIDER) {
    case 'fixture':
      return fixtureProvider;
    case 'era':
      return eraProvider;
    case 'eea':
    default:
      return eeaProvider;
  }
}

export type ReadingsResult = {
  readings: StationReading[];
  meta: ResponseMeta;
};

export async function getLatestReadings(): Promise<ReadingsResult> {
  const provider = getProvider();
  const fetchedAt = new Date().toISOString();

  const result = await cached(
    cacheKeys.latestReadings(provider.name),
    cachePolicy.latestReadings,
    () => provider.getLatestReadings(),
  );

  const readings = result.value;
  const newest = readings.reduce<string | null>((acc, r) => {
    if (!acc) return r.measuredAt;
    return Date.parse(r.measuredAt) > Date.parse(acc) ? r.measuredAt : acc;
  }, null);

  const freshness = worstFreshness(readings.map((r) => r.freshness));

  return {
    readings,
    meta: {
      source: provider.name,
      measuredAt: newest,
      fetchedAt,
      nextExpectedUpdateAt: nextExpectedUpdate(newest),
      // Stale if the DATA is old or if we are knowingly serving a cached copy
      // after an upstream failure. Either way it must not be called live.
      stale: isStale(freshness) || result.stale,
      partial: readings.length < STATIONS.length || readings.some((r) => r.partial),
      cached: result.cached,
      ...(result.degradedReason ? { degradedReason: result.degradedReason } : {}),
    },
  };
}

export async function getStations(): Promise<{ stations: AirQualityStation[]; meta: ResponseMeta }> {
  const provider = getProvider();
  const fetchedAt = new Date().toISOString();

  const result = await cached(cacheKeys.stations(provider.name), cachePolicy.stations, () =>
    provider.getStations(),
  );

  return {
    stations: result.value,
    meta: {
      source: provider.name,
      measuredAt: null,
      fetchedAt,
      nextExpectedUpdateAt: null,
      stale: result.stale,
      partial: false,
      cached: result.cached,
      ...(result.degradedReason ? { degradedReason: result.degradedReason } : {}),
    },
  };
}

export async function getStationHistory(
  stationId: string,
  options: HistoryOptions = {},
): Promise<HistoricalReading[]> {
  const provider = getProvider();
  const station = findStation(stationId);
  if (!station) return [];
  if (!provider.getStationHistory) return [];

  const window = `${options.from ?? 'all'}:${options.to ?? 'now'}:${options.includeForecast ? 'fc' : 'obs'}`;
  const result = await cached(
    cacheKeys.stationHistory(provider.name, station.id, window),
    cachePolicy.stationHistory,
    () => provider.getStationHistory!(station.id, options),
  );

  return result.value;
}

/**
 * Malta-wide summary.
 *
 * Aggregation is **worst reporting station**, matching how the per-station
 * category is itself the worst pollutant. It is deliberately conservative: a
 * median or average would let one bad station disappear behind four good ones,
 * which is the wrong failure mode for a health-relevant signal.
 *
 * `aggregation` is returned so the UI can state the method rather than
 * presenting an unexplained headline — the brief requires an island-wide summary
 * only if its methodology is transparent.
 */
export function summariseMalta(readings: StationReading[], nowIso: string): MaltaSummary {
  const reporting = readings.filter((r) => r.overallCategory !== null);

  let worst: StationReading | null = null;
  for (const reading of reporting) {
    if (!worst) {
      worst = reading;
      continue;
    }
    const delta = categoryRank(reading.overallCategory!) - categoryRank(worst.overallCategory!);
    if (delta > 0 || (delta === 0 && (reading.overallSubIndex ?? 0) > (worst.overallSubIndex ?? 0))) {
      worst = reading;
    }
  }

  const newest = reporting.reduce<string | null>((acc, r) => {
    if (!acc) return r.measuredAt;
    return Date.parse(r.measuredAt) > Date.parse(acc) ? r.measuredAt : acc;
  }, null);

  return {
    category: worst?.overallCategory ?? null,
    dominantPollutant: worst?.dominantPollutant ?? null,
    aggregation: 'worst-station',
    drivingStationId: worst?.stationId ?? null,
    reportingStations: reporting.length,
    totalStations: STATIONS.length,
    staleStations: readings.filter((r) => isStale(r.freshness)).length,
    measuredAt: newest,
    freshness: newest ? classifyFreshness(newest, nowIso) : 'unavailable',
  };
}
