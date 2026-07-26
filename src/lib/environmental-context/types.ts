/**
 * Environmental context — the atmospheric story around a measurement.
 *
 * Context explains; it never adjusts. Nothing in this module may alter a
 * measured concentration, a sub-index or a category. A Saharan dust intrusion
 * is a plausible *explanation* for a high PM10 hour, and saying so is useful —
 * saying it *caused* that hour would be an unfounded claim about a specific
 * measurement, which this project does not make.
 *
 * Every event therefore carries:
 *   - a real, citable source (name + URL), never an inferred one,
 *   - an explicit `observedOrForecast` provenance flag,
 *   - a confidence level,
 *   - hedged summary text ("may contribute", "is likely to influence").
 */

import type { PollutantCode } from '@/config/pollutants';

/**
 * Event taxonomy.
 *
 * The union is deliberately wider than what the current providers can detect.
 * `wildfire_smoke`, `shipping_emissions` and `industrial_incident` have no
 * verified feed available to this deployment, so no live provider emits them —
 * see `classify-event.ts`. They stay in the union because the type is the
 * product's vocabulary, and inventing a detector for them later must not be a
 * breaking change. The fixture provider exercises those code paths.
 */
export const ENVIRONMENTAL_CONTEXT_EVENT_TYPES = [
  'saharan_dust',
  'wildfire_smoke',
  'high_wind',
  'low_wind',
  'storm',
  'heavy_rain',
  'heatwave',
  'ozone_risk',
  'temperature_inversion',
  'sea_salt',
  'regional_pollution',
  'shipping_emissions',
  'industrial_incident',
  'other',
] as const;

export type EnvironmentalContextEventType = (typeof ENVIRONMENTAL_CONTEXT_EVENT_TYPES)[number];

/**
 * Direction of the influence a condition *may* exert on air quality.
 *
 * `unclear` is a real answer, not a fallback: strong wind disperses local
 * traffic emissions while also lifting sea salt and resuspended dust, and
 * pretending that nets out to a single direction would be dishonest.
 */
export const IMPACT_DIRECTIONS = ['worsening', 'improving', 'neutral', 'unclear'] as const;

export type ImpactDirection = (typeof IMPACT_DIRECTIONS)[number];

export type ContextConfidence = 'high' | 'medium' | 'low';

/**
 * Provenance of the condition described.
 *
 * `observed` is reserved for conditions established by measurement. Numerical
 * weather and aerosol models produce output for past hours too, but that is
 * model *analysis*, not observation — so everything derived from Open-Meteo or
 * CAMS is `forecast`, including a dust episode already under way.
 */
export type ObservedOrForecast = 'observed' | 'forecast';

export type GeographicalScope =
  'Malta' | 'Gozo' | 'Maltese Islands' | 'Central Mediterranean' | 'Regional';

/**
 * One environmental condition that may be influencing air quality.
 *
 * This shape is the published contract consumed by the UI and by
 * `/api/context`. Anything the pipeline needs internally — citations from a
 * dedupe merge, a relevance score, i18n keys — lives on `EnrichedContextEvent`
 * so that this type stays exactly what the product promises.
 */
export type EnvironmentalContextEvent = {
  /** Stable across refreshes: derived from the event's content, never random. */
  id: string;
  type: EnvironmentalContextEventType;
  title: string;
  /** Hedged prose. Must never assert that this condition caused a reading. */
  summary: string;
  impactDirection: ImpactDirection;
  confidence: ContextConfidence;
  observedOrForecast: ObservedOrForecast;
  /** ISO-8601 UTC. Absent when the condition has no bounded start. */
  startsAt?: string;
  /** ISO-8601 UTC. Absent when the end is not known. */
  endsAt?: string;
  /** When the underlying source published this information. ISO-8601 UTC. */
  publishedAt: string;
  /** When maqua.app retrieved it. ISO-8601 UTC. */
  fetchedAt: string;
  sourceName: string;
  sourceUrl: string;
  affectedPollutants?: PollutantCode[];
  geographicalScope?: GeographicalScope;
  /**
   * True only if a language model wrote `summary`. Deterministic classifiers
   * set this to false. The UI must label AI-written text as such.
   */
  aiGeneratedSummary: boolean;
};

/** One source backing an event. Several survive a dedupe merge. */
export type EventCitation = {
  sourceName: string;
  sourceUrl: string;
  /** Normalised URL used for duplicate detection. */
  canonicalUrl: string;
  publishedAt: string;
};

