/**
 * Drizzle schema — PostgreSQL (Neon).
 *
 * The database is OPTIONAL. Nothing here is required for the map, the station
 * pages or `/api/air-quality` to work; persistence adds history beyond the ~10
 * days the upstream feed carries, plus alerts, provider health and audit trails.
 * `src/db/client.ts` returns `null` when `DATABASE_URL` is unset and every query
 * module degrades to a safe default.
 *
 * Two conventions run through the whole file and are deliberate:
 *
 *  1. **Imports are relative, not `@/`-aliased.** drizzle-kit loads this module
 *     directly with its own bundler, which does not read the tsconfig `paths`
 *     map. A single aliased import here breaks `db:generate` for everyone.
 *
 *  2. **Vocabularies are `text` + `$type<>()`, not `pgEnum`.** Pollutant codes,
 *     provider names and categories originate upstream. A Postgres enum turns an
 *     unexpected value into a failed INSERT — i.e. a silently discarded
 *     measurement — which is a far worse failure than an unconstrained string.
 *     TypeScript still narrows every read and write at compile time.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import type { PollutantCode } from '../config/pollutants';
import type { AirQualityCategory } from '../config/thresholds';
import type { Island } from '../config/stations';
import type { ProviderSource } from '../lib/air-quality/types';

/** Every instant is stored with its offset. Malta observes DST; naive local
 *  timestamps would collapse the duplicated hour each October. */
const instant = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/* -------------------------------------------------------------------------- */
/*  Reference data                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Station master data, mirrored from `src/config/stations.ts`.
 *
 * Duplicating the config into the database is intentional: a reading from 2027
 * must still resolve to the station metadata that was in force when it was
 * taken, even if the station is later reclassified or retired upstream.
 */
export const airQualityStations = pgTable(
  'air_quality_stations',
  {
    /** Upstream EEA code, e.g. `MT00011`. Stable across the whole dataset. */
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    upstreamName: text('upstream_name'),
    locality: text('locality').notNull(),
    island: text('island').$type<Island>().notNull(),
    latitude: numeric('latitude', { mode: 'number', precision: 9, scale: 6 }).notNull(),
    longitude: numeric('longitude', { mode: 'number', precision: 9, scale: 6 }).notNull(),
    altitudeMetres: integer('altitude_metres'),
    stationType: text('station_type').notNull(),
    areaClassification: text('area_classification').notNull(),
    expectedPollutants: jsonb('expected_pollutants').$type<PollutantCode[]>().notNull(),
    operator: text('operator').notNull(),
    sourceUrl: text('source_url').notNull(),
    active: boolean('active').notNull().default(true),
    firstSeenAt: instant('first_seen_at').notNull().defaultNow(),
    lastSeenAt: instant('last_seen_at').notNull().defaultNow(),
  },
  (t) => [unique('air_quality_stations_slug_key').on(t.slug)],
);

/* -------------------------------------------------------------------------- */
/*  Measurements                                                              */
/* -------------------------------------------------------------------------- */

/**
 * One measured (or gap-filled) pollutant concentration for one station-hour.
 *
 * Long and narrow rather than one column per pollutant: stations measure
 * different subsets, and a wide table would force a NULL that is indistinguishable
 * from "this analyser reported nothing this hour".
 */
