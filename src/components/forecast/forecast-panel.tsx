import {
  CalendarClock,
  CircleHelp,
  Gauge,
  Minus,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
} from 'lucide-react';

import { POLLUTANTS, type PollutantCode } from '@/config/pollutants';
import type { ImpactDirection } from '@/lib/environmental-context/types';
import type {
  EnrichedForecastDriver,
  ForecastConfidence,
  StationForecastOutlook,
} from '@/lib/forecast/types';
import {
  DATE_PATTERNS,
  formatInMalta,
  formatList,
  formatNumber,
  getDictionary,
  t,
  toDateTimeAttribute,
  type Dictionary,
} from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';
import { CategoryBadge } from '@/components/air-quality/category-badge';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { localised } from '@/components/charts/localised';
import { SourceLink } from '@/components/environmental-context/source-link';

/**
 * The estimated air-quality outlook.
 *
 * maqua.app does not forecast air quality. It surfaces the official CAMS
 * forecast that the EEA publishes in the same file as the measurements, and the
 * entire job of this panel is to make sure nobody can mistake one for the other.
 *
 * Hence: an "Estimated" chip in the heading, an estimate label on every day and
 * every driver, a visually distinct surface, the instant the outlook was
 * assembled, the last real measurement it rests on, the span actually published
 * rather than a nominal "48 hours", the confidence and the reasons behind it,
 * the sources, the methodology, and a plain list of what this outlook cannot
 * tell you.
 *
 * Where the payload carries both an i18n key and its English sentence, the key
 * wins only if the dictionary has it — see `localised`.
 */

/* -------------------------------------------------------------------------- */
/*  Vocabulary                                                                */
/* -------------------------------------------------------------------------- */

const CONFIDENCE_TEXT: Record<ForecastConfidence, { key: string; text: string }> = {
  high: { key: 'forecast.confidence.high', text: 'Higher confidence' },
  medium: { key: 'forecast.confidence.medium', text: 'Moderate confidence' },
  low: { key: 'forecast.confidence.low', text: 'Lower confidence' },
};

export function confidenceLabel(level: ForecastConfidence, dict: Dictionary): string {
  const entry = CONFIDENCE_TEXT[level];
  return localised(dict, entry.key, entry.text);
}

const IMPACT_TEXT: Record<ImpactDirection, { key: string; text: string; icon: typeof Minus }> = {
  worsening: {
    key: 'forecast.impact.worsening',
    text: 'May push levels up',
    icon: TrendingUp,
  },
  improving: {
    key: 'forecast.impact.improving',
    text: 'May bring levels down',
    icon: TrendingDown,
  },
  neutral: {
    key: 'forecast.impact.neutral',
    text: 'No clear push either way',
    icon: Minus,
  },
  unclear: {
    key: 'forecast.impact.unclear',
    text: 'Effect is mixed or unclear',
    icon: CircleHelp,
  },
};

/* -------------------------------------------------------------------------- */
/*  Drivers                                                                   */
/* -------------------------------------------------------------------------- */