/**
 * Internal working shape.
 *
 * `deduplicate.ts` merges related reports into one event, and the requirement
 * is that every contributing source survives the merge — so citations cannot
 * live anywhere else. `relevance` and the i18n keys are equally pipeline
 * concerns. Consumers that only know `EnvironmentalContextEvent` are unaffected
 * because every addition is extra, never a change.
 */
export type EnrichedContextEvent = EnvironmentalContextEvent & {
  citations: EventCitation[];
  /** 0–1, scored against Malta and Gozo by `relevance.ts`. */
  relevance: number;
  /**
   * i18n keys for the deterministically generated title and summary, emitted
   * alongside the English text rather than instead of it: `t()` returns the key
   * itself when a translation is missing, so a key-only payload would render
   * raw keys in any locale whose dictionary has not caught up.
   */
  titleKey?: string;
  summaryKey?: string;
  /** Interpolation values for `titleKey` / `summaryKey`. */
  vars?: Record<string, string | number>;
};

/* -------------------------------------------------------------------------- */
/*  Upstream context inputs                                                   */
/* -------------------------------------------------------------------------- */

/** A citable upstream source. */
export type SourceRef = {
  name: string;
  url: string;
  licence: string;
};

/**
 * One hour of meteorological context for the Maltese Islands.
 *
 * Every field is nullable: a missing model variable must read as "unknown", and
 * a rule that needs it simply does not fire. It is never defaulted to 0 — zero
 * wind speed and unknown wind speed lead to opposite conclusions.
 */
export type WeatherHour = {
  /** ISO-8601 UTC instant, with an explicit `Z`. */
  time: string;
  temperatureC: number | null;
  relativeHumidityPct: number | null;
  dewPointC: number | null;
  precipitationMm: number | null;
  windSpeedKmh: number | null;
  windDirectionDeg: number | null;
  windGustKmh: number | null;
  /** Depth of the mixing layer. Low values mean pollution stays near the ground. */
  boundaryLayerHeightM: number | null;
  surfacePressureHpa: number | null;
  cloudCoverPct: number | null;
  /**
   * Temperature at 950 hPa (roughly 500 m). Used only for the inversion proxy:
   * air warmer aloft than at the surface suppresses vertical mixing.
   */
  temperature950hPaC: number | null;
};

export type WeatherContext = {
  fetchedAt: string;
  latitude: number;
  longitude: number;
  hours: WeatherHour[];
  source: SourceRef;
};

/** One hour of aerosol context from the CAMS models, via Open-Meteo. */
export type AerosolHour = {
  time: string;
  /** Mineral dust concentration, µg/m³. The Saharan dust signal. */
  dustUgm3: number | null;
  /** CAMS-modelled regional PM10 — a model field, never a station measurement. */
  modelledPm10Ugm3: number | null;
  modelledPm25Ugm3: number | null;
  aerosolOpticalDepth: number | null;
  uvIndex: number | null;
};

export type AerosolContext = {
  fetchedAt: string;
  latitude: number;
  longitude: number;
  hours: AerosolHour[];
  source: SourceRef;
};

/* -------------------------------------------------------------------------- */
/*  Service and API shapes                                                    */
/* -------------------------------------------------------------------------- */

export type AtmosphericContext = {
  weather: WeatherContext | null;
  aerosol: AerosolContext | null;
  events: EnrichedContextEvent[];
  /** Providers that failed. Present so the UI can say what is missing. */
  unavailableSources: string[];
};

export type ContextQuery = {
  types?: EnvironmentalContextEventType[];
  impact?: ImpactDirection;
  limit?: number;
};

/**
 * Response metadata for `/api/context`.
 *
 * Field-for-field identical to `ResponseMeta` (src/lib/air-quality/types.ts)
 * except for `source`, which is widened from the air-quality provider union to
 * the name of the real upstream. Environmental context comes from Open-Meteo
 * and CAMS, and labelling it `EEA` to satisfy a type would be precisely the
 * false-provenance failure this project refuses to commit. `sources` carries
 * the full citations. Validate with `contextResponseMetaSchema`.
 */
export type ContextResponseMeta = {
  source: string;
  measuredAt: string | null;
  fetchedAt: string;
  nextExpectedUpdateAt: string | null;
  stale: boolean;
  partial: boolean;
  cached: boolean;
  degradedReason?: string;
  sources: SourceRef[];
};
