import type * as React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  Building2,
  Compass,
  MapPin,
  Mountain,
  Radio,
  Ruler,
  TriangleAlert,
} from 'lucide-react';

import {
  POLLUTANTS,
  POLLUTANT_CODES,
  pollutantFromSlug,
  type PollutantCode,
} from '@/config/pollutants';
import { findStation, type StationDefinition } from '@/config/stations';
import { EU_LIMIT_VALUES, isElevatedCategory, type AirQualityCategory } from '@/config/thresholds';
import { compareToThresholds } from '@/lib/air-quality/calculate-index';
import { getLatestReadings, getStationHistory } from '@/lib/air-quality/service';
import type { PollutantReading, StationReading } from '@/lib/air-quality/types';
import { buildFallbackExplanation } from '@/lib/ai/fallback';
import { buildExplainInput } from '@/lib/ai/redact';
import { getContextEvents, getContextForForecast } from '@/lib/environmental-context/service';
import { buildStationOutlook } from '@/lib/forecast/calculate';
import {
  buildForecastPoints,
  buildPollutantSeries,
  getStationForecastSeries,
  isStationPartial,
} from '@/lib/forecast/providers/eea-cams-provider';
import {
  DATE_PATTERNS,
  SENSITIVE_GROUPS,
  categoryDescriptionKey,
  categoryHealthKey,
  categoryLabelKey,
  categoryShortAdviceKey,
  formatCoordinates,
  formatConcentration,
  formatInMalta,
  formatNumber,
  getDictionary,
  sensitiveGroupAdviceKey,
  sensitiveGroupLabelKey,
  t,
  toDateTimeAttribute,
  type Dictionary,
} from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';
import { CategoryBadge } from '@/components/air-quality/category-badge';
import { FreshnessIndicator } from '@/components/air-quality/freshness-indicator';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartSummaryFootnote } from '@/components/charts/chart-summary';
import { localised } from '@/components/charts/localised';
import {
  DEFAULT_TREND_RANGE,
  TREND_RANGES,
  buildSeries,
  isTrendRange,
  sliceSeries,
  summariseSeries,
  withGaps,
  type TrendRange,
} from '@/components/charts/series';
import { StatRow } from '@/components/charts/stat-row';
import { TrendChart, type HourlyThresholdLine } from '@/components/charts/trend-chart';
import { ForecastPanel } from '@/components/forecast/forecast-panel';
import { ContextWidget } from '@/components/environmental-context/context-widget';
import { ExplainButton } from '@/components/ai-explain/explain-button';

/**
 * One monitoring station, in full.
 *
 * A server component throughout, calling the services directly rather than
 * fetching this application's own API over HTTP — a route handler is for
 * clients that are not already inside the server. Only the chart and the
 * "Explain this" affordance cross into the browser, because only they need to.
 *
 * The two selectors on this page (window and pollutant) are LINKS carrying
 * query parameters, not client state. That keeps the page a server component,
 * makes every view addressable and shareable, and means the selectors work
 * before hydration and without JavaScript at all.
 */

export const runtime = 'nodejs';
// Air quality changes hourly and the page states its own freshness; a build-time
// snapshot would be stale before it was deployed.
export const dynamic = 'force-dynamic';

const METHODOLOGY_HREF = '/methodology';

/* -------------------------------------------------------------------------- */
/*  Metadata                                                                  */
/* -------------------------------------------------------------------------- */

type RouteParams = { stationId: string };
type RouteSearchParams = Record<string, string | string[] | undefined>;

