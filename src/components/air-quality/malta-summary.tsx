import type * as React from 'react';

import { BandRail } from '@/components/air-quality/band-rail';
import { FreshnessIndicator } from '@/components/air-quality/freshness-indicator';
import { VisuallyHidden } from '@/components/ui/visually-hidden';
import { POLLUTANTS } from '@/config/pollutants';
import { findStation } from '@/config/stations';
import type { AirQualityCategory } from '@/config/thresholds';
import type { MaltaSummary as MaltaSummaryResult } from '@/lib/air-quality/types';
import {
  categoryLabelKey,
  categoryShortAdviceKey,
  formatNumber,
  getDictionary,
  hasKey,
  t,
  type Dictionary,
} from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';

type HeadingLevel = 'h1' | 'h2' | 'h3';

export type MaltaSummaryProps = Omit<React.ComponentProps<'section'>, 'children'> & {
  summary: MaltaSummaryResult;
  /**
   * Continuous sub-index of the reading that drove the summary.
   *
   * Comes from the driving station's `overallSubIndex`, not from the category:
   * the band alone cannot be turned back into a position, and a rail drawn from
   * a rounded band would put every Moderate reading in the same place.
   */
  subIndex?: number | null;
  /** ISO-8601 UTC instant the readings were retrieved (`ResponseMeta.fetchedAt`). */
  fetchedAt?: string | null;
  /** Whole hours since the newest measurement, or supply `nowIso` instead. */
  ageHours?: number | null;
  /** ISO-8601 UTC "now". Only used when `ageHours` is absent. */
  nowIso?: string;
  /**
   * Show the band's one-sentence advice under the headline.
   *
   * The lede, not the guidance: enough to act on without scrolling, with the
   * groups and caveats left to the guidance panel below. `HealthGuidance` is
   * given `showLead={false}` wherever this is on, so the sentence appears once.
   */
  showAdvice?: boolean;
  headingLevel?: HeadingLevel;
  dict?: Dictionary;
};

/**
 * The islands-wide headline.
 *
 * Built around the scale rather than the label. "Fair" names a band; the rail
 * beneath it shows how far along a six-band axis that band actually sits, which
 * is the difference between knowing a word and knowing how much margin is left.
 * The sub-index driving the pointer was already computed and, until this
 * component was rewritten, appeared only as a figure in brackets.
 *
 * The number on this page is the worst reporting station, not an average, and
 * the section says so in plain words rather than leaving the reader to guess.
 * That matters: averaging five stations would let one genuinely poor location be
 * cancelled out by four good ones, and a reader who assumed an average would
 * draw the opposite conclusion from the same figure.
 *
 * The reporting and total counts are always shown, so "Good across Malta and
 * Gozo" can never be read as five stations agreeing when in fact it was one.
 *
 * The statement itself is deliberately not boxed — it is the first thing on the
 * page and has nothing to be grouped against. Only the scale gets a surface: it
 * is an instrument, and an instrument earns a housing where a headline does not.
 */
