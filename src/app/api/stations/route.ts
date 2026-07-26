/**
 * GET /api/stations
 *
 * Every monitoring station in the network, each paired with its current reading.
 *
 * A station that is not reporting appears with `reading: null`. It is never
 * omitted and never given a zeroed reading: a silent analyser is a fact about
 * the network that the map has to be able to show, and an absent value is not a
 * measurement of zero.
 */

import { STATIONS } from '@/config/stations';
import { getLatestReadings, getStations, summariseMalta } from '@/lib/air-quality/service';
import { handleRouteError, ok } from '@/lib/api/respond';
import type { StationReading } from '@/lib/air-quality/types';

// Provider access needs Node APIs and a stable fetch surface, matching
// /api/air-quality.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const nowIso = new Date().toISOString();

    const [{ stations, meta: stationsMeta }, { readings, meta }] = await Promise.all([
      getStations(),
      getLatestReadings(),
    ]);

    const byStationId = new Map<string, StationReading>(
      readings.map((reading) => [reading.stationId, reading]),
    );

    const entries = stations.map((station) => ({
      station,
      reading: byStationId.get(station.id) ?? null,
    }));

    const reportingStations = entries.filter((entry) => entry.reading !== null).length;

    return ok(
      {
        stations: entries,
        // Always across ALL stations: a summary of a subset would misrepresent
        // the islands, and this route has no filters anyway.
        summary: summariseMalta(readings, nowIso),
      },
      {
        /*
         * The readings envelope, not the station envelope.
         *
         * Station geometry has no measurement instant and effectively never
         * changes, so `getStations()` reports `measuredAt: null` — using it here
         * would hide the freshness of the only part of this payload that ages.
         * The station fetch can still contribute staleness, so the two are OR-ed.
         */
        ...meta,
        stale: meta.stale || stationsMeta.stale,
        cached: meta.cached && stationsMeta.cached,
        partial: meta.partial || reportingStations < STATIONS.length,
      },
    );
  } catch (error) {
    return handleRouteError('/api/stations', error);
  }
}
