/**
 * Zod schemas for everything the AI layer emits or accepts.
 *
 * Model output is treated exactly like upstream network data: untrusted, shape
 * unknown until proven. Parsing here is the first gate; `validate.ts` applies
 * the semantic gates (citations, numbers, category agreement) that a schema
 * cannot express.
 *
 * The locale union is redeclared here rather than imported from `lib/i18n`
 * because the AI layer must stay usable — and typecheckable — on its own. It is
 * structurally identical to the application `Locale`.
 */

import { z } from 'zod';

export const EXPLANATION_LOCALES = ['en', 'mt', 'fr'] as const;
export type ExplanationLocale = (typeof EXPLANATION_LOCALES)[number];
export const explanationLocaleSchema = z.enum(EXPLANATION_LOCALES);

/* -------------------------------------------------------------------------- */
/*  Explanation                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Direction a factor is pushing local air quality.
 *
 * `unknown` is a first-class answer, not a failure. Most single-hour readings
 * genuinely carry no directional information, and a model forced to choose
 * between "improving" and "worsening" will invent one.
 */
export const factorImpactSchema = z.enum(['improving', 'worsening', 'mixed', 'unknown']);
export type FactorImpact = z.infer<typeof factorImpactSchema>;

export const factorConfidenceSchema = z.enum(['low', 'medium', 'high']);
export type FactorConfidence = z.infer<typeof factorConfidenceSchema>;

export const contributingFactorSchema = z.object({
  label: z.string().trim().min(3).max(180),
  impact: factorImpactSchema,
  confidence: factorConfidenceSchema,
});

export type ContributingFactor = z.infer<typeof contributingFactorSchema>;

/**
 * The explanation contract.
 *
 * Lengths are bounded on both sides: too short is an empty gesture, too long
 * overruns the card it is rendered in and invites the model to pad with
 * generalities. Unknown keys are stripped rather than rejected, so a model that
 * helpfully adds `"notes"` still produces a usable explanation.
 */
export const airQualityExplanationSchema = z.object({
  headline: z.string().trim().min(3).max(140),
  summary: z.string().trim().min(20).max(1200),
  contributingFactors: z.array(contributingFactorSchema).max(5),
  /** What this explanation cannot tell you. Required — never optional. */
  uncertainty: z.string().trim().min(3).max(500),
  /** Must be a subset of the ids supplied in the input. Enforced in `validate.ts`. */
  sourceIds: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
});

export type AirQualityExplanation = z.infer<typeof airQualityExplanationSchema>;

/* -------------------------------------------------------------------------- */
/*  Context events                                                            */
/* -------------------------------------------------------------------------- */

export const contextEventKindSchema = z.enum([
  'weather',
  'saharan-dust',
  'wildfire-smoke',
  'sea-breeze',
  'temperature-inversion',
  'fireworks',
  'maritime',
  'roadworks',
  'other',
]);

export type ContextEventKind = z.infer<typeof contextEventKindSchema>;

/**
 * An external happening that may help explain a reading.
 *
 * Defined here so the AI layer compiles and runs with no producer wired in;
 * `buildExplainInput()` defaults to an empty list. Every text field is
 * redacted and delimiter-stripped before it reaches a prompt — events originate
 * outside maqua.app and are therefore hostile input by default.
 */
export const contextEventSchema = z.object({
  id: z.string().trim().min(1).max(80),
  kind: contextEventKindSchema,
  headline: z.string().trim().min(3).max(200),
  detail: z.string().trim().max(1000).optional(),
  /** ISO-8601 UTC. */
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  sourceName: z.string().trim().min(1).max(120),
  sourceUrl: z.string().url().optional(),
  /** Stations the event plausibly affects. Empty means island-wide. */
  stationIds: z.array(z.string().trim().min(1).max(32)).max(10).optional(),
});

export type ContextEvent = z.infer<typeof contextEventSchema>;

/* -------------------------------------------------------------------------- */
/*  Event summary                                                             */
/* -------------------------------------------------------------------------- */

export const eventRelevanceSchema = z.enum(['low', 'medium', 'high']);
export type EventRelevance = z.infer<typeof eventRelevanceSchema>;

/**
 * A short, cited summary of what is happening around the islands.
 *
 * `airQualityLink` is where a model is most tempted to assert causation from
 * coincidence, so it is a separate, explicitly hedged field rather than being
 * folded into the summary prose.
 */
export const eventSummarySchema = z.object({
  headline: z.string().trim().min(3).max(140),
  summary: z.string().trim().min(20).max(900),
  relevance: eventRelevanceSchema,
  airQualityLink: z.string().trim().min(3).max(400),
  affectedStationIds: z.array(z.string().trim().min(1).max(32)).max(5),
  sourceIds: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
});

export type EventSummary = z.infer<typeof eventSummarySchema>;

/* -------------------------------------------------------------------------- */
/*  Request bodies                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Body of `POST /api/explain`.
 *
 * Carries an identifier and a locale — nothing else. The server looks the
 * reading up itself. Accepting client-supplied concentrations or free text
 * would let anyone dictate what the model is told about Malta's air, and would
 * turn a public endpoint into an open prompt relay.
 */
export const explainRequestSchema = z.object({
  /** Station slug (`msida`) or upstream code (`MT00011`). */
  stationId: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9-]+$/, 'stationId may contain only letters, digits and hyphens'),
  locale: explanationLocaleSchema.optional(),
});

export type ExplainRequest = z.infer<typeof explainRequestSchema>;

/* -------------------------------------------------------------------------- */
/*  Model transport                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The slice of an OpenAI-compatible chat completion we actually read.
 *
 * Permissive about everything else: OpenRouter normalises across many vendors
 * and adds fields freely, and a new one must not fail a request.
 */
export const chatCompletionSchema = z
  .object({
    model: z.string().optional(),
    choices: z
      .array(
        z
          .object({
            message: z
              .object({
                content: z.string().nullish(),
              })
              .loose(),
            finish_reason: z.string().nullish(),
          })
          .loose(),
      )
      .min(1),
  })
  .loose();

/** OpenRouter reports vendor failures in the body, sometimes with HTTP 200. */
export const chatCompletionErrorSchema = z
  .object({
    error: z
      .object({
        message: z.string().optional(),
        code: z.union([z.string(), z.number()]).optional(),
      })
      .loose(),
  })
  .loose();
