import type * as React from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { getDictionary, t, type Dictionary } from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';

export type MapLoadingProps = Omit<React.ComponentProps<'div'>, 'children'> & {
  /** Height utilities for the map surface. Must match the real map's. */
  heightClassName?: string;
  dict?: Dictionary;
};

/** Roughly where the five markers land once Malta is fitted. Purely decorative. */
const MARKER_POSITIONS = [
  { top: '38%', left: '22%' },
  { top: '52%', left: '48%' },
  { top: '46%', left: '58%' },
  { top: '61%', left: '69%' },
  { top: '34%', left: '52%' },
] as const;

/**
 * The map's placeholder.
 *
 * A shaped skeleton rather than a spinner, and never a blank box: the reader
 * should be able to see that a map is arriving, and roughly what shape it will
 * be, before it does. The layout matches the real map's so nothing jumps when
 * the two swap.
 *
 * One polite status message for the whole region. The skeleton shapes are
 * `aria-hidden` via the `Skeleton` primitive, so a screen reader hears
 * "Loading map" once instead of once per placeholder. The pulse is suppressed
 * by the global reduced-motion rule.
 */
export function MapLoading({
  heightClassName = 'h-[28rem]',
  dict = getDictionary(),
  className,
  ...props
}: MapLoadingProps) {
  return (
    <div
      data-slot="map-loading"
      role="status"
      aria-live="polite"
      className={cn('rounded-card border-border relative overflow-hidden border', className)}
      {...props}
    >
      <Skeleton className={cn('w-full rounded-none', heightClassName)} />

      {MARKER_POSITIONS.map((position) => (
        <Skeleton
          key={`${position.top}-${position.left}`}
          className="absolute size-8 rounded-full"
          style={position}
        />
      ))}

      <Skeleton className="rounded-card absolute top-3 right-3 h-[13.75rem] w-11" />

      <span className="sr-only">{t(dict, 'map.loading')}</span>
    </div>
  );
}

export default MapLoading;
