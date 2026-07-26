import type * as React from 'react';

import { CategoryBadge } from '@/components/air-quality/category-badge';
import { FreshnessIndicator } from '@/components/air-quality/freshness-indicator';
import { VisuallyHidden } from '@/components/ui/visually-hidden';
import { POLLUTANTS } from '@/config/pollutants';
import { findStation } from '@/config/stations';
import type { MaltaSummary as MaltaSummaryResult } from '@/lib/air-quality/types';
import { categoryLabelKey, formatNumber, getDictionary, t, type Dictionary } from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';

type HeadingLevel = 'h1' | 'h2' | 'h3';

export type MaltaSummaryProps = Omit<React.ComponentProps<'section'>, 'children'> & {
  summary: MaltaSummaryResult;
  /** ISO-8601 UTC instant the readings were retrieved (`ResponseMeta.fetchedAt`). */
  fetchedAt?: string | null;
  /** Whole hours since the newest measurement, or supply `nowIso` instead. */
  ageHours?: number | null;
  /** ISO-8601 UTC "now". Only used when `ageHours` is absent. */
  nowIso?: string;
  headingLevel?: HeadingLevel;
  dict?: Dictionary;
};

/**
 * The islands-wide headline.
 *
 * The number on this card is the worst reporting station, not an average, and
 * the card says so in plain words rather than leaving the reader to guess. That
 * matters: averaging five stations would let one genuinely poor location be
 * cancelled out by four good ones, and a reader who assumed an average would
 * draw the opposite conclusion from the same figure.
 *
 * The reporting and total counts are always shown, so "Good across Malta and
 * Gozo" can never be read as five stations agreeing when in fact it was one.
 */
export function MaltaSummary({
  summary,
  fetchedAt,
  ageHours,
  nowIso,
  headingLevel = 'h2',
  dict = getDictionary(),
  className,
  ...props
}: MaltaSummaryProps) {
  const Heading = headingLevel;
  const hasCategory = summary.category !== null;

  const categoryLabel = t(dict, categoryLabelKey(summary.category));
  const drivingStation = summary.drivingStationId
    ? findStation(summary.drivingStationId)
    : undefined;

  return (
    <section
      data-slot="malta-summary"
      data-aq-category={summary.category ?? 'none'}
      aria-label={t(dict, 'a11y.statusRegion')}
      className={cn(
        'rounded-panel border-border bg-surface shadow-card flex flex-col gap-4 border p-5',
        className,
      )}
      {...props}
    >
      <div className="flex flex-col gap-1">
        <Heading className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
          {t(dict, 'header.overallLabel')}
        </Heading>

        {hasCategory ? (
          <p className="text-2xl leading-tight font-semibold">
            {t(dict, 'header.overallFor', { category: categoryLabel })}
          </p>
        ) : (
          <p className="text-2xl leading-tight font-semibold">{t(dict, 'header.noReporting')}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <CategoryBadge category={summary.category} size="lg" dict={dict} />

        {/* Written twice: the display label carries subscripts that a screen
            reader voices badly, so the spoken sentence uses the plain name. */}
        {summary.dominantPollutant ? (
          <p className="text-sm">
            <span aria-hidden="true">
              {t(dict, 'header.dominantPollutant', {
                pollutant: POLLUTANTS[summary.dominantPollutant].label,
              })}
            </span>
            <VisuallyHidden>
              {t(dict, 'header.dominantPollutant', {
                pollutant: POLLUTANTS[summary.dominantPollutant].ariaLabel,
              })}
            </VisuallyHidden>
          </p>
        ) : null}
      </div>

      {!hasCategory ? (
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t(dict, 'header.noReportingHint')}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5 text-sm">
        <p className="tabular font-medium">
          {t(dict, 'header.reportingStations', {
            reporting: formatNumber(summary.reportingStations, 0, dict),
            total: formatNumber(summary.totalStations, 0, dict),
          })}
        </p>

        {drivingStation ? (
          <p>{t(dict, 'header.drivingStation', { station: drivingStation.name })}</p>
        ) : null}

        {summary.staleStations > 0 ? (
          <p className="text-danger">
            {t(dict, 'header.staleStations', {
              count: formatNumber(summary.staleStations, 0, dict),
            })}
          </p>
        ) : null}
      </div>

      <FreshnessIndicator
        freshness={summary.freshness}
        measuredAt={summary.measuredAt}
        fetchedAt={fetchedAt}
        ageHours={ageHours}
        nowIso={nowIso}
        size="sm"
        dict={dict}
      />

      {/* The aggregation method is stated, not implied. `summary.aggregation`
          is currently only ever 'worst-station'; if another method is ever
          added, this copy must be branched rather than reused, because the
          sentence describes this specific rule. */}
      <div className="border-border flex flex-col gap-1 border-t pt-3">
        <p className="text-sm font-medium">{t(dict, 'header.aggregation')}</p>
        <p className="text-muted-foreground text-xs leading-relaxed">
          {t(dict, 'header.aggregationExplain')}
        </p>
      </div>
    </section>
  );
}