export const airQualityReadings = pgTable(
  'air_quality_readings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stationId: text('station_id')
      .notNull()
      .references(() => airQualityStations.id, { onDelete: 'cascade' }),
    pollutant: text('pollutant').$type<PollutantCode>().notNull(),

    /**
     * Concentration in `unit`. **Nullable on purpose and never defaulted.**
     *
     * `NULL` means the analyser reported nothing for this hour. Zero means a
     * measurement of essentially clean air. Collapsing the first into the second
     * would manufacture data, so there is no `.default(0)` here and there never
     * may be.
     */
    value: numeric('value', { mode: 'number', precision: 10, scale: 3 }),
    unit: text('unit').notNull().default('µg/m³'),

    /** Continuous European AQI sub-index in [1, 7). NULL whenever `value` is. */
    subIndex: numeric('sub_index', { mode: 'number', precision: 4, scale: 2 }),
    category: text('category').$type<AirQualityCategory>(),
    averagingPeriod: text('averaging_period').notNull(),

    /** The hour the measurement refers to. */
    measuredAt: instant('measured_at').notNull(),
    /** When maqua.app retrieved it. The gap between the two is the honest "age". */
    fetchedAt: instant('fetched_at').notNull().defaultNow(),

    /** Near-real-time data is unratified and may be revised upstream. */
    provisional: boolean('provisional').notNull().default(true),
    /**
     * Upstream `modelled_<code> === 1`: gap-filled or forecast rather than
     * measured. The only reliable observed-vs-modelled discriminator the feed
     * offers — the wall clock is not one, because past hours are gap-filled too.
     */
    modelled: boolean('modelled').notNull().default(false),

    source: text('source').$type<ProviderSource>().notNull(),

    /**
     * SHA-256 over the canonical value tuple.
     *
     * Ingestion is ON CONFLICT DO NOTHING, so the first observation of an hour
     * is authoritative and a later upstream revision does not silently overwrite
     * history. The checksum is what makes such a revision *detectable* — compare
     * incoming against stored without diffing every column.
     */
    checksum: text('checksum').notNull(),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (t) => [
    /**
     * The idempotency guarantee for ingestion. `source` is part of the key so a
     * fixture backfill and a live EEA fetch can coexist without one masking the
     * other.
     */
    unique('air_quality_readings_unique_observation').on(
      t.stationId,
      t.pollutant,
      t.measuredAt,
      t.source,
    ),
    index('air_quality_readings_station_time_idx').on(t.stationId, t.measuredAt),
    index('air_quality_readings_measured_at_idx').on(t.measuredAt),
    index('air_quality_readings_pollutant_time_idx').on(t.pollutant, t.measuredAt),
  ],
);

/**
 * CAMS forecast points, kept in their own table.
 *
 * Physically separating forecasts from observations is the enforcement of the
 * product rule "never present a forecast as an observation" — a query against
 * `air_quality_readings` cannot accidentally return one.
 */
export const airQualityForecasts = pgTable(
  'air_quality_forecasts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stationId: text('station_id')
      .notNull()
      .references(() => airQualityStations.id, { onDelete: 'cascade' }),
    pollutant: text('pollutant').$type<PollutantCode>().notNull(),
    /** The hour being forecast. */
    validAt: instant('valid_at').notNull(),
    /** The model run that produced it. Two runs may disagree about one hour. */
    issuedAt: instant('issued_at').notNull(),
    value: numeric('value', { mode: 'number', precision: 10, scale: 3 }),
    unit: text('unit').notNull().default('µg/m³'),
    subIndex: numeric('sub_index', { mode: 'number', precision: 4, scale: 2 }),
    category: text('category').$type<AirQualityCategory>(),
    model: text('model').notNull().default('CAMS'),
    source: text('source').$type<ProviderSource>().notNull(),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('air_quality_forecasts_unique_point').on(
      t.stationId,
      t.pollutant,
      t.validAt,
      t.issuedAt,
      t.source,
    ),
    index('air_quality_forecasts_station_valid_idx').on(t.stationId, t.validAt),
  ],
);

/**
 * Weather context for interpreting a reading (Saharan dust needs southerly wind;
 * an inversion traps NO2). Never used to compute an index.
 */
export const weatherObservations = pgTable(
  'weather_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stationId: text('station_id')
      .notNull()
      .references(() => airQualityStations.id, { onDelete: 'cascade' }),
    observedAt: instant('observed_at').notNull(),
    fetchedAt: instant('fetched_at').notNull().defaultNow(),
    temperatureC: numeric('temperature_c', { mode: 'number', precision: 5, scale: 2 }),
    relativeHumidityPct: numeric('relative_humidity_pct', {
      mode: 'number',
      precision: 5,
      scale: 2,
    }),
    windSpeedMs: numeric('wind_speed_ms', { mode: 'number', precision: 6, scale: 2 }),
    windDirectionDeg: numeric('wind_direction_deg', { mode: 'number', precision: 5, scale: 1 }),
    pressureHpa: numeric('pressure_hpa', { mode: 'number', precision: 7, scale: 2 }),
    precipitationMm: numeric('precipitation_mm', { mode: 'number', precision: 6, scale: 2 }),
    /** Mixing-layer height where the provider offers it; drives dispersion. */
    boundaryLayerM: numeric('boundary_layer_m', { mode: 'number', precision: 7, scale: 1 }),
    source: text('source').notNull(),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('weather_observations_unique_observation').on(t.stationId, t.observedAt, t.source),
    index('weather_observations_station_time_idx').on(t.stationId, t.observedAt),
  ],
);

