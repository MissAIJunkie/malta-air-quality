import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ThresholdComparison } from '@/components/air-quality/threshold-comparison';
import { DangerBanner } from '@/components/health-guidance/danger-banner';
import { HealthGuidance } from '@/components/health-guidance/health-guidance';
import { PollutantValue } from '@/components/pollutants/pollutant-value';
import { STATIONS } from '@/config/stations';
import { AIR_QUALITY_CATEGORIES, isElevatedCategory } from '@/config/thresholds';
import { buildPollutantReading } from '@/lib/air-quality/calculate-index';
import type { PollutantReading, StationReading } from '@/lib/air-quality/types';

import { StationList } from '../station-list';
import { StationPanel } from '../station-panel';
import type { StationEntry } from '../types';

const MSIDA = STATIONS.find((s) => s.slug === 'msida')!;
const GHARB = STATIONS.find((s) => s.slug === 'gharb')!;

function reading(overrides: Partial<StationReading> = {}): StationReading {
  const pollutants: Partial<Record<'PM2.5' | 'NO2', PollutantReading>> = {
    'PM2.5': buildPollutantReading('PM2.5', 12),
    NO2: buildPollutantReading('NO2', 30),
  };

  return {
    stationId: MSIDA.id,
    measuredAt: '2026-07-26T09:00:00.000Z',
    fetchedAt: '2026-07-26T10:00:00.000Z',
    timezone: 'Europe/Malta',
    overallCategory: 'Moderate',
    overallSubIndex: 3.2,
    dominantPollutant: 'NO2',
    pollutants,
    provisional: true,
    freshness: 'fresh',
    ageHours: 1,
    partial: false,
    source: 'FIXTURE',
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/*  A missing value is never a zero                                           */
/* -------------------------------------------------------------------------- */

describe('PollutantValue', () => {
  it('renders a null concentration as unavailable, never as 0', () => {
    const { container } = render(
      <PollutantValue pollutant="PM10" reading={buildPollutantReading('PM10', null)} />,
    );

    expect(screen.getByText('Not available')).toBeInTheDocument();
    // The strongest form of the rule: the digit must not appear at all.
    expect(container.textContent).not.toMatch(/\b0\b/);
  });

  it('distinguishes an absent reading from a reading with no value', () => {
    render(<PollutantValue pollutant="O3" reading={null} variant="detail" />);

    expect(screen.getByText('No value for this hour')).toBeInTheDocument();
    expect(screen.getByText(/not the same as a reading of zero/i)).toBeInTheDocument();
  });

  it('labels a gap-filled value "Estimated" and never "Forecast"', () => {
    render(
      <PollutantValue
        pollutant="PM2.5"
        reading={buildPollutantReading('PM2.5', 20, { modelled: true })}
        variant="detail"
      />,
    );

    expect(screen.getByText('Estimated')).toBeInTheDocument();
    expect(screen.queryByText('Forecast')).not.toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/*  Warnings                                                                  */
/* -------------------------------------------------------------------------- */

describe('DangerBanner', () => {
  it('renders for exactly the elevated bands and nothing else', () => {
    for (const category of AIR_QUALITY_CATEGORIES) {
      const { container, unmount } = render(
        <DangerBanner
          category={category}
          pollutant="PM10"
          measuredAt="2026-07-26T09:00:00.000Z"
          provisional
          modelled={false}
        />,
      );

      const banner = container.querySelector('[data-slot="danger-banner"]');
      expect(Boolean(banner)).toBe(isElevatedCategory(category));
      unmount();
    }
  });

  it('renders nothing when there is no category', () => {
    const { container } = render(
      <DangerBanner
        category={null}
        pollutant={null}
        measuredAt={null}
        provisional={false}
        modelled={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('states the pollutant, who is affected, the time, and that it is provisional', () => {
    render(
      <DangerBanner
        category="Very poor"
        pollutant="PM10"
        measuredAt="2026-07-26T09:00:00.000Z"
        provisional
        modelled={false}
        stationName="Msida"
      />,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Msida/)).toBeInTheDocument();
    expect(screen.getByText('Leading pollutant')).toBeInTheDocument();
    expect(screen.getByText('Provisional')).toBeInTheDocument();
    expect(screen.getByText('Measured')).toBeInTheDocument();
    expect(screen.getByText(/26 Jul/)).toBeInTheDocument();
    // Sensitive groups are named, not merely alluded to.
    expect(screen.getByText(/People with asthma/)).toBeInTheDocument();
    expect(
      screen.getByText(/does not replace medical advice or official emergency guidance/),
    ).toBeInTheDocument();
  });

  it('says "Estimated" for a gap-filled value and "Forecast" only when told', () => {
    const { rerender } = render(
      <DangerBanner
        category="Poor"
        pollutant="O3"
        measuredAt="2026-07-26T09:00:00.000Z"
        provisional={false}
        modelled
      />,
    );

    expect(screen.getByText('Estimated')).toBeInTheDocument();
    expect(screen.queryByText('Forecast')).not.toBeInTheDocument();

    rerender(
      <DangerBanner
        category="Poor"
        pollutant="O3"
        measuredAt="2026-07-26T09:00:00.000Z"
        provisional={false}
        modelled
        forecast
      />,
    );

    expect(screen.getByText('Forecast')).toBeInTheDocument();
  });

  it('can be silenced where a dialog is already announcing itself', () => {
    render(
      <DangerBanner
        category="Poor"
        pollutant="O3"
        measuredAt="2026-07-26T09:00:00.000Z"
        provisional={false}
        modelled={false}
        announce={false}
      />,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // Silenced, not suppressed: the warning is still fully rendered.
    expect(screen.getByText('Air quality across Malta and Gozo is Poor')).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/*  Legal limits                                                              */
/* -------------------------------------------------------------------------- */

describe('ThresholdComparison', () => {
  it('never calls a long-averaging comparison an exceedance', () => {
    // 60 µg/m³ of PM10 is above both the annual (40) and 24-hour (50) limits,
    // neither of which a single hour can settle.
    const { container } = render(<ThresholdComparison pollutant="PM10" value={60} />);

    expect(container.textContent).not.toMatch(/exceedance|breached the|in breach|illegal/i);
    expect(
      screen.getAllByText(/a single hourly reading cannot show whether it has been breached/i)
        .length,
    ).toBeGreaterThan(0);
  });

  it('pairs every non-conclusive comparison with its caveat in the same item', () => {
    const { container } = render(<ThresholdComparison pollutant="PM10" value={60} />);

    for (const item of container.querySelectorAll('li[data-conclusive="false"]')) {
      expect(item.textContent).toMatch(/cannot show whether it has been breached/i);
    }
  });

  it('states the one-hour ozone thresholds plainly, because those are conclusive', () => {
    render(<ThresholdComparison pollutant="O3" value={250} onlyAbove />);

    // 250 µg/m³ is above both the information threshold (180) and the alert
    // threshold (240), and both are genuine single-hour triggers.
    expect(
      screen.getAllByText(/one-hour threshold intended for immediate public information/i),
    ).toHaveLength(2);
  });

  it('renders nothing without a value', () => {
    const { container } = render(<ThresholdComparison pollutant="SO2" value={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

/* -------------------------------------------------------------------------- */
/*  Health guidance                                                           */
/* -------------------------------------------------------------------------- */

describe('HealthGuidance', () => {
  it('always carries the medical disclaimer, for every band and for none', () => {
    for (const category of [...AIR_QUALITY_CATEGORIES, null]) {
      const { unmount } = render(<HealthGuidance category={category} />);
      expect(
        screen.getByText(
          'maqua.app provides general environmental information and does not replace medical advice or official emergency guidance.',
        ),
      ).toBeInTheDocument();
      unmount();
    }
  });

  it('names every sensitive group the brief requires', () => {
    render(<HealthGuidance category="Poor" />);

    for (const group of [
      'People with asthma',
      'People with heart conditions',
      'People with lung conditions',
      'Older adults',
      'Children',
      'People who are pregnant',
      'People exercising hard outdoors',
    ]) {
      expect(screen.getByText(group)).toBeInTheDocument();
    }
  });

  it('offers no advice when there is no reading, rather than implying it is fine', () => {
    render(<HealthGuidance category={null} />);
    expect(
      screen.getByText('Without a reading we cannot offer advice for right now.'),
    ).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/*  Station panel                                                             */
/* -------------------------------------------------------------------------- */

describe('StationPanel', () => {
  it('shows an expected pollutant that did not report, instead of hiding the gap', () => {
    render(
      <StationPanel
        station={MSIDA}
        reading={reading()}
        expectedPollutants={MSIDA.expectedPollutants}
      />,
    );

    // Msida expects SO2 but the fixture reading carries only PM2.5 and NO2.
    expect(screen.getByText('Sulphur dioxide')).toBeInTheDocument();
    expect(screen.getAllByText('No value for this hour').length).toBeGreaterThan(0);
  });

  it('renders a pollutant present in the payload but absent from the expected list', () => {
    render(
      <StationPanel
        station={MSIDA}
        reading={reading({ pollutants: { O3: buildPollutantReading('O3', 80) } })}
        // Msida is not expected to report ozone at all.
        expectedPollutants={MSIDA.expectedPollutants}
      />,
    );

    expect(screen.getByText('Ozone')).toBeInTheDocument();
  });

  it('says plainly when there is no reading at all', () => {
    render(<StationPanel station={GHARB} reading={null} />);

    expect(screen.getByText('No current reading')).toBeInTheDocument();
    expect(screen.getByText(/is not an all-clear/i)).toBeInTheDocument();
  });

  it('reports measured-at, retrieved-at and age together', () => {
    const { container } = render(<StationPanel station={MSIDA} reading={reading()} />);
    const freshness = container.querySelector('[data-slot="freshness-indicator"]');

    expect(freshness?.textContent).toMatch(/Measured at/);
    expect(freshness?.textContent).toMatch(/Retrieved at/);
    expect(freshness?.textContent).toMatch(/1 hour old/);
  });
});

/* -------------------------------------------------------------------------- */
/*  Station list                                                              */
/* -------------------------------------------------------------------------- */

describe('StationList', () => {
  const entries: StationEntry[] = [
    { station: MSIDA, reading: reading({ overallCategory: 'Poor', overallSubIndex: 4.1 }) },
    { station: GHARB, reading: null },
  ];

  it('is a real table carrying every fact the map carries', () => {
    render(<StationList entries={entries} />);

    const table = screen.getByRole('table');
    for (const header of [
      'Stations',
      'Island',
      'Overall band',
      'Leading pollutant',
      'Measured at',
      'Age of reading',
    ]) {
      expect(within(table).getByRole('columnheader', { name: header })).toBeInTheDocument();
    }

    expect(within(table).getByRole('link', { name: 'Msida' })).toHaveAttribute(
      'href',
      '/stations/msida',
    );
  });

  it('sorts from the keyboard and reports the new order through aria-sort', async () => {
    const user = userEvent.setup();
    render(<StationList entries={entries} />);

    const header = screen.getByRole('columnheader', { name: 'Stations' });
    expect(header).toHaveAttribute('aria-sort', 'ascending');

    // Default order is by name: Għarb before Msida.
    const firstRow = () => screen.getAllByRole('row')[1];
    expect(within(firstRow()).getByRole('link').textContent).toBe('Għarb');

    await user.click(within(header).getByRole('button'));

    expect(header).toHaveAttribute('aria-sort', 'descending');
    expect(within(firstRow()).getByRole('link').textContent).toBe('Msida');
  });

  it('keeps a station with no category off the scale rather than sorting it as Good', async () => {
    const user = userEvent.setup();
    render(<StationList entries={entries} />);

    const header = screen.getByRole('columnheader', { name: 'Overall band' });
    await user.click(within(header).getByRole('button'));

    // Ascending by band: Msida has one, Għarb has none, so Għarb goes last.
    expect(within(screen.getAllByRole('row')[1]).getByRole('link').textContent).toBe('Msida');

    await user.click(within(header).getByRole('button'));

    // Descending: the absent band still sorts last, not first.
    expect(within(screen.getAllByRole('row')[1]).getByRole('link').textContent).toBe('Msida');
  });

  it('recolours by the selected pollutant and drops the leading-pollutant column', () => {
    render(<StationList entries={entries} pollutant="NO2" />);

    const table = screen.getByRole('table');
    expect(
      within(table).queryByRole('columnheader', { name: 'Leading pollutant' }),
    ).not.toBeInTheDocument();
    expect(
      within(table).getByRole('columnheader', { name: 'Nitrogen dioxide' }),
    ).toBeInTheDocument();
  });
});
