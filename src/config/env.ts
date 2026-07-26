/**
 * Environment configuration.
 *
 * Guiding rule from the brief: the public application must not crash because an
 * OPTIONAL service is unconfigured. Only genuinely required variables are
 * enforced; everything else degrades to a documented, safe default and reports
 * itself as disabled via `/api/health`.
 *
 * Server-only. Never import from a client component — secrets must not reach the
 * browser bundle.
 */

import { z } from 'zod';

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const optionalBoolean = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : v === 'true' || v === '1'));

void booleanish;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  NEXT_PUBLIC_APP_URL: z.string().url().default('https://maqua.app'),

  /** Which air-quality provider answers requests. `eea` is the verified live path. */
  AIR_QUALITY_PROVIDER: z.enum(['eea', 'era', 'fixture']).default('eea'),

  /**
   * Base URL of the EEA AQI dissemination layer.
   *
   * Configurable so a deployment can be repointed without a code change, but it
   * is validated against an allowlist at the fetch boundary (see
   * `lib/security/allowlist.ts`) so it can never become an open proxy.
   */
  EEA_AIR_QUALITY_URL: z
    .string()
    .url()
    .default('https://dis2datalake.blob.core.windows.net/airquality-derivated/AQI-noRunningMeans/'),

  /**
   * ERA direct endpoint. Intentionally empty: no ERA endpoint has ever been
   * observed from this environment (docs/DATA_SOURCE.md §2). The provider
   * refuses to run unless this is explicitly set.
   */
  ERA_AIR_QUALITY_URL: z.string().url().optional(),

  DATABASE_URL: z.string().optional(),
  DATABASE_URL_UNPOOLED: z.string().optional(),

  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().optional(),
  OPENROUTER_FALLBACK_MODEL: z.string().optional(),
  OPENROUTER_SITE_URL: z.string().url().default('https://maqua.app'),
  OPENROUTER_APP_NAME: z.string().default('maqua.app'),

  AI_EXPLANATIONS_ENABLED: optionalBoolean(true),
  AI_CONTEXT_SUMMARIES_ENABLED: optionalBoolean(true),
  AI_MAX_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(30),
  AI_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

  WEATHER_PROVIDER: z.enum(['open-meteo', 'fixture', 'none']).default('open-meteo'),
  CONTEXT_REFRESH_ENABLED: optionalBoolean(true),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('maqua.app <alerts@maqua.app>'),
  EMAIL_REPLY_TO: z.string().optional(),

  CRON_SECRET: z.string().optional(),
  /** Signs unsubscribe tokens. Alerts stay disabled without it. */
  ALERT_TOKEN_SECRET: z.string().optional(),

  SENTRY_DSN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Parse and cache the environment.
 *
 * A malformed REQUIRED variable throws — failing loudly at boot beats serving
 * wrong data. Optional services simply report themselves unconfigured.
 */
export function getEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  cached = parsed.data;
  return cached;
}

/** Test hook — never called in production paths. */
export function resetEnvCache(): void {
  cached = null;
}

/* -------------------------------------------------------------------------- */
/*  Capability flags                                                          */
/* -------------------------------------------------------------------------- */

/**
 * What is actually available in this deployment.
 *
 * Every optional subsystem is gated on its own credentials being present, so a
 * minimal deployment (no database, no Redis, no AI, no email) still serves the
 * map, the station list and the API.
 */
export function getCapabilities() {
  const env = getEnv();
  return {
    database: Boolean(env.DATABASE_URL),
    redis: Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN),
    ai: Boolean(env.OPENROUTER_API_KEY) && env.AI_EXPLANATIONS_ENABLED,
    aiContextSummaries: Boolean(env.OPENROUTER_API_KEY) && env.AI_CONTEXT_SUMMARIES_ENABLED,
    email: Boolean(env.RESEND_API_KEY) && Boolean(env.ALERT_TOKEN_SECRET),
    cron: Boolean(env.CRON_SECRET),
    weather: env.WEATHER_PROVIDER !== 'none',
    monitoring: Boolean(env.SENTRY_DSN),
  } as const;
}

export type Capabilities = ReturnType<typeof getCapabilities>;
