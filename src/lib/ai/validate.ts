/**
 * Semantic validation of model output.
 *
 * The schema in `schemas.ts` proves the shape. This file proves the CONTENT is
 * consistent with the measurements the model was given — which is the part that
 * actually matters, because a fabricated concentration is perfectly
 * schema-valid.
 *
 * The design assumption is that rejection is cheap and wrong output is not.
 * `fallback.ts` produces a genuinely useful explanation from the same data, so
 * a false rejection costs a little polish and nothing else. Every check below is
 * therefore biased towards rejecting.
 *
 * Nothing here is a substitute for the prompt rules; both exist because a prompt
 * is a request and a validator is a guarantee.
 */

import { POLLUTANTS, type PollutantCode } from '@/config/pollutants';
import { AIR_QUALITY_CATEGORIES, type AirQualityCategory } from '@/config/thresholds';
import {
  airQualityExplanationSchema,
  eventSummarySchema,
  type AirQualityExplanation,
  type EventSummary,
  type ExplanationLocale,
} from './schemas';
import type { ExplainInput, ExplainPollutantFact } from './redact';

/* -------------------------------------------------------------------------- */
/*  Result type                                                               */
/* -------------------------------------------------------------------------- */

export type RejectionReason =
  | 'unparseable'
  | 'schema'
  | 'unknown-source'
  | 'fabricated-number'
  | 'value-for-missing-pollutant'
  | 'category-contradiction'
  | 'medical-claim'
  | 'legal-claim'
  | 'overclaimed-certainty'
  | 'forecast-claim';

export type ValidationResult<T> =
  { ok: true; value: T } | { ok: false; reason: RejectionReason; detail: string };

/**
 * Locales whose output can actually be checked.
 *
 * Every pattern below is English. Accepting French or Maltese output would mean
 * shipping unvalidated model text, so those locales take the deterministic
 * fallback until the corresponding pattern sets exist. Being useful in one
 * language beats being unchecked in three.
 */
export const VALIDATED_EXPLANATION_LOCALES: readonly ExplanationLocale[] = ['en'];

export function isValidatedLocale(locale: ExplanationLocale): boolean {
  return VALIDATED_EXPLANATION_LOCALES.includes(locale);
}

/* -------------------------------------------------------------------------- */
/*  Pattern sets                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Personal medical territory.
 *
 * The line is between general precaution ("people with asthma may prefer to
 * shorten strenuous outdoor exercise") which is acceptable, and anything that
 * interprets an individual's condition or directs their treatment, which is not.
 */
const MEDICAL_PATTERNS: RegExp[] = [
  /\bdiagnos(?:e|es|ed|is|ing|tic)\b/i,
  /\bprescrib(?:e|es|ed|ing)\b/i,
  /\bprescription\b/i,
  /\bmedications?\b/i,
  /\bmedicines?\b/i,
  /\bdosages?\b/i,
  /\binhalers?\b/i,
  /\btreatments?\b/i,
  /\btherapy\b/i,
  /\bcures?\b/i,
  /\bseek (?:immediate )?medical\b/i,
  /\bconsult (?:your|a) (?:doctor|gp|physician)\b/i,
  /\byou (?:have|are developing|are suffering from)\b/i,
  /\bsymptoms? (?:of|indicate|means?|suggests?)\b/i,
];

/** Certainty the data cannot support. */
const CERTAINTY_PATTERNS: RegExp[] = [
  /\bdefinitely\b/i,
  /\bcertainly\b/i,
  /\bundoubtedly\b/i,
  /\bwithout (?:a )?doubt\b/i,
  /\bguarantee(?:s|d)?\b/i,
  /\b(?:completely|totally|perfectly|entirely) safe\b/i,
  /\b(?:no|zero) (?:risk|danger|health risk)\b/i,
  /\bproven to\b/i,
  /\bthere is no (?:risk|danger|cause for concern)\b/i,
  /\bsafe to breathe\b/i,
];

/**
 * Claims about the future.
 *
 * No forecast is ever included in the explain payload, so any assertion about
 * later conditions is invented. Hedged language ("may", "could") survives — it
 * is the flat assertion that is rejected.
 */
