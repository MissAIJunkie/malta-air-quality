/**
 * Email bodies.
 *
 * Pure functions: data in, `{ subject, text, html }` out. No clock, no network,
 * no database, no React. That makes every message diffable in a unit test, which
 * matters more here than anywhere else in the app — a bad alert email cannot be
 * corrected once it has left.
 *
 * Three constraints shape the markup:
 *
 *  - **Text is not a courtesy copy.** A health warning has to be legible with
 *    images and CSS disabled, so the plain-text part carries the complete
 *    message and the HTML part adds nothing the text lacks.
 *  - **Colour is never the only signal.** The category band shows its colour,
 *    its name and a shape marker together. Mail clients override colours, dark
 *    modes invert them, and roughly one man in twelve cannot distinguish the
 *    Moderate and Poor swatches at all.
 *  - **Dates are formatted here, not imported.** `Intl` with an explicit
 *    `Europe/Malta` zone is used directly rather than the app's i18n layer,
 *    because these functions must stay independent of the request-scoped React
 *    runtime and must produce identical output from a cron job.
 *
 * Copy is British English, matching the rest of the product. Strings a caller
 * may want to localise are accepted as parameters rather than hard-coded.
 */

import { POLLUTANTS, type PollutantCode } from '@/config/pollutants';
import { CATEGORY_PRESENTATION, type AirQualityCategory } from '@/config/thresholds';

/* -------------------------------------------------------------------------- */
/*  Mandatory notices                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Required on every message that touches health guidance. Verbatim — do not
 * paraphrase, shorten or move it below the fold.
 */
export const MEDICAL_DISCLAIMER =
  'maqua.app provides general environmental information and does not replace medical advice or official emergency guidance.';

/** Required attribution. Verbatim. */
export const DATA_ATTRIBUTION =
  "Air-quality data provided by Malta's Environment and Resources Authority (ERA), disseminated via the European Environment Agency (EEA). maqua.app is an independent project and is not operated by, affiliated with, or endorsed by ERA or the EEA.";

/* -------------------------------------------------------------------------- */
/*  Shared types                                                              */
/* -------------------------------------------------------------------------- */

export type EmailContent = {
  subject: string;
  text: string;
  html: string;
};

export type EmailLinks = {
  /** Canonical app URL, e.g. `https://maqua.app`. */
  appUrl: string;
  /** Deep link to the affected station or the relevant view. */
  detailUrl?: string;
  /** Where the underlying data came from. Required so a reader can check us. */
  sourceUrl: string;
  /** One click, no login, no confirmation step. */
  unsubscribeUrl: string;
  /** Optional preferences page, for people who want fewer alerts, not none. */
  managePreferencesUrl?: string;
};

/** Whether the trigger was an instrument reading or a model output. */
export type ReadingBasis = 'measured' | 'forecast';

/* -------------------------------------------------------------------------- */
/*  Formatting helpers                                                        */
/* -------------------------------------------------------------------------- */

const MALTA_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Malta',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const MALTA_DATE = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Malta',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * An instant in Malta local time, with the zone named.
 *
 * The zone is spelled out because the same message may be read from anywhere,
 * and "14:00" without a zone is not a timestamp — it is a guess.
 */
export function formatMaltaTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'time unavailable';
  return `${MALTA_TIME.format(date)} (Malta time)`;
}

export function formatMaltaDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'date unavailable';
  return MALTA_DATE.format(date);
}

/**
 * A concentration, or an explicit statement that there isn't one.
 *
 * `null` becomes "not available", never "0". Zero is a measurement of very clean
 * air; absence is not a measurement at all, and the two must never look alike.
 */
export function formatConcentration(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) return 'not available';
  const rounded = Math.abs(value) >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${unit}`;
}

/**
 * Non-colour marker for a category.
 *
 * Paired with the colour swatch and the category name so the band survives a
 * monochrome print, a colour-inverting dark mode and colour-blind vision.
 */
function categoryMarker(category: AirQualityCategory): string {
  return CATEGORY_PRESENTATION[category].elevated ? '▲' : '●';
}

/** How a reading was produced, in words a non-specialist can act on. */
export function describeBasis(basis: ReadingBasis): string {
  return basis === 'forecast'
    ? 'Estimated — this figure is modelled or forecast, not a direct measurement'
    : 'Measured — this figure comes directly from the monitoring station';
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape interpolated content. Station names and event summaries can contain
 *  apostrophes (`St Paul's Bay`) and are not trusted to be markup-safe. */
