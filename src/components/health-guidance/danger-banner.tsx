import { TriangleAlert } from 'lucide-react';
import type * as React from 'react';

import {
  CATEGORY_ICONS,
  CategoryBadge,
  bandIdFor,
  patternClassFor,
} from '@/components/air-quality/category-badge';
import { MedicalDisclaimer } from '@/components/health-guidance/health-guidance';
import { PollutantName } from '@/components/pollutants/pollutant-value';
import { Badge } from '@/components/ui/badge';
import { POLLUTANTS, type PollutantCode } from '@/config/pollutants';
import {
  CATEGORY_PRESENTATION,
  isElevatedCategory,
  type AirQualityCategory,
} from '@/config/thresholds';
import {
  SENSITIVE_GROUPS,
  categoryHealthKey,
  categoryLabelKey,
  categoryShortAdviceKey,
  formatList,
  formatMeasuredAt,
  getDictionary,
  sensitiveGroupLabelKey,
  t,
  toDateTimeAttribute,
  type Dictionary,
} from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';

export type DangerBannerProps = Omit<React.ComponentProps<'div'>, 'children'> & {
  /** Renders nothing unless this is one of the elevated bands. */
  category: AirQualityCategory | null | undefined;
  /** The pollutant that put the location in this band. */
  pollutant: PollutantCode | null | undefined;
  /** ISO-8601 UTC instant the reading refers to. */
  measuredAt: string | null | undefined;
  /** Near-real-time data is unvalidated and may be revised. */
  provisional: boolean;
  /**
   * True when the driving value was modelled or gap-filled rather than measured
   * (upstream `modelled_* === 1`). This is NOT the same as a forecast: the feed
   * models some past hours too, so this flag alone never justifies the word
   * "forecast".
   */
  modelled: boolean;
  /**
   * True only for a genuine future point. Must be supplied explicitly by a
   * caller that knows the point is ahead of the latest observation — it is
   * never derived from `modelled`.
   */
  forecast?: boolean;
  /** Named in the headline when the banner is about one station. */
  stationName?: string;
  /**
   * Emit `role="alert"`. Turn it off where something else is already claiming
   * the reader's attention — a dialog announcing its own title, or a second
   * banner for the same event further down the page.
   */
  announce?: boolean;
  dict?: Dictionary;
};

/**
 * An unmissable warning for the elevated bands.
 *
 * Deliberately not focus-stealing: `role="alert"` asks assistive technology to
 * announce the region when it appears, which is enough. Moving focus here would
 * throw a keyboard user out of whatever they were doing, and this is
 * information, not a task.
 *
 * Because a live region is only announced when it is inserted, a banner present
 * in the first server render is silent — correct, since the reader is arriving
 * at the page and will meet it in the normal reading order.
 *
 * Returns `null` for non-elevated and unknown bands. A missing reading is not
 * an emergency, and it is not an all-clear either; that case is handled by the
 * "no reading" states elsewhere rather than by a red banner.
 */
