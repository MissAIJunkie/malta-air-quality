import { ArrowDown, ArrowUp, Minus, Radio } from 'lucide-react';

import { POLLUTANTS, type PollutantCode } from '@/config/pollutants';
import {
  DATE_PATTERNS,
  formatConcentration,
  formatInMalta,
  formatNumber,
  getDictionary,
  t,
  toDateTimeAttribute,
  type Dictionary,
} from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';
import { localised } from './localised';
import type { SeriesStats } from './series';

/**
 * Minimum, maximum and average for one pollutant over one window.
 *
 * Two rules are enforced by construction rather than by discipline:
 *
 *   1. Every figure comes from `summariseSeries`, which counts only directly
 *      measured hours. Modelled gap-fills and forecast hours never enter an
 *      average here, because an average that blends the two is no longer a
 *      statement about what the instrument recorded.
 *   2. `null` renders as the unavailable marker. A window with nothing measured
 *      in it shows "Not available" three times over — never 0, which would be a
 *      measurement claim.
 *
 * The number of measured hours is always shown beside the figures. "Average
 * 27 µg/m³" means something quite different over 168 hours than over 3, and the
 * reader is entitled to know which they are looking at.
 */

export type StatRowProps = {
  stats: SeriesStats;
  pollutant: PollutantCode;
  dict?: Dictionary;
  className?: string;
};

type Stat = {
  id: string;
  label: string;
  value: string;
  /** ISO instant the extreme occurred, where that is meaningful. */
  at?: string | null;
  icon: typeof ArrowDown;
};

export function StatRow({ stats, pollutant, dict = getDictionary(), className }: StatRowProps) {
  const definition = POLLUTANTS[pollutant];

  const entries: Stat[] = [
    {
      id: 'min',
      label: localised(dict, 'stats.minimum', 'Lowest measured'),
      value: formatConcentration(stats.min, definition.unit, dict),
      at: stats.minAt,
      icon: ArrowDown,
    },
    {
      id: 'mean',
      label: localised(dict, 'stats.average', 'Average of measured hours'),
      value: formatConcentration(stats.mean, definition.unit, dict),
      icon: Minus,
    },
    {
      id: 'max',
      label: localised(dict, 'stats.maximum', 'Highest measured'),
      value: formatConcentration(stats.max, definition.unit, dict),
      at: stats.maxAt,
      icon: ArrowUp,
    },
    {
      id: 'count',
      label: localised(dict, 'stats.measuredHours', 'Hours with a measured value'),
      value: localised(dict, 'stats.ofTotal', '{measured} of {total}', {
        measured: formatNumber(stats.measuredCount, 0, dict),
        total: formatNumber(stats.totalCount, 0, dict),
      }),
      icon: Radio,
    },
  ];

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {entries.map((entry) => {
          const Icon = entry.icon;
          const at = entry.at ? toDateTimeAttribute(entry.at) : undefined;

          return (
            <div
              key={entry.id}
              className="rounded-card border-border bg-surface-sunken flex flex-col gap-1 border p-3"
            >
              <dt className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                {entry.label}
              </dt>
              <dd className="tabular text-base font-semibold">{entry.value}</dd>
              {at ? (
                <dd className="text-muted-foreground text-xs">
                  <time dateTime={at} className="tabular">
                    {formatInMalta(entry.at, DATE_PATTERNS.dateTime, dict)}
                  </time>
                </dd>
              ) : null}
            </div>
          );
        })}
      </dl>

      <p className="text-muted-foreground text-xs">
        {localised(
          dict,
          'stats.measuredOnlyNote',
          'Figures cover directly measured hours only. Modelled and forecast hours are excluded from the minimum, maximum and average.',
        )}{' '}
        {t(dict, 'station.provisionalExplain')}
      </p>
    </div>
  );
}
