/**
 * EEA / CAMS forecast provider.
 *
 * No new upstream and no new model. The forecast is already inside the payload
 * `air-quality/service.ts` fetches: each `current/<code>.json` carries roughly
 * ten days of history *and* roughly 48 hours of CAMS-modelled hours beyond the
 * newest measurement. This provider does one thing — split that series honestly.
 *
 * The split rule is the subtle part, and getting it wrong would put a forecast
 * on the live tile. It is **not** `timestamp > now`. The upstream gap-fills
 * *past* hours with modelled values too, so a point eleven days old can still be
 * an estimate, and the wall clock cannot distinguish the two cases. The
 * discriminator is `HistoricalReading.forecast`, which
 * `air-quality/freshness.ts` derives from the newest hour carrying a genuine
 * measurement. That is why this file never compares a timestamp to `Date.now()`.
 *
 * Caching stores only the split series, which is a function of the upstream
 * payload alone. Confidence, drivers and lead times all depend on `now`, so
 * they are computed per request in `calculate.ts` — a 59-minute-old cached
 * "next 12 hours" would be a lie about a different 12 hours.
 */

import { findStation } from '@/config/stations';
import { POLLUTANTS, type PollutantCode } from '@/config/pollutants';
import { calculateOverall } from '@/lib/air-quality/calculate-index';
import { getProvider, getStationHistory } from '@/lib/air-quality/service';
import type { HistoricalReading, ProviderSource } from '@/lib/air-quality/types';
import { cached } from '@/lib/cache/upstash';
import { cacheKeys, cachePolicy } from '@/lib/cache/keys';
import { logger } from '@/lib/monitoring/logger';
import { assessConfidence, horizonHours } from '../confidence';
import {
  EXPECTED_FORECAST_HOURS,
  FORECAST_METHODOLOGY_LABEL,
  FORECAST_METHODOLOGY_LABEL_KEY,
  forecastPointSourceFor,
} from '../types';
import type { EnrichedForecastPoint, PollutantForecastSeries } from '../types';

/**
 * Hours of observation kept alongside the forecast.
 *
 * The trend drivers compare the outlook against what has just happened, and a
 * day of context is enough to establish that without shipping the full ten-day
 * series to the client.
 */
export const OBSERVED_TAIL_HOURS = 24;

export type CamsForecastSeries = {
  stationId: string;
  /** Newest hour carrying a real measurement. `null` when the station is silent. */
  basedOnObservationAt: string | null;
  /** Trailing observations, oldest first. The baseline for trend drivers. */
  observed: HistoricalReading[];
  /** Modelled hours beyond the newest observation, oldest first. */
  forecast: HistoricalReading[];
  source: ProviderSource;
};

export type CamsForecastResult = {
  series: CamsForecastSeries;
  cached: boolean;
  stale: boolean;
  degradedReason?: string;
};

function emptySeries(stationId: string, source: ProviderSource): CamsForecastSeries {
  return { stationId, basedOnObservationAt: null, observed: [], forecast: [], source };
}

async function loadSeries(stationId: string, source: ProviderSource): Promise<CamsForecastSeries> {
  const history = await getStationHistory(stationId, { includeForecast: true });
  if (history.length === 0) return emptySeries(stationId, source);

  const ordered = [...history].sort((a, b) => Date.parse(a.measuredAt) - Date.parse(b.measuredAt));

  const observedAll = ordered.filter((point) => !point.forecast);
  const forecast = ordered.filter((point) => point.forecast);

  const basedOnObservationAt = observedAll.at(-1)?.measuredAt ?? null;

  // Trim by timestamp rather than by count: an hour missing from the upstream
  // series must shorten the window, not silently widen it.
  const cutoff = basedOnObservationAt
    ? Date.parse(basedOnObservationAt) - OBSERVED_TAIL_HOURS * 3_600_000
    : Number.NEGATIVE_INFINITY;

  return {
    stationId,
    basedOnObservationAt,
    observed: observedAll.filter((point) => Date.parse(point.measuredAt) >= cutoff),
    forecast,
    source,
  };
}

/**
 * Whether the station's most recent observation is missing pollutants it
 * normally measures.
 *
 * This is what "the station is partial" means, and it is deliberately measured
 * against the OBSERVATIONS. Judging it from the forecast instead would mark
 * every Maltese station permanently partial, because CAMS publishes no SO₂
 * forecast for them — a fact about the model, not about the station. Modelled
 * gap-fills are excluded for the same reason: a gap that has been filled is
 * still a gap.
 */
export function isStationPartial(
  series: CamsForecastSeries,
  expectedPollutants: PollutantCode[],
): boolean {
  const latest = series.observed.at(-1);
  if (!latest || expectedPollutants.length === 0) return false;

  const measured = expectedPollutants.filter((code) => {
    const reading = latest.pollutants[code];
    return reading !== undefined && reading.value !== null && !reading.modelled;
  });

  return measured.length < expectedPollutants.length;
}

/**
 * The split series for one station.
 *
 * An unknown station, a provider with no history support (the ERA stub), or an
 * upstream failure all yield an empty series rather than an error: the forecast
 * panel must be able to say "no forecast is published for this station" without
 * taking the page with it.
 */
