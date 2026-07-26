/**
 * GET /api/forecast
 *
 * The official CAMS air-quality forecast for Malta's stations, as disseminated
 * by the EEA, split from the observations and annotated with deterministically
 * derived drivers.
 *
 * Query parameters:
 *   ?station=msida | MT00011   — one station; omitted, all five are returned
 *   ?pollutant=o3              — narrow the per-pollutant series
 *   ?hours=24                  — cap the outlook at the first N forecast hours
 *   ?include=hourly|summary    — force the hour-by-hour arrays on or off
 *
 * Every point in the response carries `estimated: true`, a `source` and a
 * `methodology` label, and no code path can emit one without them. Nothing here
 * is a measurement, and nothing here modifies one.
 *
 * ## When the hourly arrays are sent
 *
 * Two days of hourly data, for five stations, across four pollutants, is over
 * a thousand points and roughly 650 KB of JSON — a slow page on a phone in
 * exchange for data no screen renders at once.
 *
 * So the default follows the request's evident intent: **asking for one station
 * is asking for its chart**, and the hours come with it (~104 KB). Asking for
 * all five is an overview, which needs only the daily summary, the peak and the
 * drivers (~16 KB). `?include=` overrides in either direction.
 *
 * The alternative — off unless explicitly requested — was rejected because a
 * caller fetching `?station=msida` would receive `points: []` with no reason to
 * suspect a query parameter existed.
 *
 * `hourlyIncluded` is always returned, so an empty `points` array is never
 * ambiguous. "Empty because you asked for a summary" and "empty because the EEA
 * publishes no forecast for this station" are completely different facts, and a
 * client must not have to guess which one it is holding.
 */

import type { NextRequest } from 'next/server';
import { STATIONS, findStation } from '@/config/stations';
import { pollutantFromSlug, type PollutantCode } from '@/config/pollutants';
import { badRequest, handleRouteError, notFound, ok } from '@/lib/api/respond';
import { getProvider } from '@/lib/air-quality/service';
import { nextExpectedUpdate } from '@/lib/air-quality/freshness';
import type { ProviderSource, ResponseMeta } from '@/lib/air-quality/types';
import { getContextForForecast } from '@/lib/environmental-context/service';
import { buildStationOutlook } from '@/lib/forecast/calculate';
import {
  buildForecastPoints,
  buildPollutantSeries,
  getStationForecastSeries,
  isStationPartial,
} from '@/lib/forecast/providers/eea-cams-provider';
import {
  forecastHoursQuerySchema,
  forecastIncludeQuerySchema,
  forecastPollutantQuerySchema,
  forecastStationQuerySchema,
} from '@/lib/forecast/schemas';
import { FORECAST_METHODOLOGY, type StationForecastOutlook } from '@/lib/forecast/types';

