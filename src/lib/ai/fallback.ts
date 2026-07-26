/**
 * Deterministic explanation, written from the measurements alone.
 *
 * This is not an error message and must never read like one. It is what the
 * page shows when AI is switched off, unconfigured, rate-limited, failing, or
 * has returned something the validator refused — and in a deployment with no
 * `OPENROUTER_API_KEY` it is what every reader sees, always. A sentence saying
 * "an explanation could not be generated" would make the product worse than
 * having no explanation at all.
 *
 * So it says the same things a good explanation says: what the rating is, which
 * pollutant set it, what the site is like, what was missing or estimated, how
 * the value sits against health guidance, how old the reading is, and what none
 * of it can tell you. Every clause comes from a computed field; nothing is
 * inferred.
 *
 * The output satisfies `validateExplanation()` against its own input, which is
 * not decoration: it keeps the honest-phrasing rules — no invented numbers, no
 * category the data does not support, no exceedance claimed from one hour — as
 * a single standard that both the model and the deterministic path must meet.
 *
 * Copy lives here rather than in the i18n dictionary because this is generated
 * prose composed from measured values, not a static interface string. English
 * ships; `mt` and `fr` fall back to English until a translated builder exists,
 * which is honest — a machine-mangled Maltese health message would be worse
 * than an English one.
 */

import { categoryRank } from '@/config/thresholds';
import type { AirQualityExplanation, ContributingFactor, ExplanationLocale } from './schemas';
import type { ExplainComparison, ExplainInput, ExplainPollutantFact } from './redact';

/* -------------------------------------------------------------------------- */
/*  Formatting helpers                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Concentrations to one decimal place, integers left bare.
 *
 * Stays inside the validator's rounding tolerance, so the fallback's own prose
 * passes the same numeric check applied to model output.
 */
function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** British list punctuation: "a, b and c", no serial comma. */
function formatList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  // Cut at a word boundary so a clamped sentence still reads as a sentence.
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Join sentences, dropping trailing ones rather than overrunning the schema. */
function joinWithin(sentences: string[], max: number): string {
  let out = '';
  for (const sentence of sentences) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > max) break;
    out = next;
  }
  return out || truncate(sentences[0] ?? '', max);
}

function thresholdName(comparison: ExplainComparison): string {
  return comparison.kind === 'eu-limit' ? 'EU limit value' : 'WHO guideline';
}

/**
 * Averaging periods as a reader would say them.
 *
 * The raw strings are written for a threshold table ("Calendar year",
 * "Annual"), and dropping them into a sentence unaltered produces "averaged
 * over calendar year".
 */
function periodPhrase(averagingPeriod: string): string {
  switch (averagingPeriod) {
    case '1 hour':
      return 'one hour';
    case 'Calendar year':
    case 'Annual':
      return 'a full year';
    case 'Maximum daily 8-hour mean':
      return 'the highest eight-hour mean of a day';
    case 'Peak season 8-hour':
      return 'eight hours during the peak season';
    default:
      return averagingPeriod.toLowerCase();
  }
}

/**
 * Indefinite article by first letter.
 *
 * Sufficient for the closed set of values that reach it — urban, suburban,
 * rural, industrial, background, traffic — and not pretending to be a general
 * English rule.
 */
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

/**
 * How far an averaging period is from the hour this reading describes.
 *
 * Nearer periods make a more meaningful comparison: an hourly value says
 * something about a one-hour threshold, a little about a 24-hour one, and very
 * little about an annual mean.
 */
function periodDistance(averagingPeriod: string): number {
  const period = averagingPeriod.toLowerCase();
  if (period.includes('1 hour')) return 0;
  if (period.includes('hour')) return 1;
  return 2;
}

/**
 * The most informative threshold to mention.
 *
 * Ranked, not simply "the lowest": the lowest is usually the WHO annual
 * guideline for PM2.5, which almost every populated place in Europe sits above.
 * Leading with it would be true, unhelpful, and slightly alarmist. Preference
 * runs conclusive single-hour thresholds, then the pollutant that actually set
 * the band, then the nearest averaging period.
 */
