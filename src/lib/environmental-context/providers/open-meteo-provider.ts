/**
 * Open-Meteo weather provider.
 *
 * Chosen because it needs no API key, publishes under CC BY 4.0, and serves
 * ECMWF and DWD model output — so the meteorological context beside a reading
 * comes from the same class of model a national forecaster uses, not from
 * anything maqua.app invented.
 *
 * Two details of the API drive the code below and would look like mistakes
 * without explanation:
 *
 *   1. Timestamps come back *naive* — `2026-07-26T00:00`, no offset — with the
 *      offset carried separately in `utc_offset_seconds`. Appending `Z` is only
 *      correct while that field is 0, so it is asserted rather than assumed.
 *   2. The response is parallel arrays. The schema proves the shape; only a
 *      length check proves that `wind_speed_10m[7]` really describes `time[7]`.
 *
 * One point is sampled, at the centroid of the islands. Malta is 27 km across;
 * five separate grid requests would return near-identical values from the same
 * model cell while quintupling the load on a free public service.
 */

import { MALTA_CENTRE } from '@/config/stations';
import { assertAllowedUrl } from '@/lib/security/allowlist';
import { logger } from '@/lib/monitoring/logger';
import { openMeteoForecastResponseSchema } from '../schemas';
import { classifyWeatherEvents, OPEN_METEO_WEATHER_SOURCE } from '../classify-event';
import type { EnrichedContextEvent, WeatherContext, WeatherHour } from '../types';

const FETCH_TIMEOUT_MS = 8_000;

/** Days of hourly output requested. Three covers the 48-hour AQI forecast plus slack. */
export const WEATHER_FORECAST_DAYS = 3;

const HOURLY_VARIABLES = [
  'temperature_2m',
  'relative_humidity_2m',
  'dew_point_2m',
  'precipitation',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'boundary_layer_height',
  'surface_pressure',
  'cloud_cover',
  // ~500 m above the surface. Only used for the inversion proxy.
  'temperature_950hPa',
] as const;

const [longitude, latitude] = MALTA_CENTRE;

export function buildWeatherUrl(): string {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', latitude.toFixed(4));
  url.searchParams.set('longitude', longitude.toFixed(4));
  url.searchParams.set('hourly', HOURLY_VARIABLES.join(','));
  // UTC throughout. Local-time conversion is a presentation concern and is done
  // once, in the i18n layer, against Europe/Malta.
  url.searchParams.set('timezone', 'UTC');
  url.searchParams.set('forecast_days', String(WEATHER_FORECAST_DAYS));
  url.searchParams.set('past_days', '1');
  return url.toString();
}

/**
 * Convert an Open-Meteo naive local timestamp to an ISO-8601 UTC instant.
 *
 * Returns null rather than guessing when the string is not the expected shape,
 * so a format change drops the hour instead of shifting the whole series.
 */
