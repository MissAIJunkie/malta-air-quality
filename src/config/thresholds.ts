/**
 * European Air Quality Index breakpoints, plus EU legal limits and WHO guidelines.
 *
 * EVERY threshold number in this application lives here. UI components must not
 * contain concentration literals — they read categories from this table via
 * `src/lib/air-quality/calculate-index.ts`.
 *
 * Verified 2026-07-26 by two independent methods (see docs/AQI_METHODOLOGY.md):
 *   1. Regression over 6,760 observed (concentration, sub-index) pairs from the
 *      five Malta stations in the EEA dissemination layer.
 *   2. The EEA's published European AQI threshold table.
 * Both agreed to within floating-point noise.
 *
 * Three distinct kinds of number appear below and are deliberately NOT mixed:
 *   - `AQI_BREAKPOINTS`  — index categories (communication)
 *   - `EU_LIMIT_VALUES`  — legally binding limits (compliance, long averaging)
 *   - `WHO_GUIDELINES`   — health-based guidance (not law)
 */

import type { PollutantCode } from './pollutants';

/* -------------------------------------------------------------------------- */
/*  Categories                                                                */
/* -------------------------------------------------------------------------- */

export const AIR_QUALITY_CATEGORIES = [
  'Good',
  'Fair',
  'Moderate',
  'Poor',
  'Very poor',
  'Extremely poor',
] as const;

export type AirQualityCategory = (typeof AIR_QUALITY_CATEGORIES)[number];

/**
 * Upstream band id (`Math.floor(aqi)`) → category.
 * Band 0 is NOT a category: it means "no index available".
 */
export const BAND_ID_TO_CATEGORY: Record<number, AirQualityCategory> = {
  1: 'Good',
  2: 'Fair',
  3: 'Moderate',
  4: 'Poor',
  5: 'Very poor',
  6: 'Extremely poor',
};

export const CATEGORY_TO_BAND_ID: Record<AirQualityCategory, number> = {
  Good: 1,
  Fair: 2,
  Moderate: 3,
  Poor: 4,
  'Very poor': 5,
  'Extremely poor': 6,
};

export type CategoryPresentation = {
  category: AirQualityCategory;
  bandId: number;
  /** Official EEA colour. Colour is NEVER the sole carrier of meaning. */
  color: string;
  /** Text that meets 4.5:1 against `color`. */
  onColor: string;
  /** Non-colour redundant encoding — required by WCAG 2.2 and §10 of the brief. */
  pattern: 'none' | 'diagonal' | 'dots' | 'grid' | 'dense' | 'solid-ring';
  /** Lucide icon name. */
  icon: string;
  /** True where the category warrants a prominent, unmissable warning. */
  elevated: boolean;
  labelKey: string;
  shortAdviceKey: string;
};

/**
 * Colours are the EEA's own published index colours, taken from the official
 * AQI viewer's `data.js`. They are reused for cross-application consistency.
 */
