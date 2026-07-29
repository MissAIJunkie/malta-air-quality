import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MaltaSummary } from '@/components/air-quality/malta-summary';
import { StationCard } from '@/components/stations/station-card';
import { StationSheet } from '@/components/stations/station-sheet';
import { STATIONS } from '@/config/stations';
import { buildPollutantReading } from '@/lib/air-quality/calculate-index';
import type { MaltaSummary as MaltaSummaryResult, StationReading } from '@/lib/air-quality/types';

import { OVERALL_FILTER, availablePollutants, categoryForFilter } from '../filter-value';
import { PollutantExplainer } from '../pollutant-explainer';
import { PollutantFilter } from '../pollutant-filter';

const MSIDA = STATIONS.find((s) => s.slug === 'msida')!;

const READING: StationReading = {
  stationId: MSIDA.id,
  measuredAt: '2026-07-26T09:00:00.000Z',
  fetchedAt: '2026-07-26T10:00:00.000Z',
  timezone: 'Europe/Malta',
  overallCategory: 'Moderate',
  overallSubIndex: 3.2,
  dominantPollutant: 'NO2',
  pollutants: {
    'PM2.5': buildPollutantReading('PM2.5', 12),
    NO2: buildPollutantReading('NO2', 30),
    SO2: buildPollutantReading('SO2', null),
  },
  provisional: true,
  freshness: 'fresh',
  ageHours: 1,
  partial: true,
  source: 'FIXTURE',
};

describe('filter-value', () => {
  it('offers only pollutants that actually carry a value', () => {
    // SO2 is present in the payload but empty, so it cannot be coloured by.
    expect(availablePollutants([READING])).toEqual(['PM2.5', 'NO2']);
  });

  it('colours by the chosen pollutant, never by the station overall', () => {
    expect(categoryForFilter(READING, OVERALL_FILTER)).toBe('Moderate');
    expect(categoryForFilter(READING, 'PM2.5')).toBe('Fair');
    // Present but empty: no category, and certainly not the overall one.
    expect(categoryForFilter(READING, 'SO2')).toBeNull();
    expect(categoryForFilter(null, 'NO2')).toBeNull();
  });
});

describe('PollutantFilter', () => {
  function Harness({ onChange }: { onChange?: (v: string) => void }) {
    const [value, setValue] = useState<'overall' | 'PM2.5' | 'NO2' | 'PM10' | 'O3' | 'SO2'>(
      OVERALL_FILTER,
    );
    return (
      <PollutantFilter
        value={value}
        onValueChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
        available={['PM2.5', 'NO2']}
      />
    );
  }

  it('is a labelled radio group with an option per pollutant plus overall', () => {
    render(<Harness />);

    const group = screen.getByRole('group', { name: 'Pollutant' });
    expect(within(group).getAllByRole('radio')).toHaveLength(6);
    expect(screen.getByRole('radio', { name: 'Overall band' })).toBeChecked();
  });

  it('disables what the dataset cannot colour by, and explains why', () => {
    render(<Harness />);

    expect(screen.getByRole('radio', { name: 'Nitrogen dioxide' })).toBeEnabled();

    const ozone = screen.getByRole('radio', { name: 'Ozone' });
    expect(ozone).toBeDisabled();

    // The reason is in the page and referenced by the disabled control, since a
    // disabled control cannot be focused to hear a tooltip.
    const describedBy = ozone.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toMatch(/No value for this hour/);
  });

  it('reports the chosen pollutant', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: 'PM2.5, fine particulate matter' }));

    expect(onChange).toHaveBeenCalledWith('PM2.5');
    expect(screen.getByRole('radio', { name: 'PM2.5, fine particulate matter' })).toBeChecked();
  });
});

