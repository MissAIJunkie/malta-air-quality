import {
  CircleHelp,
  CloudFog,
  CloudLightning,
  CloudRain,
  Compass,
  Factory,
  Flame,
  Info,
  Layers,
  Minus,
  Ship,
  SquareStack,
  Sun,
  Thermometer,
  TrendingDown,
  TrendingUp,
  Waves,
  Wind,
  type LucideIcon,
} from 'lucide-react';

import { POLLUTANTS } from '@/config/pollutants';
import type {
  EnrichedContextEvent,
  EnvironmentalContextEventType,
  ContextConfidence,
  ImpactDirection,
} from '@/lib/environmental-context/types';
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
import { SourceLink } from './source-link';

/**
 * One environmental condition that may be influencing the air.
 *
 * "May". Nothing on this card asserts that the condition caused a reading —
 * the pipeline hedges its prose by construction and the card must not undo
 * that. What the card adds is the provenance a reader needs in order to judge
 * the claim for themselves: whether the condition was observed or modelled, how
 * confident the classifier is, when it applies, who says so, and when we last
 * heard from them.
 *
 * The four impact directions are given four different presentations —
 * different icon, different accent edge, different words — because "this may
 * make the air worse" and "this is background information" are not the same
 * message and must not look alike.
 */

/* -------------------------------------------------------------------------- */
/*  Vocabulary                                                                */
/* -------------------------------------------------------------------------- */

type ImpactPresentation = {
  icon: LucideIcon;
  labelKey: string;
  labelText: string;
  /** Restrained accent on the leading edge. Never an air-quality band colour. */
  edgeClass: string;
  iconClass: string;
};

/**
 * `unclear` is presented as "mixed", not as a failure to decide.
 *
 * Strong wind disperses local traffic emissions while lifting sea salt and
 * resuspended dust. Reporting that as a single direction would be dishonest,
 * so the card says both things are happening.
 */
const IMPACT: Record<ImpactDirection, ImpactPresentation> = {
  worsening: {
    icon: TrendingUp,
    labelKey: 'context.impact.worsening',
    labelText: 'May worsen air quality',
    edgeClass: 'border-l-danger',
    iconClass: 'text-danger',
  },
  improving: {
    icon: TrendingDown,
    labelKey: 'context.impact.improving',
    labelText: 'May improve air quality',
    edgeClass: 'border-l-success',
    iconClass: 'text-success',
  },
  neutral: {
    icon: Info,
    labelKey: 'context.impact.neutral',
    labelText: 'Background information only',
    edgeClass: 'border-l-border-strong',
    iconClass: 'text-muted-foreground',
  },
  unclear: {
    icon: Minus,
    labelKey: 'context.impact.unclear',
    labelText: 'Mixed effects, pushing in both directions',
    edgeClass: 'border-l-border-strong',
    iconClass: 'text-muted-foreground',
  },
};

const TYPE_ICON: Record<EnvironmentalContextEventType, LucideIcon> = {
  saharan_dust: CloudFog,
  wildfire_smoke: Flame,
  high_wind: Wind,
  low_wind: Layers,
  storm: CloudLightning,
  heavy_rain: CloudRain,
  heatwave: Thermometer,
  ozone_risk: Sun,
  temperature_inversion: SquareStack,
  sea_salt: Waves,
  regional_pollution: Compass,
  shipping_emissions: Ship,
  industrial_incident: Factory,
  other: CircleHelp,
};

const CONFIDENCE_TEXT: Record<ContextConfidence, { key: string; text: string }> = {
  high: { key: 'context.confidence.high', text: 'Higher confidence' },
  medium: { key: 'context.confidence.medium', text: 'Moderate confidence' },
  low: { key: 'context.confidence.low', text: 'Lower confidence' },
};

/* -------------------------------------------------------------------------- */
/*  Card                                                                      */
/* -------------------------------------------------------------------------- */

export type EventCardProps = {
  event: EnrichedContextEvent;
  dict?: Dictionary;
  className?: string;
};

