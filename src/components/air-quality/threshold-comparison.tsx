import type * as React from 'react';

import { PollutantName } from '@/components/pollutants/pollutant-value';
import { POLLUTANTS, type PollutantCode } from '@/config/pollutants';
import {
  compareToThresholds,
  type ThresholdComparison as ThresholdComparisonResult,
} from '@/lib/air-quality/calculate-index';
import {
  formatConcentrationParts,
  formatNumber,
  getDictionary,
  t,
  type Dictionary,
} from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';

type HeadingLevel = 'h2' | 'h3' | 'h4';

const SUB_HEADING: Record<HeadingLevel, 'h3' | 'h4' | 'h5'> = {
  h2: 'h3',
  h3: 'h4',
  h4: 'h5',
};

export type ThresholdComparisonProps = Omit<React.ComponentProps<'section'>, 'children'> & {
  pollutant: PollutantCode;
  /** The hourly concentration being compared. `null` renders nothing. */
  value: number | null;
  /** Precomputed comparisons. Defaults to `compareToThresholds(pollutant, value)`. */
  comparisons?: readonly ThresholdComparisonResult[];
  /** Show only the thresholds the reading sits above. */
  onlyAbove?: boolean;
  headingLevel?: HeadingLevel;
  dict?: Dictionary;
};

/**
 * One hourly reading, set against the EU limit values and WHO guidelines.
 *
 * The single hardest thing this component has to do is not overstate what it is
 * showing. Almost every EU limit is an average over 24 hours or a calendar
 * year, and several permit a fixed number of exceedances before the limit is
 * breached at all — so a reading above one of those numbers is an observation
 * about one hour and nothing more. `compareToThresholds()` marks exactly that
 * with its `conclusive` flag, and every non-conclusive row here carries the
 * explanation immediately beneath the comparison, in the same list item, where
 * it cannot be read apart from it.
 *
 * There is deliberately no summary, count or verdict anywhere in this
 * component. "Two limits exceeded" would be the precise claim the data does not
 * support, however carefully the rows beneath it were worded.
 */
export function ThresholdComparison({
  pollutant,
  value,
  comparisons,
  onlyAbove = false,
  headingLevel = 'h3',
  dict = getDictionary(),
  className,
  ...props
}: ThresholdComparisonProps) {
  const all = comparisons ?? compareToThresholds(pollutant, value);
  const rows = onlyAbove ? all.filter((row) => row.above) : all;

  if (rows.length === 0) return null;

  const Heading = headingLevel;
  const SubHeading = SUB_HEADING[headingLevel];

  const euLimits = rows.filter((row) => row.kind === 'eu-limit');
  const whoGuidelines = rows.filter((row) => row.kind === 'who-guideline');

  const unit = POLLUTANTS[pollutant].unit;
  const reading = formatConcentrationParts(value, unit, dict);

  const groups = [
    {
      kind: 'eu-limit' as const,
      titleKey: 'threshold.euLimit',
      noteKey: 'threshold.legalNote',
      rows: euLimits,
    },
    {
      kind: 'who-guideline' as const,
      titleKey: 'threshold.whoGuideline',
      noteKey: 'threshold.whoNote',
      rows: whoGuidelines,
    },
  ].filter((group) => group.rows.length > 0);

  return (
    <section
      data-slot="threshold-comparison"
      data-pollutant={pollutant}
      className={cn('flex flex-col gap-4', className)}
      {...props}
    >
      <div className="flex flex-col gap-1">
        <Heading className="text-base font-semibold">{t(dict, 'threshold.sectionTitle')}</Heading>
        <p className="text-muted-foreground text-sm">
          <PollutantName pollutant={pollutant} className="font-medium" />
          {t(dict, 'common.separator')}
          <span className="tabular">{reading.text}</span>
        </p>
      </div>

      {groups.map((group) => (
        <div key={group.kind} className="flex flex-col gap-2">
          <SubHeading className="text-sm font-semibold">{t(dict, group.titleKey)}</SubHeading>

          <ul className="flex flex-col gap-3">
            {group.rows.map((row) => (
              <ThresholdRow
                key={`${row.kind}-${row.threshold}-${row.averagingPeriod}`}
                row={row}
                kindLabel={t(dict, group.titleKey)}
                dict={dict}
              />
            ))}
          </ul>

          <p className="text-muted-foreground text-xs leading-relaxed">{t(dict, group.noteKey)}</p>
        </div>
      ))}
    </section>
  );
}

function ThresholdRow({
  row,
  kindLabel,
  dict,
}: {
  row: ThresholdComparisonResult;
  kindLabel: string;
  dict: Dictionary;
}) {
  const threshold = formatNumber(row.threshold, 0, dict);

  const statement = t(dict, row.above ? 'threshold.above' : 'threshold.below', {
    reference: kindLabel,
    threshold,
    unit: row.unit,
  });

  return (
    <li
      data-above={row.above}
      data-conclusive={row.conclusive}
      className="border-border flex flex-col gap-1 border-l-2 pl-3"
    >
      <p className="text-sm font-medium">{statement}</p>

      <p className="text-muted-foreground text-xs">
        {t(dict, 'threshold.value', {
          value: threshold,
          unit: row.unit,
          period: row.averagingPeriod,
        })}
      </p>

      {/* The caveat sits inside the same list item as the comparison it
          qualifies. Separating them — into a footnote, or a note at the end of
          the group — would let a reader take the sentence above as a finding
          about legal compliance, which for a long-averaging limit it is not. */}
      {row.conclusive ? (
        row.above ? (
          <p className="text-sm leading-relaxed">{t(dict, 'threshold.conclusiveExceedance')}</p>
        ) : null
      ) : (
        <p className="text-muted-foreground text-xs leading-relaxed">
          {t(dict, 'threshold.inconclusive', { period: row.averagingPeriod })}
        </p>
      )}

      <p className="text-muted-foreground text-xs">
        {t(dict, 'threshold.reference', { reference: row.reference })}
      </p>
    </li>
  );
}
