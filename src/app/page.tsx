import type { Metadata } from 'next';
import { CloudOff } from 'lucide-react';

import { MaltaSummary } from '@/components/air-quality/malta-summary';
import { ContextWidget } from '@/components/environmental-context/context-widget';
import { ForecastPanel } from '@/components/forecast/forecast-panel';
import { DangerBanner } from '@/components/health-guidance/danger-banner';
import { HealthGuidance } from '@/components/health-guidance/health-guidance';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { availablePollutants } from '@/components/pollutants/filter-value';
import type { StationEntry } from '@/components/stations/types';
import type { PollutantCode } from '@/config/pollutants';
import { STATIONS, findStation } from '@/config/stations';
import { getLatestReadings, summariseMalta } from '@/lib/air-quality/service';
import type { MaltaSummary as MaltaSummaryResult, StationReading } from '@/lib/air-quality/types';
import { getContextEvents, getContextForForecast } from '@/lib/environmental-context/service';
import type { EnrichedContextEvent, SourceRef } from '@/lib/environmental-context/types';
import { buildStationOutlook } from '@/lib/forecast/calculate';
import {
  buildForecastPoints,
  buildPollutantSeries,
  getStationForecastSeries,
  isStationPartial,
} from '@/lib/forecast/providers/eea-cams-provider';
import type { StationForecastOutlook } from '@/lib/forecast/types';
import { getDictionary, hasKey, t } from '@/lib/i18n';
import type { MapStation } from '@/lib/map/markers';
import { logger } from '@/lib/monitoring/logger';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

/**
 * Readings are hourly and the page states its own measurement time, so it is
 * rendered per request rather than served as static HTML. Caching happens in the
 * service layer, which is where the upstream cadence is actually known.
 */
export const dynamic = 'force-dynamic';

const METHODOLOGY_HREF = '/methodology';

/**
 * The islands-wide summary shown when no reading could be obtained at all.
 *
 * Deliberately not an all-clear: `category: null` renders as "No data" and
 * `freshness: 'unavailable'` makes every component downstream describe the state
 * honestly. Omitting the headline instead would leave a page that says nothing,
 * and silence on an air-quality page reads as good news.
 */
function unavailableSummary(): MaltaSummaryResult {
  return {
    category: null,
    dominantPollutant: null,
    aggregation: 'worst-station',
    drivingStationId: null,
    reportingStations: 0,
    totalStations: STATIONS.length,
    staleStations: 0,
    measuredAt: null,
    freshness: 'unavailable',
  };
}

type ForecastResult = {
  outlook: StationForecastOutlook;
  stationName: string;
  expectedPollutants: PollutantCode[];
};

/**
 * A 48-hour outlook for one station.
 *
 * One station, and the summary only: `points` and `pollutantSeries` are stripped
 * AFTER the outlook is built, exactly as `/api/forecast` does for a
 * multi-station request. The days, the peak, the drivers and the confidence are
 * therefore all derived from the complete series — nothing is computed from a
 * truncated input — but two days of hourly points for a panel that renders a
 * daily summary would be several hundred kilobytes of payload for nothing.
 *
 * The station's own page renders the full hourly chart.
 */
async function buildOutlook(stationId: string, nowIso: string): Promise<ForecastResult | null> {
  const station = findStation(stationId);
  if (!station) return null;

  const context = await getContextForForecast(nowIso);
  const { series } = await getStationForecastSeries(station.id);

  const stationPartial = isStationPartial(series, station.expectedPollutants);
  const pointOptions = {
    nowIso,
    stationPartial,
    expectedPollutants: station.expectedPollutants,
    availableHours: series.forecast.length,
  };

  const outlook = buildStationOutlook({
    stationId: station.id,
    nowIso,
    // Attribution follows the series actually loaded, never the configured
    // provider, so a fixture series can never be presented under the EEA's name.
    provider: series.source,
    basedOnObservationAt: series.basedOnObservationAt,
    observed: series.observed,
    points: buildForecastPoints(series, pointOptions),
    pollutantSeries: buildPollutantSeries(series, pointOptions),
    weather: context.weather,
    events: context.events,
    stationPartial,
    expectedPollutants: station.expectedPollutants,
    publishedForecastHours: series.forecast.length,
  });

  return {
    outlook: { ...outlook, points: [], pollutantSeries: [] },
    stationName: station.name,
    expectedPollutants: station.expectedPollutants,
  };
}

