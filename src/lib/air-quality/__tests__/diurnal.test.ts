import { describe, expect, it } from 'vitest';

import type { HistoricalReading } from '@/lib/air-quality/types';
import {
  MIN_COVERED_HOURS_OF_DAY,
  MIN_OBSERVED_HOURS,
  describeAmplitude,
  diurnalProfile,
  formatHourOfDay,
} from '@/lib/air-quality/diurnal';

/**
 * Build a history series.
 *
 * `valueAt` receives the Malta wall-clock hour, so a test can describe a daily
 * shape directly. Starts at a winter midnight UTC (Malta is UTC+1 in January),
 * which is also the case that catches an implementation reading UTC hours: a
 * peak written at Malta 08:00 lands at 07:00 UTC.
 */
function series(
  days: number,
  valueAt: (hour: number) => number | null,
  overrides: Partial<Pick<HistoricalReading, 'forecast'>> & { modelled?: boolean } = {},
): HistoricalReading[] {
  const out: HistoricalReading[] = [];
  const start = Date.UTC(2026, 0, 5, 0, 0, 0);

  for (let h = 0; h < days * 24; h += 1) {
    const at = new Date(start + h * 3600_000);
    // Malta is UTC+1 in January.
    const maltaHour = (at.getUTCHours() + 1) % 24;
    const value = valueAt(maltaHour);

    out.push({
      stationId: 'MT00011',
      measuredAt: at.toISOString(),
      pollutants:
        value === null
          ? {}
          : {
              NO2: {
                pollutant: 'NO2',
                value,
                unit: 'µg/m³',
                category: 'Good',
                subIndex: 1,
                averagingPeriod: 'Hourly',
                thresholdReference: 'test',
                modelled: overrides.modelled ?? false,
              },
            },
      overallCategory: 'Good',
      dominantPollutant: 'NO2',
      forecast: overrides.forecast ?? false,
    });
  }

  return out;
}

describe('diurnalProfile', () => {
  it('finds the peak and trough hour in Malta wall-clock time, not UTC', () => {
    // A clean single peak at Malta 08:00 and trough at Malta 03:00.
    const profile = diurnalProfile(
      series(10, (hour) => (hour === 8 ? 60 : hour === 3 ? 10 : 25)),
      'NO2',
    );

    expect(profile).not.toBeNull();
    // 08:00 Malta is 07:00 UTC — reading UTC hours would report 7 here.
    expect(profile!.peak.hour).toBe(8);
    expect(profile!.trough.hour).toBe(3);
    expect(profile!.amplitudeRatio).toBeCloseTo(6, 5);
  });

  it('reports the sample size and window behind the claim', () => {
    const profile = diurnalProfile(
      series(10, () => 20),
      'NO2',
    );

    expect(profile!.samples).toBe(240);
    expect(profile!.windowDays).toBe(10);
    expect(profile!.overallMean).toBeCloseTo(20, 5);
  });

  it('excludes forecast points, so a modelled future cannot shape an observed profile', () => {
    // Every point is a forecast: there is no observed history at all.
    const profile = diurnalProfile(
      series(10, () => 20, { forecast: true }),
      'NO2',
    );

    expect(profile).toBeNull();
  });

  it('excludes gap-filled values, which are modelled rather than measured', () => {
    const profile = diurnalProfile(
      series(10, () => 20, { modelled: true }),
      'NO2',
    );

    expect(profile).toBeNull();
  });

  it('treats a missing value as missing rather than as zero', () => {
    /*
     * The last four hours of each day report nothing — still 20 hours of
     * coverage, so the profile is reportable. A zero-coercing implementation
     * would record four hours of 0 µg/m³, drag `overallMean` down from 30 to
     * 25, and name a trough at 20:00 that is really an instrument gap. That is
     * the exact failure the whole project refuses: zero is a measurement claim,
     * an absent reading is the absence of one.
     */
    const profile = diurnalProfile(
      series(10, (hour) => (hour >= 20 ? null : 30)),
      'NO2',
    );

    expect(profile).not.toBeNull();
    expect(profile!.samples).toBe(200);
    expect(profile!.byHour).toHaveLength(20);
    expect(profile!.overallMean).toBeCloseTo(30, 5);
    expect(profile!.byHour.every((entry) => entry.mean === 30)).toBe(true);
    // No hour of 0, and so no invented trough.
    expect(profile!.trough.mean).toBe(30);
    expect(profile!.byHour.some((entry) => entry.hour >= 20)).toBe(false);
  });

  it('declines to report when there are too few measured hours', () => {
    const hours = MIN_OBSERVED_HOURS - 1;
    const sparse = series(10, () => 20).slice(0, hours);

    expect(diurnalProfile(sparse, 'NO2')).toBeNull();
  });

  it('declines to report when the day is not covered, even with plenty of samples', () => {
    /*
     * Lots of data, all of it from a narrow band of the day. Naming a "lowest
     * hour" here would name the edge of the sample, not a trough.
     */
    const covered = MIN_COVERED_HOURS_OF_DAY - 4;
    const profile = diurnalProfile(
      series(20, (hour) => (hour < covered ? 20 + hour : null)),
      'NO2',
    );

    expect(profile).toBeNull();
  });

  it('declines to report when the trough is zero, which would make the ratio meaningless', () => {
    const profile = diurnalProfile(
      series(10, (hour) => (hour === 3 ? 0 : 25)),
      'NO2',
    );

    expect(profile).toBeNull();
  });

  it('returns null for a pollutant the station does not measure', () => {
    expect(
      diurnalProfile(
        series(10, () => 20),
        'O3',
      ),
    ).toBeNull();
  });
});

describe('describeAmplitude', () => {
  it.each([
    [1.0, 'flat'],
    [1.49, 'flat'],
    [1.5, 'moderate'],
    [2.49, 'moderate'],
    [2.5, 'pronounced'],
    [6.0, 'pronounced'],
  ])('describes a ratio of %s as %s', (ratio, expected) => {
    expect(describeAmplitude(ratio)).toBe(expected);
  });
});

describe('formatHourOfDay', () => {
  it.each([
    [0, '00:00'],
    [7, '07:00'],
    [23, '23:00'],
  ])('renders hour %i as %s, zero-padded and 24-hour', (hour, expected) => {
    expect(formatHourOfDay(hour)).toBe(expected);
  });
});
