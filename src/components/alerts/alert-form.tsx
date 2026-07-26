'use client';

import { useId, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

/**
 * Every string this form renders, resolved on the server.
 *
 * Passing plain strings rather than importing the dictionary here keeps the
 * client bundle free of the full translation table and keeps the component
 * locale-agnostic — the page decides the locale, the form just renders.
 */
export type AlertFormLabels = {
  emailLabel: string;
  emailPlaceholder: string;
  emailHelp: string;
  stationLabel: string;
  stationAll: string;
  thresholdLabel: string;
  thresholdHelp: string;
  frequencyLabel: string;
  frequencyImmediate: string;
  frequencyDaily: string;
  extrasLabel: string;
  improvementLabel: string;
  weeklyLabel: string;
  consentLabel: string;
  consentRequired: string;
  submit: string;
  submitting: string;
  success: string;
  successHint: string;
  invalidEmail: string;
  error: string;
  privacyNote: string;
  notEmergency: string;
  required: string;
};

export type AlertFormStation = {
  /** Upstream station id, submitted to the API. */
  id: string;
  name: string;
  locality: string;
  island: string;
};

export type AlertFormThreshold = {
  value: string;
  label: string;
};

export type AlertFormProps = {
  labels: AlertFormLabels;
  stations: AlertFormStation[];
  /** Bands offered as an alerting threshold, worst last. */
  thresholds: AlertFormThreshold[];
  defaultThreshold: string;
  className?: string;
};

type Status = 'idle' | 'submitting' | 'success' | 'error';

const FIELD_CLASS = [
  'h-11 w-full rounded-card border border-border bg-surface px-3 text-sm text-foreground',
  'placeholder:text-muted-foreground',
].join(' ');

/**
 * Subscription form.
 *
 * Accessibility decisions worth stating, because each one is easy to undo by
 * accident:
 *
 *  - Native `<select>`, `<input type="radio">` and `<input type="checkbox">`
 *    rather than custom widgets. They are keyboard- and screen-reader-correct
 *    for free, and on a phone they open the platform picker.
 *  - Related controls are wrapped in `<fieldset>` with a `<legend>`, so a screen
 *    reader announces "How often, As soon as it happens, radio 1 of 2" instead
 *    of an unlabelled radio.
 *  - The outcome lives in one `role="status"` region that is present from first
 *    render. A live region inserted at the moment it gains content is frequently
 *    missed by assistive technology.
 *  - Every interactive row is at least 44px tall.
 */
export function AlertForm({
  labels,
  stations,
  thresholds,
  defaultThreshold,
  className,
}: AlertFormProps) {
  const formId = useId();
  const emailId = `${formId}-email`;
  const emailHelpId = `${formId}-email-help`;
  const stationId = `${formId}-station`;
  const thresholdId = `${formId}-threshold`;
  const thresholdHelpId = `${formId}-threshold-help`;
  const consentId = `${formId}-consent`;
  const statusId = `${formId}-status`;

  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string>('');

  const [email, setEmail] = useState('');
  const [station, setStation] = useState('');
  const [threshold, setThreshold] = useState(defaultThreshold);
  const [frequency, setFrequency] = useState<'immediate' | 'daily'>('immediate');
  const [improvement, setImprovement] = useState(true);
  const [weekly, setWeekly] = useState(false);
  const [consent, setConsent] = useState(false);

  const byIsland = groupByIsland(stations);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === 'submitting') return;

    if (!consent) {
      setStatus('error');
      setMessage(labels.consentRequired);
      return;
    }

    setStatus('submitting');
    setMessage('');

    const alertTypes = ['air-quality'];
    if (improvement) alertTypes.push('improvement');
    if (weekly) alertTypes.push('weekly-summary');

    try {
      const response = await fetch('/api/alerts/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          consent: true,
          alertTypes,
          ...(station ? { station } : {}),
          thresholdCategory: threshold,
          frequency,
        }),
      });

      if (response.ok) {
        setStatus('success');
        setMessage(labels.success);
        return;
      }

      // A 400 here is almost always the address; anything else is ours to own.
      setStatus('error');
      setMessage(response.status === 400 ? labels.invalidEmail : labels.error);
    } catch {
      // Offline, or the request was blocked. Never blame the person's address
      // for a failure we cannot attribute to it.
      setStatus('error');
      setMessage(labels.error);
    }
  }

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      {status === 'success' ? (
        <div className="rounded-card border-success bg-surface-raised flex flex-col gap-2 border p-4">
          <p className="text-foreground text-sm leading-relaxed font-medium">{labels.success}</p>
          <p className="text-muted-foreground text-sm leading-relaxed">{labels.successHint}</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
          {/* Email ------------------------------------------------------------ */}
          <div className="flex flex-col gap-2">
            <label htmlFor={emailId} className="text-foreground text-sm font-medium">
              {labels.emailLabel}{' '}
              <span className="text-muted-foreground font-normal">({labels.required})</span>
            </label>
            <input
              id={emailId}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              maxLength={254}
              placeholder={labels.emailPlaceholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-describedby={emailHelpId}
              className={FIELD_CLASS}
            />
            <p id={emailHelpId} className="text-muted-foreground text-sm leading-relaxed">
              {labels.emailHelp}
            </p>
          </div>

          {/* Station ---------------------------------------------------------- */}
          <div className="flex flex-col gap-2">
            <label htmlFor={stationId} className="text-foreground text-sm font-medium">
              {labels.stationLabel}
            </label>
            <select
              id={stationId}
              name="station"
              value={station}
              onChange={(e) => setStation(e.target.value)}
              className={FIELD_CLASS}
            >
              <option value="">{labels.stationAll}</option>
              {byIsland.map(([island, group]) => (
                <optgroup key={island} label={island}>
                  {group.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {s.locality}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Threshold -------------------------------------------------------- */}
          <div className="flex flex-col gap-2">
            <label htmlFor={thresholdId} className="text-foreground text-sm font-medium">
              {labels.thresholdLabel}
            </label>
            <select
              id={thresholdId}
              name="thresholdCategory"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              aria-describedby={thresholdHelpId}
              className={FIELD_CLASS}
            >
              {thresholds.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p id={thresholdHelpId} className="text-muted-foreground text-sm leading-relaxed">
              {labels.thresholdHelp}
            </p>
          </div>

          {/* Frequency -------------------------------------------------------- */}
          <fieldset className="flex flex-col gap-2 border-0 p-0">
            <legend className="text-foreground mb-1 text-sm font-medium">
              {labels.frequencyLabel}
            </legend>
            {(
              [
                ['immediate', labels.frequencyImmediate],
                ['daily', labels.frequencyDaily],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className="rounded-card text-foreground flex min-h-11 cursor-pointer items-center gap-3 px-1 py-2 text-sm"
              >
                <input
                  type="radio"
                  name="frequency"
                  value={value}
                  checked={frequency === value}
                  onChange={() => setFrequency(value)}
                  className="accent-primary size-5"
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>

          {/* Extras ----------------------------------------------------------- */}
          <fieldset className="flex flex-col gap-2 border-0 p-0">
            <legend className="text-foreground mb-1 text-sm font-medium">
              {labels.extrasLabel}
            </legend>
            <label className="rounded-card text-foreground flex min-h-11 cursor-pointer items-center gap-3 px-1 py-2 text-sm">
              <input
                type="checkbox"
                name="improvement"
                checked={improvement}
                onChange={(e) => setImprovement(e.target.checked)}
                className="accent-primary size-5"
              />
              <span>{labels.improvementLabel}</span>
            </label>
            <label className="rounded-card text-foreground flex min-h-11 cursor-pointer items-center gap-3 px-1 py-2 text-sm">
              <input
                type="checkbox"
                name="weekly"
                checked={weekly}
                onChange={(e) => setWeekly(e.target.checked)}
                className="accent-primary size-5"
              />
              <span>{labels.weeklyLabel}</span>
            </label>
          </fieldset>

          {/* Consent ---------------------------------------------------------- */}
          <div className="flex flex-col gap-2">
            <label
              htmlFor={consentId}
              className="text-foreground flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-relaxed"
            >
              <input
                id={consentId}
                name="consent"
                type="checkbox"
                required
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="accent-primary mt-0.5 size-5 shrink-0"
              />
              <span>{labels.consentLabel}</span>
            </label>
            <p className="text-muted-foreground text-sm leading-relaxed">{labels.privacyNote}</p>
          </div>

          <Button type="submit" size="lg" disabled={status === 'submitting'} className="self-start">
            {status === 'submitting' ? labels.submitting : labels.submit}
          </Button>
        </form>
      )}

      {/*
        One live region, rendered outside the conditional above so it is in the
        document from first paint and is never unmounted. A live region inserted
        at the moment it gains content is frequently missed by assistive
        technology, which is exactly the case that matters here.
      */}
      <p
        id={statusId}
        role={status === 'error' ? 'alert' : 'status'}
        aria-live={status === 'error' ? 'assertive' : 'polite'}
        className={cn(
          'text-sm leading-relaxed',
          status === 'error' ? 'text-danger font-medium' : 'text-muted-foreground',
        )}
      >
        {message}
      </p>

      <p className="text-muted-foreground text-sm leading-relaxed">{labels.notEmergency}</p>
    </div>
  );
}

/** Group stations under their island, preserving the order they arrive in. */
function groupByIsland(stations: AlertFormStation[]): [string, AlertFormStation[]][] {
  const groups = new Map<string, AlertFormStation[]>();
  for (const station of stations) {
    const existing = groups.get(station.island);
    if (existing) existing.push(station);
    else groups.set(station.island, [station]);
  }
  return [...groups.entries()];
}