/**
 * Static per station.
 *
 * The current band is deliberately NOT in the title. Metadata is cached and
 * shared far more aggressively than the page it describes, and "Msida: Poor" in
 * a search result or a chat preview hours after the fact would be a claim about
 * the present that we cannot stand behind.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const dict = getDictionary();
  const { stationId } = await params;
  const station = findStation(safeDecode(stationId));

  if (!station) {
    return {
      title: t(dict, 'errors.stationNotFound.title'),
      description: t(dict, 'errors.stationNotFound.description'),
      robots: { index: false },
    };
  }

  // No brand suffix: the root layout's title template already appends it.
  const title = localised(dict, 'station.metaTitle', 'Air quality at {station}', {
    station: station.name,
  });

  const description = localised(
    dict,
    'station.metaDescription',
    'Hourly air-quality readings from the {type} monitoring station at {locality}, {island}, with every pollutant it measures, the European Air Quality Index band, recent trends and the official forecast.',
    {
      type: t(dict, stationTypeKey(station)).toLowerCase(),
      locality: station.locality,
      island: station.island,
    },
  );

  return {
    title,
    description,
    // Canonical is always the slug, so the upstream code form of the URL does
    // not create a duplicate.
    alternates: { canonical: `/station/${station.slug}` },
    openGraph: { title, description, type: 'website' },
  };
}

/* -------------------------------------------------------------------------- */
/*  Station vocabulary                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Decode a path segment without letting a malformed one become a 500.
 *
 * `decodeURIComponent` throws `URIError` on a stray percent sign, and
 * `/station/%` is a bad address, not a server fault — it must reach the 404 the
 * same way `/station/nowhere` does.
 */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function stationTypeKey(station: StationDefinition): string {
  switch (station.stationType) {
    case 'Traffic':
      return 'station.type.traffic';
    case 'Industrial':
      return 'station.type.industrial';
    default:
      return 'station.type.background';
  }
}

function stationTypeExplainKey(station: StationDefinition): string {
  return `${stationTypeKey(station)}Explain`;
}

function areaKey(station: StationDefinition): string {
  switch (station.areaClassification) {
    case 'Suburban':
      return 'station.area.suburban';
    case 'Rural':
      return 'station.area.rural';
    case 'Rural-Regional':
      return 'station.area.ruralRegional';
    default:
      return 'station.area.urban';
  }
}

/* -------------------------------------------------------------------------- */
/*  Trend window vocabulary                                                   */
/* -------------------------------------------------------------------------- */

const RANGE_TEXT: Record<
  TrendRange,
  { tabKey: string; tab: string; longKey: string; long: string }
> = {
  '24h': {
    tabKey: 'trend.range.24h',
    tab: '24 hours',
    longKey: 'trend.rangeLong.24h',
    long: 'the last 24 hours',
  },
  '7d': {
    tabKey: 'trend.range.7d',
    tab: '7 days',
    longKey: 'trend.rangeLong.7d',
    long: 'the last 7 days',
  },
  full: {
    tabKey: 'trend.range.full',
    tab: 'Everything published',
    longKey: 'trend.rangeLong.full',
    long: 'the whole record the feed publishes',
  },
};

/* -------------------------------------------------------------------------- */
/*  Small presentational pieces                                               */
/* -------------------------------------------------------------------------- */

function DetailRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof MapPin;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        {label}
      </dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/**
 * One pollutant at this hour.
 *
 * A pollutant with no value is rendered, not hidden. Its absence is a fact
 * about the hour, and dropping the row would leave a reader to assume the
 * station simply does not measure it.
 */
function PollutantRow({
  code,
  measurement,
  dominant,
  dict,
}: {
  code: PollutantCode;
  measurement: PollutantReading | undefined;
  dominant: boolean;
  dict: Dictionary;
}) {
  const definition = POLLUTANTS[code];
  const available = measurement !== undefined && measurement.value !== null;

  return (
    <li className="rounded-card border-border bg-surface flex flex-col gap-2 border p-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* The typographic label is shown; the spoken name is the expansion.
            Rendering both to assistive technology would read "PM2.5 — PM2.5,
            fine particulate matter". */}
        <h3 className="text-sm font-semibold">
          <span aria-hidden="true">{definition.label}</span>
          <span className="sr-only">{definition.ariaLabel}</span>
        </h3>
        {dominant ? <Badge variant="primary">{t(dict, 'pollutant.dominantBadge')}</Badge> : null}
        {measurement?.modelled ? (
          <Badge variant="outline" title={t(dict, 'pollutant.modelledExplain')}>
            {t(dict, 'pollutant.modelledLabel')}
          </Badge>
        ) : null}
      </div>

      {available ? (
        <>
          <p className="tabular text-xl font-semibold">
            {formatConcentration(measurement.value, measurement.unit, dict)}
          </p>
          <CategoryBadge
            category={measurement.category}
            subIndex={measurement.subIndex}
            size="sm"
            srPrefix={definition.ariaLabel}
            dict={dict}
          />
          <p className="text-muted-foreground text-xs">
            {t(dict, 'pollutant.averagingPeriod')}: {measurement.averagingPeriod}
          </p>
        </>
      ) : (
        <>
          {/* Never 0. An instrument that reported nothing has told us nothing. */}
          <p className="text-sm font-medium">{t(dict, 'pollutant.noValue')}</p>
          <p className="text-muted-foreground text-xs">{t(dict, 'pollutant.noValueHint')}</p>
        </>
      )}
    </li>
  );
}