const FORECAST_PATTERNS: RegExp[] = [
  /\bwill (?:improve|worsen|rise|fall|drop|increase|decrease|clear|remain|stay|continue|persist)\b/i,
  /\b(?:is|are) (?:expected|forecast|predicted|going) to\b/i,
  /\bwe expect\b/i,
  /\b(?:later today|tomorrow|tonight|this evening|overnight|in the coming hours)\b/i,
];

/**
 * Legal-compliance language.
 *
 * Permitted only where the input carries a genuine single-hour exceedance
 * (currently only the ozone information and alert thresholds). Everything else
 * is a long-averaging value that one hour cannot settle.
 */
const LEGAL_CLAIM_PATTERNS: RegExp[] = [
  /\bbreach(?:es|ed|ing)?\b/i,
  /\bviolat(?:e|es|ed|ing|ion)\b/i,
  /\b(?:illegal|unlawful)\b/i,
  /\bnon-?compliant\b/i,
  /\bexceed(?:s|ed|ing)\s+(?:the\s+)?[^.]{0,40}?(?:limit|guideline|standard|threshold)\b/i,
  /\bin excess of the\b/i,
];

/**
 * Words that turn a claim into its own denial.
 *
 * The prompt asks the model to say that one hourly reading "cannot establish an
 * exceedance of the annual limit" — a sentence whose whole purpose is to prevent
 * a misreading, and which a naive keyword match would reject. Only the legal
 * patterns get this exemption: for certainty and medical phrasing a nearby
 * negation usually makes the claim worse, not better ("there is no risk").
 */
const NEGATION_CUE =
  /\b(?:cannot|can't|can not|could not|couldn't|does not|doesn't|do not|don't|did not|is not|isn't|are not|aren't|was not|wasn't|were not|weren't|never|not|no single|unable|without)\b/i;

/* -------------------------------------------------------------------------- */
/*  Text helpers                                                              */
/* -------------------------------------------------------------------------- */

/** Every pollutant name form a model might write, longest first. */
const POLLUTANT_NAME_PATTERNS: RegExp[] = [
  /PM\s?2[.,]5/gi,
  /PM\s?10/gi,
  /PM₂[.,]₅/g,
  /PM₁₀/g,
  /NO\s?[₂2]\b/gi,
  /SO\s?[₂2]\b/gi,
  /O\s?[₃3]\b/gi,
];

const UNIT_PATTERNS: RegExp[] = [/[µμu]g\s*\/\s*m\s*[³3]/gi];

/**
 * Remove pollutant names and units before hunting for numbers.
 *
 * Otherwise "PM2.5" reads as the number 2.5 and "µg/m³" as 3, and the validator
 * spends its time rejecting correct sentences.
 */
function stripChemicalTokens(text: string): string {
  let out = text;
  for (const pattern of POLLUTANT_NAME_PATTERNS) out = out.replace(pattern, ' ');
  for (const pattern of UNIT_PATTERNS) out = out.replace(pattern, ' ');
  return out;
}

/** Numbers a reader would perceive, normalised across decimal conventions. */
export function extractQuotedNumbers(text: string): number[] {
  const cleaned = stripChemicalTokens(text)
    // Thousands separators first, so "1,200" is one number rather than "1.2".
    .replace(/(\d),(\d{3})\b/g, '$1$2')
    // Then a comma between digits is a decimal point (Maltese and French usage).
    .replace(/(\d),(\d)/g, '$1.$2');

  const matches = cleaned.match(/\d+(?:\.\d+)?/g);
  if (!matches) return [];

  return matches.map(Number).filter((n) => Number.isFinite(n));
}

/**
 * Categories named in a piece of text.
 *
 * Matched longest-first and consumed as they are found, so "Very poor" is not
 * also counted as a bare "Poor" — which would make every legitimate mention of
 * the worse bands look like a contradiction.
 */
export function extractNamedCategories(text: string): AirQualityCategory[] {
  const ordered = [...AIR_QUALITY_CATEGORIES].sort((a, b) => b.length - a.length);
  const found: AirQualityCategory[] = [];
  let remaining = text;

  for (const category of ordered) {
    const pattern = new RegExp(`\\b${category.replace(/\s+/g, '\\s+')}\\b`, 'gi');
    if (pattern.test(remaining)) {
      found.push(category);
      remaining = remaining.replace(pattern, ' ');
    }
  }

  return found;
}

