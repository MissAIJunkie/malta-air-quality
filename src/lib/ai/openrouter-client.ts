/**
 * OpenRouter transport.
 *
 * Server-only, and the only place in the application that holds the API key or
 * opens a socket to a model. Every call is bounded, every failure is typed, and
 * no failure is ever allowed to reach a user as an error page — callers degrade
 * to deterministic prose instead.
 *
 * Three behaviours are load-bearing:
 *
 *   - ONE deadline for the whole operation. Per-attempt timeouts look equivalent
 *     but stack: three retries plus a fallback model at 15 s each is 60 s of a
 *     user staring at a spinner. Attempts share a single budget and the last one
 *     gets whatever is left.
 *   - Retries are strictly for TRANSIENT faults — 429, 5xx, network, timeout. A
 *     response that arrived intact but malformed is a different fault: repeating
 *     the same request to the same model will produce the same malformed answer
 *     and bill for it twice.
 *   - A circuit breaker. When the model endpoint is down, continuing to send
 *     requests turns a degraded feature into a slow site. After repeated
 *     failures the breaker opens and calls fail instantly until a cooldown lets
 *     one trial request through.
 */

import 'server-only';

import { getEnv, getCapabilities } from '@/config/env';
import {
  OPENROUTER_COMPLETIONS_URL,
  OPENROUTER_RESILIENCE,
  getOpenRouterConfig,
} from '@/config/openrouter';
import { assertAllowedUrl } from '@/lib/security/allowlist';
import { logger } from '@/lib/monitoring/logger';
import { chatCompletionErrorSchema, chatCompletionSchema } from './schemas';
import type { PromptMessage } from './prompts';

/* -------------------------------------------------------------------------- */
/*  Errors                                                                    */
/* -------------------------------------------------------------------------- */

export type OpenRouterErrorCode =
  'not-configured' | 'circuit-open' | 'network' | 'timeout' | 'http' | 'malformed' | 'rejected';

export class OpenRouterError extends Error {
  readonly code: OpenRouterErrorCode;
  /** Safe to repeat the identical request. */
  readonly retryable: boolean;
  /**
   * Repeating is pointless on ANY model — a bad key, no credit, a refused
   * request. Stops the fallback model from burning a second call on a fault
   * that is ours, not the vendor's.
   */
  readonly fatal: boolean;
  readonly status?: number;

  constructor(
    message: string,
    options: {
      code: OpenRouterErrorCode;
      retryable?: boolean;
      fatal?: boolean;
      status?: number;
    },
  ) {
    super(message);
    this.name = 'OpenRouterError';
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.fatal = options.fatal ?? false;
    this.status = options.status;
  }
}

/* -------------------------------------------------------------------------- */
/*  Circuit breaker                                                           */
/* -------------------------------------------------------------------------- */

type BreakerState = {
  consecutiveFailures: number;
  /** Epoch ms the breaker opened. `null` while closed. */
  openedAt: number | null;
  /** A trial request is in flight after cooldown. */
  halfOpen: boolean;
};

// Module-level, so it is per-instance. In a serverless deployment that means
// each warm instance learns independently, which is the right granularity: a
// shared breaker in Redis would let one instance's network fault disable AI
// everywhere, and Redis is optional anyway.
const breaker: BreakerState = { consecutiveFailures: 0, openedAt: null, halfOpen: false };

export type CircuitStatus = {
  state: 'closed' | 'open' | 'half-open';
  consecutiveFailures: number;
  /** Epoch ms when the breaker will next admit a trial request. */
  retryAt: number | null;
};

export function getCircuitStatus(): CircuitStatus {
  if (breaker.openedAt === null) {
    return { state: 'closed', consecutiveFailures: breaker.consecutiveFailures, retryAt: null };
  }
  const retryAt = breaker.openedAt + OPENROUTER_RESILIENCE.circuitCooldownMs;
  // Once the cooldown has elapsed the breaker is effectively half-open even
  // though no request has arrived to flip the flag. Reporting it as still open
  // would have a health endpoint announce an outage that has already expired.
  const cooledDown = Date.now() >= retryAt;

  return {
    state: breaker.halfOpen || cooledDown ? 'half-open' : 'open',
    consecutiveFailures: breaker.consecutiveFailures,
    retryAt,
  };
}

/** Test hook, and the manual reset an operator would want after a fix. */
export function resetCircuitBreaker(): void {
  breaker.consecutiveFailures = 0;
  breaker.openedAt = null;
  breaker.halfOpen = false;
}

