'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type DotItemDotProps,
  type TooltipContentProps,
} from 'recharts';

import { POLLUTANTS, type PollutantCode } from '@/config/pollutants';
import { CATEGORY_PRESENTATION } from '@/config/thresholds';
import { breakpointsFor } from '@/lib/air-quality/calculate-index';
import {
  DATE_PATTERNS,
  categoryLabelKey,
  formatConcentration,
  formatInMalta,
  formatNumber,
  getDictionary,
  t,
  type Dictionary,
} from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';
import { ChartSummary, describeSeries, kindLabel } from './chart-summary';
import { localised } from './localised';
import { toChartRows, type ChartRow, type SeriesPoint } from './series';

/**
 * The hourly trend for one pollutant at one station.
 *
 * Four commitments shape this component, and none of them is negotiable for a
 * chart on a public-health page.
 *
 * **Gaps stay gaps.** An hour the instrument did not report leaves every series
 * key `null` and, with `connectNulls={false}`, leaves a hole in the line. The
 * alternative — interpolating, or worse plotting 0 — would draw a measurement
 * that was never taken.
 *
 * **Estimates never look like observations.** Measured, modelled and forecast
 * hours are three separate series with three separate line styles and three
 * separate markers. The dashed styles are legible in greyscale, so the
 * distinction does not depend on colour.
 *
 * **Bands are context, not decoration.** The six European AQI bands are drawn
 * as background regions so a value can be read against them at a glance, and
 * the legend beneath spells out every band's name and range in text.
 *
 * **The chart is not the only copy of the data.** `ChartSummary` renders the
 * same series as a sentence and a table. The SVG is marked `role="img"` with
 * that sentence as its accessible name, and carries no focusable descendants.
 *
 * Animation is off outright rather than gated behind a media query: Recharts
 * animates in JavaScript, so the global `prefers-reduced-motion` rule in
 * `globals.css` cannot reach it, and a reference tool has nothing to gain from
 * a line that draws itself.
 */

/* -------------------------------------------------------------------------- */
/*  Series presentation                                                       */
/* -------------------------------------------------------------------------- */

const SERIES_STYLE = {
  measured: { stroke: 'var(--primary)', dash: undefined, width: 2 },
  modelled: { stroke: 'var(--muted-foreground)', dash: '2 3', width: 1.75 },
  forecast: { stroke: 'var(--accent)', dash: '7 4', width: 2 },
} as const;

/**
 * Markers are drawn only where the row's own kind matches the series.
 *
 * `toChartRows` repeats a value into a neighbouring series so the line joins
 * across a change of kind; without this check that shared endpoint would carry
 * two markers, and the wrong one would be on top — a measured hour wearing a
 * forecast marker is precisely the confusion this chart exists to prevent.
 */
function dotFor(kind: keyof typeof SERIES_STYLE, props: DotItemDotProps) {
  const row = props.payload as ChartRow | undefined;
  if (!row || row.kind !== kind) return null;
  if (typeof props.cx !== 'number' || typeof props.cy !== 'number') return null;

  const style = SERIES_STYLE[kind];
  const measured = kind === 'measured';

  return (
    <circle
      cx={props.cx}
      cy={props.cy}
      r={2.6}
      // Measured points are solid; estimated ones are hollow, which reads as
      // "less substantial" without needing a colour to say so.
      fill={measured ? style.stroke : 'var(--surface)'}
      stroke={style.stroke}
      strokeWidth={1.25}
    />
  );
}

function MeasuredDot(props: DotItemDotProps) {
  return dotFor('measured', props);
}

function ModelledDot(props: DotItemDotProps) {
  return dotFor('modelled', props);
}

function ForecastDot(props: DotItemDotProps) {
  return dotFor('forecast', props);
}

/* -------------------------------------------------------------------------- */
/*  Tooltip                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Generic parameters are left at their defaults on purpose: `Tooltip.content`
 * is a function-typed property, so under `strictFunctionTypes` a narrower
 * parameter would not be assignable to it.
 */
type TrendTooltipProps = TooltipContentProps & {
  pollutant: PollutantCode;
  dict: Dictionary;
};

