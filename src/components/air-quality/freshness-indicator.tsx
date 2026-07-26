import { CloudOff, History, RadioTower, Clock, type LucideIcon } from 'lucide-react';
import type * as React from 'react';

import { ageInHours } from '@/lib/air-quality/freshness';
import type { FreshnessState } from '@/lib/air-quality/types';
import {
  formatMeasuredAt,
  formatRelativeAge,
  getDictionary,
  t,
  toDateTimeAttribute,
  type Dictionary,
} from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';

type FreshnessPresentation = {
  icon: LucideIcon;
  labelKey: string;
  descriptionKey: string;
  /** Restrained, non-band colours: freshness is metadata, not air quality. */
  toneClass: string;
};

/**
 * Presentation per state.
 *
 * The word "Live" belongs to `fresh` and to nothing else. Everything downstream
 * derives its wording from this table rather than writing its own, so a delayed
 * or stale reading can never be described as current by accident.
 */
const PRESENTATION: Record<FreshnessState, FreshnessPresentation> = {
  fresh: {
    icon: RadioTower,
    labelKey: 'freshness.fresh.label',
    descriptionKey: 'freshness.fresh.description',
    toneClass: 'text-muted-foreground',
  },
  delayed: {
    icon: Clock,
    labelKey: 'freshness.delayed.label',
    descriptionKey: 'freshness.delayed.description',
    toneClass: 'text-foreground',
  },
  stale: {
    icon: History,
    labelKey: 'freshness.stale.label',
    descriptionKey: 'freshness.stale.description',
    toneClass: 'text-danger',
  },
  unavailable: {
    icon: CloudOff,
    labelKey: 'freshness.unavailable.label',
    descriptionKey: 'freshness.unavailable.description',
    toneClass: 'text-danger',
  },
};

export type FreshnessIndicatorProps = Omit<React.ComponentProps<'span'>, 'children'> & {
  freshness: FreshnessState;
  /** ISO-8601 UTC instant the reading refers to. */
  measuredAt?: string | null;
  /**
   * ISO-8601 UTC instant maqua.app retrieved the reading (`StationReading.fetchedAt`).
   *
   * Rendered whenever it is supplied. Measured-at, retrieved-at and age answer
   * three different questions — when the air was sampled, when we last heard
   * from the source, and how old that makes the figure — and a reader needs all
   * three to judge whether a number still describes the present.
   */
  fetchedAt?: string | null;
  /**
   * Whole hours old. Supply this, or `measuredAt` together with `nowIso`.
   *
   * The component never reads the clock itself: a server render and the
   * subsequent hydration would disagree about "now" and React would report a
   * mismatch. The caller decides what "now" is and passes it down.
   */
  ageHours?: number | null;
  /** ISO-8601 UTC "now", used only when `ageHours` is not supplied. */
  nowIso?: string;
  /** Show the measurement timestamp alongside the state. Defaults to true. */
  showTimestamp?: boolean;
  size?: 'sm' | 'md';
  dict?: Dictionary;
};

/**
 * How current a reading is.
 *
 * Always renders the state in words, and the exact age whenever it can be
 * determined. Nothing here says "live" unless the reading really is within the
 * normal hourly publication window; "unavailable" is shown as a warning rather
 * than hidden, because silence would read as an all-clear.
 */
export function FreshnessIndicator({
  freshness,
  measuredAt,
  fetchedAt,
  ageHours,
  nowIso,
  showTimestamp = true,
  size = 'sm',
  dict = getDictionary(),
  className,
  ...props
}: FreshnessIndicatorProps) {
  const presentation = PRESENTATION[freshness];
  const Icon = presentation.icon;

  const resolvedAge = ageHours ?? (measuredAt && nowIso ? ageInHours(measuredAt, nowIso) : null);
  // An unknown age is stated as unknown rather than omitted, so the reader is
  // never left assuming the reading is current.
  const ageText = formatRelativeAge(resolvedAge, dict);

  const label = t(dict, presentation.labelKey);
  const description = t(dict, presentation.descriptionKey);

  // Gated on the machine-readable form rather than the rendered one:
  // `formatMeasuredAt` returns the "Not available" marker for an unparseable
  // timestamp, which would otherwise render as "Measured at Not available"
  // inside a <time> element carrying no datetime at all.
  const measuredDateTime = toDateTimeAttribute(measuredAt);
  const fetchedDateTime = toDateTimeAttribute(fetchedAt);

  return (
    <span
      data-slot="freshness-indicator"
      data-freshness={freshness}
      title={description}
      className={cn(
        'inline-flex flex-wrap items-center gap-x-2 gap-y-0.5',
        size === 'sm' ? 'text-xs' : 'text-sm',
        presentation.toneClass,
        className,
      )}
      {...props}
    >
      <span className="inline-flex items-center gap-1.5 font-medium">
        <Icon
          className={cn('shrink-0', size === 'sm' ? 'size-3.5' : 'size-4')}
          aria-hidden="true"
        />
        {label}
      </span>

      <span className="text-muted-foreground">{ageText}</span>

      {showTimestamp && measuredDateTime ? (
        <span className="text-muted-foreground">
          {t(dict, 'freshness.measuredAtLabel')}{' '}
          <time dateTime={measuredDateTime} className="tabular">
            {formatMeasuredAt(measuredAt, dict)}
          </time>
        </span>
      ) : null}

      {showTimestamp && fetchedDateTime ? (
        <span className="text-muted-foreground">
          {t(dict, 'freshness.retrievedAtLabel')}{' '}
          <time dateTime={fetchedDateTime} className="tabular">
            {formatMeasuredAt(fetchedAt, dict)}
          </time>
        </span>
      ) : null}
    </span>
  );
}
