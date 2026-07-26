import type * as React from 'react';

import { CategoryBadge } from '@/components/air-quality/category-badge';
import { Badge } from '@/components/ui/badge';
import { VisuallyHidden } from '@/components/ui/visually-hidden';
import { POLLUTANTS, type PollutantCode } from '@/config/pollutants';
import type { PollutantReading } from '@/lib/air-quality/types';
import { formatConcentrationParts, getDictionary, t, type Dictionary } from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';

/**
 * A pollutant's name, written for both eyes and ears.
 *
 * The display labels carry subscripts ("NO₂") and bare formulae ("PM2.5"),
 * which screen readers voice poorly or letter by letter. The spoken form comes
 * from `POLLUTANTS[...].ariaLabel`, which exists precisely for this.
 */
export function PollutantName({
  pollutant,
  className,
  ...props
}: Omit<React.ComponentProps<'span'>, 'children'> & { pollutant: PollutantCode }) {
  const definition = POLLUTANTS[pollutant];

  return (
    <span data-slot="pollutant-name" className={className} {...props}>
      <span aria-hidden="true">{definition.label}</span>
      <VisuallyHidden>{definition.ariaLabel}</VisuallyHidden>
    </span>
  );
}

/**
 * The unit, shown as a symbol and spoken in words.
 *
 * "µg/m³" is announced as an unhelpful run of characters by most screen
 * readers, so the symbol is hidden from the accessibility tree and the written
 * form supplied alongside it.
 */
export function ConcentrationUnit({
  unit,
  dict = getDictionary(),
  className,
  ...props
}: Omit<React.ComponentProps<'span'>, 'children'> & { unit: string; dict?: Dictionary }) {
  const symbol = t(dict, 'unit.microgramsPerCubicMetre');
  const spoken = unit === symbol ? t(dict, 'unit.microgramsPerCubicMetreLong') : unit;

  return (
    <span data-slot="concentration-unit" className={className} {...props}>
      <span aria-hidden="true">{unit}</span>
      <VisuallyHidden> {spoken}</VisuallyHidden>
    </span>
  );
}

/**
 * Averaging periods arrive from the config as English data ("Hourly"), not as
 * keys. The one value the AQI actually uses has a dictionary entry, so it is
 * translated; anything else is passed through rather than mangled.
 */
export function averagingPeriodLabel(period: string, dict: Dictionary = getDictionary()): string {
  return period === 'Hourly' ? t(dict, 'unit.hourly') : period;
}

export type PollutantValueProps = Omit<React.ComponentProps<'div'>, 'children'> & {
  pollutant: PollutantCode;
  /**
   * The reading, or `null`/`undefined` when the station published nothing for
   * this pollutant this hour. Absence is rendered explicitly, never as zero.
   */
  reading: PollutantReading | null | undefined;
  /** `inline` for table cells and cards; `detail` adds the supporting facts. */
  variant?: 'inline' | 'detail';
  /** Set false where the surrounding row or heading already names the pollutant. */
  showPollutant?: boolean;
  /** Mark this as the pollutant that set the station's overall band. */
  dominant?: boolean;
  dict?: Dictionary;
};

/**
 * One pollutant's concentration, with its unit and its band.
 *
 * Three distinct states, kept distinct:
 *   - a value            → the number, its unit and its category
 *   - a reading with no value → "Not available", plus why that is not a zero
 *   - no reading at all       → "No value for this hour"
 *
 * The second and third are different facts. The instrument reporting nothing
 * usable and the feed omitting the pollutant entirely are both absences, but
 * conflating them with each other — or with a measurement of zero — would put a
 * claim on screen that the data does not support.
 */
export function PollutantValue({
  pollutant,
  reading,
  variant = 'inline',
  showPollutant = true,
  dominant = false,
  dict = getDictionary(),
  className,
  ...props
}: PollutantValueProps) {
  const definition = POLLUTANTS[pollutant];
  const unit = reading?.unit ?? definition.unit;
  const parts = formatConcentrationParts(reading?.value, unit, dict);
  const isDetail = variant === 'detail';

  // Absent from the payload and present-but-empty read differently to a member
  // of the public, so they are not merged.
  const absence = reading
    ? { text: parts.value, hintKey: 'pollutant.noValueHint' }
    : { text: t(dict, 'pollutant.noValue'), hintKey: 'pollutant.noValueHint' };

  return (
    <div
      data-slot="pollutant-value"
      data-pollutant={pollutant}
      data-available={parts.available}
      className={cn(
        isDetail ? 'flex flex-col gap-2' : 'flex flex-wrap items-center gap-x-2 gap-y-1',
        className,
      )}
      {...props}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {showPollutant ? (
          <PollutantName
            pollutant={pollutant}
            className={cn('font-medium', isDetail ? 'text-base' : 'text-sm')}
          />
        ) : null}

        {parts.available ? (
          <span
            className={cn('tabular font-semibold', isDetail ? 'text-2xl leading-none' : 'text-sm')}
          >
            {parts.value}
            <span className={cn('ml-1 font-normal', isDetail ? 'text-sm' : 'text-xs')}>
              <ConcentrationUnit unit={unit} dict={dict} />
            </span>
          </span>
        ) : (
          <span
            className={cn('text-muted-foreground font-medium', isDetail ? 'text-base' : 'text-sm')}
          >
            {absence.text}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <CategoryBadge
          category={reading?.category ?? null}
          size="sm"
          variant="outline"
          srPrefix={definition.ariaLabel}
          dict={dict}
        />

        {/* Gap-filled, not forecast. The feed models some PAST hours too, so
            this says "Estimated" and never "Forecast". */}
        {reading?.modelled ? (
          <Badge variant="outline" size="sm" title={t(dict, 'pollutant.modelledExplain')}>
            {t(dict, 'pollutant.modelledLabel')}
          </Badge>
        ) : null}

        {dominant ? (
          <Badge variant="subtle" size="sm">
            {t(dict, 'pollutant.dominantBadge')}
          </Badge>
        ) : null}
      </div>

      {isDetail ? (
        <div className="text-muted-foreground flex flex-col gap-1 text-xs">
          <dl className="flex flex-wrap gap-x-2">
            <dt className="font-medium">{t(dict, 'pollutant.averagingPeriod')}</dt>
            <dd>
              {averagingPeriodLabel(reading?.averagingPeriod ?? definition.averagingPeriod, dict)}
            </dd>
          </dl>

          {/* The absence hint says, in words, that this is not a reading of
              zero. It is the whole reason the null case is rendered at all. */}
          {!parts.available ? <p>{t(dict, absence.hintKey)}</p> : null}

          {reading?.modelled ? <p>{t(dict, 'pollutant.modelledExplain')}</p> : null}

          {reading?.thresholdReference ? (
            <p>{t(dict, 'threshold.reference', { reference: reading.thresholdReference })}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
