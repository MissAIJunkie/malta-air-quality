/**
 * Turning a station's history into something a chart and a table can share.
 *
 * Pure, clock-injectable, and free of any `server-only` import so the same
 * module runs in the server component that computes the statistics and in the
 * client component that draws the line.
 *
 * The single idea that shapes everything here: a point has a KIND, and the kind
 * is read from the data rather than from the wall clock. The upstream feed
 * gap-fills past hours by modelling as well as publishing future ones, so
 * "after now" and "estimated" are different questions with different answers
 * (docs/DATA_SOURCE.md §5). `HistoricalReading.forecast` and
 * `PollutantReading.modelled` answer them; `Date.now()` answers neither.
 */

import type { PollutantCode } from '@/config/pollutants';
import type { AirQualityCategory } from '@/config/thresholds';
import type { HistoricalReading } from '@/lib/air-quality/types';

/**
 * What kind of number a point carries.
 *
 * `missing` is a real state and is kept in the series rather than dropped: an
 * hour the instrument did not report has to appear as a visible gap, and a
 * series that silently omits it would draw a straight line across the hole and
 * invent the reading it is missing.
 */
export type PointKind = 'measured' | 'modelled' | 'forecast' | 'missing';

export type SeriesPoint = {
  /** Epoch milliseconds — a numeric time axis needs a number. */
  atMs: number;
  /** ISO-8601 UTC instant, kept for `<time datetime>` and for formatting. */
  measuredAt: string;
  /** `null` means NOT MEASURED. It is never coerced to 0. */
  value: number | null;
  category: AirQualityCategory | null;
  subIndex: number | null;
  kind: PointKind;
};

/**
 * Extract one pollutant's series from a station's history.
 *
 * Ordering is imposed here rather than assumed: the providers sort, but a
 * chart that receives points out of order draws a scribble, and the cost of
 * being certain is one sort.
 */
export function buildSeries(history: HistoricalReading[], pollutant: PollutantCode): SeriesPoint[] {
  const points: SeriesPoint[] = [];

  for (const reading of history) {
    const atMs = Date.parse(reading.measuredAt);
    if (!Number.isFinite(atMs)) continue;

    const measurement = reading.pollutants[pollutant];
    const value =
      measurement && measurement.value !== null && Number.isFinite(measurement.value)
        ? measurement.value
        : null;

    // Forecast wins over modelled: every forecast hour is modelled, and calling
    // a future hour merely "estimated" would understate what it is.
    let kind: PointKind = 'missing';
    if (value !== null) {
      if (reading.forecast) kind = 'forecast';
      else if (measurement?.modelled) kind = 'modelled';
      else kind = 'measured';
    }

    points.push({
      atMs,
      measuredAt: reading.measuredAt,
      value,
      category: value === null ? null : (measurement?.category ?? null),
      subIndex: value === null ? null : (measurement?.subIndex ?? null),
      kind,
    });
  }

  return points.sort((a, b) => a.atMs - b.atMs);
}

/* -------------------------------------------------------------------------- */
/*  Gaps                                                                      */
/* -------------------------------------------------------------------------- */

const MS_PER_HOUR = 3_600_000;

/**
 * Ceiling on how many absent hours are enumerated across the whole series.
 *
 * Every gap still receives at least one row whatever the budget, because that
 * row is what breaks the line. The budget only limits how completely a very
 * long gap is itemised, which bounds the DOM against a corrupt timestamp
 * without ever letting a gap be drawn through.
 */
const GAP_FILL_BUDGET = 1000;

function missingAt(atMs: number): SeriesPoint {
  return {
    atMs,
    measuredAt: new Date(atMs).toISOString(),
    value: null,
    category: null,
    subIndex: null,
    kind: 'missing',
  };
}