/* -------------------------------------------------------------------------- */
/*  Environmental context                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Externally reported events that plausibly explain a reading — dust intrusions,
 * fires, major works, fireworks seasons.
 *
 * These are CONTEXT, never evidence. `relevance` and `confidence` are stored so
 * the UI can present a weak signal weakly instead of asserting causation.
 */
export const environmentalEvents = pgTable(
  'environmental_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * Stable hash over (source, canonical title, day). The same story re-crawled
     * from the same feed must update one row rather than accumulate duplicates,
     * so this — not the primary key — is the identity that matters.
     */
    dedupeHash: text('dedupe_hash').notNull(),

    kind: text('kind').notNull(),
    title: text('title').notNull(),
    summary: text('summary'),

    /** How strongly this bears on Maltese air quality. */
    relevance: text('relevance').$type<'high' | 'medium' | 'low'>().notNull(),
    /** 0–1. Extraction confidence, not truth of the event. */
    confidence: numeric('confidence', { mode: 'number', precision: 3, scale: 2 }).notNull(),

    sourceName: text('source_name').notNull(),
    sourceUrl: text('source_url').notNull(),
    publishedAt: instant('published_at'),

    firstSeenAt: instant('first_seen_at').notNull().defaultNow(),
    lastSeenAt: instant('last_seen_at').notNull().defaultNow(),

    latitude: numeric('latitude', { mode: 'number', precision: 9, scale: 6 }),
    longitude: numeric('longitude', { mode: 'number', precision: 9, scale: 6 }),
    affectsIslands: jsonb('affects_islands').$type<Island[]>(),
    relatedPollutants: jsonb('related_pollutants').$type<PollutantCode[]>(),

    /** Raw extraction payload, retained so a classification can be re-audited. */
    detail: jsonb('detail').$type<Record<string, unknown>>(),

    /** Cleared when the event stops being current. Rows are never deleted. */
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    unique('environmental_events_dedupe_hash_key').on(t.dedupeHash),
    index('environmental_events_relevance_idx').on(t.relevance, t.lastSeenAt),
    index('environmental_events_last_seen_idx').on(t.lastSeenAt),
  ],
);

/* -------------------------------------------------------------------------- */
/*  AI                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Cached model output.
 *
 * Keyed by a hash of the INPUT DATA, not by request: identical readings must
 * never trigger a second billed call. AI explains only — no number in this table
 * is ever read back as a measurement.
 */
