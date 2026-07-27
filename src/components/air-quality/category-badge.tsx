import {
  CircleAlert,
  CircleCheck,
  CircleHelp,
  OctagonAlert,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type * as React from 'react';

import {
  CATEGORY_PRESENTATION,
  NO_DATA_PRESENTATION,
  type AirQualityCategory,
} from '@/config/thresholds';
import { categoryLabelKey, formatSubIndex, getDictionary, t, type Dictionary } from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';

/**
 * Icon name → component.
 *
 * `CATEGORY_PRESENTATION` stores an icon NAME rather than a component so that
 * the config stays free of React imports and can be used on the server, in
 * tests and in the API layer. This is the one place that resolves those names,
 * and it is exported so map markers and legends resolve them identically.
 */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  CircleCheck,
  CircleAlert,
  TriangleAlert,
  OctagonAlert,
  CircleHelp,
};

/** Band id used for styling. 0 is the absence of an index, not "Good". */
export function bandIdFor(category: AirQualityCategory | null | undefined): number {
  return category ? CATEGORY_PRESENTATION[category].bandId : 0;
}

/** The redundant, non-colour texture class for a category. */
export function patternClassFor(category: AirQualityCategory | null | undefined): string {
  const pattern = category ? CATEGORY_PRESENTATION[category].pattern : NO_DATA_PRESENTATION.pattern;
  return `aq-pattern-${pattern}`;
}

export function iconFor(category: AirQualityCategory | null | undefined): LucideIcon {
  const name = category ? CATEGORY_PRESENTATION[category].icon : NO_DATA_PRESENTATION.icon;
  return CATEGORY_ICONS[name] ?? CircleHelp;
}

const SIZE_CLASSES = {
  sm: 'gap-1.5 rounded-full px-2.5 py-1 text-xs',
  md: 'gap-2 rounded-full px-3 py-1.5 text-sm',
  lg: 'gap-2.5 rounded-card px-4 py-2.5 text-base',
} as const;

const ICON_CLASSES = {
  sm: 'size-3.5',
  md: 'size-4',
  lg: 'size-5',
} as const;

export type CategoryBadgeProps = Omit<React.ComponentProps<'span'>, 'children'> & {
  /** `null` renders the "No data" state — never a default of "Good". */
  category: AirQualityCategory | null | undefined;
  size?: keyof typeof SIZE_CLASSES;
  /** `filled` uses the band colour as the background; `outline` tints a surface. */
  variant?: 'filled' | 'outline';
  /** Continuous sub-index, shown after the label when supplied. */
  subIndex?: number | null;
  /** Prefix read only by assistive technology, e.g. a station or pollutant name. */
  srPrefix?: string;
  dict?: Dictionary;
};

/**
 * The air-quality band, shown four ways at once.
 *
 * Colour, texture, icon and written label all carry the same information, so the
 * badge survives colour blindness, greyscale printing, forced-colours mode and a
 * screen reader. That redundancy is the point of the component — do not strip it
 * down to a coloured dot somewhere else in the application.
 *
 * A `null` category is a first-class state. It renders as "No data" and must
 * never be silently treated as Good: an absent reading tells us nothing.
 */
export function CategoryBadge({
  category,
  size = 'md',
  variant = 'filled',
  subIndex,
  srPrefix,
  dict = getDictionary(),
  className,
  ...props
}: CategoryBadgeProps) {
  // Looked up from the constant table rather than through `iconFor()`, so the
  // React Compiler's static analysis can see that this is a selection from a
  // fixed set and not a component defined during render.
  const iconName = category ? CATEGORY_PRESENTATION[category].icon : NO_DATA_PRESENTATION.icon;
  const Icon = CATEGORY_ICONS[iconName] ?? CircleHelp;
  const label = t(dict, categoryLabelKey(category ?? null));
  const bandId = bandIdFor(category);
  const hasSubIndex = typeof subIndex === 'number' && Number.isFinite(subIndex);

  return (
    <span
      data-slot="category-badge"
      data-aq-band={bandId}
      data-aq-category={category ?? 'none'}
      className={cn(
        'inline-flex w-fit items-center font-semibold',
        variant === 'filled' ? 'aq-swatch' : 'aq-outline',
        /* Deliberately NO `patternClassFor(category)` here.
           The texture is a colour-independent channel, and it earns that on a
           map marker, which carries no visible text — colour, icon and texture
           are all a sighted colour-blind reader gets there. This badge always
           renders the band in words next to the icon, so the texture adds no
           information and, tiled across a pill this small, reads as noise. The
           other three channels are untouched. */
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    >
      <Icon className={cn('relative z-10 shrink-0', ICON_CLASSES[size])} aria-hidden="true" />
      <span className="relative z-10">
        {srPrefix ? <span className="sr-only">{srPrefix}: </span> : null}
        {label}
      </span>
      {hasSubIndex ? (
        <span className="tabular relative z-10 font-normal opacity-90">
          {formatSubIndex(subIndex, dict)}
        </span>
      ) : null}
    </span>
  );
}
