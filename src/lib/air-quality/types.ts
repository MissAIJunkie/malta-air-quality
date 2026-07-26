/**
 * Internal air-quality domain model.
 *
 * The UI depends on these types and never on an upstream response shape.
 * Providers are responsible for normalising into them.
 */

import type { PollutantCode } from '@/config/pollutants';
import type { AirQualityCategory } from '@/config/thresholds';
import type { Island } from '@/config/stations';

export type ProviderSource = 'EEA' | 'ERA' | 'FIXTURE';

/**
 * Freshness of a reading relative to the upstream publication cadence.
 * Thresholds live in `freshness.ts` and derive from the observed cadence.
 */
export type FreshnessState = 'fresh' | 'delayed' | 'stale' | 'unavailable';

export type AirQualityStation = {
  id: string;
  slug: string;
  name: string;
  locality: string;
  island: Island;
  latitude: number;
  longitude: number;
  altitudeMetres: number;
  stationType: string;
  areaClassification: string;
  pollutantsMeasured: PollutantCode[];
  operator: string;
  sourceUrl: string;
  active: boolean;
};

export type PollutantReading = {
  pollutant: PollutantCode;
  /**
   * Measured concentration. `null` means NOT MEASURED — it must never be
   * coerced to 0, and the UI must render it as unavailable.
   */
  value: number | null;
  unit: string;
  /** `null` when no value, so no category can be derived. */
  category: AirQualityCategory | null;
  /** Continuous sub-index in [1, 7). `null` when unavailable. */
  subIndex: number | null;
  averagingPeriod: string;
  thresholdReference: string;
  /**
   * True when the value is modelled / gap-filled / forecast rather than
   * directly measured (upstream `modelled_* === 1`). Surfaced as "Estimated".
   */
  modelled: boolean;
};

export type StationReading = {
  stationId: string;
  /** ISO-8601 UTC instant the measurement refers to. */
  measuredAt: string;
  /** ISO-8601 UTC instant maqua.app retrieved it. */
  fetchedAt: string;
  timezone: 'Europe/Malta';
  /** `null` when no pollutant yielded a category. */
  overallCategory: AirQualityCategory | null;
  overallSubIndex: number | null;
  dominantPollutant: PollutantCode | null;
  pollutants: Partial<Record<PollutantCode, PollutantReading>>;
  /** Near-real-time data is unverified and subject to revision. Always true for E2a. */
  provisional: boolean;
  freshness: FreshnessState;
  /** Whole hours between `measuredAt` and retrieval. */
  ageHours: number;
  /** True when at least one expected pollutant is missing. */
  partial: boolean;
  source: ProviderSource;
};

export type HistoricalReading = {
  stationId: string;
  measuredAt: string;
  pollutants: Partial<Record<PollutantCode, PollutantReading>>;
  overallCategory: AirQualityCategory | null;
  dominantPollutant: PollutantCode | null;
  /** True when this point lies in the future — a forecast, not an observation. */
  forecast: boolean;
};

export type HistoryOptions = {
  /** Inclusive ISO-8601 UTC lower bound. */
  from?: string;
  /** Exclusive ISO-8601 UTC upper bound. */
  to?: string;
  /** Include future (forecast) points. Defaults to false. */
  includeForecast?: boolean;
};

/**
 * How the Malta-wide summary was aggregated.
 *
 * Exposed to the UI so the header can state its own methodology rather than
 * presenting an unexplained number.
 */
export type AggregationMethod = 'worst-station';

export type MaltaSummary = {
  category: AirQualityCategory | null;
  dominantPollutant: PollutantCode | null;
  aggregation: AggregationMethod;
  /** Station whose reading determined the summary. */
  drivingStationId: string | null;
  reportingStations: number;
  totalStations: number;
  staleStations: number;
  /** Newest measurement across all reporting stations. */
  measuredAt: string | null;
  freshness: FreshnessState;
};

export type ResponseMeta = {
  source: ProviderSource;
  measuredAt: string | null;
  fetchedAt: string;
  nextExpectedUpdateAt: string | null;
  stale: boolean;
  partial: boolean;
  /** True when served from cache without contacting upstream. */
  cached: boolean;
  /** Present only when upstream failed and last-known-good is being served. */
  degradedReason?: string;
};

export type ApiEnvelope<T> = {
  data: T;
  meta: ResponseMeta;
};

export interface AirQualityProvider {
  readonly name: ProviderSource;
  getStations(): Promise<AirQualityStation[]>;
  getLatestReadings(): Promise<StationReading[]>;
  getStationHistory?(stationId: string, options: HistoryOptions): Promise<HistoricalReading[]>;
}