export const aiSummaries = pgTable(
  'ai_summaries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').$type<'station' | 'malta' | 'weekly' | 'event'>().notNull(),
    /** Station id, `malta`, or an event id. */
    scopeKey: text('scope_key').notNull(),
    inputHash: text('input_hash').notNull(),
    locale: text('locale').notNull().default('en'),
    model: text('model').notNull(),
    /** Bumped whenever the prompt changes, so old text is not reused under new rules. */
    promptVersion: text('prompt_version').notNull(),
    body: text('body').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    createdAt: instant('created_at').notNull().defaultNow(),
    expiresAt: instant('expires_at'),
  },
  (t) => [
    unique('ai_summaries_unique_input').on(t.kind, t.scopeKey, t.inputHash, t.locale),
    index('ai_summaries_scope_idx').on(t.kind, t.scopeKey, t.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/*  Alerts                                                                    */
/* -------------------------------------------------------------------------- */

/** Alert families a subscriber can opt into. */
export const ALERT_TYPES = ['air-quality', 'improvement', 'weekly-summary'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

/**
 * Preferences requested but not yet consented to.
 *
 * Held apart from the live columns because a subscribe request proves only that
 * *somebody* typed an address, not that its owner did. Applying preferences —
 * or resuming a cancelled subscription — straight from the request would let
 * anyone who knows an address alter, or restart, that person's mail. They move
 * into the live columns only when the confirmation link is followed.
 */
export type PendingSubscriptionPreferences = {
  alertTypes: AlertType[];
  stationId: string | null;
  pollutant: PollutantCode | null;
  thresholdCategory: AirQualityCategory | null;
  minHoursBetweenAlerts: number;
  locale: string;
};

/**
 * A double opt-in email subscription. One row per address.
 *
 * Only token HASHES are stored. A dump of this table therefore yields no working
 * confirmation or unsubscribe link — the raw tokens exist only in the emails
 * that were sent.
 */
export const alertSubscriptions = pgTable(
  'alert_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** As typed, for display in the email. */
    email: text('email').notNull(),
    /** Lower-cased and trimmed. The identity column — uniqueness is enforced here. */
    emailNormalised: text('email_normalised').notNull(),

    /** False until the confirmation link is followed. Nothing is ever sent to an
     *  unverified address except the single confirmation message. */
    verified: boolean('verified').notNull().default(false),
    verifiedAt: instant('verified_at'),

    confirmationTokenHash: text('confirmation_token_hash'),
    confirmationSentAt: instant('confirmation_sent_at'),
    confirmationExpiresAt: instant('confirmation_expires_at'),

    /** Never expires: an unsubscribe link must work years after it was sent. */
    unsubscribeTokenHash: text('unsubscribe_token_hash').notNull(),

    alertTypes: jsonb('alert_types').$type<AlertType[]>().notNull(),

    /** Requested changes awaiting confirmation. See the type's note. */
    pendingPreferences: jsonb('pending_preferences').$type<PendingSubscriptionPreferences>(),

    /** NULL means "anywhere in the Maltese islands". */
    stationId: text('station_id').references(() => airQualityStations.id, {
      onDelete: 'set null',
    }),
    /** NULL means "whichever pollutant is driving the index". */
    pollutant: text('pollutant').$type<PollutantCode>(),
    /** Lowest category that triggers a message. Defaults applied in code, not SQL. */
    thresholdCategory: text('threshold_category').$type<AirQualityCategory>(),

    /** Anti-flap floor, in hours, between two messages to this subscriber. */
    minHoursBetweenAlerts: integer('min_hours_between_alerts').notNull().default(6),

    locale: text('locale').notNull().default('en'),
    paused: boolean('paused').notNull().default(false),

    lastAlertAt: instant('last_alert_at'),
    /**
     * The state signature of the last message sent — `kind:station:pollutant:category`.
     * While this is unchanged the episode is unchanged, so nothing re-sends. It
     * is cleared when air quality recovers, which is what re-arms the alert.
     */
    lastAlertSignature: text('last_alert_signature'),

    /** Set instead of deleting the row, so an unsubscribe cannot be undone by a
     *  replayed subscribe request and remains auditable. */
    unsubscribedAt: instant('unsubscribed_at'),

    createdAt: instant('created_at').notNull().defaultNow(),
    updatedAt: instant('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('alert_subscriptions_email_key').on(t.emailNormalised),
    index('alert_subscriptions_due_idx').on(t.verified, t.paused, t.unsubscribedAt),
    index('alert_subscriptions_confirmation_idx').on(t.confirmationTokenHash),
    index('alert_subscriptions_unsubscribe_idx').on(t.unsubscribeTokenHash),
  ],
);

/**
 * One row per attempted message. The audit trail, and the second half of the
 * deduplication guarantee.
 */
export const alertDeliveries = pgTable(
  'alert_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => alertSubscriptions.id, { onDelete: 'cascade' }),
    kind: text('kind')
      .$type<'confirmation' | 'air-quality' | 'improvement' | 'weekly-summary'>()
      .notNull(),

    /**
     * Delivery signature — the state signature plus the triggering hour.
     *
     * Distinct from `alertSubscriptions.lastAlertSignature` on purpose. That one
     * answers "is this the same ongoing episode?"; this one answers "have we
     * already sent exactly this message?", so a cron retry inside the same hour
     * is rejected by the unique index below rather than by application logic.
     */
    signature: text('signature').notNull(),

    stationId: text('station_id'),
    pollutant: text('pollutant').$type<PollutantCode>(),
    category: text('category').$type<AirQualityCategory>(),
    measuredAt: instant('measured_at'),
    /** True when the trigger was modelled/forecast rather than measured. The
     *  email must say so. */
    forecast: boolean('forecast').notNull().default(false),

    status: text('status').$type<'queued' | 'sent' | 'failed' | 'skipped'>().notNull(),
    providerMessageId: text('provider_message_id'),
    error: text('error'),

    createdAt: instant('created_at').notNull().defaultNow(),
    sentAt: instant('sent_at'),
  },
  (t) => [
    unique('alert_deliveries_unique_signature').on(t.subscriptionId, t.signature),
    index('alert_deliveries_subscription_idx').on(t.subscriptionId, t.createdAt),
    index('alert_deliveries_status_idx').on(t.status, t.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/*  Operations                                                                */
/* -------------------------------------------------------------------------- */

/** Upstream reachability samples, so `/api/health` can report a trend rather
 *  than one lucky or unlucky probe. */
export const providerHealth = pgTable(
  'provider_health',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    checkedAt: instant('checked_at').notNull().defaultNow(),
    ok: boolean('ok').notNull(),
    statusCode: integer('status_code'),
    latencyMs: integer('latency_ms'),
    /** Message only. Never a URL with credentials, never a response body. */
    error: text('error'),
    detail: jsonb('detail').$type<Record<string, unknown>>(),
  },
  (t) => [index('provider_health_provider_time_idx').on(t.provider, t.checkedAt)],
);

/** One row per ingestion job invocation — what ran, what it wrote, what it skipped. */
export const dataImportRuns = pgTable(
  'data_import_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    job: text('job').notNull(),
    source: text('source'),
    startedAt: instant('started_at').notNull().defaultNow(),
    finishedAt: instant('finished_at'),
    ok: boolean('ok'),
    rowsRead: integer('rows_read').notNull().default(0),
    rowsWritten: integer('rows_written').notNull().default(0),
    /** Rows the unique constraint rejected as already known. Expected, not an error. */
    rowsSkipped: integer('rows_skipped').notNull().default(0),
    error: text('error'),
    detail: jsonb('detail').$type<Record<string, unknown>>(),
  },
  (t) => [index('data_import_runs_job_time_idx').on(t.job, t.startedAt)],
);

/* -------------------------------------------------------------------------- */
/*  Inferred row types                                                        */
/* -------------------------------------------------------------------------- */

export type AirQualityStationRow = typeof airQualityStations.$inferSelect;
export type NewAirQualityStationRow = typeof airQualityStations.$inferInsert;
export type AirQualityReadingRow = typeof airQualityReadings.$inferSelect;
export type NewAirQualityReadingRow = typeof airQualityReadings.$inferInsert;
export type AirQualityForecastRow = typeof airQualityForecasts.$inferSelect;
export type NewAirQualityForecastRow = typeof airQualityForecasts.$inferInsert;
export type WeatherObservationRow = typeof weatherObservations.$inferSelect;
export type NewWeatherObservationRow = typeof weatherObservations.$inferInsert;
export type EnvironmentalEventRow = typeof environmentalEvents.$inferSelect;
export type NewEnvironmentalEventRow = typeof environmentalEvents.$inferInsert;
export type AiSummaryRow = typeof aiSummaries.$inferSelect;
export type NewAiSummaryRow = typeof aiSummaries.$inferInsert;
export type AlertSubscriptionRow = typeof alertSubscriptions.$inferSelect;
export type NewAlertSubscriptionRow = typeof alertSubscriptions.$inferInsert;
export type AlertDeliveryRow = typeof alertDeliveries.$inferSelect;
export type NewAlertDeliveryRow = typeof alertDeliveries.$inferInsert;
export type ProviderHealthRow = typeof providerHealth.$inferSelect;
export type NewProviderHealthRow = typeof providerHealth.$inferInsert;
export type DataImportRunRow = typeof dataImportRuns.$inferSelect;
export type NewDataImportRunRow = typeof dataImportRuns.$inferInsert;