// Matches /api/air-quality: provider access needs Node APIs.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const nowIso = new Date().toISOString();

    let stationIds = STATIONS.map((station) => station.id);

    const rawStation = params.get('station');
    if (rawStation !== null) {
      const parsed = forecastStationQuerySchema.safeParse(rawStation);
      if (!parsed.success) return badRequest('Invalid station parameter.');
      const station = findStation(parsed.data);
      if (!station) return notFound(`Unknown station: ${parsed.data}`);
      stationIds = [station.id];
    }

    let pollutantFilter: PollutantCode | null = null;
    const rawPollutant = params.get('pollutant');
    if (rawPollutant !== null) {
      const parsed = forecastPollutantQuerySchema.safeParse(rawPollutant);
      if (!parsed.success) return badRequest('Invalid pollutant parameter.');
      pollutantFilter = pollutantFromSlug(parsed.data);
      if (!pollutantFilter) return badRequest('Invalid pollutant parameter.');
    }

    let hoursLimit: number | null = null;
    const rawHours = params.get('hours');
    if (rawHours !== null) {
      const parsed = forecastHoursQuerySchema.safeParse(rawHours);
      if (!parsed.success) return badRequest('Invalid hours parameter. Expected 1 to 120.');
      hoursLimit = parsed.data;
    }

    // A single-station request is a chart request; all five is an overview.
    let includeHourly = rawStation !== null;
    const rawInclude = params.get('include');
    if (rawInclude !== null) {
      const parsed = forecastIncludeQuerySchema.safeParse(rawInclude);
      if (!parsed.success) {
        return badRequest('Invalid include parameter. Expected "hourly" or "summary".');
      }
      includeHourly = parsed.data === 'hourly';
    }

    // Weather and aerosol context is shared across every station: the islands
    // are 27 km across and the model resolution does not distinguish them.
    // Failure here is absorbed by the context service and simply yields fewer
    // drivers — never an error and never an invented condition.
    const context = await getContextForForecast(nowIso);

    const outlooks: StationForecastOutlook[] = [];
    let anyCached = false;
    let anyStale = false;
    let degradedReason: string | undefined;
    // Provenance of the series actually loaded. Starts from the configured
    // provider so an empty result still reports something truthful.
    let responseSource: ProviderSource = getProvider().name;

    for (const stationId of stationIds) {
      const station = findStation(stationId);
      if (!station) continue;

      const {
        series,
        cached,
        stale,
        degradedReason: reason,
      } = await getStationForecastSeries(stationId);

      anyCached = anyCached || cached;
      anyStale = anyStale || stale;
      responseSource = series.source;
      if (reason && !degradedReason) degradedReason = reason;

      // Judged from the observations, not from the forecast — CAMS publishes no
      // SO₂ forecast for these stations, so deriving it from the modelled hours
      // would mark all five permanently partial. See `isStationPartial`.
      const stationPartial = isStationPartial(series, station.expectedPollutants);

      const pointOptions = {
        nowIso,
        stationPartial,
        expectedPollutants: station.expectedPollutants,
        availableHours: series.forecast.length,
      };

      let points = buildForecastPoints(series, pointOptions);
      let pollutantSeries = buildPollutantSeries(series, pointOptions);

      if (hoursLimit !== null) {
        points = points.slice(0, hoursLimit);
        const cutoff = points.at(-1)?.forecastAt;
        if (cutoff) {
          const cutoffMs = Date.parse(cutoff);
          pollutantSeries = pollutantSeries.map((entry) => ({
            ...entry,
            points: entry.points.filter((point) => Date.parse(point.forecastAt) <= cutoffMs),
          }));
        }
      }

      const outlook = buildStationOutlook({
        stationId: station.id,
        nowIso,
        // Attribution follows the series that was actually loaded, not the
        // configured provider, so a cached fixture series can never be
        // presented under the EEA's name.
        provider: series.source,
        basedOnObservationAt: series.basedOnObservationAt,
        observed: series.observed,
        points,
        // Trends are always computed across every modelled pollutant: filtering
        // to one pollutant is a view concern, and narrowing the inputs would
        // silently change the drivers.
        pollutantSeries,
        weather: context.weather,
        events: context.events,
        stationPartial,
        expectedPollutants: station.expectedPollutants,
        // What upstream published, not what this request asked to see.
        publishedForecastHours: series.forecast.length,
      });

      const filtered = pollutantFilter
        ? {
            ...outlook,
            pollutantSeries: outlook.pollutantSeries.filter(
              (entry) => entry.pollutant === pollutantFilter,
            ),
          }
        : outlook;

      // Stripped last, so `days`, `peak`, `drivers` and `confidence` are all
      // derived from the complete series regardless of what is transmitted.
      outlooks.push(includeHourly ? filtered : { ...filtered, points: [], pollutantSeries: [] });
    }

    const newestObservation = outlooks.reduce<string | null>((newest, outlook) => {
      const candidate = outlook.basedOnObservationAt;
      if (!candidate) return newest;
      if (!newest) return candidate;
      return Date.parse(candidate) > Date.parse(newest) ? candidate : newest;
    }, null);

    const meta: ResponseMeta = {
      // Genuinely accurate: the CAMS forecast reaches maqua.app through the EEA
      // dissemination layer, which is exactly what this provider name denotes.
      // Read from the loaded series rather than the configured provider, so a
      // cached series always reports the source it actually came from.
      source: responseSource,
      measuredAt: newestObservation,
      fetchedAt: nowIso,
      nextExpectedUpdateAt: nextExpectedUpdate(newestObservation),
      stale: anyStale,
      partial: outlooks.some((outlook) => !outlook.available),
      cached: anyCached,
      ...(degradedReason ? { degradedReason } : {}),
    };

    return ok(
      {
        stations: outlooks,
        // Explicit, so an empty `points` array is never ambiguous.
        hourlyIncluded: includeHourly,
        filters: {
          station: rawStation === null ? null : stationIds[0],
          pollutant: pollutantFilter,
          hours: hoursLimit,
          include: includeHourly ? 'hourly' : 'summary',
        },
        methodology: FORECAST_METHODOLOGY,
        methodologyKey: 'forecast.methodology.camsViaEea',
        disclaimer:
          'This is an official European forecast, not a measurement and not a maqua.app prediction. Forecast values are estimates and may differ from what is later measured.',
        healthDisclaimer:
          'maqua.app provides general environmental information and does not replace medical advice or official emergency guidance.',
      },
      meta,
    );
  } catch (error) {
    return handleRouteError('/api/forecast', error);
  }
}