function TrendTooltip({ active, payload, pollutant, dict }: TrendTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const row = payload[0]?.payload as ChartRow | undefined;
  if (!row) return null;

  const definition = POLLUTANTS[pollutant];

  return (
    <div className="rounded-card border-border bg-surface-raised shadow-panel border px-3 py-2 text-xs">
      <p className="tabular font-medium">
        {formatInMalta(row.measuredAt, DATE_PATTERNS.dateTime, dict)}
      </p>
      <p className="tabular mt-1 text-sm font-semibold">
        {formatConcentration(row.value, definition.unit, dict)}
      </p>
      <p className="text-muted-foreground mt-0.5">
        {row.category ? t(dict, categoryLabelKey(row.category)) : t(dict, 'category.noData.label')}
        {' · '}
        {kindLabel(row.kind, dict)}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Scale                                                                     */
/* -------------------------------------------------------------------------- */

/** Round up to a value an axis can be read against: 1, 1.5, 2, 2.5, 3, 4, 5, 6 or 8 × 10ⁿ. */
function niceCeiling(value: number): number {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

/**
 * How far above the peak a band ceiling may sit before it stops being a scale.
 *
 * A band ceiling makes the best axis top, because the band boundaries are then
 * exactly where the reader expects them. But the SIXTH band's ceiling is the
 * upstream's saturation point rather than a boundary — 1200 µg/m³ for PM10,
 * 1000 for NO₂ — so an "Extremely poor" hour of 280 µg/m³ would be plotted
 * against a 1200 axis and flattened into a line along the bottom, at precisely
 * the moment its shape matters most.
 */
const MAX_HEADROOM_FACTOR = 3;

/**
 * Top of the y-axis.
 *
 * The lowest band ceiling at or above the peak, provided it is a usable scale;
 * otherwise a rounded value just above the peak. With nothing to plot the axis
 * runs to the top of band 2, so an empty chart still has an honest scale rather
 * than an arbitrary one.
 */
function yAxisTop(values: number[], pollutant: PollutantCode): number {
  const bands = breakpointsFor(pollutant);
  const peak = values.length > 0 ? Math.max(...values) : 0;
  if (peak <= 0) return bands[1].max;

  const containing = bands.find((band) => peak <= band.max);
  if (containing && containing.max <= peak * MAX_HEADROOM_FACTOR) return containing.max;

  return niceCeiling(peak * 1.2);
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A threshold defined over a single hour, and therefore plottable on an hourly
 * chart.
 *
 * `conclusive` is not decoration. Only two of these numbers — the ozone
 * information and alert thresholds — mean anything when a single hour crosses
 * them. NO₂ at 200 and SO₂ at 350 are also one-hour limits, but they permit 18
 * and 24 exceedances a year respectively, so an hour above them establishes
 * nothing. Both kinds are drawn, in deliberately different weights, and the
 * label carries the difference in words.
 */
export type HourlyThresholdLine = {
  id: string;
  /** Fully qualified: the number means nothing without its averaging period. */
  label: string;
  value: number;
  /** True only when one hour above this genuinely means something. */
  conclusive: boolean;
};

export type TrendChartProps = {
  points: SeriesPoint[];
  pollutant: PollutantCode;
  stationName: string;
  /** Human description of the window, e.g. "the last 24 hours". */
  rangeLabel: string;
  /**
   * Newest hour carrying a real measurement. Everything after it is estimated.
   *
   * Passed in rather than derived from `Date.now()`: the feed gap-fills past
   * hours too, so the wall clock cannot locate this boundary.
   */
  observedBoundary?: string | null;
  /**
   * Only thresholds defined over a single hour belong on an hourly chart.
   * Annual and 24-hour limits are compared in prose beneath, where the
   * inconclusiveness can be stated.
   */
  thresholds?: HourlyThresholdLine[];
  className?: string;
};

export function TrendChart({
  points,
  pollutant,
  stationName,
  rangeLabel,
  observedBoundary,
  thresholds = [],
  className,
}: TrendChartProps) {
  const dict = getDictionary();
  const definition = POLLUTANTS[pollutant];

  const rows = toChartRows(points);
  const values = rows.map((row) => row.value).filter((value): value is number => value !== null);

  const top = yAxisTop(values, pollutant);
  const bands = breakpointsFor(pollutant);

  const boundaryMs = observedBoundary ? Date.parse(observedBoundary) : Number.NaN;
  const hasBoundary =
    Number.isFinite(boundaryMs) &&
    rows.length > 0 &&
    boundaryMs > rows[0].atMs &&
    boundaryMs < rows[rows.length - 1].atMs;

  const spanHours = rows.length > 1 ? (rows[rows.length - 1].atMs - rows[0].atMs) / 3_600_000 : 0;
  // Below two days the hour is what a reader is looking for; beyond it the day
  // is, and repeating "00:00" across ten days tells nobody anything.
  const axisPattern = spanHours <= 48 ? DATE_PATTERNS.time : DATE_PATTERNS.date;

  const plottedThresholds = thresholds.filter((line) => line.value <= top);
  const description = describeSeries(points, pollutant, stationName, rangeLabel, dict);

  const kinds = new Set(rows.map((row) => row.kind));

  return (
    <figure className={cn('flex flex-col gap-3', className)}>
      <p className="text-muted-foreground text-xs font-medium">
        {t(dict, 'forecast.axisConcentration', { unit: definition.unit })}
      </p>

      {/*
        `role="img"` collapses the SVG to a single node with the summary as its
        name. Recharts' accessibility layer is deliberately NOT enabled: it adds
        focusable elements, and focusable descendants of a `role="img"` are
        unreachable to a screen reader while still being in the tab order. The
        table under the chart is the keyboard route to the values.
      */}
      <div
        role="img"
        aria-label={description}
        /* `overflow-hidden` contains the pre-measurement render — see
           `initialDimension` below — so nothing can spill on a narrow screen. */
        className="h-72 w-full overflow-hidden sm:h-80"
        data-testid="trend-chart"
      >
        {rows.length > 0 ? (
          <ResponsiveContainer
            width="100%"
            height="100%"
            /*
              Recharts defaults its initial dimensions to -1, and renders
              nothing at all until a `ResizeObserver` callback has measured the
              container. That leaves an empty box wherever measurement is
              unavailable or late — including any environment without
              `ResizeObserver`, which is also why the component is testable at
              all. A concrete starting size draws the chart immediately; the
              first measurement then snaps it to the true width, and
              `overflow-hidden` above keeps the intervening frame inside its box.
            */
            initialDimension={{ width: 640, height: 288 }}
          >
            <LineChart
              data={rows}
              margin={{ top: 8, right: 12, bottom: 4, left: 0 }}
              /*
                Recharts turns its accessibility layer on by default, which puts
                `tabindex="0"` on the SVG. Inside `role="img"` that is a
                focusable element that assistive technology cannot see into — a
                tab stop that announces nothing. The written summary and the
                data table below are this chart's accessible route, so the layer
                is switched off rather than left to conflict with them.
              */
              accessibilityLayer={false}
            >
              {/*
                Band backgrounds. `y1` is the previous band's ceiling rather than
                this band's floor: the bands are integer-inclusive ranges
                (16–45), so drawing from 16 would leave a one-unit stripe of
                blank between every pair.
              */}
              {bands.map((band, index) => {
                const from = index === 0 ? 0 : bands[index - 1].max;
                if (from >= top) return null;
                return (
                  <ReferenceArea
                    key={band.category}
                    y1={from}
                    y2={Math.min(band.max, top)}
                    ifOverflow="hidden"
                    fill={CATEGORY_PRESENTATION[band.category].color}
                    fillOpacity={0.16}
                    stroke="none"
                  />
                );
              })}

              <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />

              <XAxis
                dataKey="atMs"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(value: number) => formatInMalta(value, axisPattern, dict)}
                minTickGap={44}
                stroke="var(--border)"
                tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
              />

              <YAxis
                type="number"
                domain={[0, top]}
                tickFormatter={(value: number) => formatNumber(value, 0, dict)}
                width={44}
                stroke="var(--border)"
                tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
              />

              {plottedThresholds.map((line) => (
                <ReferenceLine
                  key={line.id}
                  y={line.value}
                  ifOverflow="hidden"
                  // A line a single hour cannot settle is drawn as a faint rule,
                  // not as a red bright line. Same information, honest weight.
                  stroke={line.conclusive ? 'var(--danger)' : 'var(--border-strong)'}
                  strokeDasharray={line.conclusive ? '6 3' : '2 5'}
                  strokeWidth={line.conclusive ? 1.5 : 1}
                />
              ))}

              {hasBoundary ? (
                <ReferenceLine
                  x={boundaryMs}
                  ifOverflow="hidden"
                  stroke="var(--foreground)"
                  strokeDasharray="3 3"
                  strokeWidth={1.5}
                />
              ) : null}

              <Tooltip
                isAnimationActive={false}
                cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
                content={(props) => <TrendTooltip {...props} pollutant={pollutant} dict={dict} />}
              />

              <Line
                type="monotone"
                dataKey="measured"
                name={t(dict, 'pollutant.measuredLabel')}
                stroke={SERIES_STYLE.measured.stroke}
                strokeWidth={SERIES_STYLE.measured.width}
                dot={MeasuredDot}
                activeDot={{ r: 4 }}
                connectNulls={false}
                isAnimationActive={false}
              />

              <Line
                type="monotone"
                dataKey="modelled"
                name={t(dict, 'pollutant.modelledLabel')}
                stroke={SERIES_STYLE.modelled.stroke}
                strokeWidth={SERIES_STYLE.modelled.width}
                strokeDasharray={SERIES_STYLE.modelled.dash}
                dot={ModelledDot}
                activeDot={{ r: 4 }}
                connectNulls={false}
                isAnimationActive={false}
              />

              <Line
                type="monotone"
                dataKey="forecast"
                name={t(dict, 'forecast.forecastLabel')}
                stroke={SERIES_STYLE.forecast.stroke}
                strokeWidth={SERIES_STYLE.forecast.width}
                strokeDasharray={SERIES_STYLE.forecast.dash}
                dot={ForecastDot}
                activeDot={{ r: 4 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="rounded-card border-border text-muted-foreground flex h-full items-center justify-center border border-dashed p-4 text-center text-sm">
            {t(dict, 'errors.dataUnavailable')} — {t(dict, 'errors.dataUnavailableHint')}
          </div>
        )}
      </div>

      <p className="text-muted-foreground text-xs font-medium">{t(dict, 'forecast.axisTime')}</p>

      {/* Legend. Every visual encoding used above is restated here in words. */}
      <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-2 text-xs">
        {(['measured', 'modelled', 'forecast'] as const)
          .filter((kind) => kinds.has(kind))
          .map((kind) => (
            <li key={kind} className="flex items-center gap-2">
              <svg width="26" height="10" aria-hidden="true" className="shrink-0">
                <line
                  x1="0"
                  y1="5"
                  x2="26"
                  y2="5"
                  stroke={SERIES_STYLE[kind].stroke}
                  strokeWidth={SERIES_STYLE[kind].width}
                  strokeDasharray={SERIES_STYLE[kind].dash}
                />
                <circle
                  cx="13"
                  cy="5"
                  r="2.6"
                  fill={kind === 'measured' ? SERIES_STYLE[kind].stroke : 'var(--surface)'}
                  stroke={SERIES_STYLE[kind].stroke}
                  strokeWidth={1.25}
                />
              </svg>
              {kindLabel(kind, dict)}
            </li>
          ))}

        {kinds.has('missing') ? (
          <li className="flex items-center gap-2">
            <svg width="26" height="10" aria-hidden="true" className="shrink-0">
              <line x1="0" y1="5" x2="9" y2="5" stroke="var(--border-strong)" strokeWidth={1.5} />
              <line x1="17" y1="5" x2="26" y2="5" stroke="var(--border-strong)" strokeWidth={1.5} />
            </svg>
            {localised(dict, 'chart.legend.gap', 'Gap — no value published for that hour')}
          </li>
        ) : null}

        {hasBoundary ? (
          <li className="flex items-center gap-2">
            <svg width="26" height="10" aria-hidden="true" className="shrink-0">
              <line
                x1="13"
                y1="0"
                x2="13"
                y2="10"
                stroke="var(--foreground)"
                strokeDasharray="3 3"
                strokeWidth={1.5}
              />
            </svg>
            {t(dict, 'forecast.boundaryNote')}
          </li>
        ) : null}

        {plottedThresholds.map((line) => (
          <li key={line.id} className="flex items-start gap-2">
            <svg width="26" height="10" aria-hidden="true" className="mt-1 shrink-0">
              <line
                x1="0"
                y1="5"
                x2="26"
                y2="5"
                stroke={line.conclusive ? 'var(--danger)' : 'var(--border-strong)'}
                strokeDasharray={line.conclusive ? '6 3' : '2 5'}
                strokeWidth={line.conclusive ? 1.5 : 1}
              />
            </svg>
            <span>{line.label}</span>
          </li>
        ))}
      </ul>

      {/* Band key: colour, name and the range each band covers, in text. */}
      <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {bands.map((band, index) => {
          const from = index === 0 ? 0 : bands[index - 1].max;
          if (from >= top) return null;
          return (
            <li key={band.category} className="flex items-center gap-1.5">
              <span
                className="aq-dot shrink-0"
                data-aq-band={CATEGORY_PRESENTATION[band.category].bandId}
                aria-hidden="true"
              />
              <span>
                {t(dict, categoryLabelKey(band.category))}{' '}
                <span className="tabular">
                  {formatNumber(from, 0, dict)}–{formatNumber(band.max, 0, dict)}
                </span>{' '}
                {definition.unit}
              </span>
            </li>
          );
        })}
      </ul>

      <figcaption>
        <ChartSummary
          points={points}
          pollutant={pollutant}
          stationName={stationName}
          rangeLabel={rangeLabel}
          dict={dict}
        />
      </figcaption>
    </figure>
  );
}
