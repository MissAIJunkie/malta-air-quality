import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getCapabilities, getEnv, resetEnvCache } from '@/config/env';

/**
 * The documented setup path has to work.
 *
 * `.env.example` ships every optional key with an empty value and the README
 * tells people to copy it, so `UPSTASH_REDIS_REST_URL=''` is the NORMAL state,
 * not an edge case. An empty string is not `undefined`, so a naive
 * `.url().optional()` rejects it and the app refuses to boot over a service
 * nobody configured. These tests pin the behaviour that stops that recurring.
 */

const TOUCHED = [
  'AIR_QUALITY_PROVIDER',
  'DATABASE_URL',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'OPENROUTER_API_KEY',
  'RESEND_API_KEY',
  'ALERT_TOKEN_SECRET',
  'CRON_SECRET',
  'SENTRY_DSN',
  'NEXT_PUBLIC_APP_URL',
  'EEA_AIR_QUALITY_URL',
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));
  for (const key of TOUCHED) delete process.env[key];
  resetEnvCache();
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvCache();
});

describe('environment parsing', () => {
  it('boots with nothing set at all', () => {
    expect(() => getEnv()).not.toThrow();
    expect(getEnv().AIR_QUALITY_PROVIDER).toBe('eea');
  });

  it('treats an empty optional URL as unset rather than as a malformed URL', () => {
    // Exactly what copying .env.example produces.
    process.env.UPSTASH_REDIS_REST_URL = '';
    process.env.UPSTASH_REDIS_REST_TOKEN = '';
    process.env.SENTRY_DSN = '';

    expect(() => getEnv()).not.toThrow();
    expect(getEnv().UPSTASH_REDIS_REST_URL).toBeUndefined();
  });

  it('boots with every optional key present but empty', () => {
    for (const key of TOUCHED) process.env[key] = '';
    expect(() => getEnv()).not.toThrow();
  });

  it('reports optional subsystems as unavailable when they are empty', () => {
    for (const key of TOUCHED) process.env[key] = '';
    const capabilities = getCapabilities();

    expect(capabilities.database).toBe(false);
    expect(capabilities.redis).toBe(false);
    expect(capabilities.ai).toBe(false);
    expect(capabilities.email).toBe(false);
    expect(capabilities.cron).toBe(false);
  });

  it('still enables a subsystem that is genuinely configured', () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db';

    const capabilities = getCapabilities();
    expect(capabilities.redis).toBe(true);
    expect(capabilities.database).toBe(true);
  });

  it('still rejects a value that is present and genuinely malformed', () => {
    // Silence is only for absence. A typo must still fail loudly.
    process.env.UPSTASH_REDIS_REST_URL = 'not-a-url';
    expect(() => getEnv()).toThrow(/Invalid environment configuration/);
  });

  it('rejects an unknown provider rather than falling back silently', () => {
    process.env.AIR_QUALITY_PROVIDER = 'guesswork';
    expect(() => getEnv()).toThrow(/Invalid environment configuration/);
  });
});