/**
 * Regex source matching any written form of one pollutant's name.
 *
 * Spelled-out names are included because a model asked to write plainly will
 * write "ozone", and a check that only recognised "O₃" would wave through
 * exactly the sentence it exists to catch. Only the QUALIFIED particulate names
 * appear: bare "particulate matter" is ambiguous between the two size
 * fractions, and matching it would flag a correct sentence about the fraction
 * that was reported.
 */
function pollutantNameSource(code: PollutantCode): string {
  switch (code) {
    case 'PM2.5':
      return '(?:PM\\s?2[.,]5|PM₂[.,]₅|fine particulate matter|fine particles)';
    case 'PM10':
      return '(?:PM\\s?10|PM₁₀|coarse particulate matter|coarse particles)';
    case 'NO2':
      return '(?:NO\\s?[₂2]|nitrogen dioxide)';
    case 'O3':
      return '(?:O\\s?[₃3]|ozone)';
    case 'SO2':
      return '(?:SO\\s?[₂2]|sulphur dioxide|sulfur dioxide)';
  }
}

/**
 * Whether the text attaches a concentration to a pollutant that was not
 * reported.
 *
 * This is the one product rule with no acceptable failure mode: an unmeasured
 * pollutant printed with a number reads as a measurement, and a reader has no
 * way to tell it was invented.
 */
function claimsValueForMissingPollutant(
  text: string,
  codes: PollutantCode[],
): PollutantCode | null {
  const unit = '(?:[µμu]g\\s*\\/\\s*m\\s*[³3])';

  for (const code of codes) {
    const name = pollutantNameSource(code);
    const forward = new RegExp(`${name}[^.;!?]{0,60}?\\d+(?:[.,]\\d+)?\\s*${unit}`, 'i');
    const backward = new RegExp(`\\d+(?:[.,]\\d+)?\\s*${unit}[^.;!?]{0,60}?${name}`, 'i');
    if (forward.test(text) || backward.test(text)) return code;
  }

  return null;
}

/**
 * Whether a concentration is attached to the WRONG pollutant.
 *
 * The allowlist check alone asks only whether a number appears somewhere in the
 * input, so "NO₂ was 8 µg/m³" survives it whenever 8 is the local hour or
 * another pollutant's value. Binding each quoted concentration to the pollutant
 * it is written beside closes that gap — and it is the gap that matters, because
 * a plausible wrong figure attached to the right name is undetectable to a
 * reader.
 *
 * Forward direction only (name, then number, then unit). A backward rule would
 * misread ordinary list prose — "PM10 at 26.1 µg/m³, PM2.5 at 12.4 µg/m³" pairs
 * 26.1 with PM2.5 — and reject correct sentences. Clause punctuation bounds the
 * window so a value cannot be matched across a sentence break.
 *
 * A pollutant's own threshold figures count as legitimately its own: "NO₂ is
 * above the level of the WHO guideline of 25 µg/m³" states a threshold, not a
 * measurement, and the number is genuinely attached to that pollutant. A
 * threshold belonging to a DIFFERENT pollutant still fails, which is the case
 * worth catching.
 */
function misattributedValue(
  text: string,
  pollutants: ExplainPollutantFact[],
): { code: PollutantCode; quoted: number; actual: number } | null {
  const unit = '(?:[µμu]g\\s*\\/\\s*m\\s*[³3])';

  for (const pollutant of pollutants) {
    // The measured value, that value rounded — the European AQI classifies on
    // whole µg/m³, so writing 49 for 48.6 is quoting, not inventing — and any
    // threshold supplied for this pollutant.
    const permitted = [
      pollutant.value,
      Math.round(pollutant.value),
      ...pollutant.exceededThresholds.map((t) => t.threshold),
    ];

    const scanner = new RegExp(
      `${pollutantNameSource(pollutant.code)}[^.;!?]{0,60}?(\\d+(?:[.,]\\d+)?)\\s*${unit}`,
      'gi',
    );

    let match: RegExpExecArray | null;
    while ((match = scanner.exec(text)) !== null) {
      const quoted = Number(match[1].replace(',', '.'));
      if (!Number.isFinite(quoted)) continue;
      if (permitted.some((allowed) => Math.abs(allowed - quoted) <= NUMBER_TOLERANCE)) continue;
      return { code: pollutant.code, quoted, actual: pollutant.value };
    }
  }

  return null;
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return match[0];
  }
  return null;
}

