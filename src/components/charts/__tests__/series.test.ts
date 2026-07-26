import { describe, expect, it } from 'vitest';

import type { PollutantReading, HistoricalReading } from '@/lib/air-quality/types';
import { buildPollutantReading } from '@/lib/air-quality/calculate-index';

import { buildSeries, sliceSeries, summariseSeries, toChartRows, withGaps } from '../series';

function hour(index: number): string {
  return new Date(Date.UTC(2026, 6, 20, index)).toISOString();
}

function point(
  index: number,
  value: number | null,
  options: { modelled?: boolean; forecast?: boolean } = {},
): HistoricalReading {
  const pollutants: Partial<Record<'PM10', PollutantReading>> = {};
  if (value !== null) {
    pollutants.PM10 = buildPollutantReading('PM10', value, { modelled: options.modelled });
  }

  return {
    stationId: 'MT00011',
    measuredAt: hour(index),
    pollutants,
    overallCategory: null,
    dominantPollutant: null,
    forecast: options.forecast ?? false,
  };
}

describe('buildSeries', () => {
  it('classifies a point by the data, never by the clock', () => {
    const series = buildSeries(
      [
        point(0, 20),
        point(1, 22, { modelled: true }),
        point(2, 24, { modelled: true, forecast: true }),
        point(3, null),
      ],
      'PM10',
    );

    expect(series.map((p) => p.kind)).toEqual(['measured', 'modelled', 'forecast', 'missing']);
  });

  it('keeps a missing hour as a null value rather than dropping or zeroing it', () => {
    const [only] = buildSeries([point(0, null)], 'PM10');

    expect(only.value).toBeNull();
    expect(only.category).toBeNull();
    expect(only.kind).toBe('missing');
  });

  it('orders points in time regardless of the input order', () => {
    const series = buildSeries([point(5, 20), point(1, 30), point(3, 25)], 'PM10');
    expect(series.map((p) => p.measuredAt)).toEqual([hour(1), hour(3), hour(5)]);
  });
});

describe('withGaps', () => {
  it('inserts a null row for every hour the feed published nothing', () => {
    // Two real points four hours apart: three absent hours between them.
    const series = withGaps(buildSeries([point(0, 20), point(4, 30)], 'PM10'));

    expect(series).toHaveLength(5);
    expect(series.slice(1, 4).every((p) => p.value === null && p.kind === 'missing')).toBe(true);
  });

  it('breaks the line rather than interpolating across a long absence', () => {
    const series = withGaps(buildSeries([point(0, 20), point(200, 30)], 'PM10'));
    const rows = toChartRows(series);

    // Whatever the fill budget does, there is at least one null between the two
    // real values — which is what stops the chart drawing straight through.
    const firstIndex = rows.findIndex((row) => row.measured !== null);
    const lastIndex =
      rows.length - 1 - [...rows].reverse().findIndex((row) => row.measured !== null);
    expect(rows.slice(firstIndex + 1, lastIndex).some((row) => row.measured === null)).toBe(true);
  });

  it('leaves a contiguous hourly series untouched', () => {
    const series = buildSeries([point(0, 20), point(1, 21), point(2, 22)], 'PM10');
    expect(withGaps(series)).toHaveLength(3);
  });
});

describe('summariseSeries', () => {
  it('computes min, max and mean from measured hours alone', () => {
    const series = buildSeries(
      [
        point(0, 10),
        point(1, 30),
        point(2, 900, { modelled: true }),
        point(3, 900, { forecast: true }),
        point(4, null),
      ],
      'PM10',
    );

    const stats = summariseSeries(series);

    expect(stats.min).toBe(10);
    expect(stats.max).toBe(30);
    expect(stats.mean).toBe(20);
    expect(stats.measuredCount).toBe(2);
    expect(stats.modelledCount).toBe(1);
    expect(stats.forecastCount).toBe(1);
    expect(stats.missingCount).toBe(1);
  });

  it('returns null, not zero, when nothing was measured', () => {
    const stats = summariseSeries(buildSeries([point(0, null), point(1, null)], 'PM10'));

    expect(stats.min).toBeNull();
    expect(stats.max).toBeNull();
    expect(stats.mean).toBeNull();
    expect(stats.measuredCount).toBe(0);
  });

  it('counts the span inclusively, so 24 hourly points read as 24 hours', () => {
    const readings = Array.from({ length: 24 }, (_, index) => point(index, 20));
    expect(summariseSeries(buildSeries(readings, 'PM10')).spanHours).toBe(24);
  });
});

describe('sliceSeries', () => {
  it('keeps forecast hours ahead of now whatever the window', () => {
    const now = hour(10);
    const series = buildSeries(
      [point(0, 20), point(9, 21), point(20, 22, { forecast: true })],
      'PM10',
    );

    const kept = sliceSeries(series, '24h', now).map((p) => p.measuredAt);
    expect(kept).toContain(hour(20));
  });
});

describe('toChartRows', () => {
  it('splits the kinds into separate series so styles cannot be confused', () => {
    const rows = toChartRows(buildSeries([point(0, 20), point(1, 22, { modelled: true })], 'PM10'));

    expect(rows[0].measured).toBe(20);
    expect(rows[0].modelled).toBe(20); // joined into the estimated run
    expect(rows[0].forecast).toBeNull();
    expect(rows[1].measured).toBeNull();
    expect(rows[1].modelled).toBe(22);
  });

  it('draws a join between two kinds in the less certain of the two styles', () => {
    const rows = toChartRows(buildSeries([point(0, 20), point(1, 22, { forecast: true })], 'PM10'));

    // The measured endpoint joins the forecast series, never the reverse: a
    // segment leaving for a forecast point must not be drawn as observed.
    expect(rows[0].forecast).toBe(20);
    expect(rows[1].measured).toBeNull();
  });

  it('leaves every series null for a missing hour, producing a gap', () => {
    const rows = toChartRows(buildSeries([point(0, 20), point(1, null), point(2, 24)], 'PM10'));

    expect(rows[1].measured).toBeNull();
    expect(rows[1].modelled).toBeNull();
    expect(rows[1].forecast).toBeNull();
  });
});
