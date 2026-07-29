import type * as React from 'react';

import {
  AIR_QUALITY_CATEGORIES,
  CATEGORY_PRESENTATION,
  type AirQualityCategory,
} from '@/config/thresholds';
import {
  categoryLabelKey,
  formatSubIndex,
  getDictionary,
  hasKey,
  t,
  type Dictionary,
} from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';

/**
 * Lowest and highest sub-index the scale can express.
 *
 * `calculate-index.ts` produces a value in [1, 7): the integer part is the band
 * and the fraction is the position within it, capped at .99 by
 * `SUB_INDEX_FRACTION_CAP` so a value never floors into the next band. The rail
 * therefore spans 1 to 7 exactly — not 1 to 6.99 — because band 6 occupies the
 * whole of the final sixth, and stopping the axis at 6.99 would draw that band
 * one hundredth short.
 */
const SCALE_MIN = 1;
const SCALE_MAX = 7;

/** Short axis labels, keyed by band id. Full names are used everywhere else. */
const SHORT_LABEL_KEYS: Record<number, string> = {
  1: 'rail.short.good',
  2: 'rail.short.fair',
  3: 'rail.short.moderate',
  4: 'rail.short.poor',
  5: 'rail.short.veryPoor',
  6: 'rail.short.extremelyPoor',
};

/**
 * Where a sub-index falls along the rail, as a percentage.
 *
 * Clamped rather than trusted. A value outside [1, 7) would place the marker off
 * the rail entirely, and a rail with no visible pointer reads as "no reading" —
 * a materially different and more reassuring claim than the one the data makes.
 */
export function railPosition(subIndex: number): number {
  const clamped = Math.min(Math.max(subIndex, SCALE_MIN), SCALE_MAX);
  return ((clamped - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;
}

export type BandRailProps = Omit<React.ComponentProps<'div'>, 'children'> & {
  /** Continuous sub-index in [1, 7). `null` renders the scale with no pointer. */
  subIndex: number | null | undefined;
  /** Band the reading fell in. Used for the spoken label, not for the colours. */
  category: AirQualityCategory | null | undefined;
  /**
   * `lg` names every band inside its own segment and is the page's headline
   * instrument. `sm` is a bare 6-colour strip for dense rows, where the band is
   * already written out beside it.
   */
  size?: 'lg' | 'sm';
  /** Station or place the reading belongs to, spoken before the band. */
  forLabel?: string;
  dict?: Dictionary;
};

/**
 * The European AQI scale, with this reading marked on it.
 *
 * The whole scale is always drawn, including the bands the reading is nowhere
 * near. That is the point: "Moderate" alone tells you a name, whereas a pointer
 * a third of the way along a six-band axis tells you how much room is left
 * before it matters, and lets five stations be compared by eye without reading a
 * single number.
 *
 * Exposed to assistive technology as a single `role="img"` with a label naming
 * the band and the position. The segments themselves are decorative in that
 * reading — voicing six band names in sequence would say nothing about where the
 * reading actually sits, which is the only thing this component is for.
 *
 * Note the segments carry `data-rail-band`, NOT `data-aq-band`: the latter is
 * contracted by the accessibility suite to always appear with the band spelled
 * out in text, and a segment of an axis cannot honour that.
 */
export function BandRail({
  subIndex,
  category,
  size = 'lg',
  forLabel,
  dict = getDictionary(),
  className,
  style,
  ...props
}: BandRailProps) {
  const hasReading = typeof subIndex === 'number' && Number.isFinite(subIndex);
  const copy = (key: string, fallback: string, vars?: Record<string, string>): string =>
    hasKey(dict, key) ? t(dict, key, vars) : fallback;

  const categoryLabel = t(dict, categoryLabelKey(category ?? null));

  const label = hasReading
    ? forLabel
      ? copy('rail.readingFor', `${forLabel}: ${categoryLabel}`, {
          station: forLabel,
          category: categoryLabel,
          value: formatSubIndex(subIndex, dict),
        })
      : copy('rail.reading', categoryLabel, {
          category: categoryLabel,
          value: formatSubIndex(subIndex, dict),
        })
    : forLabel
      ? copy('rail.noReadingFor', `${forLabel}: no reading`, { station: forLabel })
      : copy('rail.noReading', 'No reading');

  return (
    <div
      data-slot="band-rail"
      role="img"
      aria-label={label}
      className={cn('aq-rail', size === 'sm' && 'aq-rail-sm', className)}
      style={
        hasReading
          ? { ...style, ['--aq-rail-position' as string]: `${railPosition(subIndex)}%` }
          : style
      }
      {...props}
    >
      <div className={cn('aq-rail-track', size === 'lg' ? 'h-9 sm:h-10' : 'h-1.5')}>
        {AIR_QUALITY_CATEGORIES.map((name) => {
          const bandId = CATEGORY_PRESENTATION[name].bandId;
          return (
            <span
              key={name}
              className="aq-rail-seg"
              data-rail-band={bandId}
              /* The rail is labelled as a whole above; naming each sixth again
                 would make a screen reader recite the scale before reaching the
                 reading, which is the part that matters. */
              aria-hidden="true"
            >
              {size === 'lg' ? (
                /* Both forms are rendered and one is hidden by a CONTAINER
                   query, not a viewport one — this rail appears at three very
                   different widths on the same screen. See `.aq-rail` in
                   globals.css. */
                <span className="aq-rail-label">
                  <span className="aq-rail-label-short">
                    {copy(SHORT_LABEL_KEYS[bandId], name)}
                  </span>
                  <span className="aq-rail-label-full">{t(dict, categoryLabelKey(name))}</span>
                </span>
              ) : null}
            </span>
          );
        })}
      </div>

      {/* No pointer without a reading. An absent measurement must never be drawn
          at the bottom of the scale, which is where a defaulted 0 would put it
          and which a reader would take for clean air. */}
      {hasReading ? <span className="aq-rail-marker" aria-hidden="true" /> : null}
    </div>
  );
}
