/**
 * CAMS aerosol provider — Saharan dust detection.
 *
 * Malta sits directly on the main dust transport corridor between the Sahara
 * and southern Europe, and dust episodes are the single most common honest
 * explanation for a high PM10 hour here. Detecting them matters precisely
 * because it is the piece of context most easily abused: "it was only dust" is
 * a real phenomenon and also a convenient excuse, so the wording this provider
 * produces stays hedged and never adjusts a measurement.
 *
 * Data comes from Open-Meteo's air-quality endpoint, which republishes the
 * Copernicus Atmosphere Monitoring Service (CAMS) global and European aerosol
 * forecasts under CC BY 4.0. The `dust` field is a modelled mineral-dust
 * concentration — a forecast for a grid cell, never a Maltese station
 * measurement, and it is labelled as such everywhere it surfaces.
 *
 * Field notes that would otherwise look like oversights:
 *
 *   - `pm10` / `pm2_5` from this endpoint are CAMS *model* fields. They are
 *     kept as regional background context and are deliberately never mixed
 *     with, compared against, or substituted for ERA's measured values.
 *   - No wildfire-smoke detection is attempted. See `classify-event.ts` for why
 *     aerosol optical depth alone cannot support that claim.
 */

import { MALTA_CENTRE } from '@/config/stations';
import { assertAllowedUrl } from '@/lib/security/allowlist';
import { logger } from '@/lib/monitoring/logger';
import { openMeteoAirQualityResponseSchema } from '../schemas';
import { CAMS_AEROSOL_SOURCE, classifyAerosolEvents } from '../classify-event';
import { toUtcInstant } from './open-meteo-provider';
import type { AerosolContext, AerosolHour, EnrichedContextEvent } from '../types';

const FETCH_TIMEOUT_MS = 8_000;

/** Matches the meteorological window so the two series can be read together. */
export const AEROSOL_FORECAST_DAYS = 3;

const HOURLY_VARIABLES = ['dust', 'pm10', 'pm2_5', 'aerosol_optical_depth', 'uv_index'] as const;

const [longitude, latitude] = MALTA_CENTRE;

export function buildAerosolUrl(): string {
  const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
  url.searchParams.set('latitude', latitude.toFixed(4));
  url.searchParams.set('longitude', longitude.toFixed(4));
  url.searchParams.set('hourly', HOURLY_VARIABLES.join(','));
  url.searchParams.set('timezone', 'UTC');
  url.searchParams.set('forecast_days', String(AEROSOL_FORECAST_DAYS));
  url.searchParams.set('past_days', '1');
  // `dust` is only produced by the global CAMS domain; the European domain
  // omits it, and requesting the default would return the series as absent.
  url.searchParams.set('domains', 'cams_global');
  return url.toString();
}

function alignedSeries(
  series: (number | null)[] | undefined,
  expectedLength: number,
  label: string,
): (number | null)[] {
  if (!series) return new Array<number | null>(expectedLength).fill(null);
  if (series.length !== expectedLength) {
    logger.warn('context.cams_series_misaligned', {
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

export async function fetchAerosolContext(): Promise<AerosolContext> {
  const url = buildAerosolUrl();
  const safe = assertAllowedUrl(url);
  const started = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(safe, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });

    if (!response.ok) throw new Error(`open-meteo air-quality responded ${response.status}`);

    const parsed = openMeteoAirQualityResponseSchema.parse(await response.json());

    if (parsed.utc_offset_seconds !== 0) {
      throw new Error(`open-meteo returned a non-UTC offset (${parsed.utc_offset_seconds}s)`);
    }

    const fetchedAt = new Date().toISOString();
    const times = parsed.hourly.time;
    const length = times.length;

    const dust = alignedSeries(parsed.hourly.dust, length, 'dust');
    const pm10 = alignedSeries(parsed.hourly.pm10, length, 'pm10');
    const pm25 = alignedSeries(parsed.hourly.pm2_5, length, 'pm2_5');
    const aod = alignedSeries(parsed.hourly.aerosol_optical_depth, length, 'aerosol_optical_depth');
    const uv = alignedSeries(parsed.hourly.uv_index, length, 'uv_index');

    const hours: AerosolHour[] = [];
    let droppedHours = 0;

    for (let i = 0; i < length; i += 1) {
      const time = toUtcInstant(times[i]);
      if (!time) {
        droppedHours += 1;
        continue;
      }

      hours.push({
        time,
        dustUgm3: finite(dust[i]),
        modelledPm10Ugm3: finite(pm10[i]),
        modelledPm25Ugm3: finite(pm25[i]),
        aerosolOpticalDepth: finite(aod[i]),
        uvIndex: finite(uv[i]),
      });
    }

    if (droppedHours > 0) {
      logger.warn('context.cams_unparseable_hours', { dropped: droppedHours });
    }

    logger.info('upstream.fetch', {
      label: 'cams-aerosol',
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
      source: CAMS_AEROSOL_SOURCE,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function deriveAerosolEvents(
  aerosol: AerosolContext,
  nowIso: string,
): EnrichedContextEvent[] {
  return classifyAerosolEvents(aerosol, nowIso);
}

export const camsDustProvider = {
  name: 'CAMS' as const,
  source: CAMS_AEROSOL_SOURCE,
  fetchContext: fetchAerosolContext,
  deriveEvents: deriveAerosolEvents,
};