export const CATEGORY_PRESENTATION: Record<AirQualityCategory, CategoryPresentation> = {
  Good: {
    category: 'Good',
    bandId: 1,
    color: '#50f0e6',
    onColor: '#04322f',
    pattern: 'none',
    icon: 'CircleCheck',
    elevated: false,
    labelKey: 'category.good.label',
    shortAdviceKey: 'category.good.shortAdvice',
  },
  Fair: {
    category: 'Fair',
    bandId: 2,
    color: '#50ccaa',
    onColor: '#043024',
    pattern: 'none',
    icon: 'CircleCheck',
    elevated: false,
    labelKey: 'category.fair.label',
    shortAdviceKey: 'category.fair.shortAdvice',
  },
  Moderate: {
    category: 'Moderate',
    bandId: 3,
    color: '#f0e641',
    onColor: '#3a3405',
    pattern: 'dots',
    icon: 'CircleAlert',
    elevated: false,
    labelKey: 'category.moderate.label',
    shortAdviceKey: 'category.moderate.shortAdvice',
  },
  Poor: {
    category: 'Poor',
    bandId: 4,
    color: '#ff5050',
    onColor: '#3d0000',
    pattern: 'diagonal',
    icon: 'TriangleAlert',
    elevated: true,
    labelKey: 'category.poor.label',
    shortAdviceKey: 'category.poor.shortAdvice',
  },
  'Very poor': {
    category: 'Very poor',
    bandId: 5,
    color: '#960032',
    onColor: '#ffe4ec',
    pattern: 'dense',
    icon: 'TriangleAlert',
    elevated: true,
    labelKey: 'category.veryPoor.label',
    shortAdviceKey: 'category.veryPoor.shortAdvice',
  },
  'Extremely poor': {
    category: 'Extremely poor',
    bandId: 6,
    color: '#7d2181',
    onColor: '#fbe9fc',
    pattern: 'solid-ring',
    icon: 'OctagonAlert',
    elevated: true,
    labelKey: 'category.extremelyPoor.label',
    shortAdviceKey: 'category.extremelyPoor.shortAdvice',
  },
};

/** Presentation for the absence of data. Not a category. */
export const NO_DATA_PRESENTATION = {
  color: '#9aa5b1',
  onColor: '#1f2933',
  pattern: 'grid' as const,
  icon: 'CircleHelp',
  labelKey: 'category.noData.label',
};

/* -------------------------------------------------------------------------- */
/*  Breakpoints                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A band is an INTEGER-INCLUSIVE concentration range, in µg/m³.
 *
 * The European AQI is defined over whole µg/m³: the concentration is rounded to
 * the nearest integer, then matched against ranges published as "0–15", "16–45",
 * and so on. Modelling these as half-open real intervals ([15, 45)) looks
 * equivalent but is not — it misclassifies every value within half a unit of a
 * boundary. 15.48 µg/m³ of PM10 is *Good* (it rounds to 15), not *Fair*.
 *
 * This was established empirically, not assumed: the model below reproduces the
 * upstream sub-index for all 6,760 observed Malta (concentration, sub-index)
 * pairs with zero mismatches. See docs/AQI_METHODOLOGY.md §3.
 */
export type Breakpoint = {
  category: AirQualityCategory;
  bandId: number;
  /** Inclusive lower bound, whole µg/m³. Band 1 starts at 1. */
  min: number;
  /** Inclusive upper bound, whole µg/m³. */
  max: number;
};

export type PollutantThresholds = {
  pollutant: PollutantCode;
  unit: string;
  averagingPeriod: string;
  /** Citation for these specific numbers. */
  reference: string;
  breakpoints: Breakpoint[];
};

/**
 * Build the six bands from their inclusive upper bounds.
 *
 * Each band starts one unit above the previous band's ceiling; band 1 starts at
 * 1. A rounded concentration of 0 falls below band 1's floor and is clamped to
 * the bottom of Good — it is still a measurement, and still Good.
 */
function bands(uppers: [number, number, number, number, number, number]): Breakpoint[] {
  return uppers.map((max, i) => ({
    category: AIR_QUALITY_CATEGORIES[i],
    bandId: i + 1,
    min: i === 0 ? 1 : uppers[i - 1] + 1,
    max,
  }));
}

const EEA_REFERENCE = 'European Air Quality Index (EEA), verified 2026-07-26';

/**
 * Inclusive upper bounds per band, per pollutant.
 *
 * The top band's ceiling is the upstream's own saturation point, not infinity —
 * concentrations above it saturate rather than extrapolating off the scale.
 */