export function EventCard({ event, dict = getDictionary(), className }: EventCardProps) {
  const impact = IMPACT[event.impactDirection];
  const ImpactIcon = impact.icon;
  const TypeIcon = TYPE_ICON[event.type] ?? CircleHelp;

  const startsAt = toDateTimeAttribute(event.startsAt);
  const endsAt = toDateTimeAttribute(event.endsAt);
  const fetchedAt = toDateTimeAttribute(event.fetchedAt);

  const provenance =
    event.observedOrForecast === 'observed'
      ? t(dict, 'forecast.observedLabel')
      : t(dict, 'forecast.forecastLabel');

  return (
    <article
      data-impact={event.impactDirection}
      className={cn(
        'rounded-card border-border bg-surface flex flex-col gap-2 border border-l-4 p-3',
        impact.edgeClass,
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <TypeIcon className={cn('mt-0.5 size-4 shrink-0', impact.iconClass)} aria-hidden="true" />
        {/* h3: the widget's own heading is the h2 above it. */}
        <h3 className="text-sm leading-tight font-semibold">
          {localised(dict, event.titleKey, event.title, event.vars)}
        </h3>
      </div>

      <p className="text-muted-foreground text-sm leading-relaxed">
        {localised(dict, event.summaryKey, event.summary, event.vars)}
      </p>

      {/* Expected effect, in words as well as by the icon and the edge colour. */}
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <ImpactIcon className={cn('size-3.5 shrink-0', impact.iconClass)} aria-hidden="true" />
        {localised(dict, impact.labelKey, impact.labelText)}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="subtle">{provenance}</Badge>
        <Badge variant="subtle">
          {localised(
            dict,
            CONFIDENCE_TEXT[event.confidence].key,
            CONFIDENCE_TEXT[event.confidence].text,
          )}
        </Badge>
        {event.geographicalScope ? <Badge variant="subtle">{event.geographicalScope}</Badge> : null}
        {event.aiGeneratedSummary ? (
          <Badge variant="outline">
            {localised(dict, 'context.aiWritten', 'Summary written by an AI assistant')}
          </Badge>
        ) : null}
      </div>

      {event.affectedPollutants && event.affectedPollutants.length > 0 ? (
        <p className="text-muted-foreground text-xs">
          {localised(dict, 'context.affects', 'Most relevant to:')}{' '}
          {event.affectedPollutants.map((code) => POLLUTANTS[code].label).join(', ')}
        </p>
      ) : null}

      {startsAt || endsAt ? (
        <p className="tabular text-muted-foreground text-xs">
          {startsAt ? (
            <time dateTime={startsAt}>
              {formatInMalta(event.startsAt, DATE_PATTERNS.dateTime, dict)}
            </time>
          ) : (
            t(dict, 'common.unknown')
          )}
          {' – '}
          {endsAt ? (
            <time dateTime={endsAt}>
              {formatInMalta(event.endsAt, DATE_PATTERNS.dateTime, dict)}
            </time>
          ) : (
            localised(dict, 'context.endUnknown', 'end not known')
          )}
        </p>
      ) : null}

      <div className="border-border flex flex-col gap-1 border-t pt-2">
        {/*
          Every source that survived the dedupe merge is cited, not just the
          winner: merging two reports into one event must not quietly drop one
          organisation's attribution.
        */}
        {(event.citations.length > 0
          ? event.citations
          : [
              {
                sourceName: event.sourceName,
                sourceUrl: event.sourceUrl,
                canonicalUrl: event.sourceUrl,
                publishedAt: event.publishedAt,
              },
            ]
        ).map((citation) => (
          <SourceLink
            key={citation.canonicalUrl || citation.sourceName}
            name={citation.sourceName}
            url={citation.sourceUrl}
            prefix={localised(dict, 'common.sourcePrefix', 'Source:')}
            dict={dict}
          />
        ))}

        {fetchedAt ? (
          <p className="text-muted-foreground text-xs">
            {t(dict, 'freshness.retrievedAtLabel')}{' '}
            <time dateTime={fetchedAt} className="tabular">
              {formatInMalta(event.fetchedAt, DATE_PATTERNS.dateTime, dict)}
            </time>
          </p>
        ) : null}
      </div>
    </article>
  );
}
