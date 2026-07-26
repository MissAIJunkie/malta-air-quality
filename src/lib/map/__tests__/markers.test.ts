import { describe, expect, it } from 'vitest';

import { STATIONS } from '@/config/stations';
import type { PollutantReading, StationReading } from '@/lib/air-quality/types';
import { buildStationRows, orderStationsForMap } from '@/lib/map/markers';

function pollutantReading(overrides: Partial<PollutantReading> = {}): PollutantReading {
  return {
    pollutant: 'PM10',
    value: 20,
    unit: 'µg/m³',
    category: 'Fair',
    subIndex: 2.1,
    averagingPeriod: 'Hourly',
    thresholdReference: 'test',
    modelled: false,
    ...overrides,
  };
}

function stationReading(overrides: Partial<StationReading> = {}): StationReading {
  return {
    stationId: 'MT00011',
    measuredAt: '2026-07-26T09:00:00.000Z',
    fetchedAt: '2026-07-26T10:00:00.000Z',
    timezone: 'Europe/Malta',
    overallCategory: 'Fair',
    overallSubIndex: 2.1,
    dominantPollutant: 'PM10',
    pollutants: { PM10: pollutantReading() },
    provisional: true,
    freshness: 'fresh',
    ageHours: 1,
    partial: false,
    source: 'FIXTURE',
    ...overrides,
  };
}

describe('orderStationsForMap', () => {
  it('puts Malta before Gozo and sorts by name within each island', () => {
    const names = orderStationsForMap(STATIONS).map((station) => station.name);
    expect(names).toEqual(['Attard', 'Msida', "St Paul's Bay", 'Żejtun', 'Għarb']);
  });
});

describe('buildStationRows', () => {
  it('keeps stations that published nothing, as no data rather than as Good', () => {
    const rows = buildStationRows(STATIONS, []);

    expect(rows).toHaveLength(STATIONS.length);
    for (const row of rows) {
      expect(row.category).toBeNull();
      expect(row.freshness).toBe('unavailable');
    }
  });

  it('takes the modelled flag of the pollutant that set the overall band', () => {
    const rows = buildStationRows(STATIONS, [
      stationReading({ pollutants: { PM10: pollutantReading({ modelled: true }) } }),
    ]);
    const msida = rows.find((row) => row.station.id === 'MT00011');

    expect(msida?.category).toBe('Fair');
    expect(msida?.modelled).toBe(true);
  });

  it('reports a pollutant the station does not carry as missing, not as Good', () => {
    const rows = buildStationRows(STATIONS, [stationReading()], 'O3');
    const msida = rows.find((row) => row.station.id === 'MT00011');

    expect(msida?.category).toBeNull();
    expect(msida?.pollutantMissing).toBe(true);
    expect(msida?.value).toBeNull();
  });

  it('reports a pollutant present with a null value as no data, not as zero', () => {
    const rows = buildStationRows(
      STATIONS,
      [
        stationReading({
          pollutants: { PM10: pollutantReading({ value: null, category: null, subIndex: null }) },
        }),
      ],
      'PM10',
    );
    const msida = rows.find((row) => row.station.id === 'MT00011');

    expect(msida?.category).toBeNull();
    expect(msida?.value).toBeNull();
    expect(msida?.pollutantMissing).toBe(false);
  });

  it('shows the filtered pollutant band rather than the overall one', () => {
    const rows = buildStationRows(
      STATIONS,
      [
        stationReading({
          overallCategory: 'Poor',
          overallSubIndex: 4.2,
          dominantPollutant: 'NO2',
          pollutants: {
            NO2: pollutantReading({ pollutant: 'NO2', category: 'Poor', subIndex: 4.2, value: 90 }),
            PM10: pollutantReading({ category: 'Good', subIndex: 1.2, value: 8 }),
          },
        }),
      ],
      'PM10',
    );
    const msida = rows.find((row) => row.station.id === 'MT00011');

    expect(msida?.category).toBe('Good');
    expect(msida?.value).toBe(8);
  });
});