export const AQI_BREAKPOINTS: Record<PollutantCode, PollutantThresholds> = {
  'PM2.5': {
    pollutant: 'PM2.5',
    unit: 'µg/m³',
    averagingPeriod: 'Hourly',
    reference: EEA_REFERENCE,
    breakpoints: bands([5, 15, 50, 90, 140, 800]),
  },
  PM10: {
    pollutant: 'PM10',
    unit: 'µg/m³',
    averagingPeriod: 'Hourly',
    reference: EEA_REFERENCE,
    breakpoints: bands([15, 45, 120, 195, 270, 1200]),
  },
  NO2: {
    pollutant: 'NO2',
    unit: 'µg/m³',
    averagingPeriod: 'Hourly',
    reference: EEA_REFERENCE,
    breakpoints: bands([10, 25, 60, 100, 150, 1000]),
  },
  O3: {
    pollutant: 'O3',
    unit: 'µg/m³',
    averagingPeriod: 'Hourly',
    reference: EEA_REFERENCE,
    breakpoints: bands([60, 100, 120, 160, 180, 600]),
  },
  SO2: {
    pollutant: 'SO2',
    unit: 'µg/m³',
    averagingPeriod: 'Hourly',
    reference: EEA_REFERENCE,
    breakpoints: bands([20, 40, 125, 190, 275, 1000]),
  },
};

/**
 * Upper cap on the fractional part of a sub-index.
 *
 * A concentration sitting exactly on a band ceiling yields a fraction of 1.0,
 * which would floor into the *next* band and report the wrong category. The
 * upstream caps the fraction at 0.99 to keep `Math.floor(subIndex)` inside the
 * band it belongs to; we reproduce that exactly.
 */
export const SUB_INDEX_FRACTION_CAP = 0.99;

/* -------------------------------------------------------------------------- */
/*  Legal limits — distinct from the index                                    */
/* -------------------------------------------------------------------------- */

export type LimitValue = {
  pollutant: PollutantCode;
  value: number;
  unit: string;
  averagingPeriod: string;
  /** Exceedances permitted per calendar year before the limit is breached. */
  permittedExceedances: number | null;
  reference: string;
  /** Long-averaging limits can never be judged from one hourly reading. */
  assessableFromSingleReading: boolean;
};

/**
 * EU limit values in force under Directive 2008/50/EC, transposed in Malta by
 * S.L. 549.59.
 *
 * These describe LEGAL COMPLIANCE over long averaging periods. A single hourly
 * reading above one of these numbers is NOT a legal exceedance, and the UI must
 * never say it is. `assessableFromSingleReading` encodes exactly that.
 *
 * Directive (EU) 2024/2881 tightens several of these from 1 January 2030; it is
 * not yet in application and is therefore not used for current comparisons.
 */
export const EU_LIMIT_VALUES: LimitValue[] = [
  {
    pollutant: 'PM10',
    value: 50,
    unit: 'µg/m³',
    averagingPeriod: '24 hours',
    permittedExceedances: 35,
    reference: 'Directive 2008/50/EC Annex XI',
    assessableFromSingleReading: false,
  },
  {
    pollutant: 'PM10',
    value: 40,
    unit: 'µg/m³',
    averagingPeriod: 'Calendar year',
    permittedExceedances: null,
    reference: 'Directive 2008/50/EC Annex XI',
    assessableFromSingleReading: false,
  },
  {
    pollutant: 'PM2.5',
    value: 25,
    unit: 'µg/m³',
    averagingPeriod: 'Calendar year',
    permittedExceedances: null,
    reference: 'Directive 2008/50/EC Annex XIV',
    assessableFromSingleReading: false,
  },
  {
    pollutant: 'NO2',
    value: 200,
    unit: 'µg/m³',
    averagingPeriod: '1 hour',
    permittedExceedances: 18,
    reference: 'Directive 2008/50/EC Annex XI',
    // Hourly averaging, but 18 exceedances are permitted per year, so a single
    // reading still cannot establish a breach.
    assessableFromSingleReading: false,
  },
  {
    pollutant: 'NO2',
    value: 40,
    unit: 'µg/m³',
    averagingPeriod: 'Calendar year',
    permittedExceedances: null,
    reference: 'Directive 2008/50/EC Annex XI',
    assessableFromSingleReading: false,
  },
  {
    pollutant: 'SO2',
    value: 350,
    unit: 'µg/m³',
    averagingPeriod: '1 hour',
    permittedExceedances: 24,
    reference: 'Directive 2008/50/EC Annex XI',
    assessableFromSingleReading: false,
  },
  {
    pollutant: 'SO2',
    value: 125,
    unit: 'µg/m³',
    averagingPeriod: '24 hours',
    permittedExceedances: 3,
    reference: 'Directive 2008/50/EC Annex XI',
    assessableFromSingleReading: false,
  },
  {
    pollutant: 'O3',
    value: 120,
    unit: 'µg/m³',
    averagingPeriod: 'Maximum daily 8-hour mean',
    permittedExceedances: 25,
    reference: 'Directive 2008/50/EC Annex VII (target value)',
    assessableFromSingleReading: false,
  },
  {
    pollutant: 'O3',
    value: 180,
    unit: 'µg/m³',
    averagingPeriod: '1 hour',
    permittedExceedances: 0,
    reference: 'Directive 2008/50/EC Annex XII (information threshold)',
    // A genuine single-hour public-information trigger.
    assessableFromSingleReading: true,
  },
  {
    pollutant: 'O3',
    value: 240,
    unit: 'µg/m³',
    averagingPeriod: '1 hour',
    permittedExceedances: 0,
    reference: 'Directive 2008/50/EC Annex XII (alert threshold)',
    assessableFromSingleReading: true,
  },
];