/**
 * Insert explicit rows for hours the feed published nothing at all.
 *
 * Without this the series contains only the hours that exist upstream, and two
 * points eleven days apart become ADJACENT — which a line chart draws as a
 * single straight segment across eleven days of air nobody measured. That is
 * interpolation through missing data, and it is the specific failure this
 * chart is required not to commit.
 *
 * The inserted rows carry `value: null`, so with `connectNulls={false}` the
 * line breaks, and the accessible table gains a row per absent hour saying so
 * in words. An hour with no reading is information; it is not zero, and it is
 * not the average of its neighbours.
 */
export function withGaps(points: SeriesPoint[]): SeriesPoint[] {
  if (points.length < 2) return points;

  const out: SeriesPoint[] = [];
  let budget = GAP_FILL_BUDGET;

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    out.push(point);

    const next = points[index + 1];
    if (!next) continue;

    const missingHours = Math.round((next.atMs - point.atMs) / MS_PER_HOUR) - 1;
    if (missingHours <= 0) continue;

    // At least one, whatever the budget: the break matters more than the
    // itemisation.
    const fill = Math.max(1, Math.min(missingHours, budget));
    budget = Math.max(0, budget - fill);

    for (let hour = 1; hour <= fill; hour += 1) {
      out.push(missingAt(point.atMs + hour * MS_PER_HOUR));
    }
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/*  Ranges                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Trend windows the data can actually support.
 *
 * There is deliberately no 30-day option. Each `current/<CODE>.json` carries
 * roughly ten days of history and about two days of forecast, and
 * `getStationHistory()` reads that feed and nothing else — so a 30-day tab
 * would render two-thirds empty and imply a record that does not exist. `full`
 * shows whatever the feed published and states the span it actually covers.
 */
export const TREND_RANGES = ['24h', '7d', 'full'] as const;

export type TrendRange = (typeof TREND_RANGES)[number];

export const DEFAULT_TREND_RANGE: TrendRange = '24h';

/** Hours of history per range. `null` means "everything published". */
export const TREND_RANGE_HOURS: Record<TrendRange, number | null> = {
  '24h': 24,
  '7d': 24 * 7,
  full: null,
};

export function isTrendRange(value: unknown): value is TrendRange {
  return typeof value === 'string' && (TREND_RANGES as readonly string[]).includes(value);
}

/**
 * Narrow a series to a range.
 *
 * Future points always survive, whatever the range: the window governs how far
 * BACK the reader is looking, and dropping the outlook from a 24-hour view
 * would hide the half of the chart that is about to matter. They stay clearly
 * marked as estimates.
 */
export function sliceSeries(
  points: SeriesPoint[],
  range: TrendRange,
  nowIso: string,
): SeriesPoint[] {
  const hours = TREND_RANGE_HOURS[range];
  if (hours === null) return points;

  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return points;

  const cutoff = nowMs - hours * 3_600_000;
  return points.filter((point) => point.atMs >= cutoff);
}

/* -------------------------------------------------------------------------- */
/*  Statistics                                                                */
/* -------------------------------------------------------------------------- */

export type SeriesStats = {
  /** Points that carry a directly measured value. The denominator for min/max/mean. */
  measuredCount: number;
  modelledCount: number;
  forecastCount: number;
  missingCount: number;
  totalCount: number;
  /** `null` when nothing was measured — never 0. */
  min: number | null;
  max: number | null;
  mean: number | null;
  minAt: string | null;
  maxAt: string | null;
  /** Span the series actually covers, first point to last. */
  from: string | null;
  to: string | null;
  /**
   * Hours from the first point to the last, counted inclusively.
   *
   * Inclusive so that 24 hourly points read as "24 hours" rather than 23. It is
   * NOT a count of points: with gaps, far fewer hours than this carry a value,
   * which is what `measuredCount` and `missingCount` are for.
   */
  spanHours: number | null;
};

/**
 * Minimum, maximum and mean across the MEASURED points only.
 *
 * Modelled gap-fills and forecast hours are excluded on purpose. An average
 * that quietly folds in model output is no longer a statement about what the
 * instrument recorded, and this application's whole contract is that the two
 * are never blended. The counts are returned alongside so the UI can say how
 * many hours the figures rest on.
 */
export function summariseSeries(points: SeriesPoint[]): SeriesStats {
  let measuredCount = 0;
  let modelledCount = 0;
  let forecastCount = 0;
  let missingCount = 0;

  let min: number | null = null;
  let max: number | null = null;
  let minAt: string | null = null;
  let maxAt: string | null = null;
  let total = 0;

  for (const point of points) {
    switch (point.kind) {
      case 'measured':
        break;
      case 'modelled':
        modelledCount += 1;
        continue;
      case 'forecast':
        forecastCount += 1;
        continue;
      default:
        missingCount += 1;
        continue;
    }

    const value = point.value;
    if (value === null) continue;

    measuredCount += 1;
    total += value;

    if (min === null || value < min) {
      min = value;
      minAt = point.measuredAt;
    }
    if (max === null || value > max) {
      max = value;
      maxAt = point.measuredAt;
    }
  }

  const from = points[0]?.measuredAt ?? null;
  const to = points[points.length - 1]?.measuredAt ?? null;
  const spanHours =
    points.length > 1
      ? Math.max(1, Math.round((points[points.length - 1].atMs - points[0].atMs) / 3_600_000) + 1)
      : null;

  return {
    measuredCount,
    modelledCount,
    forecastCount,
    missingCount,
    totalCount: points.length,
    min,
    max,
    mean: measuredCount > 0 ? total / measuredCount : null,
    minAt,
    maxAt,
    from,
    to,
    spanHours,
  };
}

/* -------------------------------------------------------------------------- */
/*  Chart rows                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One row per hour, with the value repeated into a series key per kind.
 *
 * Three keys rather than one, so the three kinds can be drawn in three
 * different line styles and no reader can mistake a modelled hour for a
 * measured one. A `missing` hour leaves all three `null`, which — with
 * `connectNulls={false}` — is what produces the visible gap.
 */
export type ChartRow = SeriesPoint & {
  measured: number | null;
  modelled: number | null;
  forecast: number | null;
};

/** Least certain of two kinds. Drives which style a joining segment takes. */
function lessCertain(a: PointKind, b: PointKind): PointKind {
  const order: PointKind[] = ['measured', 'modelled', 'forecast'];
  return order.indexOf(b) > order.indexOf(a) ? b : a;
}

/**
 * Build the chart rows, joining adjacent runs of different kinds.
 *
 * Without the join, the step from the last measured hour to the first forecast
 * hour would render as a gap and the chart would look broken at precisely the
 * moment a reader is trying to follow it across.
 *
 * The joining segment is always drawn in the LESS CERTAIN of the two styles, so
 * a line leaving a measured point for a forecast one is dashed from the moment
 * it leaves. Drawing it the other way round would present a segment of forecast
 * as though it were observed.
 *
 * The duplicated endpoint does not produce a duplicated marker: each line's dot
 * renderer draws only where `row.kind` matches its own series.
 */
export function toChartRows(points: SeriesPoint[]): ChartRow[] {
  const rows: ChartRow[] = points.map((point) => ({
    ...point,
    measured: point.kind === 'measured' ? point.value : null,
    modelled: point.kind === 'modelled' ? point.value : null,
    forecast: point.kind === 'forecast' ? point.value : null,
  }));

  for (let i = 0; i < rows.length - 1; i += 1) {
    const a = rows[i];
    const b = rows[i + 1];
    if (a.value === null || b.value === null) continue;
    if (a.kind === b.kind) continue;

    const key = lessCertain(a.kind, b.kind);
    if (key === 'missing') continue;
    if (a[key] === null) a[key] = a.value;
    if (b[key] === null) b[key] = b.value;
  }

  return rows;
}
