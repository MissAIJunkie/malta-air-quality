/**
 * GET /api/air-quality
 *
 * Current readings for every station, plus the Malta-wide summary.
 *
 * Query parameters:
 *   ?station=msida | MT00011   — a single station (slug or upstream code)
 *   ?pollutant=pm10            — narrow each station to one pollutant
 */

import type { NextRequest } from 'next/server';
import { findStation } from '@/config/stations';
import { pollutantFromSlug, type PollutantCode } from '@/config/pollutants';
import { getLatestReadings, summariseMalta } from '@/lib/air-quality/service';
import { pollutantQuerySchema, stationQuerySchema } from '@/lib/air-quality/schemas';
import { badRequest, handleRouteError, notFound, ok } from '@/lib/api/respond';
import type { PollutantReading, StationReading } from '@/lib/air-quality/types';

// Provider access needs Node APIs and a stable fetch surface; the edge runtime
// buys nothing here.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const nowIso = new Date().toISOString();

    let stationFilter: string | null = null;
    const rawStation = params.get('station');
    if (rawStation !== null) {
      const parsed = stationQuerySchema.safeParse(rawStation);
      if (!parsed.success) return badRequest('Invalid station parameter.');
      const station = findStation(parsed.data);
      if (!station) return notFound(`Unknown station: ${parsed.data}`);
      stationFilter = station.id;
    }

    let pollutantFilter: PollutantCode | null = null;
    const rawPollutant = params.get('pollutant');
    if (rawPollutant !== null) {
      const parsed = pollutantQuerySchema.safeParse(rawPollutant);
      if (!parsed.success) return badRequest('Invalid pollutant parameter.');
      pollutantFilter = pollutantFromSlug(parsed.data);
      if (!pollutantFilter) return badRequest('Invalid pollutant parameter.');
    }

    const { readings, meta } = await getLatestReadings();

    // The summary always reflects ALL stations and ALL pollutants — filtering is
    // a view concern, and a filtered headline would misrepresent the islands.
    const summary = summariseMalta(readings, nowIso);

    let visible: StationReading[] = readings;
    if (stationFilter) visible = visible.filter((r) => r.stationId === stationFilter);

    if (pollutantFilter) {
      const code = pollutantFilter;
      visible = visible.map((reading) => {
        const only: Partial<Record<PollutantCode, PollutantReading>> = {};
        const single = reading.pollutants[code];
        if (single) only[code] = single;

        return {
          ...reading,
          pollutants: only,
          // When filtering to one pollutant, the headline category must describe
          // THAT pollutant — reusing the station's overall colour would silently
          // show a different pollutant's rating.
          overallCategory: single?.category ?? null,
          overallSubIndex: single?.subIndex ?? null,
          dominantPollutant: single ? code : null,
          partial: !single,
        };
      });
    }

    return ok(
      {
        stations: visible,
        summary,
        filters: {
          station: stationFilter,
          pollutant: pollutantFilter,
        },
      },
      meta,
    );
  } catch (error) {
    return handleRouteError('/api/air-quality', error);
  }
}
