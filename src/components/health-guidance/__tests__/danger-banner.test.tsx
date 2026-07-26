import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AIR_QUALITY_CATEGORIES, isElevatedCategory } from '@/config/thresholds';

import { DangerBanner } from '../danger-banner';

const BASE = {
  measuredAt: '2026-07-26T06:00:00Z',
  provisional: true,
  modelled: false,
} as const;

describe('DangerBanner — when it appears', () => {
  it.each(AIR_QUALITY_CATEGORIES.filter((c) => isElevatedCategory(c)))(
    'warns for the elevated band %s',
    (category) => {
      const { container } = render(<DangerBanner {...BASE} category={category} pollutant="PM10" />);

      expect(container.querySelector('[data-slot="danger-banner"]')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getAllByText(category).length).toBeGreaterThan(0);
    },
  );

  it.each(AIR_QUALITY_CATEGORIES.filter((c) => !isElevatedCategory(c)))(
    'stays silent for the ordinary band %s',
    (category) => {
      const { container } = render(<DangerBanner {...BASE} category={category} pollutant="PM10" />);
      // Crying wolf at Moderate would train people to ignore the banner at Poor.
      expect(container.querySelector('[data-slot="danger-banner"]')).toBeNull();
    },
  );

  it.each([null, undefined])('renders nothing for a %s category', (category) => {
    const { container } = render(<DangerBanner {...BASE} category={category} pollutant="PM10" />);
    // No reading is not an emergency — and it is not an all-clear either. It is
    // handled by the "no data" states, not by a red banner.
    expect(container.innerHTML).toBe('');
  });

  it('carries the band id and its texture, so the alarm is not colour alone', () => {
    const { container } = render(<DangerBanner {...BASE} category="Very poor" pollutant="O3" />);
    const banner = container.querySelector('[data-slot="danger-banner"]');

    expect(banner).toHaveAttribute('data-aq-category', 'Very poor');
    expect(banner).toHaveAttribute('data-aq-band', '5');
    expect(banner?.className).toMatch(/aq-pattern-/);
    // Icon, texture, band id and written label all say the same thing.
    expect(banner?.querySelector('svg')).toBeTruthy();
  });

  it('can be told not to announce itself, for a second copy on the same page', () => {
    render(<DangerBanner {...BASE} category="Poor" pollutant="NO2" announce={false} />);
    // Two live regions describing one event would be announced twice.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('DangerBanner — naming the responsible pollutant', () => {
  it('names the pollutant that put the location in this band', () => {
    render(<DangerBanner {...BASE} category="Poor" pollutant="PM2.5" />);

    expect(screen.getByText('Leading pollutant')).toBeInTheDocument();
    expect(screen.getByText('PM2.5')).toBeInTheDocument();
    // "PM2.5" reads poorly aloud, so the spoken form is supplied and the band is
    // attached to it explicitly rather than left floating.
    expect(screen.getByText('PM2.5, fine particulate matter')).toBeInTheDocument();
    expect(screen.getByText(/PM2\.5, fine particulate matter is Poor/)).toBeInTheDocument();
  });

  it.each([
    ['NO2', 'NO₂', 'Nitrogen dioxide'],
    ['O3', 'O₃', 'Ozone'],
    ['SO2', 'SO₂', 'Sulphur dioxide'],
    ['PM10', 'PM10', 'PM10, coarse particulate matter'],
  ] as const)('names %s on screen as "%s" and aloud as "%s"', (code, label, spoken) => {
    render(<DangerBanner {...BASE} category="Extremely poor" pollutant={code} />);

    expect(screen.getByText(label)).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(spoken)).toBeInTheDocument();
  });

  it('omits the attribution rather than guessing when no pollutant is known', () => {
    render(<DangerBanner {...BASE} category="Poor" pollutant={null} />);

    expect(screen.queryByText('Leading pollutant')).not.toBeInTheDocument();
    // The warning still stands: the band is elevated whether or not we can say
    // which pollutant drove it.
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('names the station when the warning is about one place', () => {
    render(<DangerBanner {...BASE} category="Poor" pollutant="PM10" stationName="Żejtun" />);
    expect(screen.getByText(/Żejtun: Poor/)).toBeInTheDocument();
  });

  it('speaks for the islands as a whole when no station is named', () => {
    render(<DangerBanner {...BASE} category="Poor" pollutant="PM10" />);
    expect(screen.getByText(/Air quality across Malta and Gozo is Poor/)).toBeInTheDocument();
  });
});

describe('DangerBanner — health guidance is cautious and qualified', () => {
  it('carries the medical disclaimer verbatim', () => {
    render(<DangerBanner {...BASE} category="Very poor" pollutant="O3" />);

    expect(
      screen.getByText(
        'maqua.app provides general environmental information and does not replace medical advice or official emergency guidance.',
      ),
    ).toBeInTheDocument();
  });

  it('defers to official instructions in an emergency', () => {
    render(<DangerBanner {...BASE} category="Extremely poor" pollutant="PM10" />);
    expect(screen.getByText(/follow official instructions rather than this page/i)).toBeVisible();
  });

  it('addresses sensitive groups without narrowing who is affected', () => {
    render(<DangerBanner {...BASE} category="Poor" pollutant="NO2" />);

    expect(screen.getByText('If you are more sensitive')).toBeInTheDocument();
    expect(screen.getByText('Advice for the current band')).toBeInTheDocument();
    // Every group is listed. Naming only some would tell the rest the warning
    // is not meant for them, which one hour of data cannot support.
    const groups = screen.getByText(/children/i).textContent ?? '';
    expect(groups).toMatch(/asthma/i);
    expect(groups).toMatch(/heart/i);
  });
});

describe('DangerBanner — provenance of the number behind the warning', () => {
  it('states when the reading was taken, in a machine-readable form', () => {
    render(<DangerBanner {...BASE} category="Poor" pollutant="PM10" />);

    const time = screen.getByText(/Sun 26 Jul/);
    expect(time.tagName.toLowerCase()).toBe('time');
    expect(time).toHaveAttribute('dateTime', '2026-07-26T06:00:00.000Z');
  });

  it('says the time is unavailable rather than printing an empty <time>', () => {
    const { container } = render(
      <DangerBanner {...BASE} measuredAt="not-a-timestamp" category="Poor" pollutant="PM10" />,
    );

    expect(container.querySelector('time')).toBeNull();
    expect(screen.getByText('Not available')).toBeInTheDocument();
  });

  it('labels a measured value as measured', () => {
    render(<DangerBanner {...BASE} category="Poor" pollutant="PM10" />);
    expect(screen.getByText('Measured')).toBeInTheDocument();
    expect(screen.queryByText('Estimated')).not.toBeInTheDocument();
    expect(screen.queryByText('Forecast')).not.toBeInTheDocument();
  });

  it('calls a gap-filled value estimated, never forecast', () => {
    // The feed models PAST hours too, so `modelled` alone does not license the
    // word "forecast" — that would be a stronger claim than the data supports.
    render(<DangerBanner {...BASE} modelled category="Poor" pollutant="PM10" />);

    expect(screen.getByText('Estimated')).toBeInTheDocument();
    expect(screen.queryByText('Forecast')).not.toBeInTheDocument();
    expect(screen.getByText(/modelled rather than measured/i)).toBeInTheDocument();
  });

  it('calls a genuine future point a forecast and says it is model output', () => {
    render(<DangerBanner {...BASE} modelled forecast category="Poor" pollutant="PM10" />);

    expect(screen.getByText('Forecast')).toBeInTheDocument();
    expect(screen.queryByText('Estimated')).not.toBeInTheDocument();
    expect(screen.getByText(/model output, not measurements/i)).toBeInTheDocument();
  });

  it('marks near-real-time data as provisional and explains why', () => {
    render(<DangerBanner {...BASE} category="Poor" pollutant="PM10" />);

    expect(screen.getByText('Provisional')).toBeInTheDocument();
    expect(screen.getByText(/may be revised|validates/i)).toBeInTheDocument();
  });

  it('drops the provisional badge for validated data', () => {
    render(<DangerBanner {...BASE} provisional={false} category="Poor" pollutant="PM10" />);
    expect(screen.queryByText('Provisional')).not.toBeInTheDocument();
  });
});