export function toUtcInstant(naive: string): string | null {
  const alreadyZoned = /(Z|[+-]\d{2}:?\d{2})$/.test(naive);
  const parsed = Date.parse(alreadyZoned ? naive : `${naive}Z`);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

/**
 * Read one hourly series, guaranteeing alignment with `time`.
 *
 * A series of the wrong length is discarded entirely: silently truncating it
 * would attach one hour's wind speed to another hour's timestamp, which is a
 * far worse failure than the variable being unavailable.
 */
function alignedSeries(
  series: (number | null)[] | undefined,
  expectedLength: number,
  label: string,
): (number | null)[] {
  if (!series) return new Array<number | null>(expectedLength).fill(null);
  if (series.length !== expectedLength) {
    logger.warn('context.open_meteo_series_misaligned', {
      label,
      expected: expectedLength,
      received: series.length,
    });
    return new Array<number | null>(expectedLength).fill(null);
  }
  return series;
}

function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function fetchWeatherContext(): Promise<WeatherContext> {
  const url = buildWeatherUrl();
  const safe = assertAllowedUrl(url);
  const started = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(safe, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      // Caching is owned by the service layer (Redis plus an in-process
      // fallback); Next's fetch cache would be a second, opaque one.
      cache: 'no-store',
    });

    if (!response.ok) throw new Error(`open-meteo responded ${response.status}`);

    const parsed = openMeteoForecastResponseSchema.parse(await response.json());

    if (parsed.utc_offset_seconds !== 0) {
      // The request asks for UTC. If the response is not in UTC, every
      // timestamp would be silently wrong by a whole number of hours.
      throw new Error(`open-meteo returned a non-UTC offset (${parsed.utc_offset_seconds}s)`);
    }

    const fetchedAt = new Date().toISOString();
    const times = parsed.hourly.time;
    const length = times.length;

    const temperature = alignedSeries(parsed.hourly.temperature_2m, length, 'temperature_2m');
    const humidity = alignedSeries(
      parsed.hourly.relative_humidity_2m,
      length,
      'relative_humidity_2m',
    );
    const dewPoint = alignedSeries(parsed.hourly.dew_point_2m, length, 'dew_point_2m');
    const precipitation = alignedSeries(parsed.hourly.precipitation, length, 'precipitation');
    const windSpeed = alignedSeries(parsed.hourly.wind_speed_10m, length, 'wind_speed_10m');
    const windDirection = alignedSeries(
      parsed.hourly.wind_direction_10m,
      length,
      'wind_direction_10m',
    );
    const windGust = alignedSeries(parsed.hourly.wind_gusts_10m, length, 'wind_gusts_10m');
    const blh = alignedSeries(parsed.hourly.boundary_layer_height, length, 'boundary_layer_height');
    const pressure = alignedSeries(parsed.hourly.surface_pressure, length, 'surface_pressure');
    const cloud = alignedSeries(parsed.hourly.cloud_cover, length, 'cloud_cover');
    const temp950 = alignedSeries(parsed.hourly.temperature_950hPa, length, 'temperature_950hPa');

    const hours: WeatherHour[] = [];
    let droppedHours = 0;

    for (let i = 0; i < length; i += 1) {
      const time = toUtcInstant(times[i]);
      if (!time) {
        droppedHours += 1;
        continue;
      }

      hours.push({
        time,
        temperatureC: finite(temperature[i]),
        relativeHumidityPct: finite(humidity[i]),
        dewPointC: finite(dewPoint[i]),
        precipitationMm: finite(precipitation[i]),
        windSpeedKmh: finite(windSpeed[i]),
        windDirectionDeg: finite(windDirection[i]),
        windGustKmh: finite(windGust[i]),
        boundaryLayerHeightM: finite(blh[i]),
        surfacePressureHpa: finite(pressure[i]),
        cloudCoverPct: finite(cloud[i]),
        temperature950hPaC: finite(temp950[i]),
      });
    }

    if (droppedHours > 0) {
      logger.warn('context.open_meteo_unparseable_hours', { dropped: droppedHours });
    }

    logger.info('upstream.fetch', {
      label: 'open-meteo-weather',
      host: safe.hostname,
      status: response.status,
      hours: hours.length,
      durationMs: Date.now() - started,
    });

    return {
      fetchedAt,
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      hours,
      source: OPEN_METEO_WEATHER_SOURCE,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Meteorological context events.
 *
 * Detection lives in `classify-event.ts` so the rules stay pure and inspectable;
 * this provider only supplies the observations they run on.
 */
export function deriveWeatherEvents(
  weather: WeatherContext,
  nowIso: string,
): EnrichedContextEvent[] {
  return classifyWeatherEvents(weather, nowIso);
}

export const openMeteoWeatherProvider = {
  name: 'Open-Meteo' as const,
  source: OPEN_METEO_WEATHER_SOURCE,
  fetchContext: fetchWeatherContext,
  deriveEvents: deriveWeatherEvents,
};