function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

/* -------------------------------------------------------------------------- */
/*  Cautious, general health guidance                                         */
/* -------------------------------------------------------------------------- */

/**
 * Default advice per category.
 *
 * General and non-diagnostic by design: it never names a condition, never tells
 * anyone to change medication, and never claims to know who is at risk. Callers
 * may pass their own localised string instead.
 */
export const CATEGORY_ADVICE: Record<AirQualityCategory, string> = {
  Good: 'Air quality is good. No particular precautions are suggested.',
  Fair: 'Air quality is fair. Most people can carry on as normal; anyone unusually sensitive to air pollution may prefer to take it easy outdoors.',
  Moderate:
    'People who are sensitive to air pollution may wish to reduce prolonged or strenuous activity outdoors. Everyone else can carry on as normal.',
  Poor: 'Consider reducing prolonged or strenuous activity outdoors, particularly if you are sensitive to air pollution. Keeping windows closed on the busiest roadside may help.',
  'Very poor':
    'Consider avoiding prolonged or strenuous activity outdoors, and reducing time spent near busy roads. Follow any guidance issued by the health authorities.',
  'Extremely poor':
    'Consider staying indoors where practical and keeping windows closed. Follow any guidance issued by the health authorities.',
};

/* -------------------------------------------------------------------------- */
/*  HTML shell                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Wrap body markup in a complete, self-contained document.
 *
 * Table-based and inline-styled on purpose: several widely used mail clients
 * strip `<style>` blocks and do not implement flexbox or grid. A 600px column is
 * the widest that reliably fits a mobile preview pane without horizontal
 * scrolling.
 */
