/**
 * OpenRouter configuration.
 *
 * maqua.app talks to exactly one AI endpoint — OpenRouter — and never to a model
 * vendor directly. That keeps one credential, one allowlisted host
 * (`openrouter.ai`, see `lib/security/allowlist.ts`) and one place to change a
 * model.
 *
 * Every model identifier in the application lives here. A model name written
 * anywhere else would silently escape the fallback chain and the cache key, so
 * the rule is absolute: no string like `openai/…` outside this file.
 *
 * Deliberately contains NO credential. The API key is read only inside
 * `lib/ai/openrouter-client.ts`, which is `server-only`, so importing this
 * module from a client component can never leak a secret.
 */

import { getEnv } from './env';

/** Chat-completions endpoint. Host must stay on the outbound allowlist. */
export const OPENROUTER_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Prompt contract version.
 *
 * Bump whenever the prompt text, the requested JSON shape, or the meaning of a
 * field changes. It is part of the explanation cache key, so a bump invalidates
 * every cached explanation instead of mixing outputs from two different
 * contracts — which is what would otherwise happen, invisibly.
 */
export const PROMPT_VERSION = '2026-07-26.1';

/** Shipped defaults, overridable by environment. */
export const OPENROUTER_DEFAULTS = {
  /**
   * Small, fast, inexpensive, and reliable at JSON-shaped output. The task is
   * explanation of already-computed numbers, not reasoning, so a frontier model
   * buys nothing here.
   */
  model: 'openai/gpt-4.1-mini',
  /** Different vendor on purpose: a single vendor outage must not disable AI. */
  fallbackModel: 'google/gemini-2.5-flash',
  maxTokens: 700,
  /**
   * Low but not zero. Zero temperature makes repeated near-identical inputs
   * produce lockstep phrasing that reads mechanical; the cache, not the sampler,
   * is what guarantees identical inputs cost one call.
   */
  temperature: 0.2,
} as const;

/** Transient-failure handling. Shared by the client and its circuit breaker. */
export const OPENROUTER_RESILIENCE = {
  /** Attempts on the primary model, including the first. */
  maxAttempts: 3,
  /** First backoff step, doubled per retry, with jitter. */
  backoffBaseMs: 400,
  backoffMaxMs: 4_000,
  /** Consecutive failures that trip the breaker open. */
  circuitFailureThreshold: 4,
  /** How long the breaker stays open before a single trial request. */
  circuitCooldownMs: 60_000,
} as const;

export type OpenRouterConfig = {
  defaultModel: string;
  fallbackModel: string;
  /** Sent as `HTTP-Referer`; OpenRouter uses it for attribution. */
  siteUrl: string;
  /** Sent as `X-Title`. */
  appName: string;
  /** Budget for the WHOLE operation, retries and fallback model included. */
  timeoutMs: number;
  maxTokens: number;
  temperature: number;
  promptVersion: string;
};

/**
 * Resolve configuration from the environment.
 *
 * A function rather than a frozen constant so tests can vary the environment,
 * and so an import of this module never runs before `getEnv()` is safe to call.
 */
export function getOpenRouterConfig(): OpenRouterConfig {
  const env = getEnv();

  return {
    defaultModel: process.env.OPENROUTER_MODEL ?? OPENROUTER_DEFAULTS.model,
    fallbackModel: process.env.OPENROUTER_FALLBACK_MODEL ?? OPENROUTER_DEFAULTS.fallbackModel,
    siteUrl: env.OPENROUTER_SITE_URL,
    appName: env.OPENROUTER_APP_NAME,
    timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
    maxTokens: OPENROUTER_DEFAULTS.maxTokens,
    temperature: OPENROUTER_DEFAULTS.temperature,
    promptVersion: PROMPT_VERSION,
  };
}

/** Seconds a generated explanation stays valid. Drives the AI cache TTL. */
export function getExplanationCacheTtlSeconds(): number {
  return getEnv().AI_CACHE_TTL_SECONDS;
}

/** Model calls permitted per minute across the deployment. */
export function getAiRequestsPerMinute(): number {
  return getEnv().AI_MAX_REQUESTS_PER_MINUTE;
}
