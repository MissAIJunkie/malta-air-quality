import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { buildPollutantReading } from '@/lib/air-quality/calculate-index';
import type { HistoricalReading, PollutantReading } from '@/lib/air-quality/types';

import { buildSeries, withGaps } from '../series';
import { TrendChart } from '../trend-chart';

/**
 * jsdom has no layout engine and no `ResizeObserver`, so Recharts falls back to
 * `ResponsiveContainer`'s `initialDimension` — which is exactly why that prop is
 * set on the chart. Without it these tests could not run, and neither could the
 * chart render on any client whose first measurement is delayed.
 */

function hour(index: number): string {
  return new Date(Date.UTC(2026, 6, 20, index)).toISOString();
}

function reading(
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

function renderChart(readings: HistoricalReading[]) {
  const points = withGaps(buildSeries(readings, 'PM10'));
  return render(
    <TrendChart
      points={points}
      pollutant="PM10"
      stationName="Msida"
      rangeLabel="the last 24 hours"
      observedBoundary={hour(2)}
      thresholds={[{ id: 'test', label: 'Test threshold, 60 µg/m³', value: 60, conclusive: true }]}
    />,
  );
}

const SERIES: HistoricalReading[] = [
  reading(0, 20),
  reading(1, 30),
  reading(2, 40),
  // Hour 3 is absent from the feed entirely — `withGaps` supplies the hole.
  reading(4, 50, { modelled: true }),
  reading(5, 55, { forecast: true }),
];

describe('TrendChart', () => {
  it('draws the chart', () => {
    const { container } = renderChart(SERIES);
    expect(container.querySelector('.recharts-surface')).toBeTruthy();
    expect(container.querySelectorAll('.recharts-curve').length).toBeGreaterThan(0);
  });

  it('draws the six index bands as background regions', () => {
    const { container } = renderChart(SERIES);
    expect(container.querySelectorAll('.recharts-reference-area').length).toBeGreaterThan(0);
  });

  it('breaks the line at a missing hour instead of drawing through it', () => {
    // Measured either side of an hour the feed never published.
    const { container } = renderChart([reading(0, 20), reading(2, 40)]);

    const paths = [...container.querySelectorAll('.recharts-line-curve')]
      .map((node) => node.getAttribute('d') ?? '')
      .filter((d) => d.length > 0);

    // More than one `M` means more than one sub-path: the line genuinely stops
    // and restarts rather than spanning the gap.
    expect(paths.some((d) => (d.match(/M/g) ?? []).length > 1)).toBe(true);
    // And it is not simply drawing the hole at zero.
    expect(paths.join(' ')).not.toMatch(/L\s*[\d.]+,\s*246/);
  });

  it('gives the estimated series a dash pattern, so the difference survives greyscale', () => {
    const { container } = renderChart(SERIES);
    const dashed = [...container.querySelectorAll('.recharts-line-curve')].filter((node) =>
      node.getAttribute('stroke-dasharray'),
    );
    expect(dashed.length).toBeGreaterThan(0);
  });

  it('exposes the chart as an image with the written summary as its name', () => {
    renderChart(SERIES);
    const figure = screen.getByRole('img');
    expect(figure.getAttribute('aria-label')).toContain('PM10, coarse particulate matter');
    expect(figure.getAttribute('aria-label')).toContain('µg/m³');
  });

  it('has no focusable descendant inside the image role', () => {
    const { container } = renderChart(SERIES);
    const figure = container.querySelector('[role="img"]');
    expect(figure?.querySelector('a, button, [tabindex]:not([tabindex="-1"])')).toBeNull();
  });

  it('labels the unit on both axes', () => {
    renderChart(SERIES);
    expect(screen.getByText('Concentration (µg/m³)')).toBeInTheDocument();
    // Also the table's time column header, hence `getAllByText`.
    expect(screen.getAllByText('Time (Malta)').length).toBeGreaterThan(0);
  });

  it('renders a missing hour as unavailable in the table, never as zero', () => {
    renderChart(SERIES);

    const table = screen.getByRole('table');
    const missingRow = [...table.querySelectorAll('tbody tr')].find((row) =>
      row.textContent?.includes('No value for this hour'),
    );

    expect(missingRow).toBeDefined();
    expect(missingRow?.textContent).toContain('Not available');
    expect(missingRow?.textContent).not.toMatch(/\b0 µg\/m³/);
  });

  it('names how every value was obtained in the accessible table', () => {
    renderChart(SERIES);
    const table = screen.getByRole('table');

    expect(table.textContent).toContain('Measured');
    expect(table.textContent).toContain('Estimated');
    expect(table.textContent).toContain('Forecast');
  });

  it('does not flatten the chart when a reading reaches the worst band', () => {
    // PM10 band 6 runs 271–1200 µg/m³, but 1200 is the upstream's saturation
    // point, not a scale. Plotting 280 against it would squash the series into
    // the bottom fifth of the chart at the exact hour its shape matters most.
    const { container } = renderChart([reading(0, 275), reading(1, 280)]);

    const ticks = [
      ...container.querySelectorAll(
        '.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value',
      ),
    ]
      .map((node) => Number((node.textContent ?? '').replace(/[^\d.]/g, '')))
      .filter((n) => Number.isFinite(n));

    const top = Math.max(...ticks);
    expect(top).toBeGreaterThanOrEqual(280);
    expect(top).toBeLessThan(280 * 3);
  });

  it('draws a threshold one hour cannot settle more faintly than one it can', () => {
    const points = withGaps(buildSeries([reading(0, 100), reading(1, 150)], 'PM10'));
    const { container } = render(
      <TrendChart
        points={points}
        pollutant="PM10"
        stationName="Msida"
        rangeLabel="the last 24 hours"
        thresholds={[
          { id: 'conclusive', label: 'Information threshold', value: 120, conclusive: true },
          { id: 'inconclusive', label: '18 exceedances permitted', value: 140, conclusive: false },
        ]}
      />,
    );

    const strokes = [...container.querySelectorAll('.recharts-reference-line line')].map((node) =>
      node.getAttribute('stroke'),
    );

    expect(strokes).toContain('var(--danger)');
    expect(strokes).toContain('var(--border-strong)');
  });

  it('says so plainly when there is nothing to plot', () => {
    render(
      <TrendChart
        points={[]}
        pollutant="PM10"
        stationName="Msida"
        rangeLabel="the last 24 hours"
      />,
    );

    expect(screen.getByRole('img').getAttribute('aria-label')).toContain(
      'no hourly values were published',
    );
    expect(screen.queryByRole('table')).toBeNull();
  });
});