/**
 * First match that is NOT preceded by a negation.
 *
 * The window is the preceding clause rather than the whole text, so a denial
 * early in a paragraph cannot license an assertion three sentences later.
 */
function firstUnhedgedMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const scanner = new RegExp(
      pattern.source,
      pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
    );
    let match: RegExpExecArray | null;

    while ((match = scanner.exec(text)) !== null) {
      const clauseStart = Math.max(0, match.index - 90);
      const preceding =
        text
          .slice(clauseStart, match.index)
          .split(/[.;!?]/)
          .pop() ?? '';
      if (NEGATION_CUE.test(preceding)) continue;
      return match[0];
    }
  }

  return null;
}

/** Parse a model response that may arrive as text, with or without fencing. */
function coerceJson(raw: unknown): unknown | undefined {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return undefined;

  const trimmed = raw.trim();
  // Some vendors wrap JSON in a markdown fence despite being asked not to.
  // Unwrapping is not leniency about content — the object inside still faces
  // every check below.
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    return JSON.parse(unfenced);
  } catch {
    return undefined;
  }
}

/* -------------------------------------------------------------------------- */
/*  Explanation validation                                                    */
/* -------------------------------------------------------------------------- */

const NUMBER_TOLERANCE = 0.05;

function isAllowedNumber(value: number, allowlist: number[]): boolean {
  // Tolerance covers honest rounding for display: a model writing 42.3 for a
  // measured 42.34 is quoting the input, not inventing a figure.
  return allowlist.some((allowed) => Math.abs(allowed - value) <= NUMBER_TOLERANCE);
}

/**
 * Validate an explanation against the input it was generated from.
 *
 * Order is deliberate: cheap structural checks first, then citations, then
 * content. The first failure wins, so the logged reason is the most fundamental
 * problem rather than a downstream symptom of it.
 */
export function validateExplanation(
  raw: unknown,
  input: ExplainInput,
): ValidationResult<AirQualityExplanation> {
  const candidate = coerceJson(raw);
  if (candidate === undefined) {
    return { ok: false, reason: 'unparseable', detail: 'response was not JSON' };
  }

  const parsed = airQualityExplanationSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      reason: 'schema',
      detail: issue ? `${issue.path.join('.') || '(root)'}: ${issue.message}` : 'schema mismatch',
    };
  }

  const explanation = parsed.data;

  /* Citations -------------------------------------------------------------- */

  const allowedIds = new Set(input.sourceIds);
  for (const id of explanation.sourceIds) {
    if (!allowedIds.has(id)) {
      return { ok: false, reason: 'unknown-source', detail: `cited unsupplied source id "${id}"` };
    }
  }

  const text = [
    explanation.headline,
    explanation.summary,
    explanation.uncertainty,
    ...explanation.contributingFactors.map((f) => f.label),
  ].join('\n');

  /* Numbers ---------------------------------------------------------------- */

  for (const quoted of extractQuotedNumbers(text)) {
    if (!isAllowedNumber(quoted, input.numericAllowlist)) {
      return {
        ok: false,
        reason: 'fabricated-number',
        detail: `quoted ${quoted}, which is not in the input`,
      };
    }
  }

  const invented = claimsValueForMissingPollutant(
    text,
    input.unavailablePollutants.map((p) => p.code),
  );
  if (invented) {
    return {
      ok: false,
      reason: 'value-for-missing-pollutant',
      detail: `stated a concentration for ${POLLUTANTS[invented].label}, which was not reported`,
    };
  }

  const misattributed = misattributedValue(text, input.pollutants);
  if (misattributed) {
    return {
      ok: false,
      reason: 'fabricated-number',
      detail: `attributed ${misattributed.quoted} to ${POLLUTANTS[misattributed.code].label}, which measured ${misattributed.actual}`,
    };
  }

  /* Categories ------------------------------------------------------------- */

  const allowedCategories = new Set(input.allowedCategories);
  for (const named of extractNamedCategories(text)) {
    if (!allowedCategories.has(named)) {
      return {
        ok: false,
        reason: 'category-contradiction',
        detail: `named category "${named}", which the measurements do not support`,
      };
    }
  }

  /* Claims ----------------------------------------------------------------- */

  const medical = firstMatch(text, MEDICAL_PATTERNS);
  if (medical) {
    return { ok: false, reason: 'medical-claim', detail: `medical phrasing: "${medical}"` };
  }

  const certainty = firstMatch(text, CERTAINTY_PATTERNS);
  if (certainty) {
    return {
      ok: false,
      reason: 'overclaimed-certainty',
      detail: `asserted certainty: "${certainty}"`,
    };
  }

  const forecast = firstMatch(text, FORECAST_PATTERNS);
  if (forecast) {
    return { ok: false, reason: 'forecast-claim', detail: `claimed the future: "${forecast}"` };
  }

  if (!input.hasConclusiveExceedance) {
    const legal = firstUnhedgedMatch(text, LEGAL_CLAIM_PATTERNS);
    if (legal) {
      return {
        ok: false,
        reason: 'legal-claim',
        detail: `asserted an exceedance from one hourly reading: "${legal}"`,
      };
    }
  }

  return { ok: true, value: explanation };
}

