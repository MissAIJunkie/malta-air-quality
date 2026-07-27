'use client';

import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type * as React from 'react';

import { CategoryBadge } from '@/components/air-quality/category-badge';
import {
  OVERALL_FILTER,
  categoryForFilter,
  pollutantReadingFor,
} from '@/components/pollutants/filter-value';
import { PollutantValue } from '@/components/pollutants/pollutant-value';
import {
  islandLabel,
  stationHref,
  type StationDescriptor,
  type StationEntry,
} from '@/components/stations/types';
import { VisuallyHidden } from '@/components/ui/visually-hidden';
import { POLLUTANTS, POLLUTANT_CODES, type PollutantCode } from '@/config/pollutants';
import { categoryRank, type AirQualityCategory } from '@/config/thresholds';
import type { FreshnessState, StationReading } from '@/lib/air-quality/types';
import {
  formatMeasuredAt,
  formatRelativeAge,
  getDictionary,
  t,
  toDateTimeAttribute,
  type Dictionary,
} from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';

/* -------------------------------------------------------------------------- */
/*  Sorting                                                                   */
/* -------------------------------------------------------------------------- */

export type StationSortKey =
  'station' | 'island' | 'category' | 'pollutant' | 'measuredAt' | 'freshness';

export type StationSortDirection = 'ascending' | 'descending';

export type StationSort = {
  key: StationSortKey;
  direction: StationSortDirection;
};

type Column = {
  key: StationSortKey;
  /** Painted in the header. */
  label: string;
  /** Announced instead of `label` where the two differ. */
  spoken: string;
};

/**
 * Pinned locale, not the runtime's.
 *
 * This component server-renders before it hydrates, and `localeCompare` with an
 * unpinned locale resolves differently on Node and in the browser — enough to
 * reorder "Għarb" against "Attard" between the two passes and produce a
 * hydration mismatch. `sensitivity: 'base'` also sorts the Maltese diacritics
 * next to their plain letters rather than after every unaccented name.
 */
const COLLATOR = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** Worst last: freshness reads best from most current to least. */
const FRESHNESS_ORDER: Record<FreshnessState, number> = {
  fresh: 0,
  delayed: 1,
  stale: 2,
  unavailable: 3,
};

/**
 * Rank an air-quality category. `null` is deliberately absent from this scale.
 *
 * "No data" is not the best band and not the worst — it is not on the scale at
 * all, so rows without a category are pushed to the end in BOTH directions
 * rather than being allowed to sort as if they were Good.
 */
function categoryValue(category: AirQualityCategory | null): number | null {
  return category === null ? null : categoryRank(category);
}

