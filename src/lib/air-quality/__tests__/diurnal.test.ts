import { describe, expect, it } from 'vitest';

import type { PollutantCode } from '@/config/pollutants';
import type { HistoricalReading } from '@/lib/air-quality/types';
import {
  LOW_CONCENTRATION_FRACTION,
  MIN_COVERED_HOURS_OF_DAY,
  MIN_OBSERVED_HOURS,
  describeAmplitude,
  diurnalProfile,
  formatHourOfDay,
} from '@/lib/air-quality/diurnal';
import { AQI_BREAKPOINTS } from '@/config/thresholds';

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
  overrides: Partial<Pick<HistoricalReading, 'forecast'>> & {
    modelled?: boolean;
    /** Defaults to NO₂. Set it where the pollutant's own band scale matters. */
    pollutant?: PollutantCode;
  } = {},
): HistoricalReading[] {
  const code: PollutantCode = overrides.pollutant ?? 'NO2';
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
              [code]: {
                pollutant: code,
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
      dominantPollutant: code,
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

describe('diurnalProfile — concentrations too low to have a shape', () => {
  /*
   * The defect this guards. `amplitudeRatio` is scale-free, so SO₂ swinging
   * between 0.2 and 0.6 µg/m³ — instrument noise around a detection limit, in
   * a pollutant the guides describe as near-absent in Malta — produced a ratio
   * of 3 and rendered as "a pronounced daily cycle".
   */
  it('flags a near-zero series rather than describing its cycle', () => {
    const profile = diurnalProfile(
      series(10, (hour) => (hour === 9 ? 0.6 : hour === 3 ? 0.2 : 0.3), { pollutant: 'SO2' }),
      'SO2',
    );

    expect(profile).not.toBeNull();
    expect(profile!.lowConcentration).toBe(true);
    // The ratio is still computed; it is simply not to be described.
    expect(profile!.amplitudeRatio).toBeGreaterThan(2.5);
  });

  it('flags a series whose trough would render as "0.0"', () => {
    /*
     * Mean is high enough to clear the fractional floor, but the trough is
     * 0.04 — which `toFixed(1)` prints as "0.0", indistinguishable from the
     * zero this project refuses to print for a missing value.
     */
    const profile = diurnalProfile(
      series(10, (hour) => (hour === 3 ? 0.04 : 30), { pollutant: 'SO2' }),
      'SO2',
    );

    expect(profile).not.toBeNull();
    expect(profile!.lowConcentration).toBe(true);
  });

  it('does not flag a series comfortably above the floor', () => {
    const profile = diurnalProfile(
      series(10, (hour) => (hour === 9 ? 24 : hour === 3 ? 8 : 15), { pollutant: 'SO2' }),
      'SO2',
    );

    expect(profile).not.toBeNull();
    expect(profile!.lowConcentration).toBe(false);
    expect(profile!.amplitudeRatio).toBeCloseTo(3, 5);
  });

  it('scales the floor to each pollutant’s own Good ceiling', () => {
    /*
     * 1.2 µg/m³ is below the floor for SO₂ (Good ends at 20, so the floor is
     * 4) and above it for PM2.5 (Good ends at 5, so the floor is 1). The same
     * concentration is therefore describable for one pollutant and not the
     * other, which is the whole point of scaling it.
     */
    const so2Floor = AQI_BREAKPOINTS.SO2.breakpoints[0]!.max * LOW_CONCENTRATION_FRACTION;
    const pm25Floor = AQI_BREAKPOINTS['PM2.5'].breakpoints[0]!.max * LOW_CONCENTRATION_FRACTION;
    expect(1.2).toBeLessThan(so2Floor);
    expect(1.2).toBeGreaterThan(pm25Floor);

    const so2 = diurnalProfile(
      series(10, (hour) => (hour === 9 ? 1.4 : 1.2), { pollutant: 'SO2' }),
      'SO2',
    );
    const pm25 = diurnalProfile(
      series(10, (hour) => (hour === 9 ? 1.4 : 1.2), { pollutant: 'PM2.5' }),
      'PM2.5',
    );

    expect(so2!.lowConcentration).toBe(true);
    expect(pm25!.lowConcentration).toBe(false);
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