/**
 * Averaging periods as they read inside a sentence.
 *
 * The config stores them as labels ("Calendar year", "Annual"), which are right
 * in a table and wrong in prose: `threshold.inconclusive` interpolates them
 * after the word "over", and "an average over Annual" is not English. Only the
 * grammar changes here — no number, no period and no reference is altered.
 */
const PERIOD_PHRASE: Record<string, string> = {
  '1 hour': 'one hour',
  '24 hours': '24 hours',
  'Calendar year': 'a calendar year',
  Annual: 'a calendar year',
  'Maximum daily 8-hour mean': 'the highest eight-hour mean of a day',
  'Peak season 8-hour': 'eight-hour means through the peak season',
};

function periodPhrase(period: string): string {
  return PERIOD_PHRASE[period] ?? period.toLowerCase();
}

/**
 * How the latest value sits against EU limits and WHO guidelines.
 *
 * `compareToThresholds` returns facts and a `conclusive` flag; it deliberately
 * returns no verdict. This is where the flag is honoured: an hourly value above
 * an annual limit is reported as being above that LEVEL, with an explicit
 * sentence saying a single hour cannot settle compliance. Only the ozone
 * information and alert thresholds — genuine single-hour public-information
 * triggers — are allowed to read as an exceedance.
 */
function ThresholdComparison({
  pollutant,
  value,
  dict,
}: {
  pollutant: PollutantCode;
  value: number | null;
  dict: Dictionary;
}) {
  const comparisons = compareToThresholds(pollutant, value);

  if (value === null || comparisons.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {localised(
          dict,
          'threshold.noComparison',
          'There is no current value for this pollutant, so it cannot be compared with any limit or guideline.',
        )}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {comparisons.map((comparison) => {
          const reference =
            comparison.kind === 'eu-limit'
              ? t(dict, 'threshold.euLimit')
              : t(dict, 'threshold.whoGuideline');

          return (
            <li
              key={`${comparison.kind}-${comparison.averagingPeriod}-${comparison.threshold}`}
              className="rounded-card border-border bg-surface flex flex-col gap-1 border p-3 text-sm"
            >
              <p className="font-medium">
                {t(dict, comparison.above ? 'threshold.above' : 'threshold.below', {
                  reference: reference,
                  threshold: formatNumber(comparison.threshold, 0, dict),
                  unit: comparison.unit,
                })}
              </p>
              <p className="text-muted-foreground text-xs">
                {t(dict, 'threshold.value', {
                  value: formatNumber(comparison.threshold, 0, dict),
                  unit: comparison.unit,
                  period: comparison.averagingPeriod,
                })}
                {' · '}
                {t(dict, 'threshold.reference', { reference: comparison.reference })}
              </p>
              {comparison.above ? (
                <p className="text-xs">
                  {comparison.conclusive
                    ? t(dict, 'threshold.conclusiveExceedance')
                    : t(dict, 'threshold.inconclusive', {
                        period: periodPhrase(comparison.averagingPeriod),
                      })}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p className="text-muted-foreground text-xs leading-relaxed">
        {t(dict, 'threshold.legalNote')} {t(dict, 'threshold.whoNote')}
      </p>
    </div>
  );
}

function HealthGuidance({
  category,
  dict,
}: {
  category: AirQualityCategory | null;
  dict: Dictionary;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-card border-border bg-surface flex flex-col gap-1 border p-3">
          <h3 className="text-sm font-semibold">{t(dict, 'health.forEveryone')}</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t(dict, categoryHealthKey(category, 'general'))}
          </p>
        </div>
        <div className="rounded-card border-border bg-surface flex flex-col gap-1 border p-3">
          <h3 className="text-sm font-semibold">{t(dict, 'health.forSensitiveGroups')}</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t(dict, categoryHealthKey(category, 'sensitive'))}
          </p>
        </div>
      </div>

      <details>
        <summary className="text-primary inline-flex min-h-11 cursor-pointer items-center text-sm font-medium underline decoration-from-font underline-offset-4">
          {localised(dict, 'health.groupsToggle', 'Who is more affected, and why')}
        </summary>
        <dl className="mt-2 flex flex-col gap-2">
          {SENSITIVE_GROUPS.map((group) => (
            <div key={group}>
              <dt className="text-sm font-medium">{t(dict, sensitiveGroupLabelKey(group))}</dt>
              <dd className="text-muted-foreground text-sm leading-relaxed">
                {t(dict, sensitiveGroupAdviceKey(group))}
              </dd>
            </div>
          ))}
        </dl>
      </details>

      <p className="text-muted-foreground text-xs leading-relaxed">
        {t(dict, 'health.generalGuidance')} {t(dict, 'health.emergencyNote')}
      </p>
      {/* VERBATIM, required wherever health guidance appears. */}
      <p className="text-muted-foreground text-xs leading-relaxed">
        {t(dict, 'disclaimer.medical')}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                      */
/* -------------------------------------------------------------------------- */

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function StationPage({
  params,
  searchParams,
}: {
  params: Promise<RouteParams>;
  searchParams: Promise<RouteSearchParams>;
}) {
  const dict = getDictionary();
  const { stationId } = await params;
  const station = findStation(safeDecode(stationId));
  if (!station) notFound();

  const query = await searchParams;
  const nowIso = new Date().toISOString();

  // Independent reads, issued together: four sequential round trips would put
  // three avoidable waits in front of the reader.
  const [readingsResult, history, forecastResult, forecastContext, contextResult] =
    await Promise.all([
      getLatestReadings(),
      getStationHistory(station.id, { includeForecast: true }),
      getStationForecastSeries(station.id),
      getContextForForecast(nowIso),
      getContextEvents({ limit: 12 }),
    ]);

  const reading: StationReading | null =
    readingsResult.readings.find((entry) => entry.stationId === station.id) ?? null;

  /* --- Pollutant and window selection ------------------------------------ */

  // What this station actually offers: what it is known to measure, plus
  // anything that unexpectedly turned up in the payload. The registry is
  // advisory; the data decides.
  const availablePollutants = POLLUTANT_CODES.filter(
    (code) =>
      station.expectedPollutants.includes(code) ||
      reading?.pollutants[code] !== undefined ||
      history.some((point) => point.pollutants[code] !== undefined),
  );

  const requested = pollutantFromSlug(firstParam(query.pollutant));
  const selectedPollutant: PollutantCode =
    (requested && availablePollutants.includes(requested) ? requested : null) ??
    (reading?.dominantPollutant && availablePollutants.includes(reading.dominantPollutant)
      ? reading.dominantPollutant
      : null) ??
    availablePollutants[0] ??
    'PM10';

  const rangeParam = firstParam(query.range);
  const range: TrendRange = isTrendRange(rangeParam) ? rangeParam : DEFAULT_TREND_RANGE;

  // Slice first, then fill: the absent hours worth enumerating are the ones
  // inside the window a reader is actually looking at.
  const points = withGaps(sliceSeries(buildSeries(history, selectedPollutant), range, nowIso));
  const stats = summariseSeries(points);

  const rangeLabel = localised(dict, RANGE_TEXT[range].longKey, RANGE_TEXT[range].long);

  /* --- Threshold lines --------------------------------------------------- */

  // Only limits defined over a single hour may be drawn on an hourly chart.
  // A line at the annual mean would invite exactly the comparison the rules
  // forbid; those appear in the prose below, where the caveat can be stated.
  //
  // Being a one-hour limit is not the same as being settleable in one hour.
  // NO₂ at 200 and SO₂ at 350 permit 18 and 24 exceedances a year, so an hour
  // above them establishes nothing — and a legend entry is read on its own,
  // away from the caveat in the prose below. So the allowance travels with the
  // label, and `conclusive` decides how heavily the line is drawn.
  const hourlyThresholds: HourlyThresholdLine[] = EU_LIMIT_VALUES.filter(
    (limit) => limit.pollutant === selectedPollutant && limit.averagingPeriod === '1 hour',
  ).map((limit) => {
    const value = `${t(dict, 'threshold.euLimit')}: ${t(dict, 'threshold.value', {
      value: formatNumber(limit.value, 0, dict),
      unit: limit.unit,
      period: limit.averagingPeriod,
    })}`;

    const qualifier = limit.assessableFromSingleReading
      ? localised(dict, 'threshold.singleHourTrigger', 'a single-hour public-information threshold')
      : localised(
          dict,
          'threshold.exceedancesPermitted',
          '{count} exceedances permitted each year, so one hour above it settles nothing',
          { count: formatNumber(limit.permittedExceedances ?? 0, 0, dict) },
        );

    return {
      id: `${limit.pollutant}-${limit.value}-${limit.reference}`,
      label: `${value} — ${qualifier}`,
      value: limit.value,
      conclusive: limit.assessableFromSingleReading,
    };
  });

  /* --- Forecast ---------------------------------------------------------- */

  const { series: forecastSeries } = forecastResult;
  const stationPartial = isStationPartial(forecastSeries, station.expectedPollutants);
  const pointOptions = {
    nowIso,
    stationPartial,
    expectedPollutants: station.expectedPollutants,
    availableHours: forecastSeries.forecast.length,
  };

  const outlook = buildStationOutlook({
    stationId: station.id,
    nowIso,
    // Attribution follows the series that was actually loaded, never the
    // configured provider: a cached fixture series must not be published under
    // the EEA's name.
    provider: forecastSeries.source,
    basedOnObservationAt: forecastSeries.basedOnObservationAt,
    observed: forecastSeries.observed,
    points: buildForecastPoints(forecastSeries, pointOptions),
    pollutantSeries: buildPollutantSeries(forecastSeries, pointOptions),
    weather: forecastContext.weather,
    events: forecastContext.events,
    stationPartial,
    expectedPollutants: station.expectedPollutants,
    // What upstream published, before any view narrows it: confidence must
    // describe the data, not the request.
    publishedForecastHours: forecastSeries.forecast.length,
  });

  /* --- AI explanation ---------------------------------------------------- */

  // Built here, on the server, from the same reading the endpoint would use.
  // It gives the client a deterministic explanation to fall back on when the
  // request never arrives, and the source labels needed to render citations.
  const explainInput = reading ? buildExplainInput(reading, { locale: 'en', station }) : null;
  const explainFallback = explainInput ? buildFallbackExplanation(explainInput) : null;
  const sourceLabels: Record<string, string> = Object.fromEntries(
    (explainInput?.sources ?? []).map((source) => [source.id, source.label]),
  );

  /* --- Derived display values -------------------------------------------- */

  const selectedDefinition = POLLUTANTS[selectedPollutant];
  const latestSelected = reading?.pollutants[selectedPollutant];
  const category = reading?.overallCategory ?? null;
  const elevated = category !== null && isElevatedCategory(category);
  const measuredAtAttr = toDateTimeAttribute(reading?.measuredAt);

  const hrefFor = (next: { range?: TrendRange; pollutant?: PollutantCode }) => {
    const search = new URLSearchParams({
      range: next.range ?? range,
      pollutant: POLLUTANTS[next.pollutant ?? selectedPollutant].slug,
    });
    return `/station/${station.slug}?${search.toString()}`;
  };

  return (
    /* `id="main"` is the skip link's target — every page in this app owns its
       own main landmark; the root layout deliberately does not. */
    <main id="main" className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
      <nav aria-label={t(dict, 'station.allStations')}>
        <Link
          href="/"
          className="text-primary inline-flex min-h-11 items-center gap-1.5 text-sm underline decoration-from-font underline-offset-4"
        >
          <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
          {t(dict, 'header.viewStations')}
        </Link>
      </nav>

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold sm:text-3xl">{station.name}</h1>
        <p className="text-muted-foreground text-sm">
          {station.locality} · {t(dict, `station.island.${station.island.toLowerCase()}`)} ·{' '}
          {t(dict, stationTypeKey(station))} · {t(dict, areaKey(station))}
        </p>
      </header>

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start lg:gap-6">
        {/*
          On a phone the context sits above the readings — the "what is going on
          right now" card a reader swipes through before the detail. On a wide
          screen it becomes the collapsible right-hand panel.
        */}
        <ContextWidget
          events={contextResult.events}
          fetchedAt={contextResult.meta.fetchedAt}
          sources={contextResult.meta.sources}
          /* `meta.partial` says something did not answer, not which — so the
             note stays general rather than naming the wrong provider. */
          partialNote={
            contextResult.meta.partial
              ? localised(
                  dict,
                  'context.partialSources',
                  'One or more sources did not respond, so this list may be incomplete.',
                )
              : undefined
          }
          dict={dict}
          className="order-1 lg:col-start-2 lg:row-start-2"
        />

        <div className="order-2 flex flex-col gap-6 lg:col-start-1 lg:row-span-3 lg:row-start-1">
          {/* --- Current reading ------------------------------------------ */}
          <Card asSection aria-labelledby="now-heading">
            <CardHeader>
              <CardTitle as="h2" id="now-heading" className="text-lg">
                {t(dict, 'header.title')}
              </CardTitle>
            </CardHeader>

            <CardContent>
              {reading ? (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <CategoryBadge
                      category={category}
                      subIndex={reading.overallSubIndex}
                      size="lg"
                      srPrefix={station.name}
                      dict={dict}
                    />
                    {reading.provisional ? (
                      <Badge variant="outline" title={t(dict, 'station.provisionalExplain')}>
                        {t(dict, 'station.provisional')}
                      </Badge>
                    ) : null}
                    {reading.partial ? (
                      <Badge variant="outline" title={t(dict, 'station.partialExplain')}>
                        {t(dict, 'station.partial')}
                      </Badge>
                    ) : null}
                  </div>

                  {/* Poor and worse get a callout rather than a paragraph. The
                      band colour already says it; this says it again in a form
                      that survives greyscale, colour blindness and a glance. */}
                  <p
                    className={cn(
                      'text-sm leading-relaxed',
                      elevated
                        ? 'rounded-card border-border-strong bg-surface-sunken flex items-start gap-2 border p-3 font-medium'
                        : 'text-muted-foreground',
                    )}
                  >
                    {elevated ? (
                      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    ) : null}
                    <span>{t(dict, categoryShortAdviceKey(category))}</span>
                  </p>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    {t(dict, categoryDescriptionKey(category))}
                  </p>

                  {reading.dominantPollutant ? (
                    <p className="text-sm">
                      {t(dict, 'station.dominantPollutant')}:{' '}
                      <strong>{POLLUTANTS[reading.dominantPollutant].label}</strong>
                      <span className="text-muted-foreground block text-xs">
                        {t(dict, 'station.dominantExplain')} {t(dict, 'station.overallExplain')}
                      </span>
                    </p>
                  ) : null}

                  <FreshnessIndicator
                    freshness={reading.freshness}
                    measuredAt={reading.measuredAt}
                    fetchedAt={reading.fetchedAt}
                    ageHours={reading.ageHours}
                    size="md"
                    dict={dict}
                  />

                  {readingsResult.meta.nextExpectedUpdateAt ? (
                    <p className="text-muted-foreground text-xs">
                      {t(dict, 'station.nextExpected', {
                        time: formatInMalta(
                          readingsResult.meta.nextExpectedUpdateAt,
                          DATE_PATTERNS.dateTime,
                          dict,
                        ),
                      })}
                    </p>
                  ) : null}

                  {/* Only when the upstream actually failed.
                      `meta.cached` is true for almost every request by design —
                      the cache is what keeps upstream to ~4 calls an hour — so
                      warning on it would tell nearly every visitor the feed was
                      down. A notice that is always showing is a notice nobody
                      reads. `degradedReason` is set only on a real failure. */}
                  {readingsResult.meta.degradedReason ? (
                    <p className="text-muted-foreground text-xs">
                      {t(dict, 'freshness.cachedNotice')}{' '}
                      {t(dict, 'freshness.degradedReason', {
                        reason: readingsResult.meta.degradedReason,
                      })}
                    </p>
                  ) : null}

                  <p className="text-muted-foreground text-xs">
                    {t(dict, 'disclaimer.provisional')}
                  </p>
                </>
              ) : (
                <>
                  <CategoryBadge category={null} size="lg" srPrefix={station.name} dict={dict} />
                  <p className="text-sm font-medium">{t(dict, 'station.noReading')}</p>
                  <p className="text-muted-foreground text-sm">
                    {t(dict, 'station.noReadingHint')} {t(dict, 'errors.dataUnavailableHint')}
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          {/* --- Pollutants ------------------------------------------------ */}
          <Card asSection aria-labelledby="pollutants-heading">
            <CardHeader>
              <CardTitle as="h2" id="pollutants-heading" className="text-lg">
                {t(dict, 'station.pollutants')}
              </CardTitle>
              {measuredAtAttr ? (
                <p className="text-muted-foreground text-sm">
                  {t(dict, 'station.measuredAt', {
                    time: formatInMalta(reading?.measuredAt, DATE_PATTERNS.dateTime, dict),
                  })}
                </p>
              ) : null}
            </CardHeader>

            <CardContent>
              {availablePollutants.length > 0 ? (
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {availablePollutants.map((code) => (
                    <PollutantRow
                      key={code}
                      code={code}
                      measurement={reading?.pollutants[code]}
                      dominant={reading?.dominantPollutant === code}
                      dict={dict}
                    />
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">{t(dict, 'station.noPollutants')}</p>
              )}
            </CardContent>
          </Card>

          {/* --- Trends ---------------------------------------------------- */}
          <Card asSection aria-labelledby="trends-heading">
            <CardHeader>
              {/* Not "Last ten days": the heading must describe the window the
                  reader has actually selected, and one of them is 24 hours. */}
              <CardTitle as="h2" id="trends-heading" className="text-lg">
                {localised(dict, 'trend.sectionTitle', 'Trends and recent history')}
              </CardTitle>
              <p className="text-muted-foreground text-sm">
                {t(dict, 'forecast.historyDescription')}
              </p>
            </CardHeader>

            <CardContent>
              {/* Window selector. Links, so every view has its own address. */}
              <nav aria-label={localised(dict, 'trend.windowLabel', 'Trend window')}>
                <ul className="flex flex-wrap gap-2">
                  {TREND_RANGES.map((option) => {
                    const current = option === range;
                    return (
                      <li key={option}>
                        <Link
                          href={hrefFor({ range: option })}
                          aria-current={current ? 'page' : undefined}
                          className={cn(
                            'rounded-card inline-flex min-h-11 items-center border px-3 text-sm',
                            current
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-surface text-foreground hover:bg-muted',
                          )}
                        >
                          {localised(dict, RANGE_TEXT[option].tabKey, RANGE_TEXT[option].tab)}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>

              {/* Pollutant selector. */}
              <nav aria-label={t(dict, 'pollutant.selectorLabel')}>
                <ul className="flex flex-wrap gap-2">
                  {availablePollutants.map((code) => {
                    const current = code === selectedPollutant;
                    return (
                      <li key={code}>
                        <Link
                          href={hrefFor({ pollutant: code })}
                          aria-current={current ? 'page' : undefined}
                          className={cn(
                            'rounded-card inline-flex min-h-11 items-center border px-3 text-sm',
                            current
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-surface text-foreground hover:bg-muted',
                          )}
                        >
                          <span aria-hidden="true">{POLLUTANTS[code].label}</span>
                          <span className="sr-only">{POLLUTANTS[code].ariaLabel}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>

              <p className="text-muted-foreground text-xs leading-relaxed">
                {localised(
                  dict,
                  'trend.windowNote',
                  'The published feed carries roughly ten days of hourly history and about two days of forecast, so no longer window is offered. Hours the instrument did not report are shown as gaps.',
                )}
                {stats.spanHours !== null
                  ? ` ${localised(
                      dict,
                      'trend.actualSpan',
                      'This view covers {hours} hours from {from} to {to}.',
                      {
                        hours: formatNumber(stats.spanHours, 0, dict),
                        from: formatInMalta(stats.from, DATE_PATTERNS.dateTime, dict),
                        to: formatInMalta(stats.to, DATE_PATTERNS.dateTime, dict),
                      },
                    )}`
                  : ''}
              </p>

              <TrendChart
                points={points}
                pollutant={selectedPollutant}
                stationName={station.name}
                rangeLabel={rangeLabel}
                observedBoundary={forecastSeries.basedOnObservationAt}
                thresholds={hourlyThresholds}
              />

              <StatRow stats={stats} pollutant={selectedPollutant} dict={dict} />

              <ChartSummaryFootnote dict={dict} />
            </CardContent>
          </Card>

          {/* --- Threshold comparison -------------------------------------- */}
          <Card asSection aria-labelledby="thresholds-heading">
            <CardHeader>
              <CardTitle as="h2" id="thresholds-heading" className="text-lg">
                {t(dict, 'threshold.sectionTitle')}
              </CardTitle>
              <p className="text-muted-foreground text-sm">
                {selectedDefinition.label} —{' '}
                {formatConcentration(latestSelected?.value ?? null, selectedDefinition.unit, dict)}
              </p>
            </CardHeader>
            <CardContent>
              <ThresholdComparison
                pollutant={selectedPollutant}
                value={latestSelected?.value ?? null}
                dict={dict}
              />
            </CardContent>
          </Card>

          {/* --- Health --------------------------------------------------- */}
          <Card asSection aria-labelledby="health-heading">
            <CardHeader>
              <CardTitle as="h2" id="health-heading" className="text-lg">
                {t(dict, 'health.sectionTitle')}
              </CardTitle>
              {category ? (
                <p className="text-muted-foreground text-sm">
                  {t(dict, 'health.currentAdvice')}: {t(dict, categoryLabelKey(category))}
                </p>
              ) : (
                <p className="text-muted-foreground text-sm">{t(dict, 'health.noAdvice')}</p>
              )}
            </CardHeader>
            <CardContent>
              <HealthGuidance category={category} dict={dict} />
            </CardContent>
          </Card>

          {/* --- Forecast -------------------------------------------------- */}
          <ForecastPanel
            outlook={outlook}
            stationName={station.name}
            expectedPollutants={station.expectedPollutants}
            methodologyHref={METHODOLOGY_HREF}
            dict={dict}
          />

          {/* --- Explain this --------------------------------------------- */}
          {reading && explainFallback ? (
            <Card asSection aria-labelledby="explain-heading">
              <CardHeader>
                <CardTitle as="h2" id="explain-heading" className="text-lg">
                  {t(dict, 'ai.sectionTitle')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ExplainButton
                  stationId={station.slug}
                  stationName={station.name}
                  sourceLabels={sourceLabels}
                  fallback={explainFallback}
                  /* VERBATIM, and identical to what the endpoint attaches. */
                  disclaimer={t(dict, 'disclaimer.medical')}
                />
              </CardContent>
            </Card>
          ) : null}

          {/* --- Provenance ----------------------------------------------- */}
          <Card asSection aria-labelledby="source-heading">
            <CardHeader>
              {/* Not simply "Data source": the footer already carries a heading
                  by that name, and two identical h2s make an outline useless. */}
              <CardTitle as="h2" id="source-heading" className="text-lg">
                {localised(dict, 'station.provenanceHeading', 'Where this reading comes from')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {t(dict, 'footer.attribution')}
              </p>

              <ul className="flex flex-col gap-1 text-sm">
                <li>
                  <Link
                    href={METHODOLOGY_HREF}
                    className="text-primary underline decoration-from-font underline-offset-4"
                  >
                    {t(dict, 'footer.methodologyLink')}
                  </Link>
                </li>
                <li>
                  <a
                    href={station.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline decoration-from-font underline-offset-4"
                  >
                    {t(dict, 'station.sourceLink')}
                    <span className="sr-only"> ({t(dict, 'a11y.newWindow')})</span>
                  </a>
                </li>
              </ul>

              <p className="text-muted-foreground text-xs leading-relaxed">
                {t(dict, 'methodology.indexBody')} {t(dict, 'methodology.missingDataBody')}
              </p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                {t(dict, 'disclaimer.notOfficial')}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* --- Station metadata -------------------------------------------- */}
        <Card
          asSection
          aria-labelledby="about-station-heading"
          className="order-3 lg:col-start-2 lg:row-start-1"
        >
          <CardHeader>
            <CardTitle as="h2" id="about-station-heading" className="text-lg">
              {t(dict, 'station.panelTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-3">
              <DetailRow icon={Radio} label={t(dict, 'station.type')}>
                {t(dict, stationTypeKey(station))}
                <span className="text-muted-foreground block text-xs">
                  {t(dict, stationTypeExplainKey(station))}
                </span>
              </DetailRow>

              <DetailRow icon={Building2} label={t(dict, 'station.area')}>
                {t(dict, areaKey(station))}
              </DetailRow>

              <DetailRow icon={MapPin} label={t(dict, 'station.island')}>
                {t(dict, `station.island.${station.island.toLowerCase()}`)}
              </DetailRow>

              <DetailRow icon={Mountain} label={t(dict, 'station.altitude')}>
                <span className="tabular">
                  {t(dict, 'station.altitudeValue', {
                    metres: formatNumber(station.altitudeMetres, 0, dict),
                  })}
                </span>
              </DetailRow>

              <DetailRow icon={Compass} label={t(dict, 'station.coordinates')}>
                <span className="tabular">
                  {formatCoordinates(station.latitude, station.longitude)}
                </span>
              </DetailRow>

              <DetailRow icon={Ruler} label={t(dict, 'station.operator')}>
                {station.operator}
              </DetailRow>
            </dl>

            <p className="text-muted-foreground text-xs">
              {localised(dict, 'station.codeLabel', 'Station code')}:{' '}
              <span className="tabular">{station.id}</span>
            </p>
            <p className="text-muted-foreground text-xs">{t(dict, 'time.timezoneNote')}</p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
