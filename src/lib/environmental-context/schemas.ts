/**
 * Zod schemas for environmental context.
 *
 * Two boundaries are validated here:
 *
 *   1. Inbound upstream payloads (Open-Meteo). Open-Meteo returns parallel
 *      arrays, so the schema proves the *shape*; `open-meteo-provider.ts` then
 *      proves the *alignment* (every series the same length as `time`), which a
 *      schema cannot express.
 *   2. Inbound query parameters on `/api/context`.
 *
 * The outbound event schema is exported so consumers — including other agents'
 * UI code — can validate `/api/context` without re-deriving the shape.
 */

import { z } from 'zod';
import { POLLUTANT_CODES } from '@/config/pollutants';
import { ENVIRONMENTAL_CONTEXT_EVENT_TYPES, IMPACT_DIRECTIONS } from './types';

/* -------------------------------------------------------------------------- */
/*  Upstream: Open-Meteo                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A requested hourly variable.
 *
 * Optional because Open-Meteo silently omits a series it cannot produce for a
 * location or model, and nullable per element because individual hours can be
 * absent. A missing series means "unknown", which suppresses the rules that
 * depend on it — it must never become a run of zeroes.
 */
const hourlySeries = z.array(z.number().nullable()).optional();

const openMeteoEnvelope = {
  latitude: z.number(),
  longitude: z.number(),
  /**
   * Checked by the provider before timestamps are treated as UTC. Open-Meteo
   * returns naive local times (`2026-07-26T00:00`) with the offset carried
   * separately, so appending `Z` is only correct while this is 0.
   */
  utc_offset_seconds: z.number(),
  timezone: z.string(),
  elevation: z.number().nullish(),
  generationtime_ms: z.number().nullish(),
};

export const openMeteoForecastResponseSchema = z
  .object({
    ...openMeteoEnvelope,
    hourly_units: z.record(z.string(), z.string()).optional(),
    hourly: z
      .object({
        time: z.array(z.string()).min(1),
        temperature_2m: hourlySeries,
        relative_humidity_2m: hourlySeries,
        dew_point_2m: hourlySeries,
        precipitation: hourlySeries,
        wind_speed_10m: hourlySeries,
        wind_direction_10m: hourlySeries,
        wind_gusts_10m: hourlySeries,
        boundary_layer_height: hourlySeries,
        surface_pressure: hourlySeries,
        cloud_cover: hourlySeries,
        temperature_950hPa: hourlySeries,
      })
      .loose(),
  })
  .loose();

export type OpenMeteoForecastResponse = z.infer<typeof openMeteoForecastResponseSchema>;

export const openMeteoAirQualityResponseSchema = z
  .object({
    ...openMeteoEnvelope,
    hourly_units: z.record(z.string(), z.string()).optional(),
    hourly: z
      .object({
        time: z.array(z.string()).min(1),
        dust: hourlySeries,
        pm10: hourlySeries,
        pm2_5: hourlySeries,
        aerosol_optical_depth: hourlySeries,
        uv_index: hourlySeries,
      })
      .loose(),
  })
  .loose();

export type OpenMeteoAirQualityResponse = z.infer<typeof openMeteoAirQualityResponseSchema>;

/* -------------------------------------------------------------------------- */
/*  Outbound: events                                                          */
/* -------------------------------------------------------------------------- */

export const eventTypeSchema = z.enum(ENVIRONMENTAL_CONTEXT_EVENT_TYPES);

export const impactDirectionSchema = z.enum(IMPACT_DIRECTIONS);

export const contextConfidenceSchema = z.enum(['high', 'medium', 'low']);

export const observedOrForecastSchema = z.enum(['observed', 'forecast']);

export const geographicalScopeSchema = z.enum([
  'Malta',
  'Gozo',
  'Maltese Islands',
  'Central Mediterranean',
  'Regional',
]);

/**
 * A citable HTTPS source.
 *
 * `https` only, and no embedded credentials: event URLs are rendered as
 * clickable citations, so `javascript:` and `data:` must never survive
 * validation even if a future feed emits one.
 */
export const sourceUrlSchema = z
  .string()
  .url()
  .refine(
    (raw) => {
      try {
        const url = new URL(raw);
        return url.protocol === 'https:' && !url.username && !url.password;
      } catch {
        return false;
      }
    },
    { message: 'source URL must be plain HTTPS' },
  );

export const isoInstantSchema = z
  .string()
  .refine((v) => Number.isFinite(Date.parse(v)), { message: 'not a parseable ISO-8601 instant' });

export const eventCitationSchema = z.object({
  sourceName: z.string().min(1),
  sourceUrl: sourceUrlSchema,
  canonicalUrl: z.string().min(1),
  publishedAt: isoInstantSchema,
});

export const environmentalContextEventSchema = z.object({
  id: z.string().min(1),
  type: eventTypeSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  impactDirection: impactDirectionSchema,
  confidence: contextConfidenceSchema,
  observedOrForecast: observedOrForecastSchema,
  startsAt: isoInstantSchema.optional(),
  endsAt: isoInstantSchema.optional(),
  publishedAt: isoInstantSchema,
  fetchedAt: isoInstantSchema,
  sourceName: z.string().min(1),
  sourceUrl: sourceUrlSchema,
  affectedPollutants: z.array(z.enum(POLLUTANT_CODES)).optional(),
  geographicalScope: geographicalScopeSchema.optional(),
  aiGeneratedSummary: z.boolean(),
});

export const enrichedContextEventSchema = environmentalContextEventSchema.extend({
  citations: z.array(eventCitationSchema),
  relevance: z.number().min(0).max(1),
  titleKey: z.string().optional(),
  summaryKey: z.string().optional(),
  vars: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});

export const sourceRefSchema = z.object({
  name: z.string().min(1),
  url: sourceUrlSchema,
  licence: z.string().min(1),
});

/**
 * `/api/context` metadata.
 *
 * Mirrors `responseMetaSchema` from `air-quality/schemas.ts` but widens
 * `source` to a free-form upstream name — see the note on `ContextResponseMeta`.
 * Exported so UI code validates against this rather than against the
 * air-quality meta, which would reject `"Open-Meteo"`.
 */
export const contextResponseMetaSchema = z.object({
  source: z.string().min(1),
  measuredAt: z.string().nullable(),
  fetchedAt: isoInstantSchema,
  nextExpectedUpdateAt: z.string().nullable(),
  stale: z.boolean(),
  partial: z.boolean(),
  cached: z.boolean(),
  degradedReason: z.string().optional(),
  sources: z.array(sourceRefSchema),
});

/* -------------------------------------------------------------------------- */
/*  Inbound query validation                                                  */
/* -------------------------------------------------------------------------- */

/**
 * `?type=` accepts one event type or a comma-separated list.
 *
 * An unknown type is a client error rather than an ignored filter: silently
 * returning everything for `?type=volcano` would look like a working filter
 * that simply found nothing.
 */
export const contextTypeQuerySchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .transform((raw) =>
    raw
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part.length > 0),
  )
  .pipe(z.array(eventTypeSchema).min(1).max(ENVIRONMENTAL_CONTEXT_EVENT_TYPES.length));

export const contextImpactQuerySchema = z.string().trim().toLowerCase().pipe(impactDirectionSchema);

export const contextLimitQuerySchema = z.coerce.number().int().min(1).max(50);