export default async function HomePage() {
  const dict = getDictionary();
  const copy = (key: string, fallback: string): string =>
    hasKey(dict, key) ? t(dict, key) : fallback;

  /**
   * One clock reading for the whole page.
   *
   * Every component that needs to know how old a reading is receives this same
   * instant. Letting each one call `Date.now()` would produce a page whose parts
   * disagree — by milliseconds on the server, and by the whole request duration
   * once it hydrates.
   */
  const nowIso = new Date().toISOString();

  /**
   * The upstream feed is the one dependency that can fail, and this page has to
   * survive it. A failure yields no readings and an explicit "unavailable"
   * summary; the shell, the station list, the legend and the attribution all
   * still render. Nothing here is allowed to reach the error boundary, because a
   * blank page is indistinguishable from "nothing to report".
   */
  let readings: StationReading[] = [];
  let summary: MaltaSummaryResult = unavailableSummary();
  let fetchedAt: string = nowIso;
  let degraded = false;
  let degradedReason: string | undefined;

  try {
    const result = await getLatestReadings();
    readings = result.readings;
    fetchedAt = result.meta.fetchedAt;
    degradedReason = result.meta.degradedReason;
    degraded = Boolean(result.meta.degradedReason);
    summary = summariseMalta(readings, nowIso);
  } catch (error) {
    logger.error('page.home.readings_failed', { error: String(error) });
    degraded = true;
  }

  const readingById = new Map(readings.map((reading) => [reading.stationId, reading]));

  /**
   * Every station appears, whether or not it reported.
   *
   * `reading: null` is a first-class state meaning "published nothing usable
   * this hour". Dropping the station instead would quietly shrink the network
   * from five to four without saying so.
   */
  const entries: StationEntry[] = STATIONS.filter((station) => station.active).map((station) => ({
    station,
    reading: readingById.get(station.id) ?? null,
  }));

  const mapStations: MapStation[] = entries.map(({ station }) => ({
    id: station.id,
    slug: station.slug,
    name: station.name,
    locality: station.locality,
    island: station.island,
    latitude: station.latitude,
    longitude: station.longitude,
  }));

  const expectedByStation: Record<string, PollutantCode[]> = Object.fromEntries(
    STATIONS.map((station) => [station.id, station.expectedPollutants]),
  );

  const drivingReading = summary.drivingStationId
    ? (readingById.get(summary.drivingStationId) ?? null)
    : null;
  const drivingStation = summary.drivingStationId
    ? findStation(summary.drivingStationId)
    : undefined;

  /**
   * The pollutant that put the islands in their current band, so the banner can
   * say whether that particular value was measured or modelled.
   *
   * `modelled` is not `forecast`: the feed gap-fills past hours too, and only a
   * point genuinely ahead of the newest observation is a forecast. Nothing on
   * this page is one, so `forecast` is left at its default of false.
   */
  const drivingPollutant =
    summary.dominantPollutant && drivingReading
      ? (drivingReading.pollutants[summary.dominantPollutant] ?? null)
      : null;

  /* Context and forecast are enrichment. Neither may take the page down, and
     neither is invented when its provider is silent — the panel simply does not
     appear. */
  let contextEvents: EnrichedContextEvent[] = [];
  let contextSources: SourceRef[] = [];
  let contextFetchedAt = nowIso;
  try {
    const context = await getContextEvents({ limit: 6 });
    contextEvents = context.events;
    contextSources = context.meta.sources;
    contextFetchedAt = context.meta.fetchedAt;
  } catch (error) {
    logger.warn('page.home.context_failed', { error: String(error) });
  }

  let forecast: ForecastResult | null = null;
  try {
    const forecastStationId = summary.drivingStationId ?? entries[0]?.station.id ?? null;
    if (forecastStationId) forecast = await buildOutlook(forecastStationId, nowIso);
  } catch (error) {
    logger.warn('page.home.forecast_failed', { error: String(error) });
  }

  return (
    <DashboardShell
      entries={entries}
      mapStations={mapStations}
      readings={readings}
      available={availablePollutants(readings)}
      drivingStationId={summary.drivingStationId}
      expectedByStation={expectedByStation}
      serviceStatus={
        degraded ? (
          <div
            role="status"
            className="rounded-card border-border-strong bg-surface flex items-start gap-3 border p-4"
          >
            <CloudOff className="text-danger mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <div className="flex flex-col gap-1">
              <p className="text-foreground text-sm font-medium">
                {t(dict, 'errors.upstream.title')}
              </p>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {/* Two genuinely different situations: a cached copy is being
                    served, or there is nothing to serve at all. */}
                {readings.length > 0
                  ? t(dict, 'freshness.cachedNotice')
                  : t(dict, 'errors.upstream.description')}
              </p>
              {degradedReason ? (
                <p className="text-subtle text-xs">
                  {t(dict, 'freshness.degradedReason', { reason: degradedReason })}
                </p>
              ) : null}
              <p className="text-muted-foreground text-sm leading-relaxed">
                {t(dict, 'errors.dataUnavailableHint')}
              </p>
            </div>
          </div>
        ) : null
      }
      banner={
        <DangerBanner
          category={summary.category}
          pollutant={summary.dominantPollutant}
          measuredAt={summary.measuredAt}
          provisional={drivingReading?.provisional ?? true}
          modelled={drivingPollutant?.modelled ?? false}
          stationName={drivingStation?.name}
          dict={dict}
        />
      }
      summary={
        <MaltaSummary
          summary={summary}
          fetchedAt={fetchedAt}
          nowIso={nowIso}
          headingLevel="h1"
          dict={dict}
        />
      }
      guidance={
        <HealthGuidance category={summary.category} headingLevel="h2" detail="brief" dict={dict} />
      }
      context={
        contextEvents.length > 0 ? (
          <ContextWidget
            events={contextEvents}
            fetchedAt={contextFetchedAt}
            sources={contextSources}
            headingId="home-context"
            dict={dict}
          />
        ) : null
      }
      forecast={
        forecast ? (
          <ForecastPanel
            outlook={forecast.outlook}
            stationName={forecast.stationName}
            expectedPollutants={forecast.expectedPollutants}
            methodologyHref={METHODOLOGY_HREF}
            headingId="home-forecast"
            dict={dict}
          />
        ) : (
          <p className="text-muted-foreground rounded-card border-border bg-surface border p-4 text-sm leading-relaxed">
            {copy('forecast.noForecast', 'No forecast is available for this station.')}
          </p>
        )
      }
    />
  );
}