/* -------------------------------------------------------------------------- */
/*  Event summary validation                                                  */
/* -------------------------------------------------------------------------- */

export type EventSummaryValidationOptions = {
  allowedSourceIds: string[];
  /** Station ids the summary may name. */
  allowedStationIds?: string[];
  /** Categories observed right now; naming any other contradicts the data. */
  allowedCategories?: AirQualityCategory[];
};

/**
 * Validate an event summary.
 *
 * Numbers are not allowlist-checked here: event prose legitimately carries dates
 * and quantities from its own source text, and a summary quotes them. Citations,
 * categories and the claim patterns still apply — those are the parts that could
 * mislead a reader about air quality itself.
 */
export function validateEventSummary(
  raw: unknown,
  options: EventSummaryValidationOptions,
): ValidationResult<EventSummary> {
  const candidate = coerceJson(raw);
  if (candidate === undefined) {
    return { ok: false, reason: 'unparseable', detail: 'response was not JSON' };
  }

  const parsed = eventSummarySchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      reason: 'schema',
      detail: issue ? `${issue.path.join('.') || '(root)'}: ${issue.message}` : 'schema mismatch',
    };
  }

  const summary = parsed.data;
  const allowedIds = new Set(options.allowedSourceIds);
  for (const id of summary.sourceIds) {
    if (!allowedIds.has(id)) {
      return { ok: false, reason: 'unknown-source', detail: `cited unsupplied source id "${id}"` };
    }
  }

  const allowedStations = new Set(options.allowedStationIds ?? []);
  for (const stationId of summary.affectedStationIds) {
    if (!allowedStations.has(stationId)) {
      return {
        ok: false,
        reason: 'unknown-source',
        detail: `named station "${stationId}", which was not supplied`,
      };
    }
  }

  const text = [summary.headline, summary.summary, summary.airQualityLink].join('\n');

  const allowedCategories = new Set(options.allowedCategories ?? []);
  for (const named of extractNamedCategories(text)) {
    if (!allowedCategories.has(named)) {
      return {
        ok: false,
        reason: 'category-contradiction',
        detail: `named category "${named}", which the measurements do not support`,
      };
    }
  }

  const medical = firstMatch(text, MEDICAL_PATTERNS);
  if (medical) {
    return { ok: false, reason: 'medical-claim', detail: `medical phrasing: "${medical}"` };
  }

  const certainty = firstMatch(text, CERTAINTY_PATTERNS);
  if (certainty) {
    return {
      ok: false,
      reason: 'overclaimed-certainty',
      detail: `asserted certainty: "${certainty}"`,
    };
  }

  const legal = firstUnhedgedMatch(text, LEGAL_CLAIM_PATTERNS);
  if (legal) {
    return { ok: false, reason: 'legal-claim', detail: `asserted an exceedance: "${legal}"` };
  }

  return { ok: true, value: summary };
}
