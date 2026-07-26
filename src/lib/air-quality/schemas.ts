/**
 * Zod schemas for the upstream EEA dissemination payloads.
 *
 * Every byte crossing the network boundary is validated here. The upstream is a
 * public backing store rather than a contractual API (docs/DATA_SOURCE.md §9),
 * so a shape change must surface as a clean, logged validation failure — not as
 * `undefined` leaking into a category calculation.
 *
 * Deliberately permissive about *extra* fields and strict about the ones we
 * read: new upstream columns must not break the app.
 */

import { z } from 'zod';
import { POLLUTANT_CODES } from '@/config/pollutants';

/** ISO-8601 UTC instant, as used for the hour keys. */
export const isoInstantSchema = z
  .string()
  .refine((v) => Number.isFinite(Date.parse(v)), { message: 'not a parseable ISO-8601 instant' });

/**
 * One hour of readings for one station.
 *
 * Field names are dynamic (`val_PM2.5`, `aqi_NO2`, `modelled_O3`), so the schema
 * is assembled from the pollutant registry rather than written out by hand —
 * adding a pollutant in one place keeps validation in step.
 */
const hourlyShape: Record<string, z.ZodTypeAny> = {
  culprit: z.string().nullish(),
  aqi: z.number().nullish(),
};

for (const code of POLLUTANT_CODES) {
  // `val_*` is null whenever the pollutant was not measured. Nullable, never
  // defaulted to 0 — a default here would silently manufacture clean air.
  hourlyShape[`val_${code}`] = z.number().nullish();
  hourlyShape[`aqi_${code}`] = z.number().nullish();
  // 0 = measured, 1 = modelled/gap-filled/forecast.
  hourlyShape[`modelled_${code}`] = z.union([z.literal(0), z.literal(1)]).nullish();
}

export const upstreamHourlySchema = z.object(hourlyShape).loose();

export type UpstreamHourly = z.infer<typeof upstreamHourlySchema>;

/**
 * A whole `current/<code>.json`: an object keyed by ISO hour.
 *
 * Hours that fail validation are dropped by the provider rather than failing the
 * entire station — one malformed hour in a 300-hour series must not blank the map.
 */
export const upstreamStationSeriesSchema = z.record(isoInstantSchema, upstreamHourlySchema);

export type UpstreamStationSeries = z.infer<typeof upstreamStationSeriesSchema>;

/** `content/index.json` — points at the current station master file. */
export const upstreamContentIndexSchema = z.object({
  contents: z.array(z.string()).min(1),
  languages: z.record(z.string(), z.string()).optional(),
});

/** One row of `content/raw_stations.json.<stamp>`. */
export const upstreamStationMetaSchema = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),
    operational: z.union([z.literal(0), z.literal(1)]).nullish(),
    lon: z.number().min(-180).max(180),
    lat: z.number().min(-90).max(90),
    altitude: z.number().nullish(),
    station_type: z.string().nullish(),
    area_classification: z.string().nullish(),
    network: z.string().nullish(),
    organisation: z.string().nullish(),
    municipality: z.string().nullish(),
  })
  .loose();

export const upstreamStationListSchema = z.array(upstreamStationMetaSchema);

export type UpstreamStationMeta = z.infer<typeof upstreamStationMetaSchema>;

/* -------------------------------------------------------------------------- */
/*  Outbound API schemas                                                      */
/* -------------------------------------------------------------------------- */

export const airQualityCategorySchema = z.enum([
  'Good',
  'Fair',
  'Moderate',
  'Poor',
  'Very poor',
  'Extremely poor',
]);

export const freshnessStateSchema = z.enum(['fresh', 'delayed', 'stale', 'unavailable']);

export const pollutantCodeSchema = z.enum(POLLUTANT_CODES);

export const responseMetaSchema = z.object({
  source: z.enum(['EEA', 'ERA', 'FIXTURE']),
  measuredAt: z.string().nullable(),
  fetchedAt: z.string(),
  nextExpectedUpdateAt: z.string().nullable(),
  stale: z.boolean(),
  partial: z.boolean(),
  cached: z.boolean(),
  degradedReason: z.string().optional(),
});

/* -------------------------------------------------------------------------- */
/*  Inbound query validation                                                  */
/* -------------------------------------------------------------------------- */

/** `?station=` accepts an upstream code or a slug; resolution happens later. */
export const stationQuerySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'station must be alphanumeric');

export const pollutantQuerySchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.enum(['pm25', 'pm10', 'no2', 'o3', 'so2']));

export const limitQuerySchema = z.coerce.number().int().min(1).max(50);