export function MaltaSummary({
  summary,
  subIndex,
  fetchedAt,
  ageHours,
  nowIso,
  showAdvice = false,
  headingLevel = 'h2',
  dict = getDictionary(),
  className,
  ...props
}: MaltaSummaryProps) {
  const Heading = headingLevel;
  const hasCategory = summary.category !== null;
  const copy = (key: string, fallback: string): string =>
    hasKey(dict, key) ? t(dict, key) : fallback;

  const categoryLabel = t(dict, categoryLabelKey(summary.category));
  const drivingStation = summary.drivingStationId
    ? findStation(summary.drivingStationId)
    : undefined;

  /* One line of facts about the same reading, joined by dividers rather than
     stacked. Each of these used to be its own paragraph, and five paragraphs of
     14px grey is how a headline stops looking like a headline. */
  const facts = [
    t(dict, 'header.reportingStations', {
      reporting: formatNumber(summary.reportingStations, 0, dict),
      total: formatNumber(summary.totalStations, 0, dict),
    }),
    drivingStation ? t(dict, 'header.drivingStation', { station: drivingStation.name }) : null,
  ].filter((entry): entry is string => entry !== null);

  return (
    /* An asymmetric split, not a stack: the statement owns the wide column and
       the scale sits beside it as an instrument on its own surface. Stacked
       full-width, the headline, the rail and the aggregation note all carried
       the same visual weight — three same-width bands is how a hero stops
       being a hero. */
    <section
      data-slot="malta-summary"
      data-aq-category={summary.category ?? 'none'}
      aria-label={t(dict, 'a11y.statusRegion')}
      className={cn(
        'grid items-start gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-10',
        className,
      )}
      {...props}
    >
      {/* --- The statement ------------------------------------------------- */}
      <div className="flex flex-col gap-5">
        {/* Eyebrow: where, when, how current. Consolidated into one line on
            purpose. "Live · 1 hour old · Measured at · Retrieved at" was
            previously repeated on the summary and on each of the five station
            cards, which is the same four facts printed six times for readings
            that all share an hour. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-muted-foreground font-mono text-[0.6875rem] font-medium tracking-[0.14em] uppercase">
            {t(dict, 'header.overallLabel')}
          </p>
          <span className="bg-border h-3 w-px shrink-0" aria-hidden="true" />
          <FreshnessIndicator
            freshness={summary.freshness}
            measuredAt={summary.measuredAt}
            fetchedAt={fetchedAt}
            ageHours={ageHours}
            nowIso={nowIso}
            size="sm"
            dict={dict}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Heading className="text-3xl leading-[1.05] font-bold text-balance sm:text-4xl lg:text-5xl">
            {hasCategory
              ? t(dict, 'header.overallFor', { category: categoryLabel })
              : t(dict, 'header.noReporting')}
          </Heading>

          {hasCategory ? (
            <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm sm:text-base">
              {summary.dominantPollutant ? (
                <span>
                  <span aria-hidden="true">
                    {t(dict, 'header.dominantPollutant', {
                      pollutant: POLLUTANTS[summary.dominantPollutant].label,
                    })}
                  </span>
                  {/* Written twice: the display label carries subscripts that
                        a screen reader voices badly, so the spoken sentence uses
                        the plain name. */}
                  <VisuallyHidden>
                    {t(dict, 'header.dominantPollutant', {
                      pollutant: POLLUTANTS[summary.dominantPollutant].ariaLabel,
                    })}
                  </VisuallyHidden>
                </span>
              ) : null}
              {facts.map((fact) => (
                <span key={fact} className="flex items-center gap-2">
                  <span className="bg-border h-3 w-px shrink-0" aria-hidden="true" />
                  {fact}
                </span>
              ))}
            </p>
          ) : (
            <p className="text-muted-foreground max-w-prose text-sm leading-relaxed sm:text-base">
              {t(dict, 'header.noReportingHint')}
            </p>
          )}
        </div>

        {/* The one thing to do about it, at reading size. Deliberately larger
            than the surrounding metadata: of everything on this page it is the
            sentence most readers came for. */}
        {showAdvice && hasCategory ? (
          <p className="max-w-prose text-base leading-relaxed sm:text-lg">
            {t(dict, categoryShortAdviceKey(summary.category as AirQualityCategory))}
          </p>
        ) : null}

        {summary.staleStations > 0 ? (
          <p className="text-danger text-sm font-medium">
            {t(dict, 'header.staleStations', {
              count: formatNumber(summary.staleStations, 0, dict),
            })}
          </p>
        ) : null}
      </div>

      {/* --- The instrument --------------------------------------------------
          The scale on its own sunken surface, with the aggregation rule wired
          to it — the rule is a property of the reading the pointer marks, so
          the two travel together.

          The sub-index is deliberately NOT printed beside the rail.
          `formatSubIndex` rounds to one decimal, so a reading of 2.97 prints
          as "3.0" next to a headline that correctly says Fair, and the two look
          like a contradiction. The pointer already states the position exactly;
          the rounded figure remains where it has room to be explained, on the
          station panel. */}
      <div className="rounded-panel border-border bg-surface-sunken flex flex-col gap-4 border p-5">
        <div className="flex flex-col gap-2">
          <BandRail subIndex={subIndex ?? null} category={summary.category} size="lg" dict={dict} />
          <p className="text-subtle text-xs">
            {copy('rail.scaleName', 'European Air Quality Index')}
          </p>
        </div>

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
      </div>
    </section>
  );
}
