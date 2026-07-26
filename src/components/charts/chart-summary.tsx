import type * as React from 'react';

import { POLLUTANTS, type PollutantCode } from '@/config/pollutants';
import {
  DATE_PATTERNS,
  categoryLabelKey,
  formatConcentration,
  formatInMalta,
  getDictionary,
  t,
  toDateTimeAttribute,
  type Dictionary,
} from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';
import { localised } from './localised';
import { summariseSeries, type PointKind, type SeriesPoint } from './series';

/**
 * The chart's text alternative.
 *
 * A line chart is an image, and an image of numbers is not data to anyone using
 * a screen reader, a text browser, or a printer that dropped the SVG. So every
 * chart on this site ships with this component: a sentence that says what the
 * series does, and the complete table of values behind a disclosure.
 *
 * The table is a real `<table>` with a `<caption>` and header cells, not a grid
 * of divs, because that is what row-and-column navigation needs. It carries a
 * "How the value was obtained" column rather than relying on the line style,
 * which does not survive the transition to text.
 */

const KIND_FALLBACK: Record<PointKind, { key: string; text: string }> = {
  measured: { key: 'pollutant.measuredLabel', text: 'Measured' },
  modelled: { key: 'pollutant.modelledLabel', text: 'Estimated' },
  forecast: { key: 'forecast.forecastLabel', text: 'Forecast' },
  missing: { key: 'pollutant.noValue', text: 'No value for this hour' },
};

export function kindLabel(kind: PointKind, dict: Dictionary): string {
  const entry = KIND_FALLBACK[kind];
  return localised(dict, entry.key, entry.text);
}

export type ChartSummaryProps = {
  points: SeriesPoint[];
  pollutant: PollutantCode;
  stationName: string;
  /** Human description of the window, e.g. "the last 24 hours". */
  rangeLabel: string;
  /**
   * When false the whole component is available only to assistive technology.
   * The default renders the sentence visibly and puts the table behind a
   * disclosure, because sighted readers want the numbers too.
   */
  visible?: boolean;
  dict?: Dictionary;
};

/**
 * One sentence describing the series.
 *
 * Exported because the chart uses the same text as its `aria-label`, so the
 * accessible name of the image and the paragraph beneath it cannot drift apart.
 */
export function describeSeries(
  points: SeriesPoint[],
  pollutant: PollutantCode,
  stationName: string,
  rangeLabel: string,
  dict: Dictionary = getDictionary(),
): string {
  const definition = POLLUTANTS[pollutant];
  const stats = summariseSeries(points);

  if (points.length === 0) {
    return localised(
      dict,
      'chart.summary.empty',
      '{pollutant} at {station}: no hourly values were published for {range}.',
      { pollutant: definition.ariaLabel, station: stationName, range: rangeLabel },
    );
  }

  const sentences: string[] = [
    localised(
      dict,
      'chart.summary.lead',
      '{pollutant} at {station}, hourly, in {unit}, covering {range}.',
      {
        pollutant: definition.ariaLabel,
        station: stationName,
        unit: definition.unit,
        range: rangeLabel,
      },
    ),
    // The window a reader asked for and the hours the feed actually published
    // are different things, and on a sparse feed they diverge sharply. Both are
    // stated, so "the last 7 days" can never imply seven days of data.
    localised(dict, 'chart.summary.coverage', 'The published points run from {from} to {to}.', {
      from: formatInMalta(stats.from, DATE_PATTERNS.dateTime, dict),
      to: formatInMalta(stats.to, DATE_PATTERNS.dateTime, dict),
    }),
    localised(
      dict,
      'chart.summary.composition',
      '{total} hours are shown: {measured} measured, {modelled} filled in by modelling, {forecast} forecast, and {missing} with no value at all.',
      {
        total: stats.totalCount,
        measured: stats.measuredCount,
        modelled: stats.modelledCount,
        forecast: stats.forecastCount,
        missing: stats.missingCount,
      },
    ),
  ];

  if (stats.measuredCount > 0) {
    sentences.push(
      localised(
        dict,
        'chart.summary.range',
        'Measured values ran from {min} at {minAt} to {max} at {maxAt}, averaging {mean} across the {count} measured hours.',
        {
          min: formatConcentration(stats.min, definition.unit, dict),
          minAt: formatInMalta(stats.minAt, DATE_PATTERNS.dateTime, dict),
          max: formatConcentration(stats.max, definition.unit, dict),
          maxAt: formatInMalta(stats.maxAt, DATE_PATTERNS.dateTime, dict),
          mean: formatConcentration(stats.mean, definition.unit, dict),
          count: stats.measuredCount,
        },
      ),
    );
  } else {
    sentences.push(
      localised(
        dict,
        'chart.summary.noMeasured',
        'No directly measured value is available in this window, so no minimum, maximum or average can be given.',
      ),
    );
  }

  return sentences.join(' ');
}

export function ChartSummary({
  points,
  pollutant,
  stationName,
  rangeLabel,
  visible = true,
  dict = getDictionary(),
}: ChartSummaryProps) {
  const definition = POLLUTANTS[pollutant];
  const description = describeSeries(points, pollutant, stationName, rangeLabel, dict);

  return (
    <div className="flex flex-col gap-2">
      <p className={cn('text-muted-foreground text-sm leading-relaxed', !visible && 'sr-only')}>
        {description}
      </p>

      {points.length > 0 ? (
        <details className={cn('group', !visible && 'sr-only')}>
          <summary className="text-primary inline-flex min-h-11 cursor-pointer items-center text-sm font-medium underline decoration-from-font underline-offset-4">
            {t(dict, 'a11y.dataTableToggle')}
          </summary>

          {/* Wide content scrolls inside its own box; the page must not. */}
          <div className="rounded-card border-border mt-2 max-h-96 overflow-auto border">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="text-muted-foreground px-3 py-2 text-left text-xs">
                {t(dict, 'a11y.dataTableCaption')} — {definition.ariaLabel}, {definition.unit}.
              </caption>
              <thead className="bg-surface-sunken sticky top-0">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {localised(dict, 'chart.table.time', 'Time (Malta)')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {localised(dict, 'chart.table.value', 'Value')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {localised(dict, 'chart.table.band', 'Band')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {localised(dict, 'chart.table.origin', 'How the value was obtained')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {points.map((point) => (
                  <tr key={point.measuredAt} className="border-border border-t">
                    <th scope="row" className="px-3 py-1.5 font-normal whitespace-nowrap">
                      <time dateTime={toDateTimeAttribute(point.measuredAt)} className="tabular">
                        {formatInMalta(point.measuredAt, DATE_PATTERNS.dateTime, dict)}
                      </time>
                    </th>
                    <td className="tabular px-3 py-1.5 whitespace-nowrap">
                      {/* `null` renders the unavailable marker, never a zero. */}
                      {formatConcentration(point.value, definition.unit, dict)}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      {point.category
                        ? t(dict, categoryLabelKey(point.category))
                        : t(dict, 'category.noData.label')}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{kindLabel(point.kind, dict)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </div>
  );
}

/**
 * The two standing caveats that belong under any chart of this feed: some past
 * hours are modelled gap-fills, and every time shown is Malta wall-clock time.
 */
export function ChartSummaryFootnote({
  className,
  dict = getDictionary(),
  ...props
}: React.ComponentProps<'p'> & { dict?: Dictionary }) {
  return (
    <p className={cn('text-muted-foreground text-xs', className)} {...props}>
      {t(dict, 'forecast.gapFilledNote')} {t(dict, 'time.timezoneNote')}
    </p>
  );
}
