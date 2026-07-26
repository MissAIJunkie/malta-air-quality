/**
 * Pollutant registry.
 *
 * Codes match the upstream EEA dissemination layer's field suffixes
 * (`val_PM2.5`, `aqi_NO2`, ...) so the mapping stays a lookup rather than a
 * transformation. See docs/DATA_SOURCE.md §5.
 */

export const POLLUTANT_CODES = ['PM2.5', 'PM10', 'NO2', 'O3', 'SO2'] as const;

export type PollutantCode = (typeof POLLUTANT_CODES)[number];

/** Pollutants that carry a European AQI sub-index. */
export const AQI_POLLUTANTS = POLLUTANT_CODES;

export type PollutantDefinition = {
  code: PollutantCode;
  /** Stable key for i18n lookups and URL query params (lowercase, no symbols). */
  slug: string;
  /** Display label with correct typography (subscripts, no ASCII fallback). */
  label: string;
  /** Plain-text label for screen readers, where "₂" reads poorly. */
  ariaLabel: string;
  unit: string;
  /**
   * Averaging period used by the European AQI for this pollutant.
   * All five are hourly under the "no running means" variant we consume.
   */
  averagingPeriod: string;
  /** i18n keys — never render these directly; resolve through the dictionary. */
  descriptionKey: string;
  sourcesKey: string;
  healthEffectsKey: string;
};

export const POLLUTANTS: Record<PollutantCode, PollutantDefinition> = {
  'PM2.5': {
    code: 'PM2.5',
    slug: 'pm25',
    label: 'PM2.5',
    ariaLabel: 'PM2.5, fine particulate matter',
    unit: 'µg/m³',
    averagingPeriod: 'Hourly',
    descriptionKey: 'pollutant.pm25.description',
    sourcesKey: 'pollutant.pm25.sources',
    healthEffectsKey: 'pollutant.pm25.healthEffects',
  },
  PM10: {
    code: 'PM10',
    slug: 'pm10',
    label: 'PM10',
    ariaLabel: 'PM10, coarse particulate matter',
    unit: 'µg/m³',
    averagingPeriod: 'Hourly',
    descriptionKey: 'pollutant.pm10.description',
    sourcesKey: 'pollutant.pm10.sources',
    healthEffectsKey: 'pollutant.pm10.healthEffects',
  },
  NO2: {
    code: 'NO2',
    slug: 'no2',
    label: 'NO₂',
    ariaLabel: 'Nitrogen dioxide',
    unit: 'µg/m³',
    averagingPeriod: 'Hourly',
    descriptionKey: 'pollutant.no2.description',
    sourcesKey: 'pollutant.no2.sources',
    healthEffectsKey: 'pollutant.no2.healthEffects',
  },
  O3: {
    code: 'O3',
    slug: 'o3',
    label: 'O₃',
    ariaLabel: 'Ozone',
    unit: 'µg/m³',
    averagingPeriod: 'Hourly',
    descriptionKey: 'pollutant.o3.description',
    sourcesKey: 'pollutant.o3.sources',
    healthEffectsKey: 'pollutant.o3.healthEffects',
  },
  SO2: {
    code: 'SO2',
    slug: 'so2',
    label: 'SO₂',
    ariaLabel: 'Sulphur dioxide',
    unit: 'µg/m³',
    averagingPeriod: 'Hourly',
    descriptionKey: 'pollutant.so2.description',
    sourcesKey: 'pollutant.so2.sources',
    healthEffectsKey: 'pollutant.so2.healthEffects',
  },
};

const SLUG_TO_CODE: Record<string, PollutantCode> = Object.fromEntries(
  POLLUTANT_CODES.map((code) => [POLLUTANTS[code].slug, code]),
);

/** Resolve a `?pollutant=` query value. Returns null for anything unknown. */
export function pollutantFromSlug(slug: string | null | undefined): PollutantCode | null {
  if (!slug) return null;
  return SLUG_TO_CODE[slug.toLowerCase()] ?? null;
}

export function isPollutantCode(value: unknown): value is PollutantCode {
  return typeof value === 'string' && (POLLUTANT_CODES as readonly string[]).includes(value);
}
