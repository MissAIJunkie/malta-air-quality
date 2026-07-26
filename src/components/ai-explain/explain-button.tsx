'use client';

import { useCallback, useId, useState } from 'react';
import { Sparkles } from 'lucide-react';

import type { AirQualityExplanation, ExplanationLocale } from '@/lib/ai/schemas';
import { getDictionary, t } from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';
import { Button } from '@/components/ui/button';
import { localised } from '@/components/charts/localised';
import { ExplanationPanel, type ExplanationResult } from './explanation-panel';

/**
 * "Explain this" — on demand, and only on demand.
 *
 * Nothing is requested until someone asks. Generating an explanation for every
 * visitor would burn a model call on the overwhelming majority of readers who
 * only wanted the number, and would make an optional feature into a tax on
 * every page load.
 *
 * ## Failure is not an error state
 *
 * The endpoint already degrades to a deterministic explanation whenever AI is
 * off, unconfigured, rate-limited or refused by the validator, and returns it
 * with HTTP 200. This component covers the one case the endpoint cannot: the
 * request never arriving. The server has already computed the same
 * deterministic explanation from the same reading and passed it down as
 * `fallback`, so a dead network yields the identical text a working one would
 * have — not an apology.
 *
 * ## Announcement
 *
 * The result lands in an `aria-live="polite"` region that is present, and
 * empty, from first render. The completed text is written once: there is no
 * token-by-token streaming, because a live region that mutates on every token
 * is read out as a stutter of fragments and is worse than useless.
 */

export type ExplainButtonProps = {
  /** Station slug or upstream code. The server resolves the reading itself. */
  stationId: string;
  stationName: string;
  /** Source id → human label, for resolving the citations the model returns. */
  sourceLabels?: Record<string, string>;
  /**
   * Deterministic explanation for this reading, computed on the server.
   *
   * Present so that a failed request still shows the same words a successful
   * degraded request would have shown.
   */
  fallback: AirQualityExplanation;
  /** The verbatim medical disclaimer. */
  disclaimer: string;
  locale?: ExplanationLocale;
  className?: string;
};

type Status = 'idle' | 'loading' | 'ready';

export function ExplainButton({
  stationId,
  stationName,
  sourceLabels = {},
  fallback,
  disclaimer,
  locale = 'en',
  className,
}: ExplainButtonProps) {
  const dict = getDictionary();
  const regionId = useId();

  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<ExplanationResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const localFallback = useCallback(
    (): ExplanationResult => ({
      explanation: fallback,
      generated: 'fallback',
      generatedAt: new Date().toISOString(),
      disclaimer,
    }),
    [fallback, disclaimer],
  );

  const request = useCallback(async () => {
    setStatus('loading');
    setNotice(null);

    try {
      const response = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stationId, locale }),
      });

      if (response.status === 429) {
        // Flooding is the reader's own doing and worth saying, but they still
        // get an explanation rather than a closed door.
        setNotice(t(dict, 'ai.rateLimited'));
        setResult(localFallback());
        return;
      }

      const body: unknown = await response.json().catch(() => null);
      const data =
        body && typeof body === 'object' && 'data' in body
          ? (body as { data: Partial<ExplanationResult> & { generated?: string } }).data
          : null;

      if (!response.ok || !data?.explanation) {
        setResult(localFallback());
        return;
      }

      setResult({
        explanation: data.explanation,
        // Anything other than an explicit 'ai' is treated as deterministic, so
        // a malformed field can only ever under-claim the model's involvement.
        generated: data.generated === 'ai' ? 'ai' : 'fallback',
        generatedAt: data.generatedAt ?? new Date().toISOString(),
        ...(data.model ? { model: data.model } : {}),
        cached: Boolean(data.cached),
        disclaimer: data.disclaimer ?? disclaimer,
      });
    } catch {
      // Offline, aborted, blocked — all the same answer.
      setResult(localFallback());
    } finally {
      setStatus('ready');
    }
  }, [dict, disclaimer, locale, localFallback, stationId]);

  const busy = status === 'loading';
  const canRetry = status === 'ready' && result?.generated === 'ai';

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={request}
          disabled={busy}
          aria-controls={regionId}
        >
          <Sparkles aria-hidden="true" />
          {busy ? t(dict, 'ai.explaining') : t(dict, 'ai.explain')}
          <span className="sr-only"> — {stationName}</span>
        </Button>

        {canRetry ? (
          <Button type="button" variant="ghost" size="sm" onClick={request} disabled={busy}>
            {t(dict, 'ai.regenerate')}
          </Button>
        ) : null}
      </div>

      <p className="text-muted-foreground text-xs leading-relaxed">
        {t(dict, 'ai.notMedical')} {t(dict, 'ai.unavailableHint')}
      </p>

      {/*
        Present and empty from first render: a live region added to the DOM at
        the same moment as its content is frequently not announced at all.
      */}
      <div id={regionId} aria-live="polite" aria-busy={busy} className="flex flex-col gap-3">
        {busy ? <p className="text-muted-foreground text-sm">{t(dict, 'ai.explaining')}…</p> : null}

        {notice ? (
          <p className="rounded-card border-border bg-surface-sunken border p-3 text-sm">
            {notice}
          </p>
        ) : null}

        {status === 'ready' && result ? (
          <ExplanationPanel result={result} sourceLabels={sourceLabels} dict={dict} />
        ) : null}
      </div>

      {status === 'idle' ? (
        <p className="sr-only">
          {localised(
            dict,
            'ai.idleHint',
            'No explanation has been requested. Activate the button to prepare one.',
          )}
        </p>
      ) : null}
    </div>
  );
}
