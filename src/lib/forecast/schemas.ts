/**
 * Zod schemas for the forecast module.
 *
 * There is no upstream to validate here — the forecast arrives inside the EEA
 * payload that `air-quality/schemas.ts` already checks, and revalidating it
 * would duplicate that contract rather than strengthen it. What these schemas
 * cover is the *outbound* shape and the inbound query, so a consumer can
 * validate `/api/forecast` without re-deriving the types, and so a malformed
 * query is rejected before it reaches the provider.
 *
 * `estimated` is modelled as a literal `true`, not a boolean. That is the point:
 * a payload claiming `estimated: false` must fail validation rather than be
 * accepted and rendered as a measurement.
 */

import { z } from 'zod';
import { POLLUTANT_CODES } from '@/config/pollutants';
import { AIR_QUALITY_CATEGORIES } from '@/config/thresholds';
import { FORECAST_CONFIDENCE_LEVELS } from './types';
import { impactDirectionSchema, sourceUrlSchema } from '@/lib/environmental-context/schemas';

export const isoInstantSchema = z
  .string()
  .refine((v) => Number.isFinite(Date.parse(v)), { message: 'not a parseable ISO-8601 instant' });

export const forecastConfidenceSchema = z.enum(FORECAST_CONFIDENCE_LEVELS);

export const airQualityCategorySchema = z.enum(AIR_QUALITY_CATEGORIES);

export const forecastDriverSchema = z.object({
  label: z.string().min(1),
  detail: z.string().min(1),
  impact: impactDirectionSchema,
  confidence: forecastConfidenceSchema,
});

export const enrichedForecastDriverSchema = forecastDriverSchema.extend({
  id: z.string().min(1),
  labelKey: z.string().min(1),
  detailKey: z.string().min(1),
  vars: z.record(z.string(), z.union([z.string(), z.number()])),
  appliesFrom: isoInstantSchema,
  appliesTo: isoInstantSchema,
  sourceName: z.string().min(1),
  sourceUrl: sourceUrlSchema,
});

export const airQualityForecastPointSchema = z.object({
  forecastAt: isoInstantSchema,
  stationId: z.string().min(1).optional(),
  pollutant: z.enum(POLLUTANT_CODES).optional(),
  predictedValue: z.number().optional(),
  predictedCategory: airQualityCategorySchema.nullable(),
  confidence: forecastConfidenceSchema,
  drivers: z.array(forecastDriverSchema),
  source: z.string().min(1),
  // Literal, not boolean: a point that says it is not an estimate is invalid.
  estimated: z.literal(true),
});

export const enrichedForecastPointSchema = airQualityForecastPointSchema.extend({
  drivers: z.array(enrichedForecastDriverSchema),
  methodology: z.string().min(1),
  methodologyKey: z.string().min(1),
  horizonHours: z.number(),
  predictedSubIndex: z.number().nullable(),
  dominantPollutant: z.enum(POLLUTANT_CODES).nullable(),
  unit: z.string().optional(),
});

export const pollutantForecastSeriesSchema = z.object({
  pollutant: z.enum(POLLUTANT_CODES),
  unit: z.string().min(1),
  points: z.array(enrichedForecastPointSchema),
});

export const forecastDayOutlookSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected a YYYY-MM-DD local date'),
  worstCategory: airQualityCategorySchema.nullable(),
  dominantPollutant: z.enum(POLLUTANT_CODES).nullable(),
  peakAt: isoInstantSchema.nullable(),
  confidence: forecastConfidenceSchema,
  hours: z.number().int().min(0),
});

export const forecastSourceRefSchema = z.object({
  name: z.string().min(1),
  url: sourceUrlSchema,
  licence: z.string().min(1),
});

export const stationForecastOutlookSchema = z.object({
  stationId: z.string().min(1),
  generatedAt: isoInstantSchema,
  basedOnObservationAt: isoInstantSchema.nullable(),
  horizon: z
    .object({
      from: isoInstantSchema,
      to: isoInstantSchema,
      hours: z.number().int().min(0),
    })
    .nullable(),
  points: z.array(enrichedForecastPointSchema),
  pollutantSeries: z.array(pollutantForecastSeriesSchema),
  peak: enrichedForecastPointSchema.nullable(),
  days: z.array(forecastDayOutlookSchema),
  drivers: z.array(enrichedForecastDriverSchema),
  confidence: forecastConfidenceSchema,
  confidenceReasons: z.array(z.string()),
  confidenceReasonKeys: z.array(z.string()),
  methodology: z.string().min(1),
  methodologyKey: z.string().min(1),
  sources: z.array(forecastSourceRefSchema).min(1),
  estimated: z.literal(true),
  available: z.boolean(),
  unavailableReason: z.string().optional(),
  unavailableReasonKey: z.string().optional(),
});

/* -------------------------------------------------------------------------- */
/*  Inbound query validation                                                  */
/* -------------------------------------------------------------------------- */

/** `?station=` accepts an upstream code or a slug; resolution happens later. */
export const forecastStationQuerySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'station must be alphanumeric');

export const forecastPollutantQuerySchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.enum(['pm25', 'pm10', 'no2', 'o3', 'so2']));

/** `?hours=` narrows the outlook to the first N hours. */
export const forecastHoursQuerySchema = z.coerce.number().int().min(1).max(120);

/**
 * `?include=` overrides the hour-by-hour arrays in either direction.
 *
 * A closed set rather than a free-form list: anything else is a client error, so
 * a typo surfaces as a 400 instead of quietly returning a summary the caller
 * will misread as an empty forecast.
 */
export const forecastIncludeQuerySchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.enum(['hourly', 'summary']));