function htmlShell(title: string, body: string, footer: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f2ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c2b33;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f2ec;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;border:1px solid #dcd7cb;">
<tr><td style="padding:28px 28px 8px 28px;">
<p style="margin:0 0 20px 0;font-size:14px;letter-spacing:0.08em;text-transform:uppercase;color:#1b4965;font-weight:700;">maqua.app</p>
${body}
</td></tr>
<tr><td style="padding:8px 28px 28px 28px;border-top:1px solid #e8e4da;">
${footer}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/**
 * The footer every message carries: attribution, disclaimer, source link, app
 * link and a one-click unsubscribe.
 *
 * Built centrally so no template can accidentally ship without them.
 */
function htmlFooter(links: EmailLinks, includeUnsubscribe: boolean): string {
  const manage = links.managePreferencesUrl
    ? ` &nbsp;·&nbsp; <a href="${esc(links.managePreferencesUrl)}" style="color:#1b4965;">Change what you receive</a>`
    : '';

  const unsubscribe = includeUnsubscribe
    ? `<p style="margin:0 0 12px 0;font-size:13px;line-height:1.6;color:#4a5a63;">
<a href="${esc(links.unsubscribeUrl)}" style="color:#1b4965;">Unsubscribe from maqua.app alerts</a>${manage}
</p>`
    : '';

  return `<p style="margin:16px 0 12px 0;font-size:13px;line-height:1.6;color:#4a5a63;">
<strong>${esc(MEDICAL_DISCLAIMER)}</strong>
</p>
<p style="margin:0 0 12px 0;font-size:12px;line-height:1.6;color:#6a7a83;">
${esc(DATA_ATTRIBUTION)}
</p>
<p style="margin:0 0 12px 0;font-size:13px;line-height:1.6;color:#4a5a63;">
<a href="${esc(links.sourceUrl)}" style="color:#1b4965;">View the data source</a>
&nbsp;·&nbsp;
<a href="${esc(links.appUrl)}" style="color:#1b4965;">maqua.app</a>
</p>
${unsubscribe}`;
}

function textFooter(links: EmailLinks, includeUnsubscribe: boolean): string {
  const lines = [
    '',
    '---',
    MEDICAL_DISCLAIMER,
    '',
    DATA_ATTRIBUTION,
    '',
    `Data source: ${links.sourceUrl}`,
    `maqua.app: ${links.appUrl}`,
  ];

  if (includeUnsubscribe) {
    lines.push(`Unsubscribe: ${links.unsubscribeUrl}`);
    if (links.managePreferencesUrl) {
      lines.push(`Change what you receive: ${links.managePreferencesUrl}`);
    }
  }

  return lines.join('\n');
}

/** The category band, rendered so it reads correctly without colour. */
function htmlCategoryBanner(category: AirQualityCategory, headline: string): string {
  const presentation = CATEGORY_PRESENTATION[category];
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
<tr>
<td style="background-color:${presentation.color};color:${presentation.onColor};padding:14px 16px;border-radius:8px;font-size:16px;font-weight:700;">
<span aria-hidden="true">${categoryMarker(category)}</span>&nbsp;${esc(category)} — ${esc(headline)}
</td>
</tr>
</table>`;
}

/* -------------------------------------------------------------------------- */
/*  1. Confirm subscription                                                   */
/* -------------------------------------------------------------------------- */

export type ConfirmSubscriptionInput = {
  /** One sentence describing exactly what was requested, so consent is informed. */
  subscriptionDescription: string;
  confirmUrl: string;
  /** ISO-8601. Rendered in Malta time. */
  expiresAtIso: string;
  links: EmailLinks;
};

/**
 * Double opt-in confirmation.
 *
 * Carries no unsubscribe link in the body on purpose: nothing has been
 * subscribed yet, so the correct way out is simply to ignore this message. Saying
 * so plainly is more honest than a link that unsubscribes from nothing. The
 * transport still sets a `List-Unsubscribe` header.
 */
export function confirmSubscriptionEmail(input: ConfirmSubscriptionInput): EmailContent {
  const subject = 'Confirm your maqua.app air-quality alerts';
  const expires = formatMaltaTime(input.expiresAtIso);

  const text = [
    'Confirm your maqua.app air-quality alerts',
    '',
    'Someone — we hope you — asked to receive air-quality alerts from maqua.app for:',
    '',
    `  ${input.subscriptionDescription}`,
    '',
    'To start receiving them, open this link:',
    `  ${input.confirmUrl}`,
    '',
    `This link stops working at ${expires}.`,
    '',
    'If you did not request this, ignore this email. Nothing has been subscribed, and we will not contact you again.',
    textFooter(input.links, false),
  ].join('\n');

  const html = htmlShell(
    subject,
    `<h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;color:#123244;">Confirm your air-quality alerts</h1>
<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">Someone — we hope you — asked to receive air-quality alerts from maqua.app for:</p>
<p style="margin:0 0 20px 0;padding:12px 16px;background-color:#f0f4f6;border-left:3px solid #1b4965;font-size:15px;line-height:1.6;">${esc(input.subscriptionDescription)}</p>
<p style="margin:0 0 24px 0;">
<a href="${esc(input.confirmUrl)}" style="display:inline-block;background-color:#1b4965;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:8px;font-size:16px;font-weight:600;min-height:44px;line-height:20px;">Confirm my alerts</a>
</p>
<p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#4a5a63;">Or paste this into your browser:<br><span style="word-break:break-all;">${esc(input.confirmUrl)}</span></p>
<p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#4a5a63;">This link stops working at ${esc(expires)}.</p>
<p style="margin:0 0 8px 0;font-size:14px;line-height:1.6;color:#4a5a63;">If you did not request this, ignore this email. Nothing has been subscribed, and we will not contact you again.</p>`,
    htmlFooter(input.links, false),
  );

  return { subject, text, html };
}

/* -------------------------------------------------------------------------- */
/*  2. Air-quality alert                                                      */
/* -------------------------------------------------------------------------- */

export type AirQualityAlertInput = {
  /** Station or area the alert is about. Never omitted — an alert without a
   *  place is not actionable. */
  areaName: string;
  stationName: string;
  category: AirQualityCategory;
  dominantPollutant: PollutantCode;
  value: number | null;
  unit: string;
  /** ISO-8601 instant the reading refers to. */
  measuredAtIso: string;
  basis: ReadingBasis;
  /** Optional localised advice. Falls back to the cautious default for the band. */
  advice?: string;
  /** Optional one-line context, e.g. a Saharan dust intrusion. Presented as
   *  possible context, never as an established cause. */
  contextNote?: string;
  links: EmailLinks;
};

/**
 * An episode has begun, or worsened.
 *
 * Every mandatory element is present in both parts: what happened, whether it
 * was measured or modelled, when in Malta time, where, the source, the app, an
 * unsubscribe link and the medical disclaimer.
 */
export function airQualityAlertEmail(input: AirQualityAlertInput): EmailContent {
  const pollutant = POLLUTANTS[input.dominantPollutant];
  const measuredAt = formatMaltaTime(input.measuredAtIso);
  const reading = formatConcentration(input.value, input.unit);
  const advice = input.advice ?? CATEGORY_ADVICE[input.category];
  const basisLine = describeBasis(input.basis);
  const forecastFlag = input.basis === 'forecast' ? 'Forecast: ' : '';

  const subject = `${forecastFlag}Air quality is ${input.category} at ${input.stationName}`;

  const headline =
    input.basis === 'forecast'
      ? `${pollutant.ariaLabel} expected to reach this level`
      : `driven by ${pollutant.ariaLabel}`;

  const summary =
    input.basis === 'forecast'
      ? `Air quality at ${input.stationName} (${input.areaName}) is forecast to be ${input.category}, with ${pollutant.label} the main contributor.`
      : `Air quality at ${input.stationName} (${input.areaName}) is ${input.category}, with ${pollutant.label} the main contributor.`;

  const textLines = [
    subject,
    '',
    summary,
    '',
    `Basis:        ${basisLine}`,
    `Pollutant:    ${pollutant.label} (${pollutant.ariaLabel})`,
    `Concentration: ${reading}`,
    `Time:         ${measuredAt}`,
    `Station:      ${input.stationName}, ${input.areaName}`,
    '',
    'What this means',
    advice,
  ];

  if (input.contextNote) {
    textLines.push(
      '',
      'Possible context',
      `${input.contextNote} This is context reported elsewhere, not an established cause of this reading.`,
    );
  }

  if (input.links.detailUrl) {
    textLines.push('', `See the full reading: ${input.links.detailUrl}`);
  }

  const text = [...textLines, textFooter(input.links, true)].join('\n');

  const contextHtml = input.contextNote
    ? `<h2 style="margin:24px 0 8px 0;font-size:16px;color:#123244;">Possible context</h2>
<p style="margin:0 0 8px 0;font-size:15px;line-height:1.6;">${esc(input.contextNote)}</p>
<p style="margin:0 0 8px 0;font-size:13px;line-height:1.6;color:#6a7a83;">This is context reported elsewhere, not an established cause of this reading.</p>`
    : '';

  const detailHtml = input.links.detailUrl
    ? `<p style="margin:20px 0 0 0;">
<a href="${esc(input.links.detailUrl)}" style="display:inline-block;background-color:#1b4965;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:8px;font-size:16px;font-weight:600;min-height:44px;line-height:20px;">See the full reading</a>
</p>`
    : '';

  const html = htmlShell(
    subject,
    `${htmlCategoryBanner(input.category, headline)}
<h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;color:#123244;">${esc(input.stationName)}, ${esc(input.areaName)}</h1>
<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">${esc(summary)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;font-size:15px;line-height:1.6;border-collapse:collapse;">
<tr><td style="padding:6px 0;color:#4a5a63;width:42%;">Basis</td><td style="padding:6px 0;font-weight:600;">${esc(basisLine)}</td></tr>
<tr><td style="padding:6px 0;color:#4a5a63;">Pollutant</td><td style="padding:6px 0;font-weight:600;">${esc(pollutant.label)} <span style="font-weight:400;color:#4a5a63;">(${esc(pollutant.ariaLabel)})</span></td></tr>
<tr><td style="padding:6px 0;color:#4a5a63;">Concentration</td><td style="padding:6px 0;font-weight:600;">${esc(reading)}</td></tr>
<tr><td style="padding:6px 0;color:#4a5a63;">Measurement time</td><td style="padding:6px 0;font-weight:600;">${esc(measuredAt)}</td></tr>
</table>
<h2 style="margin:24px 0 8px 0;font-size:16px;color:#123244;">What this means</h2>
<p style="margin:0 0 8px 0;font-size:15px;line-height:1.6;">${esc(advice)}</p>
${contextHtml}
${detailHtml}`,
    htmlFooter(input.links, true),
  );

  return { subject, text, html };
}

/* -------------------------------------------------------------------------- */
/*  3. Improvement notice                                                     */
/* -------------------------------------------------------------------------- */

export type ImprovementNoticeInput = {
  areaName: string;
  stationName: string;
  /** Category now. */
  category: AirQualityCategory;
  /** Category at the peak of the episode being closed. */
  previousCategory: AirQualityCategory;
  dominantPollutant: PollutantCode | null;
  value: number | null;
  unit: string;
  measuredAtIso: string;
  basis: ReadingBasis;
  advice?: string;
  links: EmailLinks;
};

/**
 * The episode has ended.
 *
 * Sent because an alert with no all-clear leaves people avoiding the outdoors
 * for longer than the data warrants — the absence of a follow-up is itself
 * misinformation.
 */
export function improvementNoticeEmail(input: ImprovementNoticeInput): EmailContent {
  const measuredAt = formatMaltaTime(input.measuredAtIso);
  const advice = input.advice ?? CATEGORY_ADVICE[input.category];
  const basisLine = describeBasis(input.basis);
  const pollutant = input.dominantPollutant ? POLLUTANTS[input.dominantPollutant] : null;
  const reading = pollutant ? formatConcentration(input.value, input.unit) : null;

  const subject = `Air quality has improved at ${input.stationName}`;
  const summary = `Air quality at ${input.stationName} (${input.areaName}) has returned to ${input.category}, from ${input.previousCategory} earlier.`;

  const textLines = [
    subject,
    '',
    summary,
    '',
    `Basis:   ${basisLine}`,
    `Time:    ${measuredAt}`,
    `Station: ${input.stationName}, ${input.areaName}`,
  ];

  if (pollutant && reading) {
    textLines.push(`Main pollutant: ${pollutant.label} at ${reading}`);
  }

  textLines.push('', 'What this means', advice);

  if (input.links.detailUrl) {
    textLines.push('', `See the current reading: ${input.links.detailUrl}`);
  }

  const text = [...textLines, textFooter(input.links, true)].join('\n');

  const pollutantRow =
    pollutant && reading
      ? `<tr><td style="padding:6px 0;color:#4a5a63;">Main pollutant</td><td style="padding:6px 0;font-weight:600;">${esc(pollutant.label)} at ${esc(reading)}</td></tr>`
      : '';

  const detailHtml = input.links.detailUrl
    ? `<p style="margin:20px 0 0 0;">
<a href="${esc(input.links.detailUrl)}" style="display:inline-block;background-color:#1b4965;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:8px;font-size:16px;font-weight:600;min-height:44px;line-height:20px;">See the current reading</a>
</p>`
    : '';

  const html = htmlShell(
    subject,
    `${htmlCategoryBanner(input.category, `improved from ${input.previousCategory}`)}
<h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;color:#123244;">${esc(input.stationName)}, ${esc(input.areaName)}</h1>
<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">${esc(summary)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;font-size:15px;line-height:1.6;border-collapse:collapse;">
<tr><td style="padding:6px 0;color:#4a5a63;width:42%;">Basis</td><td style="padding:6px 0;font-weight:600;">${esc(basisLine)}</td></tr>
<tr><td style="padding:6px 0;color:#4a5a63;">Measurement time</td><td style="padding:6px 0;font-weight:600;">${esc(measuredAt)}</td></tr>
${pollutantRow}
</table>
<h2 style="margin:24px 0 8px 0;font-size:16px;color:#123244;">What this means</h2>
<p style="margin:0 0 8px 0;font-size:15px;line-height:1.6;">${esc(advice)}</p>
${detailHtml}`,
    htmlFooter(input.links, true),
  );

  return { subject, text, html };
}

/* -------------------------------------------------------------------------- */
/*  4. Weekly summary                                                         */
/* -------------------------------------------------------------------------- */

export type WeeklyStationSummary = {
  stationName: string;
  areaName: string;
  /** Worst category observed in the period. `null` when the station reported
   *  nothing — rendered as "no data", never as "Good". */
  worstCategory: AirQualityCategory | null;
  worstPollutant: PollutantCode | null;
  /** Hours in an elevated band (Poor or worse). */
  elevatedHours: number;
  /** Hours with a usable reading, out of `expectedHours`. */
  observedHours: number;
  expectedHours: number;
};

export type WeeklySummaryInput = {
  periodStartIso: string;
  periodEndIso: string;
  stations: WeeklyStationSummary[];
  links: EmailLinks;
};

/**
 * The weekly digest.
 *
 * Reports data completeness alongside every station, because "no elevated hours"
 * from a station that only reported a third of the week means something quite
 * different from the same figure at full coverage — and only one of those is
 * good news.
 */
export function weeklySummaryEmail(input: WeeklySummaryInput): EmailContent {
  const start = formatMaltaDate(input.periodStartIso);
  const end = formatMaltaDate(input.periodEndIso);
  const subject = `Your weekly Malta air-quality summary, ${start} to ${end}`;

  const describe = (station: WeeklyStationSummary): string => {
    const coverage =
      station.expectedHours > 0
        ? `${Math.round((station.observedHours / station.expectedHours) * 100)}% data coverage`
        : 'coverage unknown';

    if (station.worstCategory === null) {
      return `${station.stationName} (${station.areaName}): no readings available this week — ${coverage}.`;
    }

    const pollutant = station.worstPollutant ? POLLUTANTS[station.worstPollutant].label : 'unknown';
    const elevated =
      station.elevatedHours === 0
        ? 'no hours in a Poor or worse band'
        : station.elevatedHours === 1
          ? '1 hour in a Poor or worse band'
          : `${station.elevatedHours} hours in a Poor or worse band`;

    return `${station.stationName} (${station.areaName}): worst was ${station.worstCategory} (${pollutant}); ${elevated}; ${coverage}.`;
  };

  const text = [
    subject,
    '',
    `A summary of what the five monitoring stations recorded between ${start} and ${end}.`,
    '',
    ...input.stations.map((s) => `- ${describe(s)}`),
    '',
    'These figures describe the European Air Quality Index, which is a communication scale. They are not a legal compliance assessment: EU limit values are defined over 24-hour and annual averaging periods and cannot be judged from a week of hourly readings.',
    '',
    `See the full week: ${input.links.appUrl}`,
    textFooter(input.links, true),
  ].join('\n');

  const rows = input.stations
    .map((station) => {
      const banner =
        station.worstCategory === null
          ? `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background-color:#9aa5b1;color:#1f2933;font-size:13px;font-weight:700;"><span aria-hidden="true">◌</span>&nbsp;No data</span>`
          : `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background-color:${CATEGORY_PRESENTATION[station.worstCategory].color};color:${CATEGORY_PRESENTATION[station.worstCategory].onColor};font-size:13px;font-weight:700;"><span aria-hidden="true">${categoryMarker(station.worstCategory)}</span>&nbsp;${esc(station.worstCategory)}</span>`;

      return `<tr>
<td style="padding:12px 0;border-bottom:1px solid #e8e4da;font-size:15px;line-height:1.5;">
<strong>${esc(station.stationName)}</strong><br>
<span style="color:#4a5a63;font-size:13px;">${esc(station.areaName)}</span>
</td>
<td style="padding:12px 0;border-bottom:1px solid #e8e4da;text-align:right;font-size:15px;line-height:1.5;">
${banner}<br>
<span style="color:#4a5a63;font-size:13px;">${esc(describeCounts(station))}</span>
</td>
</tr>`;
    })
    .join('\n');

  const html = htmlShell(
    subject,
    `<h1 style="margin:0 0 8px 0;font-size:22px;line-height:1.3;color:#123244;">Your weekly air-quality summary</h1>
<p style="margin:0 0 20px 0;font-size:15px;line-height:1.6;color:#4a5a63;">${esc(start)} to ${esc(end)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 20px 0;">
${rows}
</table>
<p style="margin:0 0 12px 0;font-size:13px;line-height:1.6;color:#6a7a83;">These figures describe the European Air Quality Index, which is a communication scale. They are not a legal compliance assessment: EU limit values are defined over 24-hour and annual averaging periods and cannot be judged from a week of hourly readings.</p>
<p style="margin:20px 0 0 0;">
<a href="${esc(input.links.appUrl)}" style="display:inline-block;background-color:#1b4965;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:8px;font-size:16px;font-weight:600;min-height:44px;line-height:20px;">See the full week</a>
</p>`,
    htmlFooter(input.links, true),
  );

  return { subject, text, html };
}

function describeCounts(station: WeeklyStationSummary): string {
  const coverage =
    station.expectedHours > 0
      ? `${Math.round((station.observedHours / station.expectedHours) * 100)}% coverage`
      : 'coverage unknown';

  if (station.worstCategory === null) return coverage;
  const elevated =
    station.elevatedHours === 1 ? '1 elevated hour' : `${station.elevatedHours} elevated hours`;
  return `${elevated} · ${coverage}`;
}