function assertCircuitClosed(): void {
  if (breaker.openedAt === null) return;

  const elapsed = Date.now() - breaker.openedAt;
  if (elapsed < OPENROUTER_RESILIENCE.circuitCooldownMs) {
    throw new OpenRouterError('AI endpoint circuit is open', {
      code: 'circuit-open',
      fatal: true,
    });
  }

  // Cooldown elapsed: admit one trial request. A failure re-opens immediately
  // rather than spending another full run of retries proving the same point.
  breaker.halfOpen = true;
}

function recordSuccess(): void {
  if (breaker.openedAt !== null || breaker.consecutiveFailures > 0) {
    logger.info('ai.circuit_closed', { previousFailures: breaker.consecutiveFailures });
  }
  resetCircuitBreaker();
}

function recordFailure(): void {
  if (breaker.halfOpen) {
    breaker.halfOpen = false;
    breaker.openedAt = Date.now();
    logger.warn('ai.circuit_reopened', { consecutiveFailures: breaker.consecutiveFailures });
    return;
  }

  breaker.consecutiveFailures += 1;
  if (
    breaker.openedAt === null &&
    breaker.consecutiveFailures >= OPENROUTER_RESILIENCE.circuitFailureThreshold
  ) {
    breaker.openedAt = Date.now();
    logger.warn('ai.circuit_opened', {
      consecutiveFailures: breaker.consecutiveFailures,
      cooldownMs: OPENROUTER_RESILIENCE.circuitCooldownMs,
    });
  }
}

/* -------------------------------------------------------------------------- */
/*  Classification                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Map an HTTP status onto retry semantics.
 *
 * 401/402/403 are ours to fix — a wrong key, an empty balance, a blocked
 * account — and no amount of retrying or model-switching helps.
 * 404 means the configured model no longer exists at OpenRouter, which the
 * fallback model can genuinely rescue, so it is fatal to the attempt but not to
 * the operation.
 */
function classifyStatus(status: number): { retryable: boolean; fatal: boolean } {
  if (status === 429) return { retryable: true, fatal: false };
  if (status >= 500) return { retryable: true, fatal: false };
  if (status === 401 || status === 402 || status === 403) return { retryable: false, fatal: true };
  return { retryable: false, fatal: false };
}

function backoffDelay(attempt: number): number {
  const exponential = OPENROUTER_RESILIENCE.backoffBaseMs * 2 ** (attempt - 1);
  const capped = Math.min(exponential, OPENROUTER_RESILIENCE.backoffMaxMs);
  // Jitter keeps several instances recovering from one outage from synchronising
  // into a thundering herd.
  return capped + Math.floor(Math.random() * 250);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* -------------------------------------------------------------------------- */
/*  Transport                                                                 */
/* -------------------------------------------------------------------------- */

export type CompletionRequest = {
  messages: PromptMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Ask the vendor to constrain output to a JSON object where supported. */
  jsonOutput?: boolean;
  /** Tags the log lines so one feature's failures are separable from another's. */
  purpose?: string;
};

export type CompletionResult = {
  /** Raw assistant text. Never trusted — hand it to `validate.ts`. */
  content: string;
  /** Model that actually answered, which may be the fallback. */
  model: string;
  usedFallbackModel: boolean;
  attempts: number;
  durationMs: number;
};

export function isAiConfigured(): boolean {
  return getCapabilities().ai;
}

async function sendOnce(
  model: string,
  request: CompletionRequest,
  budgetMs: number,
): Promise<string> {
  const config = getOpenRouterConfig();
  const apiKey = getEnv().OPENROUTER_API_KEY;
  // Re-checked here rather than trusted from the caller: this is the last line
  // before the network, and an unauthenticated request would still be sent.
  if (!apiKey) {
    throw new OpenRouterError('OPENROUTER_API_KEY is not set', {
      code: 'not-configured',
      fatal: true,
    });
  }

  // Routed through the SSRF allowlist like every other outbound call, so the
  // endpoint cannot be quietly repointed by configuration.
  const url = assertAllowedUrl(OPENROUTER_COMPLETIONS_URL);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, budgetMs));

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        // OpenRouter attribution headers. Public information about the app, not
        // about the person asking — no request headers are ever forwarded.
        'HTTP-Referer': config.siteUrl,
        'X-Title': config.appName,
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        max_tokens: request.maxTokens ?? config.maxTokens,
        temperature: request.temperature ?? config.temperature,
        ...(request.jsonOutput === false ? {} : { response_format: { type: 'json_object' } }),
      }),
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new OpenRouterError('AI request exceeded its time budget', {
        code: 'timeout',
        retryable: true,
      });
    }
    throw new OpenRouterError(`AI request failed: ${String(error)}`, {
      code: 'network',
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const { retryable, fatal } = classifyStatus(response.status);
    // The body is read and discarded: it can echo prompt content, and prompt
    // content must never reach a log.
    await response.text().catch(() => '');
    throw new OpenRouterError(`AI request returned HTTP ${response.status}`, {
      code: 'http',
      status: response.status,
      retryable,
      fatal,
    });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new OpenRouterError('AI response was not JSON', { code: 'malformed' });
  }

  // OpenRouter reports some vendor failures in the body with HTTP 200.
  const asError = chatCompletionErrorSchema.safeParse(body);
  if (asError.success) {
    const rawCode = asError.data.error.code;
    const status = typeof rawCode === 'number' ? rawCode : undefined;
    const classified = status ? classifyStatus(status) : { retryable: false, fatal: false };
    throw new OpenRouterError('AI provider reported an error', {
      code: 'http',
      status,
      ...classified,
    });
  }

  const parsed = chatCompletionSchema.safeParse(body);
  if (!parsed.success) {
    throw new OpenRouterError('AI response did not match the completion shape', {
      code: 'malformed',
    });
  }

  const choice = parsed.data.choices[0];
  const content = choice?.message.content?.trim();
  if (!content) {
    throw new OpenRouterError('AI response contained no content', { code: 'malformed' });
  }

  // Truncated output is structurally certain to fail JSON parsing downstream.
  // Naming it here makes the log say why, instead of "invalid JSON".
  if (choice?.finish_reason === 'length') {
    throw new OpenRouterError('AI response was truncated by the token limit', {
      code: 'malformed',
    });
  }

  return content;
}

