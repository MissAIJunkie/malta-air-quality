import { describe, it, expect } from 'vitest';
import oracle from '../../../../fixtures/upstream-aqi-oracle.json';
import {
  calculateSubIndex,
  calculateCategory,
  categoryFromSubIndex,
  buildPollutantReading,
  calculateOverall,
  compareToThresholds,
  findConclusiveExceedances,
} from '../calculate-index';
import type { PollutantCode } from '@/config/pollutants';
import type { PollutantReading } from '../types';

type OraclePair = {
  station: string;
  measuredAt: string;
  pollutant: PollutantCode;
  value: number;
  upstreamSubIndex: number;
};

const PAIRS = oracle as OraclePair[];

describe('European AQI — agreement with the upstream index', () => {
  /**
   * The decisive test. Our breakpoint table is an independent reimplementation;
   * if it reproduces the EEA's own continuous sub-index across hundreds of real
   * Malta observations, the table is right. Captured 2026-07-26.
   */
  it('reproduces the upstream sub-index for every real observation', () => {
    expect(PAIRS.length).toBeGreaterThan(500);

    const mismatches = PAIRS.filter((p) => {
      const ours = calculateSubIndex(p.pollutant, p.value);
      if (ours === null) return true;
      return Math.abs(ours - p.upstreamSubIndex) > 1e-6;
    });

    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(mismatches).toHaveLength(0);
  });

  it('agrees with the upstream band on every observation', () => {
    const mismatches = PAIRS.filter(
      (p) => calculateCategory(p.pollutant, p.value) !== categoryFromSubIndex(p.upstreamSubIndex),
    );
    expect(mismatches).toHaveLength(0);
  });

  it('covers every pollutant and more than one band', () => {
    const byPollutant = new Set(PAIRS.map((p) => p.pollutant));
    expect([...byPollutant].sort()).toEqual(['NO2', 'O3', 'PM10', 'PM2.5', 'SO2']);

    const bands = new Set(PAIRS.map((p) => Math.floor(p.upstreamSubIndex)));
    expect(bands.size).toBeGreaterThan(1);
  });
});

describe('breakpoint edges', () => {
  /**
   * The EEA publishes bands as inclusive integer ranges: PM10 "0–15" is Good,
   * "16–45" is Fair. So the CEILING of a range belongs to that range — 15 µg/m³
   * of PM10 is Good, and Fair does not begin until 16.
   */
  it.each([
    ['PM2.5', 0, 'Good'],
    ['PM2.5', 5, 'Good'],
    ['PM2.5', 6, 'Fair'],
    ['PM2.5', 15, 'Fair'],
    ['PM2.5', 16, 'Moderate'],
    ['PM2.5', 50, 'Moderate'],
    ['PM2.5', 51, 'Poor'],
    ['PM2.5', 91, 'Very poor'],
    ['PM2.5', 141, 'Extremely poor'],
    ['PM10', 15, 'Good'],
    ['PM10', 16, 'Fair'],
    ['PM10', 45, 'Fair'],
    ['PM10', 46, 'Moderate'],
    ['PM10', 121, 'Poor'],
    ['NO2', 10, 'Good'],
    ['NO2', 11, 'Fair'],
    ['NO2', 26, 'Moderate'],
    ['O3', 60, 'Good'],
    ['O3', 61, 'Fair'],
    ['O3', 121, 'Poor'],
    ['SO2', 20, 'Good'],
    ['SO2', 21, 'Fair'],
  ] as Array<[PollutantCode, number, string]>)(
    '%s at %s µg/m³ is %s',
    (pollutant, value, expected) => {
      expect(calculateCategory(pollutant, value)).toBe(expected);
    },
  );

  it('rounds to whole µg/m³ before classifying', () => {
    // The decisive case. 15.48 rounds to 15 and stays Good; 15.5 rounds to 16
    // and becomes Fair. Treating the bands as half-open real intervals would
    // call both of these Fair, which is what the upstream data disproves.
    expect(calculateCategory('PM10', 15.48)).toBe('Good');
    expect(calculateCategory('PM10', 15.5)).toBe('Fair');
  });

  it('caps the fraction so a band ceiling does not floor into the next band', () => {
    // 45 is PM10's Fair ceiling: fraction is exactly 1.0 before capping.
    const subIndex = calculateSubIndex('PM10', 45);
    expect(subIndex).toBeCloseTo(2.99, 10);
    expect(Math.floor(subIndex as number)).toBe(2);
    expect(calculateCategory('PM10', 45)).toBe('Fair');
  });

  it('places a rounded zero at the bottom of Good rather than below the scale', () => {
    // Band 1 starts at 1 µg/m³, so 0 sits below its floor. It is still a real
    // measurement of very clean air and must classify as Good, not as no-data.
    expect(calculateSubIndex('SO2', 0.13)).toBe(1);
    expect(calculateCategory('SO2', 0.13)).toBe('Good');
  });

  it('saturates rather than overflowing at the top band', () => {
    const subIndex = calculateSubIndex('PM10', 5_000);
    expect(subIndex).toBeCloseTo(6.99, 10);
    expect(calculateCategory('PM10', 5_000)).toBe('Extremely poor');
  });
});