function DriverItem({ driver, dict }: { driver: EnrichedForecastDriver; dict: Dictionary }) {
  const impact = IMPACT_TEXT[driver.impact];
  const Icon = impact.icon;

  const from = toDateTimeAttribute(driver.appliesFrom);
  const to = toDateTimeAttribute(driver.appliesTo);

  return (
    <li className="rounded-card border-border bg-surface flex flex-col gap-1 border p-3">
      <p className="flex items-start gap-2 text-sm font-semibold">
        <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {localised(dict, driver.labelKey, driver.label, driver.vars)}
      </p>

      <p className="text-muted-foreground text-sm leading-relaxed">
        {localised(dict, driver.detailKey, driver.detail, driver.vars)}
      </p>

      <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span>{localised(dict, impact.key, impact.text)}</span>
        <span aria-hidden="true">·</span>
        <span>{confidenceLabel(driver.confidence, dict)}</span>
        {from && to ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="tabular">
              <time dateTime={from}>
                {formatInMalta(driver.appliesFrom, DATE_PATTERNS.dateTime, dict)}
              </time>
              {' – '}
              <time dateTime={to}>
                {formatInMalta(driver.appliesTo, DATE_PATTERNS.dateTime, dict)}
              </time>
            </span>
          </>
        ) : null}
      </p>

      <SourceLink
        name={driver.sourceName}
        url={driver.sourceUrl}
        prefix={localised(dict, 'common.sourcePrefix', 'Source:')}
        dict={dict}
      />
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/*  Panel                                                                     */
/* -------------------------------------------------------------------------- */

export type ForecastPanelProps = {
  outlook: StationForecastOutlook;
  stationName: string;
  /**
   * What the station normally measures. Used to state plainly which pollutants
   * the model does not forecast, rather than leaving their absence unexplained.
   */
  expectedPollutants: PollutantCode[];
  /** Where the full methodology write-up lives. */
  methodologyHref?: string;
  headingId?: string;
  dict?: Dictionary;
  className?: string;
};

export function ForecastPanel({
  outlook,
  stationName,
  expectedPollutants,
  methodologyHref = '/methodology',
  headingId = 'forecast-heading',
  dict = getDictionary(),
  className,
}: ForecastPanelProps) {
  const generatedAt = toDateTimeAttribute(outlook.generatedAt);
  const basedOn = toDateTimeAttribute(outlook.basedOnObservationAt);

  const forecastPollutants = new Set(
    outlook.pollutantSeries.filter((series) => series.points.length > 0).map((s) => s.pollutant),
  );
  const notForecast = expectedPollutants.filter((code) => !forecastPollutants.has(code));

  return (
    <Card
      asSection
      aria-labelledby={headingId}
      /* Dashed border and a sunken surface: the outlook must not look like the
         measured panels above it, before a single word is read. */
      className={cn('bg-surface-sunken border-dashed', className)}
    >
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle as="h2" id={headingId} className="text-lg">
            {localised(dict, 'forecast.outlookTitle', 'Estimated air-quality outlook')}
          </CardTitle>
          <Badge variant="outline">
            <CalendarClock aria-hidden="true" />
            {t(dict, 'common.estimated')}
          </Badge>
        </div>

        <p className="text-muted-foreground text-sm leading-relaxed">
          {t(dict, 'forecast.notObservation')} {t(dict, 'forecast.description')}
        </p>
      </CardHeader>

      <CardContent>
        {/* Provenance, always, whether or not there is anything to show. */}
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground text-xs">
              {localised(dict, 'forecast.generatedAtLabel', 'Prepared at')}
            </dt>
            <dd className="tabular">
              {generatedAt ? (
                <time dateTime={generatedAt}>
                  {formatInMalta(outlook.generatedAt, DATE_PATTERNS.dateTime, dict)}
                </time>
              ) : (
                t(dict, 'common.notAvailable')
              )}
            </dd>
          </div>

          <div>
            <dt className="text-muted-foreground text-xs">
              {localised(dict, 'forecast.basedOnLabel', 'Based on measurements up to')}
            </dt>
            <dd className="tabular">
              {basedOn ? (
                <time dateTime={basedOn}>
                  {formatInMalta(outlook.basedOnObservationAt, DATE_PATTERNS.dateTime, dict)}
                </time>
              ) : (
                t(dict, 'common.notAvailable')
              )}
            </dd>
          </div>

          {outlook.horizon ? (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground text-xs">
                {localised(dict, 'forecast.horizonLabel', 'Published outlook')}
              </dt>
              <dd className="tabular">
                {localised(dict, 'forecast.horizonValue', '{from} to {to} ({hours} hours)', {
                  from: formatInMalta(outlook.horizon.from, DATE_PATTERNS.dateTime, dict),
                  to: formatInMalta(outlook.horizon.to, DATE_PATTERNS.dateTime, dict),
                  hours: formatNumber(outlook.horizon.hours, 0, dict),
                })}
              </dd>
            </div>
          ) : null}
        </dl>

        {!outlook.available ? (
          <p className="rounded-card border-border bg-surface flex items-start gap-2 border p-3 text-sm">
            <TriangleAlert
              className="text-muted-foreground mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <span>
              {t(dict, 'forecast.noForecast')}{' '}
              {localised(dict, outlook.unavailableReasonKey, outlook.unavailableReason ?? '')}
            </span>
          </p>
        ) : (
          <>
            {/* Confidence, with its reasons. A bare "medium" explains nothing. */}
            <div className="rounded-card border-border bg-surface flex flex-col gap-1.5 border p-3">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Gauge className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                {confidenceLabel(outlook.confidence, dict)}
              </p>
              {outlook.confidenceReasons.length > 0 ? (
                <ul className="text-muted-foreground list-disc pl-5 text-sm">
                  {outlook.confidenceReasons.map((reason, index) => (
                    <li key={outlook.confidenceReasonKeys[index] ?? reason}>
                      {localised(dict, outlook.confidenceReasonKeys[index], reason)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {outlook.peak?.predictedCategory ? (
              <p className="text-sm">
                {t(dict, 'forecast.peakExpected', {
                  time: formatInMalta(outlook.peak.forecastAt, DATE_PATTERNS.dateTime, dict),
                })}{' '}
                <CategoryBadge
                  category={outlook.peak.predictedCategory}
                  subIndex={outlook.peak.predictedSubIndex}
                  size="sm"
                  srPrefix={localised(dict, 'forecast.peakBadgePrefix', 'Highest expected band')}
                  dict={dict}
                />
              </p>
            ) : null}

            {/* Day by day. Every card says "estimate" in words. */}
            {outlook.days.length > 0 ? (
              <ul className="grid gap-3 sm:grid-cols-2">
                {outlook.days.map((day) => (
                  <li
                    key={day.date}
                    className="rounded-card border-border bg-surface flex flex-col gap-2 border p-3"
                  >
                    <p className="text-sm font-semibold">
                      <time dateTime={day.date}>
                        {formatInMalta(`${day.date}T12:00:00Z`, DATE_PATTERNS.dateLong, dict)}
                      </time>
                    </p>

                    <CategoryBadge
                      category={day.worstCategory}
                      size="sm"
                      srPrefix={localised(
                        dict,
                        'forecast.dayBadgePrefix',
                        'Highest band estimated for this day',
                      )}
                      dict={dict}
                    />

                    <p className="text-muted-foreground text-xs">
                      {t(dict, 'common.estimated')}
                      {' · '}
                      {confidenceLabel(day.confidence, dict)}
                      {' · '}
                      {localised(dict, 'forecast.dayHours', '{count} forecast hours', {
                        count: formatNumber(day.hours, 0, dict),
                      })}
                    </p>

                    {day.dominantPollutant ? (
                      <p className="text-muted-foreground text-xs">
                        {t(dict, 'header.dominantPollutant', {
                          pollutant: POLLUTANTS[day.dominantPollutant].label,
                        })}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}

            {outlook.drivers.length > 0 ? (
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">
                  {localised(dict, 'forecast.driversHeading', 'Why the outlook looks like this')}
                </h3>
                <ul className="flex flex-col gap-2">
                  {outlook.drivers.map((driver) => (
                    <DriverItem key={driver.id} driver={driver} dict={dict} />
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}

        {/* Limitations. Stated whether or not an outlook was published — the
            absence of one is itself a limitation worth naming. */}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">
            {localised(dict, 'forecast.limitationsHeading', 'What this outlook cannot tell you')}
          </h3>
          <ul className="text-muted-foreground list-disc pl-5 text-sm leading-relaxed">
            <li>
              {localised(
                dict,
                'forecast.limitation.modelOutput',
                'These are modelled values for {station}, not measurements, and may differ from what is later recorded there.',
                { station: stationName },
              )}
            </li>
            <li>
              {localised(
                dict,
                'forecast.limitation.regional',
                'The model describes regional conditions. It cannot anticipate a local event such as roadworks, a fire or a fireworks display.',
              )}
            </li>
            <li>
              {localised(
                dict,
                'forecast.limitation.horizon',
                'Confidence falls the further ahead the outlook reaches.',
              )}
            </li>
            {notForecast.length > 0 ? (
              <li>
                {localised(
                  dict,
                  'forecast.limitation.notForecast',
                  'No forecast is published for {pollutants} at this station, although the station measures it.',
                  {
                    pollutants: formatList(
                      notForecast.map((code) => POLLUTANTS[code].label),
                      dict,
                    ),
                  },
                )}
              </li>
            ) : null}
          </ul>
        </div>

        {/* Methodology and attribution. */}
        <div className="border-border flex flex-col gap-2 border-t pt-3">
          <p className="text-muted-foreground text-xs leading-relaxed">
            {localised(dict, outlook.methodologyKey, outlook.methodology)}
          </p>

          <p className="text-xs">
            <a
              href={methodologyHref}
              className="text-primary underline decoration-from-font underline-offset-2"
            >
              {t(dict, 'footer.methodologyLink')}
            </a>
          </p>

          <ul className="flex flex-col gap-1">
            {outlook.sources.map((source) => (
              <li key={source.name}>
                <SourceLink
                  name={source.name}
                  url={source.url}
                  prefix={localised(dict, 'common.sourcePrefix', 'Source:')}
                  dict={dict}
                />
                <span className="text-muted-foreground ml-1 text-xs">({source.licence})</span>
              </li>
            ))}
          </ul>

          <p className="text-muted-foreground text-xs">{t(dict, 'disclaimer.medical')}</p>
        </div>
      </CardContent>
    </Card>
  );
}