function timeValue(reading: StationReading | null): number | null {
  if (!reading) return null;
  const ms = Date.parse(reading.measuredAt);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Compare two possibly-absent numbers, keeping absences last either way.
 *
 * Returns `null` when neither row has a value, letting the caller fall through
 * to the stable tiebreak instead of declaring an arbitrary winner.
 */
function compareNullable(a: number | null, b: number | null, descending: boolean): number | null {
  if (a === null && b === null) return null;
  if (a === null) return 1;
  if (b === null) return -1;
  if (a === b) return null;
  return descending ? b - a : a - b;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export type StationListProps = Omit<React.ComponentProps<'div'>, 'children'> & {
  entries: readonly StationEntry[];
  /**
   * Show one pollutant's value and band instead of the station's overall band.
   * Mirrors the pollutant filter, so this list and a filtered map agree.
   */
  pollutant?: PollutantCode | null;
  /** Uncontrolled starting order. */
  defaultSort?: StationSort;
  /** Controlled order. Supply `onSortChange` alongside it. */
  sort?: StationSort;
  onSortChange?: (sort: StationSort) => void;
  /** Visible table caption. Defaults to "All stations". */
  caption?: string;
  /** Link to a station's full page. Defaults to `stationHref(station)`. */
  hrefFor?: (station: StationDescriptor) => string;
  dict?: Dictionary;
};

/**
 * The map-free equivalent of the station map.
 *
 * This is not a fallback or a degraded view: it carries every fact the map
 * carries — which station, on which island, in which band, driven by which
 * pollutant, measured when, and how current that makes it — in a real table
 * that can be read linearly, navigated cell by cell, sorted from the keyboard
 * and printed.
 *
 * A client component because the columns sort. The order that ships in the
 * server render is a meaningful one (station name, A to Z) rather than the
 * array's incidental order, so the table is already useful before it hydrates.
 */
export function StationList({
  entries,
  pollutant = null,
  defaultSort,
  sort,
  onSortChange,
  caption,
  hrefFor,
  dict = getDictionary(),
  className,
  ...props
}: StationListProps) {
  const [internalSort, setInternalSort] = useState<StationSort>(
    defaultSort ?? { key: 'station', direction: 'ascending' },
  );
  const [announcement, setAnnouncement] = useState('');

  const activeSort = sort ?? internalSort;

  // The leading-pollutant column is meaningless while a single pollutant is
  // selected: every row would name that same pollutant.
  const showDominantColumn = pollutant === null;

  const columns = useMemo(() => {
    // `label` is what is painted, `spoken` is what is announced. They differ
    // only for a pollutant column, whose display label carries a subscript
    // that a screen reader would read out character by character.
    const list: Column[] = [
      { key: 'station', label: t(dict, 'nav.stations'), spoken: t(dict, 'nav.stations') },
      { key: 'island', label: t(dict, 'station.island'), spoken: t(dict, 'station.island') },
      {
        key: 'category',
        label: pollutant ? POLLUTANTS[pollutant].label : t(dict, 'station.overall'),
        spoken: pollutant ? POLLUTANTS[pollutant].ariaLabel : t(dict, 'station.overall'),
      },
    ];

    if (showDominantColumn) {
      const label = t(dict, 'station.dominantPollutant');
      list.push({ key: 'pollutant', label, spoken: label });
    }

    const measuredLabel = t(dict, 'freshness.measuredAtLabel');
    const ageLabel = t(dict, 'freshness.ageLabel');
    list.push(
      { key: 'measuredAt', label: measuredLabel, spoken: measuredLabel },
      { key: 'freshness', label: ageLabel, spoken: ageLabel },
    );

    return list;
  }, [dict, pollutant, showDominantColumn]);

  // A controlled caller could hand us a key whose column is hidden, and a
  // visible column can disappear when a filter is applied. Either way the table
  // must still sort by something that exists.
  const sortIsUsable = columns.some((column) => column.key === activeSort.key);
  const sortKey: StationSortKey = sortIsUsable ? activeSort.key : 'station';
  const sortDirection: StationSortDirection = sortIsUsable ? activeSort.direction : 'ascending';

  const rows = useMemo(
    () => sortEntries(entries, { key: sortKey, direction: sortDirection }, pollutant),
    [entries, sortKey, sortDirection, pollutant],
  );

  function handleSort(key: StationSortKey, spoken: string) {
    const direction: StationSortDirection =
      sortKey === key && sortDirection === 'ascending' ? 'descending' : 'ascending';

    const next: StationSort = { key, direction };
    if (sort === undefined) setInternalSort(next);
    onSortChange?.(next);

    // Reordering rows is silent to a screen reader, so the new order is
    // announced once, politely. `aria-sort` on the header carries the same
    // fact for anyone who navigates back to it.
    setAnnouncement(
      `${spoken}${t(dict, 'common.separator')}${t(
        dict,
        direction === 'ascending' ? 'a11y.sortAscending' : 'a11y.sortDescending',
      )}`,
    );
  }

  return (
    <div data-slot="station-list" className={cn('flex flex-col gap-2', className)} {...props}>
      {/* `relative` so this box is the containing block for the `sr-only`
          pollutant labels in the cells. They are `position: absolute`, and
          without it they resolve against the initial containing block, keep
          their static position out in the scrolled-away part of the table and
          escape this clip — which makes the whole document scroll sideways. */}
      <div className="relative overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="text-muted-foreground pb-3 text-left text-sm">
            {caption ?? t(dict, 'station.allStations')}
          </caption>

          <thead>
            <tr className="border-border border-b">
              {columns.map((column) => {
                const isActive = sortKey === column.key;
                const SortIcon = !isActive
                  ? ChevronsUpDown
                  : sortDirection === 'ascending'
                    ? ArrowUp
                    : ArrowDown;

                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={isActive ? sortDirection : 'none'}
                    className="p-0 align-bottom"
                  >
                    {/* The button's accessible name is the column label and
                        nothing else. Folding the sort state into the name
                        would have it announced on every visit to the cell;
                        `aria-sort` above already carries that. */}
                    <button
                      type="button"
                      onClick={() => handleSort(column.key, column.spoken)}
                      className={cn(
                        'hover:bg-muted inline-flex min-h-11 w-full items-center gap-1.5 rounded-sm px-3 py-2 text-left text-xs font-semibold transition-colors',
                        isActive ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {column.label === column.spoken ? (
                        column.label
                      ) : (
                        <>
                          <span aria-hidden="true">{column.label}</span>
                          <VisuallyHidden>{column.spoken}</VisuallyHidden>
                        </>
                      )}
                      <SortIcon className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="text-muted-foreground px-3 py-6 text-center"
                >
                  {t(dict, 'home.emptyState')}
                </td>
              </tr>
            ) : null}

            {rows.map(({ station, reading }) => {
              const category = categoryForFilter(reading, pollutant ?? OVERALL_FILTER);
              const measuredDateTime = toDateTimeAttribute(reading?.measuredAt);
              const dominant = reading?.dominantPollutant ?? null;

              return (
                <tr key={station.id} className="border-border border-b last:border-b-0">
                  <th scope="row" className="px-3 py-2 align-top font-medium">
                    <Link
                      href={hrefFor ? hrefFor(station) : stationHref(station)}
                      className="hover:text-primary inline-flex min-h-11 items-center rounded-sm transition-colors"
                    >
                      {station.name}
                    </Link>
                  </th>

                  <td className="px-3 py-2 align-middle">{islandLabel(station.island, dict)}</td>

                  <td className="px-3 py-2 align-middle">
                    {pollutant ? (
                      <PollutantValue
                        pollutant={pollutant}
                        reading={pollutantReadingFor(reading, pollutant)}
                        variant="inline"
                        showPollutant={false}
                        dict={dict}
                      />
                    ) : (
                      <CategoryBadge
                        category={category}
                        size="sm"
                        variant="outline"
                        srPrefix={station.name}
                        dict={dict}
                      />
                    )}
                  </td>

                  {showDominantColumn ? (
                    <td className="px-3 py-2 align-middle">
                      {dominant ? (
                        <>
                          <span aria-hidden="true">{POLLUTANTS[dominant].label}</span>
                          <VisuallyHidden>{POLLUTANTS[dominant].ariaLabel}</VisuallyHidden>
                        </>
                      ) : (
                        <span className="text-muted-foreground">
                          {t(dict, 'common.notAvailable')}
                        </span>
                      )}
                    </td>
                  ) : null}

                  <td className="tabular px-3 py-2 align-middle">
                    {measuredDateTime ? (
                      <time dateTime={measuredDateTime}>
                        {formatMeasuredAt(reading?.measuredAt, dict)}
                      </time>
                    ) : (
                      <span className="text-muted-foreground">
                        {t(dict, 'common.notAvailable')}
                      </span>
                    )}
                  </td>

                  <td className="px-3 py-2 align-middle">
                    {reading ? (
                      <span className="flex flex-col">
                        <span>{t(dict, freshnessLabelKey(reading.freshness))}</span>
                        <span className="text-muted-foreground text-xs">
                          {formatRelativeAge(reading.ageHours, dict)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-danger">{t(dict, 'freshness.unavailable.label')}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Empty on first paint, so arriving at the page announces nothing. */}
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <p className="text-muted-foreground text-xs leading-relaxed">
        {t(dict, 'a11y.colourNotAlone')}
      </p>
    </div>
  );
}

function freshnessLabelKey(state: FreshnessState): string {
  return `freshness.${state}.label`;
}

/* -------------------------------------------------------------------------- */
/*  Ordering                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Order the rows.
 *
 * Every comparator falls through to the station id, so equal keys always
 * produce the same order — without it, re-sorting on a tied column would
 * shuffle rows for no visible reason.
 */
function sortEntries(
  entries: readonly StationEntry[],
  sort: StationSort,
  pollutant: PollutantCode | null,
): StationEntry[] {
  const descending = sort.direction === 'descending';
  const sign = descending ? -1 : 1;

  return [...entries].sort((a, b) => {
    const primary = compareBy(a, b, sort.key, pollutant, descending, sign);
    if (primary !== null && primary !== 0) return primary;
    return COLLATOR.compare(a.station.id, b.station.id);
  });
}

function compareBy(
  a: StationEntry,
  b: StationEntry,
  key: StationSortKey,
  pollutant: PollutantCode | null,
  descending: boolean,
  sign: number,
): number | null {
  switch (key) {
    case 'station':
      return sign * COLLATOR.compare(a.station.name, b.station.name);

    case 'island': {
      const byIsland = COLLATOR.compare(a.station.island, b.station.island);
      // Within an island the secondary order is the station name, which stays
      // ascending: flipping it too would make the grouping hard to scan.
      return byIsland === 0 ? COLLATOR.compare(a.station.name, b.station.name) : sign * byIsland;
    }

    case 'category':
      return compareNullable(
        categoryValue(categoryForFilter(a.reading, pollutant ?? OVERALL_FILTER)),
        categoryValue(categoryForFilter(b.reading, pollutant ?? OVERALL_FILTER)),
        descending,
      );

    case 'pollutant': {
      const rank = (entry: StationEntry) => {
        const code = entry.reading?.dominantPollutant;
        if (!code) return null;
        const index = POLLUTANT_CODES.indexOf(code);
        return index === -1 ? null : index;
      };
      return compareNullable(rank(a), rank(b), descending);
    }

    case 'measuredAt':
      return compareNullable(timeValue(a.reading), timeValue(b.reading), descending);

    case 'freshness':
      return compareNullable(
        a.reading ? FRESHNESS_ORDER[a.reading.freshness] : null,
        b.reading ? FRESHNESS_ORDER[b.reading.freshness] : null,
        descending,
      );

    default:
      return null;
  }
}