describe('PollutantExplainer', () => {
  it('covers what it is, where it comes from, health effects, period and unit', () => {
    render(<PollutantExplainer pollutant="O3" headingLevel="h2" />);

    expect(screen.getByRole('heading', { level: 2, name: 'Ozone' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'What it is' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: 'Where it comes from' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Health effects' })).toBeInTheDocument();
    expect(screen.getByText('Hourly')).toBeInTheDocument();
    expect(screen.getByText('µg/m³')).toBeInTheDocument();
    expect(screen.getByText(/It forms in the air when sunlight reacts/)).toBeInTheDocument();
  });
});

describe('MaltaSummary', () => {
  const summary: MaltaSummaryResult = {
    category: 'Moderate',
    dominantPollutant: 'NO2',
    aggregation: 'worst-station',
    drivingStationId: MSIDA.id,
    reportingStations: 3,
    totalStations: 5,
    // Deliberately plural: `header.staleStations` has no singular form yet, and
    // asserting on "1 station readings" would fail the moment that is fixed.
    staleStations: 2,
    measuredAt: '2026-07-26T09:00:00.000Z',
    freshness: 'fresh',
  };

  it('states the aggregation method rather than leaving it to be guessed', () => {
    render(<MaltaSummary summary={summary} ageHours={1} />);

    expect(
      screen.getByText('Malta-wide status follows the worst reporting station.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/We do not average across stations/)).toBeInTheDocument();
  });

  it('shows how many stations that summary actually rests on', () => {
    render(<MaltaSummary summary={summary} ageHours={1} />);

    expect(screen.getByText('3 of 5 stations reporting')).toBeInTheDocument();
    expect(screen.getByText('Highest reading at Msida')).toBeInTheDocument();
    expect(screen.getByText(/2 station readings are older than expected/)).toBeInTheDocument();
  });

  it('does not present an absence of readings as an all-clear', () => {
    render(
      <MaltaSummary
        summary={{
          ...summary,
          category: null,
          dominantPollutant: null,
          drivingStationId: null,
          reportingStations: 0,
          measuredAt: null,
          freshness: 'unavailable',
        }}
      />,
    );

    expect(screen.getByText('No station is reporting right now')).toBeInTheDocument();
    expect(screen.getByText(/Nothing here should be read as an all-clear/)).toBeInTheDocument();
    expect(screen.queryByText(/Air quality across Malta and Gozo is Good/)).not.toBeInTheDocument();
  });
});

describe('StationCard', () => {
  it('links to the station and shows its band', () => {
    render(<StationCard station={MSIDA} reading={READING} />);

    // Singular: this is the address the route actually serves. The assertion
    // read `/stations/msida` and so held the 404 in place rather than catching it.
    expect(screen.getByRole('link', { name: 'Msida' })).toHaveAttribute('href', '/station/msida');
    expect(screen.getByText('Moderate')).toBeInTheDocument();
  });

  it('says there is no reading rather than showing an empty band', () => {
    render(<StationCard station={MSIDA} reading={null} />);

    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(screen.getByText('No current reading')).toBeInTheDocument();
  });

  it('shows the chosen pollutant instead of the overall band when filtered', () => {
    render(<StationCard station={MSIDA} reading={READING} pollutant="SO2" />);

    // SO2 reported nothing usable: unavailable, not the station's Moderate.
    expect(screen.getByText('Not available')).toBeInTheDocument();
    expect(screen.queryByText('Moderate')).not.toBeInTheDocument();
  });
});

describe('StationSheet', () => {
  it('names itself, renders the panel, and does not double up the heading', async () => {
    const user = userEvent.setup();

    render(
      <StationSheet
        station={MSIDA}
        reading={READING}
        expectedPollutants={MSIDA.expectedPollutants}
        trigger={<button type="button">Open Msida</button>}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Open Msida' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Msida' })).toBeInTheDocument();
    // The panel's own header is suppressed, so the name appears once.
    expect(within(dialog).getAllByRole('heading', { name: 'Msida' })).toHaveLength(1);
    expect(within(dialog).getByText('Pollutants measured')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('does not fire an alert that would cut off the dialog announcement', async () => {
    const user = userEvent.setup();

    render(
      <StationSheet
        station={MSIDA}
        reading={{ ...READING, overallCategory: 'Very poor', overallSubIndex: 5.2 }}
        trigger={<button type="button">Open</button>}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Open' }));
    await screen.findByRole('dialog');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // The warning itself is still there, just not announced over the dialog.
    expect(screen.getByText(/Msida: Very poor/)).toBeInTheDocument();
  });
});