export async function getStationForecastSeries(stationId: string): Promise<CamsForecastResult> {
  const provider = getProvider();
  const station = findStation(stationId);

  if (!station) {
    return { series: emptySeries(stationId, provider.name), cached: false, stale: false };
  }

  try {
    // Namespaced by provider, matching `latestReadings` and `stationHistory`.
    // Without it a fixture-built series could be served while the app believes
    // it is running against the EEA, and the response would carry the wrong
    // provenance for data that never came from there.
    const result = await cached(
      cacheKeys.forecast(`${provider.name}:${station.id}`),
      cachePolicy.forecast,
      () => loadSeries(station.id, provider.name),
    );

    return {
      series: result.value,
      cached: result.cached,
      stale: result.stale,
      ...(result.degradedReason ? { degradedReason: result.degradedReason } : {}),
    };
  } catch (error) {
    logger.warn('forecast.series_unavailable', { stationId: station.id, error: String(error) });
    return {
      series: emptySeries(station.id, provider.name),
      cached: false,
      stale: true,
      degradedReason: 'upstream_unavailable',
    };
  }
}

/* -------------------------------------------------------------------------- */
/*  Point construction                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Fraction of a station's expected pollutants present in a modelled hour.
 *
 * Feeds the confidence assessment: a "forecast" resting on one pollutant out of
 * five is a much weaker statement than one resting on all of them.
 */
function pollutantCoverage(point: HistoricalReading, expected: PollutantCode[]): number {
  if (expected.length === 0) return 1;
  const present = expected.filter(
    (code) => point.pollutants[code]?.value !== null && point.pollutants[code] !== undefined,
  );
  return present.length / expected.length;
}

/**
 * Round a sub-index for transport.
 *
 * The continuous sub-index is a display and ordering quantity, and JSON
 * serialises it at full double precision — `2.4444444444444446` costs eighteen
 * characters on every one of well over a thousand points. Three decimals is
 * finer than any band boundary by four orders of magnitude, so nothing is lost
 * but the bytes.
 */
function roundSubIndex(subIndex: number | null): number | null {
  if (subIndex === null || !Number.isFinite(subIndex)) return null;
  return Math.round(subIndex * 1000) / 1000;
}

type PointOptions = {
  nowIso: string;
  stationPartial: boolean;
  expectedPollutants: PollutantCode[];
  availableHours: number;
};

/**
 * Build the hourly overall points.
 *
 * Pure: `nowIso` is a parameter, so the same series always produces the same
 * points for a given reference instant. Confidence is per point because lead
 * time is what it depends on — hour 2 of an outlook is not as uncertain as hour
 * 44 of the same one.
 */
export function buildForecastPoints(
  series: CamsForecastSeries,
  options: PointOptions,
): EnrichedForecastPoint[] {
  const points: EnrichedForecastPoint[] = [];

  for (const hour of series.forecast) {
    const overall = calculateOverall(hour.pollutants);
    const lead = horizonHours(hour.measuredAt, options.nowIso);

    const { confidence } = assessConfidence({
      horizonHours: lead,
      availableHours: options.availableHours,
      expectedHours: EXPECTED_FORECAST_HOURS,
      stationPartial: options.stationPartial,
      pollutantCoverage: pollutantCoverage(hour, options.expectedPollutants),
    });

    points.push({
      forecastAt: hour.measuredAt,
      stationId: series.stationId,
      predictedCategory: overall.category,
      predictedSubIndex: roundSubIndex(overall.subIndex),
      dominantPollutant: overall.dominantPollutant,
      confidence,
      // Drivers are attached by `calculate.ts`, which is the only place that
      // knows about weather and aerosol context.
      drivers: [],
      source: forecastPointSourceFor(series.source),
      estimated: true,
      methodology: FORECAST_METHODOLOGY_LABEL,
      methodologyKey: FORECAST_METHODOLOGY_LABEL_KEY,
      horizonHours: lead === null ? 0 : Math.max(0, Math.round(lead)),
    });
  }

  return points;
}

/**
 * Per-pollutant forecast series.
 *
 * Only pollutants the modelled hours actually contain appear. A station that
 * reports no ozone (Msida) gets no ozone forecast, rather than an empty line on
 * a chart that implies a measurement of zero.
 */
export function buildPollutantSeries(
  series: CamsForecastSeries,
  options: PointOptions,
): PollutantForecastSeries[] {
  const byPollutant = new Map<PollutantCode, EnrichedForecastPoint[]>();

  for (const hour of series.forecast) {
    const lead = horizonHours(hour.measuredAt, options.nowIso);
    const coverage = pollutantCoverage(hour, options.expectedPollutants);

    for (const [code, reading] of Object.entries(hour.pollutants) as Array<
      [PollutantCode, NonNullable<HistoricalReading['pollutants'][PollutantCode]>]
    >) {
      if (reading.value === null) continue;

      const { confidence } = assessConfidence({
        horizonHours: lead,
        availableHours: options.availableHours,
        expectedHours: EXPECTED_FORECAST_HOURS,
        stationPartial: options.stationPartial,
        pollutantCoverage: coverage,
      });

      const list = byPollutant.get(code) ?? [];
      list.push({
        forecastAt: hour.measuredAt,
        stationId: series.stationId,
        pollutant: code,
        predictedValue: reading.value,
        predictedCategory: reading.category,
        predictedSubIndex: roundSubIndex(reading.subIndex),
        dominantPollutant: code,
        confidence,
        drivers: [],
        source: forecastPointSourceFor(series.source),
        estimated: true,
        methodology: FORECAST_METHODOLOGY_LABEL,
        methodologyKey: FORECAST_METHODOLOGY_LABEL_KEY,
        horizonHours: lead === null ? 0 : Math.max(0, Math.round(lead)),
        unit: reading.unit,
      });
      byPollutant.set(code, list);
    }
  }

  const out: PollutantForecastSeries[] = [];
  // Iterate the registry, not the map, so pollutant order is stable across
  // responses regardless of upstream key order.
  for (const code of Object.keys(POLLUTANTS) as PollutantCode[]) {
    const points = byPollutant.get(code);
    if (!points || points.length === 0) continue;
    out.push({ pollutant: code, unit: POLLUTANTS[code].unit, points });
  }

  return out;
}