/* -------------------------------------------------------------------------- */
/*  WHO guidelines — health guidance, not law                                 */
/* -------------------------------------------------------------------------- */

export type WhoGuideline = {
  pollutant: PollutantCode;
  value: number;
  unit: string;
  averagingPeriod: string;
  reference: string;
  assessableFromSingleReading: boolean;
};

/** WHO global air quality guidelines, 2021. */
export const WHO_GUIDELINES: WhoGuideline[] = [
  { pollutant: 'PM2.5', value: 15, unit: 'µg/m³', averagingPeriod: '24 hours', reference: 'WHO 2021', assessableFromSingleReading: false },
  { pollutant: 'PM2.5', value: 5, unit: 'µg/m³', averagingPeriod: 'Annual', reference: 'WHO 2021', assessableFromSingleReading: false },
  { pollutant: 'PM10', value: 45, unit: 'µg/m³', averagingPeriod: '24 hours', reference: 'WHO 2021', assessableFromSingleReading: false },
  { pollutant: 'PM10', value: 15, unit: 'µg/m³', averagingPeriod: 'Annual', reference: 'WHO 2021', assessableFromSingleReading: false },
  { pollutant: 'NO2', value: 25, unit: 'µg/m³', averagingPeriod: '24 hours', reference: 'WHO 2021', assessableFromSingleReading: false },
  { pollutant: 'NO2', value: 10, unit: 'µg/m³', averagingPeriod: 'Annual', reference: 'WHO 2021', assessableFromSingleReading: false },
  { pollutant: 'O3', value: 100, unit: 'µg/m³', averagingPeriod: 'Peak season 8-hour', reference: 'WHO 2021', assessableFromSingleReading: false },
  { pollutant: 'SO2', value: 40, unit: 'µg/m³', averagingPeriod: '24 hours', reference: 'WHO 2021', assessableFromSingleReading: false },
];

/** Categories at which prominent health warnings are shown. */
export const ELEVATED_CATEGORIES: readonly AirQualityCategory[] = AIR_QUALITY_CATEGORIES.filter(
  (c) => CATEGORY_PRESENTATION[c].elevated,
);

export function isElevatedCategory(category: AirQualityCategory): boolean {
  return CATEGORY_PRESENTATION[category].elevated;
}

/** Rank for "worst wins" aggregation. Higher is worse. */
export function categoryRank(category: AirQualityCategory): number {
  return CATEGORY_TO_BAND_ID[category];
}
