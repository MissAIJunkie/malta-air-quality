import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { POLLUTANT_CODES } from '@/config/pollutants';
import { buildPollutantReading } from '@/lib/air-quality/calculate-index';
import type { PollutantCode } from '@/config/pollutants';
import type { PollutantReading, StationReading } from '@/lib/air-quality/types';

import {
  OVERALL_FILTER,
  availablePollutants,
  categoryForFilter,
  isPollutantFilterValue,
  pollutantReadingFor,
  subIndexForFilter,
} from '../filter-value';
import { PollutantFilter } from '../pollutant-filter';

const ALL = [...POLLUTANT_CODES];

function renderFilter(overrides: Partial<React.ComponentProps<typeof PollutantFilter>> = {}) {
  const onValueChange = vi.fn();
  render(
    <PollutantFilter
      value={OVERALL_FILTER}
      onValueChange={onValueChange}
      available={ALL}
      {...overrides}
    />,
  );
  return { onValueChange };
}

describe('PollutantFilter — the group', () => {
  it('is a labelled group of radios, not a bag of unlabelled buttons', () => {
    renderFilter();

    // A native radio group brings arrow-key navigation, a group semantic and a
    // disabled state that assistive technology already understands.
    expect(screen.getByRole('group', { name: 'Pollutant' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(POLLUTANT_CODES.length + 1);
  });

  it('offers an overall option alongside every pollutant', () => {
    renderFilter();

    expect(screen.getByRole('radio', { name: 'Overall band' })).toBeInTheDocument();
    for (const spoken of [
      'PM2.5, fine particulate matter',
      'PM10, coarse particulate matter',
      'Nitrogen dioxide',
      'Ozone',
      'Sulphur dioxide',
    ]) {
      expect(screen.getByRole('radio', { name: spoken })).toBeInTheDocument();
    }
  });

  it('reflects the current selection', () => {
    renderFilter({ value: 'NO2' });

    expect(screen.getByRole('radio', { name: 'Nitrogen dioxide' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Overall band' })).not.toBeChecked();
  });

  it('reports the chosen pollutant to its caller', async () => {
    const user = userEvent.setup();
    const { onValueChange } = renderFilter();

    await user.click(screen.getByRole('radio', { name: 'Ozone' }));
    expect(onValueChange).toHaveBeenCalledWith('O3');
  });

  it('is operable from the keyboard', async () => {
    const user = userEvent.setup();
    const { onValueChange } = renderFilter({ value: OVERALL_FILTER });

    await user.tab();
    expect(screen.getByRole('radio', { name: 'Overall band' })).toHaveFocus();

    // Arrow keys move within a radio group; this comes free with native radios
    // and would have to be rebuilt by hand for a custom widget.
    await user.keyboard('{ArrowRight}');
    expect(onValueChange).toHaveBeenCalledWith('PM2.5');
  });

  it('gives every option a 44px minimum target', () => {
    // WCAG 2.2 Target Size. jsdom does no layout, so the constraint is checked
    // where it is declared: `min-h-11` is 2.75rem, which is 44px.
    renderFilter();
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.closest('label')?.className).toContain('min-h-11');
    }
  });
});

describe('PollutantFilter — unsupported options are disabled, not hidden', () => {
  it('disables a pollutant that no station is reporting', () => {
    // Msida is the only station without ozone in the real network, but a whole
    // hour with no usable ozone anywhere is entirely possible.
    renderFilter({ available: ALL.filter((code) => code !== 'O3') });

    expect(screen.getByRole('radio', { name: 'Ozone' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Nitrogen dioxide' })).toBeEnabled();
  });

  it('keeps the disabled option visible, so its absence is explained', () => {
    // Removing it would imply the network does not measure ozone at all, which
    // is a different and untrue claim.
    renderFilter({ available: ALL.filter((code) => code !== 'O3') });

    const ozone = screen.getByRole('radio', { name: 'Ozone' });
    expect(ozone).toBeInTheDocument();
    expect(screen.getByText('O₃')).toBeInTheDocument();
  });

  it('points each disabled option at a written reason', () => {
    renderFilter({ available: ALL.filter((code) => code !== 'SO2') });

    const sulphur = screen.getByRole('radio', { name: 'Sulphur dioxide' });
    const describedBy = sulphur.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();

    // A disabled control cannot be focused, so the explanation has to be
    // readable in the page rather than only on the control.
    const note = document.getElementById(describedBy as string);
    expect(note?.textContent).toContain('Sulphur dioxide');
    expect(note?.textContent).toMatch(/No value for this hour/i);
  });

  it('does not describe an enabled option as unavailable', () => {
    renderFilter({ available: ALL.filter((code) => code !== 'SO2') });
    expect(screen.getByRole('radio', { name: 'Nitrogen dioxide' })).not.toHaveAttribute(
      'aria-describedby',
    );
  });

  it('ignores a click on a disabled option', async () => {
    const user = userEvent.setup();
    const { onValueChange } = renderFilter({ available: ALL.filter((c) => c !== 'O3') });

    await user.click(screen.getByRole('radio', { name: 'Ozone' }));
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('never disables the overall option', () => {
    // The overall band is derived from whatever did report, so it is always
    // meaningful — even when every individual pollutant is missing.
    renderFilter({ available: [] });

    expect(screen.getByRole('radio', { name: 'Overall band' })).toBeEnabled();
    for (const code of POLLUTANT_CODES) {
      expect(
        screen.getAllByRole('radio').filter((r) => (r as HTMLInputElement).value === code)[0],
      ).toBeDisabled();
    }
  });

  it('shows no unavailability note when everything is reporting', () => {
    renderFilter({ available: ALL });
    expect(screen.queryByText(/No value for this hour/i)).not.toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/*  The filter's value semantics                                              */
/* -------------------------------------------------------------------------- */

function station(
  stationId: string,
  entries: Array<[PollutantCode, number | null]>,
  overall: Partial<StationReading> = {},
): StationReading {
  const pollutants: Partial<Record<PollutantCode, PollutantReading>> = {};
  for (const [code, value] of entries) {
    const reading = buildPollutantReading(code, value);
    // A pollutant with no usable value is still PRESENT in the payload — that
    // is exactly the case `availablePollutants` has to see through.
    pollutants[code] = reading;
  }

  return {
    stationId,
    measuredAt: '2026-07-26T06:00:00.000Z',
    fetchedAt: '2026-07-26T07:00:00.000Z',
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
    ...overall,
  };
}

describe('availablePollutants', () => {
  it('offers only pollutants some station actually has a value for', () => {
    const readings = [
      station('MT00004', [
        ['PM10', 30],
        ['NO2', 25],
      ]),
      station('MT00011', [['PM2.5', 12]]),
    ];
    expect(availablePollutants(readings)).toEqual(['PM2.5', 'PM10', 'NO2']);
  });

  it('does not count a pollutant that is present everywhere with no value', () => {
    // There would be nothing to colour by, so the option is disabled and says so
    // rather than producing an all-grey map with no explanation.
    const readings = [
      station('MT00004', [
        ['O3', null],
        ['PM10', 20],
      ]),
    ];
    expect(availablePollutants(readings)).toEqual(['PM10']);
  });

  it('offers nothing when nothing is reporting', () => {
    expect(availablePollutants([])).toEqual([]);
    expect(availablePollutants([station('MT00004', [['PM10', null]])])).toEqual([]);
  });

  it('preserves the registry order rather than the order stations arrived in', () => {
    const readings = [
      station('MT00004', [
        ['SO2', 3],
        ['PM2.5', 9],
      ]),
    ];
    expect(availablePollutants(readings)).toEqual(['PM2.5', 'SO2']);
  });
});

describe('categoryForFilter and subIndexForFilter', () => {
  // PM10 at 30 µg/m³ is Fair; NO₂ at 40 is Moderate. Two different bands in one
  // station is the whole point of the filter.
  const reading = station(
    'MT00004',
    [
      ['PM10', 30],
      ['NO2', 40],
    ],
    {
      overallCategory: 'Moderate',
      overallSubIndex: 3.2,
    },
  );

  it('uses the station band under the overall filter', () => {
    expect(categoryForFilter(reading, OVERALL_FILTER)).toBe('Moderate');
    expect(subIndexForFilter(reading, OVERALL_FILTER)).toBe(3.2);
  });

  it("uses the pollutant's own band under a pollutant filter", () => {
    // Showing the overall colour while a filter is active would attribute one
    // pollutant's severity to another.
    expect(categoryForFilter(reading, 'PM10')).toBe('Fair');
    expect(categoryForFilter(reading, 'NO2')).toBe('Moderate');
  });

  it('returns null — never the overall band — for a pollutant the station lacks', () => {
    expect(categoryForFilter(reading, 'O3')).toBeNull();
    expect(subIndexForFilter(reading, 'O3')).toBeNull();
  });

  it('returns null for a missing station rather than inventing a band', () => {
    expect(categoryForFilter(null, 'PM10')).toBeNull();
    expect(categoryForFilter(undefined, OVERALL_FILTER)).toBeNull();
    expect(subIndexForFilter(null, 'PM10')).toBeNull();
  });

  it('treats a present-but-empty reading as unavailable', () => {
    const empty = station('MT00004', [['PM10', null]]);
    expect(pollutantReadingFor(empty, 'PM10')?.value).toBeNull();
    expect(categoryForFilter(empty, 'PM10')).toBeNull();
  });
});

describe('isPollutantFilterValue', () => {
  it('accepts the overall option and every pollutant code', () => {
    expect(isPollutantFilterValue(OVERALL_FILTER)).toBe(true);
    for (const code of POLLUTANT_CODES) expect(isPollutantFilterValue(code)).toBe(true);
  });

  it.each([null, undefined, '', 'pm25', 'PM2', 42, {}])(
    'rejects %o, so a hostile query string cannot select a nonexistent series',
    (value) => {
      expect(isPollutantFilterValue(value)).toBe(false);
    },
  );
});
