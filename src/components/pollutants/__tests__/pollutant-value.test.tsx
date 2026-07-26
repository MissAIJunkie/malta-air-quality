import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { buildPollutantReading } from '@/lib/air-quality/calculate-index';
import type { PollutantReading } from '@/lib/air-quality/types';

import { ConcentrationUnit, PollutantName, PollutantValue } from '../pollutant-value';

/** Digits that are not part of a pollutant's own name ("PM2.5", "NO₂"). */
function measurementDigits(text: string): string[] {
  return text.replace(/PM\s*2\.5|PM\s*10|NO₂|O₃|SO₂|µg\/m³/g, '').match(/\d+(\.\d+)?/g) ?? [];
}

describe('PollutantValue — a value that is present', () => {
  it('shows the number, its unit and its band', () => {
    render(<PollutantValue pollutant="PM10" reading={buildPollutantReading('PM10', 36.02)} />);

    expect(screen.getByText('36')).toBeInTheDocument();
    expect(screen.getByText('µg/m³')).toBeInTheDocument();
    expect(screen.getByText('Fair')).toBeInTheDocument();
  });

  it('renders a genuine zero as a measurement, because 0 µg/m³ is one', () => {
    // The mirror image of the rule below. A real reading of zero must NOT be
    // hidden as unavailable — it is the cleanest possible air, and saying
    // "Not available" would understate what the instrument reported.
    const { container } = render(
      <PollutantValue pollutant="SO2" reading={buildPollutantReading('SO2', 0)} />,
    );

    // Rendered to one decimal place, as small concentrations always are.
    expect(screen.getByText('0.0')).toBeInTheDocument();
    expect(screen.getByText('Good')).toBeInTheDocument();
    expect(container.querySelector('[data-available]')).toHaveAttribute('data-available', 'true');
    expect(screen.queryByText(/Not available/i)).not.toBeInTheDocument();
  });

  it('marks a modelled value as estimated rather than as a forecast', () => {
    // The feed gap-fills PAST hours too, so "Estimated" is the honest word and
    // "Forecast" would be a stronger claim than the flag supports.
    render(
      <PollutantValue
        pollutant="O3"
        reading={buildPollutantReading('O3', 95, { modelled: true })}
        variant="detail"
      />,
    );

    expect(screen.getByText('Estimated')).toBeInTheDocument();
    expect(screen.queryByText('Forecast')).not.toBeInTheDocument();
  });
});

describe('PollutantValue — a missing value is never zero', () => {
  it('renders a reading with a null value as "Not available", never as 0', () => {
    const reading = buildPollutantReading('NO2', null);
    expect(reading.value).toBeNull();

    const { container } = render(<PollutantValue pollutant="NO2" reading={reading} />);

    expect(screen.getByText('Not available')).toBeInTheDocument();
    // The decisive assertion. A 0 here would be a claim that the air was clean
    // during an hour in which nothing was measured at all.
    expect(measurementDigits(container.textContent ?? '')).toEqual([]);
    expect(container.querySelector('[data-available]')).toHaveAttribute('data-available', 'false');
  });

  it('distinguishes "the instrument reported nothing" from "the feed omitted it"', () => {
    // Two different facts about the world. Merging them would tell the reader
    // less than the data supports.
    const withReading = render(
      <PollutantValue pollutant="SO2" reading={buildPollutantReading('SO2', null)} />,
    );
    expect(screen.getByText('Not available')).toBeInTheDocument();
    withReading.unmount();

    render(<PollutantValue pollutant="SO2" reading={null} />);
    expect(screen.getByText('No value for this hour')).toBeInTheDocument();
  });

  it('says in words that an absence is not a reading of zero', () => {
    render(<PollutantValue pollutant="O3" reading={null} variant="detail" />);

    // This sentence is the entire reason the empty state is rendered instead of
    // the row being dropped.
    expect(screen.getByText(/This is not the same as a reading of zero/i)).toBeInTheDocument();
  });

  it('shows "No data" rather than a default band when there is no category', () => {
    render(<PollutantValue pollutant="PM2.5" reading={null} />);

    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(screen.queryByText('Good')).not.toBeInTheDocument();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    'treats the unusable value %s as unavailable rather than formatting it',
    (value) => {
      const reading: PollutantReading = {
        ...buildPollutantReading('PM10', 20),
        value: value as number,
      };
      const { container } = render(<PollutantValue pollutant="PM10" reading={reading} />);

      expect(screen.getByText('Not available')).toBeInTheDocument();
      expect(container.textContent).not.toMatch(/NaN|Infinity/);
    },
  );
});

describe('PollutantValue — spoken output', () => {
  it('gives a screen reader words instead of a formula', () => {
    render(<PollutantValue pollutant="NO2" reading={buildPollutantReading('NO2', 45)} />);

    // "NO₂" is voiced letter by letter and "µg/m³" as a run of symbols, so both
    // carry a written alternative alongside the visual form.
    const name = screen.getByText('Nitrogen dioxide');
    expect(name).toBeInTheDocument();
    expect(screen.getByText('NO₂')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(/micrograms per cubic metre/i)).toBeInTheDocument();
  });

  it('prefixes the band with the pollutant it belongs to', () => {
    const { container } = render(
      <PollutantValue pollutant="PM2.5" reading={buildPollutantReading('PM2.5', 60)} />,
    );

    const badge = container.querySelector('[data-slot="category-badge"]');
    expect(badge).not.toBeNull();
    // Without the prefix a screen reader hears five bare band names in a row
    // with nothing to attach them to.
    expect(within(badge as HTMLElement).getByText(/PM2\.5, fine particulate matter/)).toBeVisible();
  });
});

describe('PollutantName and ConcentrationUnit', () => {
  it('show the symbol and speak the words', () => {
    render(<PollutantName pollutant="O3" />);
    expect(screen.getByText('O₃')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Ozone')).toBeInTheDocument();
  });

  it('spell out the microgram unit for assistive technology', () => {
    render(<ConcentrationUnit unit="µg/m³" />);
    expect(screen.getByText('µg/m³')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(/micrograms per cubic metre/i)).toBeInTheDocument();
  });

  it('passes an unrecognised unit through rather than mislabelling it', () => {
    render(<ConcentrationUnit unit="mg/m³" />);

    // Both the visible symbol and the spoken form show the unit unchanged. The
    // failure mode being guarded against is announcing milligrams as
    // micrograms — a thousandfold error in a health-relevant number.
    expect(screen.getAllByText('mg/m³')).toHaveLength(2);
    expect(screen.queryByText(/micrograms/i)).not.toBeInTheDocument();
  });
});
