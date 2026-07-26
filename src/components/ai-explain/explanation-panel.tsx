import { Calculator, CircleHelp, Minus, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';

import type { AirQualityExplanation, FactorConfidence, FactorImpact } from '@/lib/ai/schemas';
import {
  DATE_PATTERNS,
  formatInMalta,
  getDictionary,
  t,
  toDateTimeAttribute,
  type Dictionary,
} from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';
import { Badge } from '@/components/ui/badge';
import { localised } from '@/components/charts/localised';

/**
 * The rendered explanation.
 *
 * `/api/explain` returns HTTP 200 whether a language model wrote the text or
 * the deterministic builder did, and `generated` says which. That distinction
 * is the whole reason this component branches: labelling the deterministic
 * output "AI-generated" would be a false provenance claim, and in a deployment
 * with no `OPENROUTER_API_KEY` it would be a false claim on every single page
 * view. The deterministic path is not an error state and is never presented as
 * one — it is simply a different, and more auditable, author.
 *
 * Citations are resolved against the source labels the server built from the
 * same reading, so `obs.pm10` is shown as the measurement it refers to. An id
 * with no label is printed as-is rather than dropped: an unresolved citation is
 * still a citation, and hiding it would overstate how well we understand the
 * output.
 */

/**
 * VERBATIM. Required by the product brief wherever AI-written text is shown.
 *
 * Held as a constant rather than a dictionary key for the same reason
 * `footer.attribution` and `disclaimer.medical` are marked as fixed text in the
 * dictionary: the exact wording is a commitment, not a copy decision.
 */
export const AI_GENERATED_NOTICE =
  'AI-generated explanation based on current measurements and cited environmental sources.';

const IMPACT: Record<FactorImpact, { key: string; text: string; icon: typeof Minus }> = {
  worsening: { key: 'ai.impact.worsening', text: 'Pushing levels up', icon: TrendingUp },
  improving: { key: 'ai.impact.improving', text: 'Pushing levels down', icon: TrendingDown },
  mixed: { key: 'ai.impact.mixed', text: 'Mixed effect', icon: Minus },
  unknown: { key: 'ai.impact.unknown', text: 'Direction not established', icon: CircleHelp },
};

const CONFIDENCE: Record<FactorConfidence, { key: string; text: string }> = {
  high: { key: 'ai.confidence.high', text: 'Higher confidence' },
  medium: { key: 'ai.confidence.medium', text: 'Moderate confidence' },
  low: { key: 'ai.confidence.low', text: 'Lower confidence' },
};

export type ExplanationResult = {
  explanation: AirQualityExplanation;
  /** Which author produced the text. Decides the notice, and nothing else. */
  generated: 'ai' | 'fallback';
  /** ISO-8601 UTC instant the explanation was produced. */
  generatedAt: string;
  model?: string;
  cached?: boolean;
  /** The verbatim medical disclaimer, as returned by the API. */
  disclaimer: string;
};

export type ExplanationPanelProps = {
  result: ExplanationResult;
  /** Source id → human label, built server-side from the same measurements. */
  sourceLabels?: Record<string, string>;
  headingId?: string;
  dict?: Dictionary;
  className?: string;
};

export function ExplanationPanel({
  result,
  sourceLabels = {},
  headingId,
  dict = getDictionary(),
  className,
}: ExplanationPanelProps) {
  const { explanation, generated } = result;
  const isAi = generated === 'ai';
  const generatedAt = toDateTimeAttribute(result.generatedAt);

  return (
    <div
      className={cn(
        'rounded-card border-border bg-surface flex flex-col gap-3 border p-4',
        className,
      )}
    >
      <h3 id={headingId} className="text-base leading-tight font-semibold">
        {explanation.headline}
      </h3>

      <p className="text-sm leading-relaxed">{explanation.summary}</p>

      {explanation.contributingFactors.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">
            {localised(dict, 'ai.factorsHeading', 'What is contributing')}
          </h4>
          <ul className="flex flex-col gap-1.5">
            {explanation.contributingFactors.map((factor) => {
              const impact = IMPACT[factor.impact];
              const Icon = impact.icon;
              return (
                <li key={factor.label} className="flex items-start gap-2 text-sm">
                  <Icon
                    className="text-muted-foreground mt-0.5 size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span>
                    {factor.label}
                    <span className="text-muted-foreground block text-xs">
                      {localised(dict, impact.key, impact.text)}
                      {' · '}
                      {localised(
                        dict,
                        CONFIDENCE[factor.confidence].key,
                        CONFIDENCE[factor.confidence].text,
                      )}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <h4 className="text-sm font-semibold">
          {localised(dict, 'ai.uncertaintyHeading', 'What this cannot tell you')}
        </h4>
        <p className="text-muted-foreground text-sm leading-relaxed">{explanation.uncertainty}</p>
      </div>

      {explanation.sourceIds.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h4 className="text-sm font-semibold">
            {localised(dict, 'ai.citationsHeading', 'What this is based on')}
          </h4>
          <ul className="text-muted-foreground list-disc pl-5 text-xs leading-relaxed">
            {explanation.sourceIds.map((id) => (
              <li key={id}>{sourceLabels[id] ?? id}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Provenance. The branch that matters most on this page. */}
      <div className="border-border flex flex-col gap-1.5 border-t pt-3">
        <p className="text-muted-foreground flex items-start gap-2 text-xs leading-relaxed">
          {isAi ? (
            <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <Calculator className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          )}
          <span>
            {isAi
              ? AI_GENERATED_NOTICE
              : localised(
                  dict,
                  'ai.deterministicNotice',
                  'Written automatically from the measurements shown on this page. No AI was involved.',
                )}{' '}
            {t(dict, 'ai.doesNotCompute')}
          </span>
        </p>

        <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {generatedAt ? (
            <span className="tabular">
              {t(dict, 'context.generatedAt', {
                time: formatInMalta(result.generatedAt, DATE_PATTERNS.dateTime, dict),
              })}
            </span>
          ) : null}
          {isAi && result.model ? <Badge variant="subtle">{result.model}</Badge> : null}
          {result.cached ? (
            <Badge variant="subtle">
              {localised(dict, 'ai.reusedAnswer', 'Reused an earlier answer for this hour')}
            </Badge>
          ) : null}
        </p>

        <p className="text-muted-foreground text-xs leading-relaxed">{result.disclaimer}</p>
      </div>
    </div>
  );
}
