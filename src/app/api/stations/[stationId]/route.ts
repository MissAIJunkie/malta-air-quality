/**
 * GET /api/stations/[stationId]
 *
 * One station, its current reading, and its recent history.
 *
 * `stationId` accepts either the URL slug (`msida`) or the upstream code
 * (`MT00011`), because both appear in the wild: the slug is what the site links
 * to, the code is what the EEA feed and every citation use.
 *
 * Query parameters:
 *   ?hours=48        — how far back the history reaches, 1 to 240
 *   ?include=forecast — append the modelled hours beyond the last observation
 *
 * History points keep their own `forecast` flag whatever `include` says, so a
 * consumer can never mistake a modelled hour for a measured one.
 */

import { z } from 'zod';

import { findStation } from '@/config/stations';
import { stationQuerySchema } from '@/lib/air-quality/schemas';
import { getLatestReadings, getStationHistory, getStations } from '@/lib/air-quality/service';
import { badRequest, handleRouteError, notFound, ok } from '@/lib/api/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Ten days — the whole window each upstream station document carries. */
const MAX_HISTORY_HOURS = 240;
const DEFAULT_HISTORY_HOURS = 48;

const historyHoursSchema = z.coerce.number().int().min(1).max(MAX_HISTORY_HOURS);

const HOUR_MS = 60 * 60 * 1000;

export async function GET(
  request: Request,
  // Next 16 resolves dynamic segments asynchronously.
  { params }: { params: Promise<{ stationId: string }> },
) {
  try {
    const { stationId } = await params;

    const parsedId = stationQuerySchema.safeParse(stationId);
    if (!parsedId.success) return badRequest('Invalid station identifier.');

    const station = findStation(parsedId.data);
    if (!station) return notFound(`Unknown station: ${parsedId.data}`);

    const searchParams = new URL(request.url).searchParams;

    let hours = DEFAULT_HISTORY_HOURS;
    const rawHours = searchParams.get('hours');
    if (rawHours !== null) {
      const parsed = historyHoursSchema.safeParse(rawHours);
      if (!parsed.success) {
        return badRequest(`Invalid hours parameter. Expected 1 to ${MAX_HISTORY_HOURS}.`);
      }
      hours = parsed.data;
    }

    let includeForecast = false;
    const rawInclude = searchParams.get('include');
    if (rawInclude !== null) {
      if (rawInclude !== 'forecast' && rawInclude !== 'observations') {
        return badRequest('Invalid include parameter. Expected "forecast" or "observations".');
      }
      includeForecast = rawInclude === 'forecast';
    }

    /*
     * The lower bound is rounded down to the hour.
     *
     * `getStationHistory` builds its cache key from the window, so a bound
     * carrying minutes and seconds would mint a new key on every request and the
     * cache would never hit. Rounding costs at most one extra hour of data and
     * makes the key stable for the whole hour.
     */
    const from = new Date(Math.floor((Date.now() - hours * HOUR_MS) / HOUR_MS) * HOUR_MS);

    const [{ stations, meta: stationsMeta }, { readings, meta }, history] = await Promise.all([
      getStations(),
      getLatestReadings(),
      getStationHistory(station.id, { from: from.toISOString(), includeForecast }),
    ]);

    const descriptor = stations.find((candidate) => candidate.id === station.id) ?? null;
    const reading = readings.find((candidate) => candidate.stationId === station.id) ?? null;

    return ok(
      {
        station: descriptor,
        // `null` when this station is not currently reporting. Never a zeroed
        // reading — silence from an analyser is not a measurement.
        reading,
        history,
        historyWindow: {
          from: from.toISOString(),
          hours,
          includeForecast,
          /**
           * Explicit, so an empty `history` array is never ambiguous: "no
           * history is published for this station" and "this window happens to
           * contain nothing" are different facts.
           */
          points: history.length,
          forecastPoints: history.filter((point) => point.forecast).length,
        },
      },
      {
        ...meta,
        stale: meta.stale || stationsMeta.stale,
        cached: meta.cached && stationsMeta.cached,
        // Partial when this station is silent or is missing an expected
        // pollutant, regardless of how the rest of the network is doing.
        partial: reading === null || reading.partial,
      },
    );
  } catch (error) {
    return handleRouteError('/api/stations/[stationId]', error);
  }
}
