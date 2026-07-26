/**
 * Air-quality forecast domain model.
 *
 * The central fact about this module: **maqua.app does not forecast air
 * quality.** It surfaces an official European one. Each `current/<code>.json`
 * the EEA publishes already carries roughly 48 hours of CAMS-modelled hours
 * beyond the newest measurement (docs/DATA_SOURCE.md §5), and those hours are
 * what this module presents — relabelled, split from the observations, and
 * annotated with deterministically derived drivers.
 *
 * Building a bespoke model would be worse in every respect that matters:
 * unvalidated, unattributable, and impossible for a reader to check. Presenting
 * CAMS output as if it were ours would be worse still.
 *
 * Consequences that show up as types below:
 *   - Every point is `estimated: true`. There is no code path that emits a
 *     forecast point without it.
 *   - Every point carries a `source` and a `methodology` label, so a value can
 *     never be lifted out of context and read as a measurement.
 *   - Confidence is a horizon-derived band, not a probability. Calling it a
 *     percentage would imply a calibration nobody has performed.
 */

import type { PollutantCode } from '@/config/pollutants';
import type { AirQualityCategory } from '@/config/thresholds';
import type { ProviderSource } from '@/lib/air-quality/types';
import type { ImpactDirection } from '@/lib/environmental-context/types';

export const FORECAST_CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;

export type ForecastConfidence = (typeof FORECAST_CONFIDENCE_LEVELS)[number];

/* -------------------------------------------------------------------------- */
/*  Provenance constants                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Attribution and methodology live here, beside the types, for one practical
 * reason: both the provider (which reaches the network and therefore imports
 * `server-only` transitively) and the pure assembler in `calculate.ts` need
 * them. Putting them in the provider would drag the server-only chain into the
 * pure module and make it untestable in isolation.
 */
export type ForecastSourceRef = {
  name: string;
  url: string;
  licence: string;
};

export const CAMS_FORECAST_SOURCE: ForecastSourceRef = {
  name: 'Copernicus Atmosphere Monitoring Service (CAMS), disseminated by the European Environment Agency (EEA)',
  url: 'https://airindex.eea.europa.eu/AQI/index.html',
  licence: 'Copernicus and EEA open data',
};

/**
 * Attribution for synthetic data.
 *
 * Fixture output must never carry a real organisation's name. Citing CAMS or
 * the EEA beside invented numbers would be a false claim of provenance — and a
 * far more damaging one than an unlabelled value, because it is checkable and
 * wrong. It also survives screenshots, logs and AI prompts, none of which carry
 * `meta.source`.
 */
export const FIXTURE_FORECAST_SOURCE: ForecastSourceRef = {
  name: 'maqua.app development fixture — not a real forecast',
  url: 'https://maqua.app/',
  licence: 'Sample data',
};

/** Short attribution carried on every individual point. */
export const FORECAST_POINT_SOURCE = 'CAMS forecast, via the EEA';

export const FIXTURE_POINT_SOURCE = 'maqua.app fixture — not a real forecast';

/**
 * Attribution for a provider.
 *
 * Every point, driver and outlook resolves its source through these rather than
 * hardcoding CAMS, so selecting the fixture provider cannot leave a real
 * organisation's name attached to synthetic values.
 */
export function forecastSourceFor(provider: ProviderSource): ForecastSourceRef {
  return provider === 'FIXTURE' ? FIXTURE_FORECAST_SOURCE : CAMS_FORECAST_SOURCE;
}

export function forecastPointSourceFor(provider: ProviderSource): string {
  return provider === 'FIXTURE' ? FIXTURE_POINT_SOURCE : FORECAST_POINT_SOURCE;
}

/**
 * The methodology *label* every point carries.
 *
 * Short by necessity. A two-day outlook for five stations runs to well over a
 * thousand points, and repeating the full statement on each one added roughly
 * half a megabyte to the response — most of a mobile page load spent on the
 * same sentence over and over. The label travels with every point so a value
 * lifted out of context still says what it is; the full statement is carried
 * once per outlook in `methodology`, and once more at the top of the response.
 */
export const FORECAST_METHODOLOGY_LABEL = 'European AQI applied to CAMS modelled concentrations';

export const FORECAST_METHODOLOGY =
  'Modelled hourly concentrations from the Copernicus Atmosphere Monitoring Service, published alongside the measurements in the EEA European Air Quality Index dissemination layer and classified with the same European AQI bands maqua.app applies to observations. maqua.app does not model air quality and does not adjust these values.';

export const FORECAST_METHODOLOGY_KEY = 'forecast.methodology.camsViaEea';

export const FORECAST_METHODOLOGY_LABEL_KEY = 'forecast.methodology.label';

