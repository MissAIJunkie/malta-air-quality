import Link from 'next/link';
import type * as React from 'react';

import { BandRail } from '@/components/air-quality/band-rail';
import { CategoryBadge } from '@/components/air-quality/category-badge';
import { FreshnessIndicator } from '@/components/air-quality/freshness-indicator';
import {
  OVERALL_FILTER,
  categoryForFilter,
  pollutantReadingFor,
} from '@/components/pollutants/filter-value';
import { PollutantValue } from '@/components/pollutants/pollutant-value';
import {
  islandLabel,
  stationHref,
  stationTypeLabel,
  type StationDescriptor,
} from '@/components/stations/types';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { POLLUTANTS, type PollutantCode } from '@/config/pollutants';
import type { StationReading } from '@/lib/air-quality/types';
import { getDictionary, t, type Dictionary } from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';

type HeadingLevel = 'h2' | 'h3' | 'h4';

export type StationCardProps = Omit<React.ComponentProps<'div'>, 'children'> & {
  station: StationDescriptor;
  /** `null` when the station published nothing usable for this hour. */
  reading: StationReading | null | undefined;
  /**
   * Colour and summarise by one pollutant instead of the station's overall
   * band. Matches the pollutant filter, so a filtered map and a filtered card
   * never disagree.
   */
  pollutant?: PollutantCode | null;
  /** Link to the station's full page. Defaults to `stationHref(station)`. */
  href?: string;
  /**
   * A caller-supplied control, e.g. "show on the map". Rendered in the footer.
   * Its presence disables the whole-card click target, since two overlapping
   * targets would make the card's own link unreachable by pointer.
   */
  action?: React.ReactNode;
  headingLevel?: HeadingLevel;
  dict?: Dictionary;
};

/**
 * A station at a glance.
 *
 * With `href` and no `action`, the heading's link is stretched over the whole
 * card, so the card behaves as one large target while the accessibility tree
 * still contains exactly one link with a meaningful name. Adding an `action`
 * removes the stretch rather than nesting interactive elements.
 */
export function StationCard({
  station,
  reading,
  pollutant = null,
  href,
  action,
  headingLevel = 'h3',
  dict = getDictionary(),
  className,
  ...props
}: StationCardProps) {
  const Heading = headingLevel;
  const resolvedHref = href ?? stationHref(station);

  const filter = pollutant ?? OVERALL_FILTER;
  const category = categoryForFilter(reading, filter);
  const pollutantReading = pollutant ? pollutantReadingFor(reading, pollutant) : null;

  const stretch = Boolean(resolvedHref) && !action;

  return (
    <Card
      data-slot="station-card"
      data-station={station.id}
      className={cn('gap-3', stretch && 'relative', className)}
      {...props}
    >
      <div className="flex flex-col gap-1">
        <Heading className="text-base leading-tight font-semibold">
          <Link
            href={resolvedHref}
            className={cn(
              'hover:text-primary inline-flex min-h-11 items-center rounded-sm transition-colors',
              // A stretched link keeps one link per card rather than wrapping
              // the card in a second, redundant one.
              stretch && 'after:absolute after:inset-0 after:content-[""]',
            )}
          >
            {station.name}
          </Link>
        </Heading>

        <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm">
          <span>{station.locality}</span>
          <span aria-hidden="true">{t(dict, 'common.separator')}</span>
          <span>{islandLabel(station.island, dict)}</span>
          <span aria-hidden="true">{t(dict, 'common.separator')}</span>
          <span>{stationTypeLabel(station.stationType, dict)}</span>
        </p>
      </div>

      {pollutant ? (
        <PollutantValue
          pollutant={pollutant}
          reading={pollutantReading}
          variant="inline"
          dict={dict}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <CategoryBadge
            category={category}
            size="md"
            subIndex={reading?.overallSubIndex ?? null}
            srPrefix={station.name}
            dict={dict}
          />

          {reading?.dominantPollutant ? (
            <Badge variant="subtle" size="sm">
              <span aria-hidden="true">{POLLUTANTS[reading.dominantPollutant].label}</span>
              <span className="sr-only">
                {t(dict, 'header.dominantPollutant', {
                  pollutant: POLLUTANTS[reading.dominantPollutant].ariaLabel,
                })}
              </span>
            </Badge>
          ) : null}
        </div>
      )}

      {/* The same scale as the headline, at 6px.
          Five cards in a row become directly comparable: the pointers line up
          against one shared axis, so "which station is worst, and by how much"
          is answered by eye rather than by reading five sub-indices. Only drawn
          for the overall band — under a pollutant filter the card shows that
          pollutant's own value, and a rail built from the station's overall
          index would be measuring something else. */}
      {!pollutant ? (
        <BandRail
          subIndex={reading?.overallSubIndex ?? null}
          category={category}
          size="sm"
          forLabel={station.name}
          dict={dict}
        />
      ) : null}

      {reading ? (
        <FreshnessIndicator
          freshness={reading.freshness}
          measuredAt={reading.measuredAt}
          ageHours={reading.ageHours}
          /* The headline states the measurement hour for the whole page. A
             fresh station shares it by definition, so repeating it on all five
             cards printed the same timestamp six times; anything not fresh is
             exactly the case where the reader does need its own time. */
          showTimestamp={reading.freshness !== 'fresh'}
          size="sm"
          dict={dict}
        />
      ) : (
        <p className="text-muted-foreground text-sm">{t(dict, 'station.noReading')}</p>
      )}

      {reading?.provisional ? (
        <p className="text-muted-foreground text-xs">{t(dict, 'station.provisional')}</p>
      ) : null}

      {/* Sits above the stretched link's pseudo-element so it stays clickable. */}
      {action ? <div className="relative z-10 flex flex-wrap gap-2">{action}</div> : null}
    </Card>
  );
}