function chooseComparison(pollutants: ExplainPollutantFact[]): {
  pollutant: ExplainPollutantFact;
  comparison: ExplainComparison;
} | null {
  let best: {
    pollutant: ExplainPollutantFact;
    comparison: ExplainComparison;
    score: number;
  } | null = null;

  for (const pollutant of pollutants) {
    for (const comparison of pollutant.exceededThresholds) {
      const score =
        (comparison.conclusive ? 0 : 100) +
        (pollutant.dominant ? 0 : 10) +
        periodDistance(comparison.averagingPeriod);

      if (
        !best ||
        score < best.score ||
        // Same standing: the higher threshold is the stronger statement.
        (score === best.score && comparison.threshold > best.comparison.threshold)
      ) {
        best = { pollutant, comparison, score };
      }
    }
  }

  return best ? { pollutant: best.pollutant, comparison: best.comparison } : null;
}

function siteDescription(input: ExplainInput): string {
  const area = input.station.areaClassification.toLowerCase().replace('rural-regional', 'rural');
  return `${area} ${input.station.stationType.toLowerCase()}`;
}

/* -------------------------------------------------------------------------- */
/*  English builder                                                           */
/* -------------------------------------------------------------------------- */

function buildFactors(input: ExplainInput): ContributingFactor[] {
  const factors: ContributingFactor[] = [];
  const dominant = input.pollutants.find((p) => p.dominant) ?? input.pollutants[0];

  if (dominant && input.reading.overallCategory) {
    const elevated = categoryRank(input.reading.overallCategory) >= 3;
    factors.push({
      label: `${dominant.label} at ${formatValue(dominant.value)} ${dominant.unit} is the highest-rated pollutant this hour and sets the station's band`,
      impact: elevated ? 'worsening' : 'unknown',
      confidence: 'high',
    });
  }

  // Station siting is the single most useful piece of interpretation available
  // without any external data: it tells a reader what the number represents.
  if (input.station.stationType === 'Traffic') {
    factors.push({
      label: `This is a roadside site, so readings track nearby traffic emissions more closely than conditions across the wider area`,
      impact: 'worsening',
      confidence: 'medium',
    });
  } else if (input.station.stationType === 'Industrial') {
    factors.push({
      label: `This is an industrial site, so readings track nearby industrial emissions more closely than conditions across the wider area`,
      impact: 'worsening',
      confidence: 'medium',
    });
  } else {
    const site = siteDescription(input);
    factors.push({
      label: `This is ${article(site)} ${site} site, so readings describe general levels in the area rather than any single nearby source`,
      impact: 'mixed',
      confidence: 'medium',
    });
  }

  if (input.pollutants.some((p) => p.estimated)) {
    factors.push({
      label: 'Some values for this hour are modelled estimates rather than direct measurements',
      impact: 'unknown',
      confidence: 'low',
    });
  }

  if (input.unavailablePollutants.length > 0) {
    const missing = input.unavailablePollutants.length;
    factors.push({
      label:
        missing === 1
          ? `${input.unavailablePollutants[0].label} is missing for this hour, so the band is based on the rest`
          : `${missing} of the pollutants this station usually reports are missing for this hour`,
      impact: 'unknown',
      confidence: 'low',
    });
  }

  if (input.reading.freshness !== 'fresh') {
    factors.push({
      label: `The most recent measurement was ${input.reading.ageHours} hours old when it was retrieved`,
      impact: 'unknown',
      confidence: 'high',
    });
  }

  return factors.slice(0, 4).map((factor) => ({ ...factor, label: truncate(factor.label, 180) }));
}

function buildUncertainty(input: ExplainInput): string {
  const parts: string[] = [];

  if (input.reading.provisional) {
    parts.push(
      'These are near-real-time figures and are provisional: ERA may revise or withdraw them after quality control.',
    );
  }

  parts.push(
    'This summary describes only the measurements listed above — no weather, traffic or forecast information was used, so it cannot say why the reading is what it is.',
  );

  if (input.unavailablePollutants.length > 0) {
    parts.push('Pollutants that were not reported cannot be described at all.');
  }

  if (input.reading.freshness !== 'fresh') {
    parts.push('Conditions may have changed since the measurement was taken.');
  }

  return truncate(parts.join(' '), 500);
}

function buildSourceIds(input: ExplainInput): string[] {
  const ids = new Set<string>([input.station.sourceId, 'method.european-aqi']);
  for (const pollutant of input.pollutants) ids.add(pollutant.sourceId);
  const chosen = chooseComparison(input.pollutants);
  if (chosen) ids.add(chosen.comparison.sourceId);
  return [...ids].slice(0, 12);
}