/**
 * Hours the EEA normally publishes ahead of the newest measurement.
 *
 * Used only as the denominator when judging whether a series is unusually
 * short. It is never presented to a reader as the length of *this* outlook —
 * `StationForecastOutlook.horizon` reports what was actually published.
 */
export const EXPECTED_FORECAST_HOURS = 48;

/**
 * One reason the forecast points the way it does.
 *
 * Drivers are derived by rule from the forecast series and from public weather
 * and aerosol forecasts — never by a language model, and never as a claim of
 * causation. `label` and `detail` are hedged by construction.
 */
export type ForecastDriver = {
  label: string;
  detail: string;
  impact: ImpactDirection;
  confidence: ForecastConfidence;
};

/**
 * A driver with the pipeline's own metadata attached.
 *
 * `label` and `detail` ship as English text *and* as i18n keys. `t()` returns
 * the key itself when a translation is missing, so a key-only payload would
 * render `forecast.driver.dust.label` to any reader whose dictionary has not
 * caught up. Emitting both lets the UI localise where it can and stay readable
 * where it cannot.
 */
export type EnrichedForecastDriver = ForecastDriver & {
  /** Stable within a response; lets the UI key a list without an index. */
  id: string;
  labelKey: string;
  detailKey: string;
  vars: Record<string, string | number>;
  /** Hours this driver applies to, ISO-8601 UTC. */
  appliesFrom: string;
  appliesTo: string;
  sourceName: string;
  sourceUrl: string;
};

/**
 * One forecast hour.
 *
 * `predictedValue` is present only on a per-pollutant point; the overall point
 * carries a category and no concentration, because "the overall value" is not a
 * concentration of anything.
 */
export type AirQualityForecastPoint = {
  /** ISO-8601 UTC instant the forecast refers to. */
  forecastAt: string;
  stationId?: string;
  pollutant?: PollutantCode;
  predictedValue?: number;
  /** `null` when the modelled hour yielded no classifiable value. */
  predictedCategory: AirQualityCategory | null;
  confidence: ForecastConfidence;
  drivers: ForecastDriver[];
  source: string;
  /** Never optional and never false. A forecast is always an estimate. */
  estimated: true;
};

export type EnrichedForecastPoint = Omit<AirQualityForecastPoint, 'drivers'> & {
  drivers: EnrichedForecastDriver[];
  /**
   * Required by `/api/forecast`: no point travels without its methodology
   * label. This is the short form — see `FORECAST_METHODOLOGY_LABEL`. The full
   * statement is on the outlook.
   */
  methodology: string;
  methodologyKey: string;
  /** Hours between the reference instant and `forecastAt`. Drives confidence. */
  horizonHours: number;
  /** Continuous European AQI sub-index, `null` when unclassifiable. */
  predictedSubIndex: number | null;
  /** Worst pollutant in the modelled hour. */
  dominantPollutant: PollutantCode | null;
  unit?: string;
};

export type PollutantForecastSeries = {
  pollutant: PollutantCode;
  unit: string;
  points: EnrichedForecastPoint[];
};

/** A day of the outlook, bucketed by Malta local date. */
export type ForecastDayOutlook = {
  /** `YYYY-MM-DD` in Europe/Malta, not UTC — readers plan in local days. */
  date: string;
  worstCategory: AirQualityCategory | null;
  dominantPollutant: PollutantCode | null;
  /** Instant of the worst forecast hour that day. */
  peakAt: string | null;
  confidence: ForecastConfidence;
  /** Forecast hours available for this day. Rarely 24 at either end. */
  hours: number;
};

/**
 * A station's complete outlook.
 *
 * `horizon` reports the span the upstream actually published rather than a
 * fixed "48 hours". The real figure moves with the publication cycle, and under
 * `AIR_QUALITY_PROVIDER=fixture` it is only a couple of hours — a claim of 48
 * would be false in the configuration the project guarantees must work.
 */
export type StationForecastOutlook = {
  stationId: string;
  /** Instant the outlook was assembled. Confidence is relative to this. */
  generatedAt: string;
  /** Newest genuinely measured hour; the forecast begins after it. */
  basedOnObservationAt: string | null;
  horizon: { from: string; to: string; hours: number } | null;
  points: EnrichedForecastPoint[];
  pollutantSeries: PollutantForecastSeries[];
  /** Worst forecast hour in the window. `null` when nothing is classifiable. */
  peak: EnrichedForecastPoint | null;
  days: ForecastDayOutlook[];
  drivers: EnrichedForecastDriver[];
  confidence: ForecastConfidence;
  /** Why the confidence is what it is, in plain words. */
  confidenceReasons: string[];
  confidenceReasonKeys: string[];
  methodology: string;
  methodologyKey: string;
  sources: ForecastSourceRef[];
  estimated: true;
  /** False when upstream published no forecast hours for this station. */
  available: boolean;
  unavailableReason?: string;
  unavailableReasonKey?: string;
};
