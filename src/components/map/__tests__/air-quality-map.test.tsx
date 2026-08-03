import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AirQualityMap } from '@/components/map/air-quality-map';
import { STATIONS } from '@/config/stations';
import type { StationReading } from '@/lib/air-quality/types';
import { resetWebGLProbe } from '@/lib/map/webgl';

/**
 * jsdom has no WebGL, so every render here takes the fallback path — which is
 * precisely the path worth testing. The map itself needs a GPU and belongs in
 * the browser-based end-to-end suite; what must be verified here is that a
 * reader without a renderer still receives the complete station list.
 */

const reading: StationReading = {
  stationId: 'MT00011',
  measuredAt: '2026-07-26T09:00:00.000Z',
  fetchedAt: '2026-07-26T10:00:00.000Z',
  timezone: 'Europe/Malta',
  overallCategory: 'Moderate',
  overallSubIndex: 3.4,
  dominantPollutant: 'PM10',
  pollutants: {
    PM10: {
      pollutant: 'PM10',
      value: 62,
      unit: 'µg/m³',
      category: 'Moderate',
      subIndex: 3.4,
      averagingPeriod: 'Hourly',
      thresholdReference: 'test',
      modelled: false,
    },
  },
  provisional: true,
  freshness: 'fresh',
  ageHours: 1,
  partial: false,
  source: 'FIXTURE',
};

describe('AirQualityMap without WebGL', () => {
  it('renders every station as a list instead of an error', () => {
    resetWebGLProbe();
    render(<AirQualityMap readings={[reading]} />);

    const fallback = screen.getByRole('region', { name: /could not be loaded/i });
    const items = within(fallback).getAllByRole('listitem');

    expect(items).toHaveLength(STATIONS.length);
    for (const station of STATIONS) {
      expect(within(fallback).getByText(station.name)).toBeInTheDocument();
    }
  });

  it('describes a station with no reading as no data, never as good', () => {
    resetWebGLProbe();
    render(<AirQualityMap readings={[]} />);

    const fallback = screen.getByRole('region', { name: /could not be loaded/i });
    expect(within(fallback).getAllByText('No data')).toHaveLength(STATIONS.length);
    expect(within(fallback).queryByText('Good')).not.toBeInTheDocument();
  });

  it('keeps the legend, including its no-data entry, under the band name every other surface uses', () => {
    resetWebGLProbe();
    render(<AirQualityMap readings={[reading]} />);

    const legend = screen.getByRole('region', { name: /air-quality bands/i });
    expect(within(legend).getByText('No data')).toBeInTheDocument();
    expect(within(legend).getByText('Extremely poor')).toBeInTheDocument();
    expect(within(legend).getByText('All pollutants')).toBeInTheDocument();
  });
});