/**
 * Request a completion, with retries, a single fallback model, and one deadline.
 *
 * Model order is: the configured default (up to `maxAttempts` tries, transient
 * faults only) then the fallback model (exactly one try). The fallback is
 * reached both when the primary exhausts its retries and when it fails
 * non-transiently — a vendor returning malformed responses is precisely when a
 * second vendor is worth having. It is NOT reached for fatal faults, where the
 * problem is our credential or our balance.
 */
export async function requestCompletion(request: CompletionRequest): Promise<CompletionResult> {
  const config = getOpenRouterConfig();
  const startedAt = Date.now();
  const deadlineAt = startedAt + config.timeoutMs;
  const purpose = request.purpose ?? 'unspecified';

  if (!getEnv().OPENROUTER_API_KEY) {
    throw new OpenRouterError('OPENROUTER_API_KEY is not set', {
      code: 'not-configured',
      fatal: true,
    });
  }

  assertCircuitClosed();

  const models = [config.defaultModel, config.fallbackModel];
  let attempts = 0;
  let lastError: OpenRouterError = new OpenRouterError('AI request was never attempted', {
    code: 'network',
  });

  for (const [modelIndex, model] of models.entries()) {
    // The fallback model gets exactly one attempt: it exists to survive a vendor
    // outage, not to double the retry budget.
    const maxAttempts = modelIndex === 0 ? OPENROUTER_RESILIENCE.maxAttempts : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) {
        lastError = new OpenRouterError('AI request exceeded its time budget', {
          code: 'timeout',
          retryable: false,
        });
        recordFailure();
        throw lastError;
      }

      attempts += 1;
      try {
        const content = await sendOnce(model, request, remaining);
        recordSuccess();

        logger.info('ai.completion', {
          purpose,
          model,
          attempts,
          usedFallbackModel: modelIndex > 0,
          durationMs: Date.now() - startedAt,
        });

        return {
          content,
          model,
          usedFallbackModel: modelIndex > 0,
          attempts,
          durationMs: Date.now() - startedAt,
        };
      } catch (error) {
        lastError =
          error instanceof OpenRouterError
            ? error
            : new OpenRouterError(String(error), { code: 'network', retryable: true });

        logger.warn('ai.attempt_failed', {
          purpose,
          model,
          attempt,
          code: lastError.code,
          status: lastError.status,
          retryable: lastError.retryable,
        });

        if (lastError.fatal) {
          recordFailure();
          throw lastError;
        }

        // Malformed-but-delivered responses fall through to the next MODEL
        // without being retried on this one.
        if (!lastError.retryable) break;

        if (attempt < maxAttempts) {
          const wait = Math.min(backoffDelay(attempt), Math.max(0, deadlineAt - Date.now()));
          if (wait <= 0) break;
          await delay(wait);
        }
      }
    }
  }

  recordFailure();
  logger.error('ai.completion_failed', {
    purpose,
    attempts,
    code: lastError.code,
    status: lastError.status,
    durationMs: Date.now() - startedAt,
  });

  throw lastError;
}