describe('missing data is never zero', () => {
  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY])(
    'returns null for %s rather than a Good category',
    (value) => {
      expect(calculateSubIndex('PM10', value as number | null)).toBeNull();
      expect(calculateCategory('PM10', value as number | null)).toBeNull();
    },
  );

  it('accepts trace negatives that round to zero as clean air', () => {
    // Real upstream values: SO2 at Għarb reports -0.02228 µg/m³ when the
    // pollutant is below the detection limit. That is clean air, not no-data.
    expect(calculateCategory('SO2', -0.02228)).toBe('Good');
    expect(calculateSubIndex('SO2', -0.02228)).toBe(1);
  });

  it('rejects negatives large enough to indicate an instrument fault', () => {
    expect(calculateSubIndex('NO2', -1.2)).toBeNull();
    expect(calculateCategory('NO2', -1.2)).toBeNull();
    expect(buildPollutantReading('NO2', -1.2).value).toBeNull();
  });

  it('distinguishes a genuine zero from a missing value', () => {
    // Exactly 0 µg/m³ IS a measurement and must classify as Good.
    expect(calculateCategory('NO2', 0)).toBe('Good');
    expect(calculateCategory('NO2', null)).toBeNull();
  });

  it('keeps value null on a reading built from a missing measurement', () => {
    const reading = buildPollutantReading('PM10', null);
    expect(reading.value).toBeNull();
    expect(reading.category).toBeNull();
    expect(reading.subIndex).toBeNull();
    expect(reading.unit).toBe('µg/m³');
  });

  it('carries the modelled flag through', () => {
    expect(buildPollutantReading('O3', 85, { modelled: true }).modelled).toBe(true);
    expect(buildPollutantReading('O3', 85).modelled).toBe(false);
  });
});

describe('upstream sub-index band conversion', () => {
  it('treats band 0 as no data, not Good', () => {
    // aqi_* === 0 in the upstream payload means "no index available".
    expect(categoryFromSubIndex(0)).toBeNull();
    expect(categoryFromSubIndex(0.9)).toBeNull();
  });

  it('floors, matching the upstream viewer', () => {
    expect(categoryFromSubIndex(3.9999)).toBe('Moderate');
    expect(categoryFromSubIndex(4)).toBe('Poor');
  });
});

function readings(
  entries: Array<[PollutantCode, number | null]>,
): Partial<Record<PollutantCode, PollutantReading>> {
  const out: Partial<Record<PollutantCode, PollutantReading>> = {};
  for (const [code, value] of entries) out[code] = buildPollutantReading(code, value);
  return out;
}

describe('overall category — worst pollutant wins', () => {
  it('selects the worst reported pollutant', () => {
    const result = calculateOverall(
      readings([
        ['PM10', 20], // Fair
        ['NO2', 30], // Moderate
        ['O3', 10], // Good
      ]),
    );
    expect(result.category).toBe('Moderate');
    expect(result.dominantPollutant).toBe('NO2');
  });

  it('ignores missing pollutants entirely', () => {
    const result = calculateOverall(
      readings([
        ['PM10', null],
        ['NO2', 30],
      ]),
    );
    expect(result.category).toBe('Moderate');
    expect(result.dominantPollutant).toBe('NO2');
  });

  it('returns null when nothing is reportable', () => {
    expect(calculateOverall(readings([['PM10', null]]))).toEqual({
      category: null,
      subIndex: null,
      dominantPollutant: null,
    });
    expect(calculateOverall({})).toEqual({
      category: null,
      subIndex: null,
      dominantPollutant: null,
    });
  });

  it('breaks same-category ties on the higher sub-index', () => {
    // Both Moderate; PM10 sits higher within the band.
    const result = calculateOverall(
      readings([
        ['PM10', 115], // 3.94
        ['NO2', 30], // 3.14
      ]),
    );
    expect(result.dominantPollutant).toBe('PM10');
  });

  it('is deterministic regardless of insertion order', () => {
    const a = calculateOverall(readings([['PM10', 20], ['NO2', 30]]));
    const b = calculateOverall(readings([['NO2', 30], ['PM10', 20]]));
    expect(a).toEqual(b);
  });
});

describe('legal limits versus health guidance', () => {
  it('never marks a long-averaging limit conclusive from one hourly reading', () => {
    const annual = compareToThresholds('NO2', 250).filter(
      (c) => c.kind === 'eu-limit' && c.averagingPeriod === 'Calendar year',
    );
    expect(annual).toHaveLength(1);
    expect(annual[0].above).toBe(true);
    // Above the number, but a single hour cannot establish an annual breach.
    expect(annual[0].conclusive).toBe(false);
  });

  it('treats the NO2 hourly limit as inconclusive because exceedances are permitted', () => {
    const hourly = compareToThresholds('NO2', 250).filter(
      (c) => c.kind === 'eu-limit' && c.averagingPeriod === '1 hour',
    );
    expect(hourly[0].above).toBe(true);
    expect(hourly[0].conclusive).toBe(false);
  });

  it('does treat the ozone information threshold as conclusive', () => {
    const found = findConclusiveExceedances('O3', 200);
    expect(found).toHaveLength(1);
    expect(found[0].threshold).toBe(180);
    expect(found[0].reference).toContain('information threshold');
  });

  it('flags both ozone thresholds above the alert level', () => {
    expect(findConclusiveExceedances('O3', 300).map((c) => c.threshold).sort()).toEqual([180, 240]);
  });

  it('reports nothing conclusive for ordinary elevated particulates', () => {
    expect(findConclusiveExceedances('PM10', 80)).toHaveLength(0);
  });

  it('separates WHO guidance from EU law', () => {
    const kinds = new Set(compareToThresholds('PM2.5', 30).map((c) => c.kind));
    expect(kinds).toEqual(new Set(['eu-limit', 'who-guideline']));
  });

  it('returns nothing for a missing value', () => {
    expect(compareToThresholds('PM10', null)).toEqual([]);
  });
});
