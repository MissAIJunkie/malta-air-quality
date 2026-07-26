/**
 * POST /api/explain
 *
 * A plain-language explanation of one station's current reading.
 *
 * The contract that governs everything below: this endpoint must not fail
 * because AI failed. Disabled, unconfigured, rate-limited, timed out, circuit
 * open, or answering with something the validator refused — every one of those
 * paths returns HTTP 200 with `generated: 'fallback'` and a deterministic
 * explanation built from the same measurements. The only non-200 outcomes are a
 * malformed request, an unknown station, genuine per-IP flooding, and the
 * absence of any reading to explain.
 *
 * The body carries a station id and a locale. It deliberately cannot carry
 * readings, prose or instructions: the server looks the measurements up itself,
 * so a public endpoint can never be used to put words in the model's mouth.
 */

import type { NextRequest } from 'next/server';
import { getCapabilities } from '@/config/env';
import { getOpenRouterConfig } from '@/config/openrouter';
import { findStation } from '@/config/stations';
import { getLatestReadings } from '@/lib/air-quality/service';
import {
  badRequest,
  handleRouteError,
  notFound,
  ok,
  serviceUnavailable,
  tooManyRequests,
} from '@/lib/api/respond';
import { logger } from '@/lib/monitoring/logger';
import { identifierFromHeaders, rateLimit } from '@/lib/security/rate-limit';
import { getOrCreateExplanation } from '@/lib/ai/cache';
import { buildFallbackExplanation } from '@/lib/ai/fallback';
import { requestCompletion } from '@/lib/ai/openrouter-client';
import { buildExplanationPrompt } from '@/lib/ai/prompts';
import { buildExplainInput, type ExplainInput } from '@/lib/ai/redact';
import { explainRequestSchema, type AirQualityExplanation } from '@/lib/ai/schemas';
import { isValidatedLocale, validateExplanation } from '@/lib/ai/validate';

// Node runtime: the AI client and the explanation cache are `server-only` and
// use Node APIs, and nothing here benefits from running at the edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Travels with every explanation.
 *
 * Required verbatim by the product rules, and attached at the API boundary
 * rather than left to each consumer, so no client can render health-adjacent
 * text without having been handed the notice that belongs with it.
 */
const HEALTH_DISCLAIMER =
  'maqua.app provides general environmental information and does not replace medical advice or official emergency guidance.';

type ExplainOutcome = {
  explanation: AirQualityExplanation;
  generated: 'ai' | 'fallback';
  model?: string;
  cached: boolean;
};

/** Raised inside the cache factory so a spent AI budget is never cached. */
class AiBudgetExhaustedError extends Error {
  constructor() {
    super('AI request budget exhausted for this window');
    this.name = 'AiBudgetExhaustedError';
  }
}

/** Raised when model output fails validation. Never cached, never shown. */
class ExplanationRejectedError extends Error {
  constructor(readonly reason: string) {
    super(`Model output rejected: ${reason}`);
    this.name = 'ExplanationRejectedError';
  }
}

function fallbackOutcome(input: ExplainInput): ExplainOutcome {
  return {
    explanation: buildFallbackExplanation(input),
    generated: 'fallback',
    cached: false,
  };
}

/**
 * Produce an explanation, degrading rather than failing.
 *
 * The AI spend budget is consumed INSIDE the cache factory, so a cache hit
 * costs nothing against it — the budget exists to cap model calls, and a served
 * cache entry is not one.
 */
async function explain(input: ExplainInput): Promise<ExplainOutcome> {
  if (!getCapabilities().ai) return fallbackOutcome(input);

  // Output in a language the validator cannot check would be unverified model
  // text on a public-health page. See `validate.ts`.
  if (!isValidatedLocale(input.locale)) return fallbackOutcome(input);

  const config = getOpenRouterConfig();

  try {
    const result = await getOrCreateExplanation(input, config.defaultModel, async () => {
      const budget = await rateLimit('ai/explain', 'global');
      if (!budget.success) throw new AiBudgetExhaustedError();

      const prompt = buildExplanationPrompt(input);
      const completion = await requestCompletion({
        messages: prompt.messages,
        purpose: 'explain',
      });

      const validation = validateExplanation(completion.content, input);
      if (!validation.ok) {
        // The rejection reason is logged, never returned: it quotes model text,
        // and model text that failed validation is exactly what must not be
        // shown to anyone.
        logger.warn('ai.explanation_rejected', {
          station: input.station.id,
          model: completion.model,
          reason: validation.reason,
          detail: validation.detail,
        });
        throw new ExplanationRejectedError(validation.reason);
      }

      return { explanation: validation.value, model: completion.model };
    });

    return {
      explanation: result.explanation,
      generated: 'ai',
      model: result.model,
      cached: result.cached,
    };
  } catch (error) {
    logger.info('ai.explanation_degraded', {
      station: input.station.id,
      reason: error instanceof Error ? error.name : 'unknown',
    });
    return fallbackOutcome(input);
  }
}

export async function POST(request: NextRequest) {
  try {
    // Cheapest gate first: flooding is rejected before a body is read, a station
    // is resolved, or upstream is touched.
    const identifier = identifierFromHeaders(request.headers);
    const gate = await rateLimit('api/explain', identifier);
    if (!gate.success) return tooManyRequests(gate.retryAfterSeconds);

    const body = await request.json().catch(() => null);
    if (body === null || typeof body !== 'object') {
      return badRequest('Expected a JSON object body.');
    }

    const parsed = explainRequestSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body.');
    }

    const station = findStation(parsed.data.stationId);
    if (!station) return notFound(`Unknown station: ${parsed.data.stationId}`);

    const { readings, meta } = await getLatestReadings();
    const reading = readings.find((r) => r.stationId === station.id);
    if (!reading) {
      // Nothing to explain is a data problem, not an AI problem, and inventing
      // prose about a station that reported nothing would be the worst possible
      // answer.
      return serviceUnavailable(`No current reading is available for ${station.name}.`);
    }

    const input = buildExplainInput(reading, { locale: parsed.data.locale ?? 'en' });
    const outcome = await explain(input);

    return ok(
      {
        explanation: outcome.explanation,
        generated: outcome.generated,
        generatedAt: new Date().toISOString(),
        ...(outcome.model ? { model: outcome.model } : {}),
        cached: outcome.cached,
        disclaimer: HEALTH_DISCLAIMER,
      },
      meta,
      // Overrides the shared cache headers: this is a rate-limited POST whose
      // body varies per request, and a shared cache must not hold it.
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return handleRouteError('/api/explain', error);
  }
}
