/**
 * /alerts — set up, confirm and cancel email alerts.
 *
 * A server component. It resolves every string through the dictionary, decides
 * whether this deployment can send email at all, and hands the client component
 * plain data.
 *
 * The `?state=` parameter is set by the confirm and unsubscribe routes when
 * somebody follows a link from an email. It carries no token, so the resulting
 * URL is safe to bookmark, share or leave in a browser history.
 */

import type { Metadata } from 'next';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertForm,
  type AlertFormLabels,
  type AlertFormStation,
  type AlertFormThreshold,
} from '@/components/alerts/alert-form';
import { getCapabilities } from '@/config/env';
import { STATIONS } from '@/config/stations';
import { AIR_QUALITY_CATEGORIES, type AirQualityCategory } from '@/config/thresholds';
import { getDictionary, hasKey, t, categoryLabelKey } from '@/lib/i18n';
import { MEDICAL_DISCLAIMER, DATA_ATTRIBUTION } from '@/lib/notifications/templates';

// No brand in the title: the root layout's template already appends it, and
// "— maqua.app | maqua.app" is what a hardcoded suffix produces.
const PAGE_TITLE = 'Air-quality alerts';
const PAGE_DESCRIPTION =
  'Get an email when air quality at a Maltese monitoring station reaches a band you care about.';

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: '/alerts' },
  openGraph: { title: PAGE_TITLE, description: PAGE_DESCRIPTION, type: 'website' },
};

/**
 * Bands offered as an alerting threshold.
 *
 * Good and Fair are excluded on purpose: an email that says "the air is fine"
 * every hour trains people to ignore the ones that matter.
 */
const THRESHOLD_CATEGORIES: AirQualityCategory[] = AIR_QUALITY_CATEGORIES.filter(
  (category) => category !== 'Good' && category !== 'Fair',
);

const DEFAULT_THRESHOLD: AirQualityCategory = 'Poor';

/** Outcomes the confirm and unsubscribe routes can redirect here with. */
const OUTCOME_KEYS = {
  confirmed: 'alerts.confirmSuccess',
  'confirm-invalid': 'alerts.confirmError',
  'confirm-expired': 'alerts.confirmError',
  unsubscribed: 'alerts.unsubscribeSuccess',
  'alerts-unavailable': 'alerts.unavailable',
} as const;

type Outcome = keyof typeof OUTCOME_KEYS;