/** Reading with no usable measurement at all. Still owed a real explanation. */
function buildNoDataExplanation(input: ExplainInput): AirQualityExplanation {
  const missing = input.unavailablePollutants.map((p) => p.label);

  const sentences = [
    `${input.station.name} did not report a usable measurement for ${input.reading.measuredAtLocal} (Malta time), so no European Air Quality Index band can be worked out for that hour.`,
    missing.length > 0
      ? `${formatList(missing)} ${missing.length === 1 ? 'was' : 'were'} not reported.`
      : 'No pollutant reached the index calculation for this hour.',
    'A missing value is not a reading of clean air — it means the instrument did not report, and nothing can be concluded from it either way.',
    `${input.station.name} is ${article(siteDescription(input))} ${siteDescription(input)} site operated by ${input.station.operator}, and normally publishes hourly.`,
  ];

  return {
    headline: truncate(`No air-quality rating is available for ${input.station.name}`, 140),
    summary: joinWithin(sentences, 1200),
    contributingFactors: buildFactors(input),
    uncertainty: buildUncertainty(input),
    sourceIds: buildSourceIds(input),
  };
}

function buildEnglishExplanation(input: ExplainInput): AirQualityExplanation {
  const category = input.reading.overallCategory;
  const dominant = input.pollutants.find((p) => p.dominant) ?? input.pollutants[0];

  if (!category || !dominant) return buildNoDataExplanation(input);

  const sentences: string[] = [
    `The European Air Quality Index rates conditions at ${input.station.name} as ${category}, using measurements for ${input.reading.measuredAtLocal} (Malta time).`,
    `${dominant.label} sets that rating, at ${formatValue(dominant.value)} ${dominant.unit}${
      dominant.estimated ? ', a modelled estimate rather than a direct measurement' : ''
    } — the highest-rated pollutant the station reported this hour.`,
  ];

  const others = input.pollutants.filter((p) => p !== dominant);
  if (others.length > 0) {
    const list = formatList(
      others.map((p) => `${p.label} at ${formatValue(p.value)} ${p.unit} (${p.category})`),
    );
    sentences.push(`Also reported: ${list}.`);
  }

  if (input.unavailablePollutants.length > 0) {
    const missing = formatList(input.unavailablePollutants.map((p) => p.label));
    sentences.push(
      `${missing} ${input.unavailablePollutants.length === 1 ? 'was' : 'were'} not reported for this hour, so the rating reflects only the pollutants above.`,
    );
  }

  const chosen = chooseComparison(input.pollutants);
  if (chosen) {
    const { pollutant, comparison } = chosen;
    sentences.push(
      comparison.conclusive
        ? `${pollutant.label} is above the ${thresholdName(comparison)} of ${formatValue(comparison.threshold)} ${comparison.unit} averaged over ${periodPhrase(comparison.averagingPeriod)} — a threshold that applies to a single hour, which is why this one is worth stating.`
        : `${pollutant.label} is above the level of the ${thresholdName(comparison)} of ${formatValue(comparison.threshold)} ${comparison.unit} averaged over ${periodPhrase(comparison.averagingPeriod)}; that period is far longer than an hour, so one reading cannot settle whether the guideline has been met.`,
    );
  }

  if (input.reading.freshness !== 'fresh') {
    sentences.push(
      `This reading was ${input.reading.ageHours} hours old when it was retrieved, so it describes recent rather than present conditions.`,
    );
  }

  for (const event of input.events.slice(0, 1)) {
    sentences.push(`Context reported nearby: ${event.headline} (${event.sourceName}).`);
  }

  return {
    headline: truncate(`Air quality at ${input.station.name} is rated ${category}`, 140),
    summary: joinWithin(sentences, 1200),
    contributingFactors: buildFactors(input),
    uncertainty: buildUncertainty(input),
    sourceIds: buildSourceIds(input),
  };
}

/* -------------------------------------------------------------------------- */
/*  Entry point                                                               */
/* -------------------------------------------------------------------------- */

type FallbackBuilder = (input: ExplainInput) => AirQualityExplanation;

/**
 * One builder per language.
 *
 * Adding Maltese means adding a builder here and a matching pattern set in
 * `validate.ts` — the two must arrive together, or the safety checks would be
 * silently skipped for that language.
 */
const BUILDERS: Partial<Record<ExplanationLocale, FallbackBuilder>> = {
  en: buildEnglishExplanation,
};

/**
 * Build the deterministic explanation for a reading.
 *
 * Total function: it never throws, never awaits, and never needs a network. If
 * it could fail, the whole degradation story would be a fiction.
 */
export function buildFallbackExplanation(input: ExplainInput): AirQualityExplanation {
  const builder = BUILDERS[input.locale] ?? buildEnglishExplanation;
  return builder(input);
}
