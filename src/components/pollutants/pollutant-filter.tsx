'use client';

import { useId } from 'react';
import type * as React from 'react';

import { OVERALL_FILTER, type PollutantFilterValue } from '@/components/pollutants/filter-value';
import { VisuallyHidden } from '@/components/ui/visually-hidden';
import { POLLUTANTS, POLLUTANT_CODES, type PollutantCode } from '@/config/pollutants';
import { formatList, getDictionary, t, type Dictionary } from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';

type Option = {
  value: PollutantFilterValue;
  /** Shown on screen. May contain subscripts. */
  label: string;
  /** Announced instead of the label, where the label reads poorly aloud. */
  spoken: string;
};

export type PollutantFilterProps = Omit<
  React.ComponentProps<'fieldset'>,
  'children' | 'onChange' | 'defaultValue'
> & {
  value: PollutantFilterValue;
  onValueChange: (value: PollutantFilterValue) => void;
  /**
   * Pollutants the current dataset can actually colour by — normally
   * `availablePollutants(readings)`. Everything else is offered but disabled,
   * so the reader can see that the pollutant exists and is simply not reporting.
   */
  available: readonly PollutantCode[];
  /** Radio group name. Defaults to a generated id; set it if two filters coexist. */
  name?: string;
  dict?: Dictionary;
};

/**
 * Choose the pollutant a view is coloured by.
 *
 * Native radios rather than a custom widget: they bring roving arrow-key
 * navigation, a proper group semantic and a disabled state that assistive
 * technology already understands, none of which has to be reimplemented or kept
 * correct by hand. The inputs are visually hidden and the styling hangs off
 * `has-[…]` on the label, so what is painted and what is focused stay the same
 * element.
 *
 * Unavailable options are disabled rather than removed. Hiding them would imply
 * the network does not measure that pollutant at all, when in fact it simply
 * published nothing usable this hour — and the note below the group says so.
 */
export function PollutantFilter({
  value,
  onValueChange,
  available,
  name,
  dict = getDictionary(),
  className,
  ...props
}: PollutantFilterProps) {
  const generatedId = useId();
  const groupName = name ?? `pollutant-filter-${generatedId}`;
  const noteId = `${generatedId}-unavailable`;

  const options: Option[] = [
    {
      value: OVERALL_FILTER,
      label: t(dict, 'station.overall'),
      spoken: t(dict, 'station.overall'),
    },
    ...POLLUTANT_CODES.map((code) => ({
      value: code as PollutantFilterValue,
      label: POLLUTANTS[code].label,
      spoken: POLLUTANTS[code].ariaLabel,
    })),
  ];

  const unavailable = POLLUTANT_CODES.filter((code) => !available.includes(code));
  const hasUnavailable = unavailable.length > 0;

  return (
    <fieldset
      data-slot="pollutant-filter"
      className={cn('flex flex-col gap-2 border-0 p-0', className)}
      {...props}
    >
      <legend className="text-sm font-semibold">{t(dict, 'pollutant.selectorLabel')}</legend>

      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isDisabled = option.value !== OVERALL_FILTER && !available.includes(option.value);

          return (
            <label
              key={option.value}
              data-value={option.value}
              className={cn(
                'rounded-card relative inline-flex min-h-11 cursor-pointer items-center justify-center px-4 py-2 text-sm font-medium',
                'border-border bg-surface text-foreground border transition-colors',
                'hover:bg-muted',
                // The input is clipped, so its own focus ring is invisible.
                // The visible ring is drawn on the label instead.
                'has-[input:focus-visible]:outline-ring has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2',
                'has-[input:checked]:border-primary has-[input:checked]:bg-primary has-[input:checked]:text-primary-foreground',
                'has-[input:disabled]:hover:bg-surface has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-55',
              )}
            >
              <input
                type="radio"
                name={groupName}
                value={option.value}
                checked={value === option.value}
                disabled={isDisabled}
                aria-describedby={isDisabled ? noteId : undefined}
                onChange={() => onValueChange(option.value)}
                className="sr-only"
              />
              <span aria-hidden="true">{option.label}</span>
              <VisuallyHidden>{option.spoken}</VisuallyHidden>
            </label>
          );
        })}
      </div>

      {/* One shared explanation, referenced by every disabled option. A
          disabled control cannot be focused, so the reason has to be readable
          in the page itself rather than only on the control. */}
      {hasUnavailable ? (
        <p id={noteId} className="text-muted-foreground text-xs">
          {formatList(
            unavailable.map((code) => POLLUTANTS[code].ariaLabel),
            dict,
          )}
          {t(dict, 'common.separator')}
          {t(dict, 'pollutant.noValue')}
        </p>
      ) : null}
    </fieldset>
  );
}