function isOutcome(value: unknown): value is Outcome {
  return typeof value === 'string' && value in OUTCOME_KEYS;
}

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const dict = getDictionary();
  const params = await searchParams;
  const rawState = Array.isArray(params.state) ? params.state[0] : params.state;
  const outcome = isOutcome(rawState) ? rawState : null;

  /**
   * Resolve a key, falling back to English if the dictionary does not carry it.
   *
   * `t()` returns the key itself when it is missing, which is the right
   * behaviour during development but would show `alerts.emailHelp` to a member
   * of the public. The key stays the source of truth once it exists; the
   * fallback only covers copy this page needs that the shared dictionary has not
   * grown yet.
   */
  const s = (key: string, fallback: string): string =>
    hasKey(dict, key) ? t(dict, key) : fallback;

  /**
   * Alerts need BOTH halves, and the form is shown only when both are present.
   *
   * `capabilities.email` covers RESEND_API_KEY and ALERT_TOKEN_SECRET;
   * `capabilities.database` covers the row that records the pending
   * confirmation. `/api/alerts/subscribe` refuses on either, so gating on email
   * alone would render a form that looks entirely functional and fails on every
   * submission — the exact broken state this page exists to avoid.
   */
  const capabilities = getCapabilities();
  const alertsEnabled = capabilities.email && capabilities.database;

  const labels: AlertFormLabels = {
    emailLabel: t(dict, 'alerts.emailLabel'),
    emailPlaceholder: t(dict, 'alerts.emailPlaceholder'),
    emailHelp: s(
      'alerts.emailHelp',
      'We will send one confirmation email. Alerts start only after you follow the link in it.',
    ),
    stationLabel: t(dict, 'alerts.stationLabel'),
    stationAll: t(dict, 'alerts.stationAll'),
    thresholdLabel: t(dict, 'alerts.thresholdLabel'),
    thresholdHelp: t(dict, 'alerts.thresholdHelp'),
    frequencyLabel: t(dict, 'alerts.frequencyLabel'),
    frequencyImmediate: t(dict, 'alerts.frequencyImmediate'),
    frequencyDaily: t(dict, 'alerts.frequencyDaily'),
    extrasLabel: s('alerts.extrasLabel', 'Also send me'),
    improvementLabel: s('alerts.improvementLabel', 'A note when air quality improves again'),
    weeklyLabel: s('alerts.weeklyLabel', 'A weekly summary'),
    consentLabel: t(dict, 'alerts.consentLabel'),
    consentRequired: t(dict, 'alerts.consentRequired'),
    submit: t(dict, 'alerts.submit'),
    submitting: t(dict, 'alerts.submitting'),
    success: t(dict, 'alerts.success'),
    successHint: t(dict, 'alerts.successHint'),
    invalidEmail: t(dict, 'alerts.invalidEmail'),
    error: t(dict, 'alerts.error'),
    privacyNote: t(dict, 'alerts.privacyNote'),
    notEmergency: t(dict, 'alerts.notEmergency'),
    required: t(dict, 'common.required'),
  };

  const stations: AlertFormStation[] = STATIONS.filter((station) => station.active).map(
    (station) => ({
      id: station.id,
      name: station.name,
      locality: station.locality,
      island: station.island,
    }),
  );

  const thresholds: AlertFormThreshold[] = THRESHOLD_CATEGORIES.map((category) => ({
    value: category,
    // The dictionary is authoritative for the band name; the raw category value
    // is the fallback so a missing key never leaves an empty option.
    label: hasKey(dict, categoryLabelKey(category))
      ? t(dict, categoryLabelKey(category))
      : category,
  }));

  return (
    <main id="main" className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-foreground text-2xl font-semibold tracking-tight sm:text-3xl">
          {t(dict, 'alerts.sectionTitle')}
        </h1>
        <p className="text-muted-foreground text-base leading-relaxed">
          {t(dict, 'alerts.description')}
        </p>
      </header>

      {outcome ? (
        <p
          role="status"
          className="rounded-card border-border-strong bg-surface-raised text-foreground border p-4 text-sm leading-relaxed font-medium"
        >
          {t(dict, OUTCOME_KEYS[outcome])}
        </p>
      ) : null}

      {alertsEnabled ? (
        <Card asSection>
          <CardHeader>
            <CardTitle as="h2">{s('alerts.formTitle', 'Set up an alert')}</CardTitle>
            <CardDescription>
              {s(
                'alerts.formDescription',
                'Choose where and from which band. You can change or stop these at any time.',
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertForm
              labels={labels}
              stations={stations}
              thresholds={thresholds}
              defaultThreshold={DEFAULT_THRESHOLD}
            />
          </CardContent>
        </Card>
      ) : (
        /*
         * Honest unavailable state.
         *
         * A form that posts to an endpoint which cannot send email would take an
         * address, promise a confirmation link and deliver nothing. Saying so
         * plainly is the only acceptable behaviour, and it is what the app does
         * by default: alerts need RESEND_API_KEY, ALERT_TOKEN_SECRET and a
         * database, none of which are required to run maqua.app.
         */
        <Card asSection>
          <CardHeader>
            <CardTitle as="h2">{t(dict, 'alerts.unavailable')}</CardTitle>
            <CardDescription>
              {s(
                'alerts.unavailableDetail',
                'No addresses are being collected and no alerts can be sent. Everything else on maqua.app — the map, the stations, the history and the API — works as normal.',
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Name the missing piece rather than a generic "misconfigured":
                whoever runs the deployment is the one reading this. */}
            <p className="text-muted-foreground text-sm leading-relaxed">
              {!capabilities.email
                ? s(
                    'alerts.unavailableEmail',
                    'This deployment has no email service configured (RESEND_API_KEY and ALERT_TOKEN_SECRET).',
                  )
                : s(
                    'alerts.unavailableDatabase',
                    'This deployment has no database configured (DATABASE_URL), so a subscription could not be recorded.',
                  )}
            </p>
          </CardContent>
        </Card>
      )}

      <section aria-labelledby="alerts-limits" className="flex flex-col gap-2">
        <h2 id="alerts-limits" className="text-foreground text-base font-semibold">
          {s('alerts.limitsTitle', 'What these alerts are, and are not')}
        </h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {s(
            'alerts.limitsBody',
            'Alerts describe the European Air Quality Index, a communication scale. They are not a legal compliance assessment: EU limit values are defined over 24-hour and annual averaging periods and cannot be judged from a single hourly reading. Where a figure is modelled or forecast rather than measured, the email says so.',
          )}
        </p>
        <p className="text-foreground text-sm leading-relaxed font-medium">{MEDICAL_DISCLAIMER}</p>
        <p className="text-muted-foreground text-xs leading-relaxed">{DATA_ATTRIBUTION}</p>
      </section>
    </main>
  );
}