export function DangerBanner({
  category,
  pollutant,
  measuredAt,
  provisional,
  modelled,
  forecast = false,
  stationName,
  announce = true,
  dict = getDictionary(),
  className,
  ...props
}: DangerBannerProps) {
  if (!category || !isElevatedCategory(category)) return null;

  // Indexed straight out of the constant tables rather than through
  // `iconFor()`, so the React Compiler can see this is a selection from a fixed
  // set and not a component defined during render. `CategoryBadge` resolves its
  // icon the same way, for the same reason.
  const Icon = CATEGORY_ICONS[CATEGORY_PRESENTATION[category].icon] ?? TriangleAlert;
  const categoryLabel = t(dict, categoryLabelKey(category));

  const headline = stationName
    ? t(dict, 'map.markerLabel', { station: stationName, category: categoryLabel })
    : t(dict, 'header.overallFor', { category: categoryLabel });

  // Every sensitive group is named. Narrowing the list to the leading
  // pollutant would tell somebody the warning is not meant for them, and the
  // evidence does not support that precision at a single hour.
  const affected = formatList(
    SENSITIVE_GROUPS.map((group) => t(dict, sensitiveGroupLabelKey(group))),
    dict,
  );

  const measuredDateTime = toDateTimeAttribute(measuredAt);

  return (
    <div
      data-slot="danger-banner"
      data-aq-band={bandIdFor(category)}
      data-aq-category={category}
      role={announce ? 'alert' : undefined}
      className={cn(
        'aq-outline rounded-panel border-l-4 [border-left-color:var(--aq-color)] p-5',
        patternClassFor(category),
        className,
      )}
      {...props}
    >
      {/* The texture overlay is painted above the background, so the content
          is lifted onto its own layer to stay legible. */}
      <div className="relative z-10 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Icon className="size-6 shrink-0" aria-hidden="true" />
          <p className="text-lg leading-tight font-semibold">{headline}</p>
          <CategoryBadge category={category} size="sm" dict={dict} />
        </div>

        <dl className="flex flex-col gap-3 text-sm">
          {pollutant ? (
            <div className="flex flex-wrap items-baseline gap-x-2">
              <dt className="font-medium">{t(dict, 'pollutant.dominantBadge')}</dt>
              <dd>
                <PollutantName pollutant={pollutant} />
                <span className="sr-only">
                  {' '}
                  {t(dict, 'pollutant.bandFor', {
                    pollutant: POLLUTANTS[pollutant].ariaLabel,
                    category: categoryLabel,
                  })}
                </span>
              </dd>
            </div>
          ) : null}

          <div className="flex flex-col gap-1">
            <dt className="font-medium">{t(dict, 'health.forSensitiveGroups')}</dt>
            <dd className="leading-relaxed">{affected}</dd>
          </div>

          <div className="flex flex-col gap-1">
            <dt className="font-medium">{t(dict, 'health.currentAdvice')}</dt>
            <dd className="flex flex-col gap-1 leading-relaxed">
              <span>{t(dict, categoryShortAdviceKey(category))}</span>
              <span>{t(dict, categoryHealthKey(category, 'sensitive'))}</span>
            </dd>
          </div>

          <div className="flex flex-wrap items-baseline gap-x-2">
            <dt className="font-medium">{t(dict, 'freshness.measuredAtLabel')}</dt>
            <dd className="tabular">
              {measuredDateTime ? (
                <time dateTime={measuredDateTime}>{formatMeasuredAt(measuredAt, dict)}</time>
              ) : (
                t(dict, 'common.notAvailable')
              )}
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap items-center gap-2">
          {/* Measured, estimated and forecast are three different claims, and
              the badge states which one this is rather than leaving the reader
              to assume the strongest. */}
          {forecast ? (
            <Badge variant="outline" size="sm" title={t(dict, 'forecast.notObservation')}>
              {t(dict, 'forecast.estimateBadge')}
            </Badge>
          ) : modelled ? (
            <Badge variant="outline" size="sm" title={t(dict, 'pollutant.modelledExplain')}>
              {t(dict, 'pollutant.modelledLabel')}
            </Badge>
          ) : (
            <Badge variant="outline" size="sm">
              {t(dict, 'pollutant.measuredLabel')}
            </Badge>
          )}

          {provisional ? (
            <Badge variant="outline" size="sm" title={t(dict, 'station.provisionalExplain')}>
              {t(dict, 'station.provisional')}
            </Badge>
          ) : null}
        </div>

        <div className="flex flex-col gap-1 text-xs leading-relaxed">
          {forecast ? <p>{t(dict, 'forecast.notObservation')}</p> : null}
          {!forecast && modelled ? <p>{t(dict, 'pollutant.modelledExplain')}</p> : null}
          {provisional ? <p>{t(dict, 'station.provisionalExplain')}</p> : null}
          <p>{t(dict, 'disclaimer.emergency')}</p>
        </div>

        <MedicalDisclaimer dict={dict} className="text-foreground/80" />
      </div>
    </div>
  );
}
