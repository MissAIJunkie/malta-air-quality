import { CircleHelp, CloudOff, History } from 'lucide-react';

import {
  CATEGORY_ICONS,
  bandIdFor,
  patternClassFor,
} from '@/components/air-quality/category-badge';
import { CATEGORY_PRESENTATION, NO_DATA_PRESENTATION } from '@/config/thresholds';
import { isNotLive, type MapStationRow } from '@/lib/map/markers';
import {
  categoryLabelKey,
  formatConcentration,
  getDictionary,
  t,
  type Dictionary,
} from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';

export type StationMarkerProps = {
  row: MapStationRow;
  selected: boolean;
  onSelect: (stationId: string) => void;
  /** Show the station's name beneath the pin. */
  showLabel?: boolean;
  dict?: Dictionary;
};

/**
 * One station on the map, as a real button.
 *
 * This is a DOM element positioned over the canvas by MapLibre, not something
 * painted into it. That is the whole point: a canvas-drawn marker cannot be
 * reached with Tab, cannot be announced, cannot take a focus ring and cannot be
 * given a 44px hit area. A button can, and does.
 *
 * The band is carried four ways over — colour, texture, icon and the written
 * name in the accessible label — and two more caveats ride alongside it, both
 * of which are product rules rather than decoration:
 *
 *   - a modelled value gets a dashed outline and the word "Estimated", because
 *     a forecast must never look like an observation;
 *   - a stale or missing reading gets a badge and the words "Not live",
 *     because an old number must never look like a current one.
 *
 * The visible name is `aria-hidden`: it repeats what the screen-reader label
 * already says, and announcing it twice would be noise.
 */
export function StationMarker({
  row,
  selected,
  onSelect,
  showLabel = true,
  dict = getDictionary(),
}: StationMarkerProps) {
  const { station, category, value, unit, modelled, elevated, freshness, pollutantMissing } = row;

  const iconName = category ? CATEGORY_PRESENTATION[category].icon : NO_DATA_PRESENTATION.icon;
  // Selected from a constant table rather than through a helper, so this stays
  // visibly a choice between fixed components and not a component defined
  // during render. `category-badge.tsx` resolves icons the same way.
  const Icon = CATEGORY_ICONS[iconName] ?? CircleHelp;

  const notLive = isNotLive(freshness);
  const StatusIcon = freshness === 'unavailable' ? CloudOff : History;

  const accessibleName = category
    ? t(dict, 'map.markerLabel', {
        station: station.name,
        category: t(dict, categoryLabelKey(category)),
      })
    : t(dict, 'map.markerNoData', { station: station.name });

  // Only ever set when a single pollutant is being shown; `formatConcentration`
  // renders an absent value as "Not available" and never as zero.
  const concentration = value !== null && unit ? formatConcentration(value, unit, dict) : null;

  return (
    <button
      type="button"
      data-slot="station-marker"
      data-station-id={station.id}
      data-aq-band={bandIdFor(category)}
      data-selected={String(selected)}
      aria-pressed={selected}
      title={
        selected
          ? t(dict, 'map.selectedStation', { station: station.name })
          : t(dict, 'map.selectStation', { station: station.name })
      }
      onClick={() => onSelect(station.id)}
      className={cn(
        'group relative flex size-11 cursor-pointer items-center justify-center',
        'rounded-full bg-transparent p-0',
      )}
    >
      {/* The complete accessible name, assembled from parts so each caveat can
          be added or omitted without rewriting a sentence. */}
      <span className="sr-only">{accessibleName}</span>
      {concentration ? <span className="sr-only">, {concentration}</span> : null}
      {pollutantMissing ? <span className="sr-only">, {t(dict, 'common.notMeasured')}</span> : null}
      {modelled ? <span className="sr-only">, {t(dict, 'common.estimated')}</span> : null}
      {notLive ? <span className="sr-only">, {t(dict, 'freshness.notLive')}</span> : null}

      {/* A soft halo, drawn only for the bands that warrant attention. It is
          decoration on top of an already-complete encoding — never the only
          signal, and never an interpolated pollution surface. */}
      {elevated ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 -z-10 rounded-full bg-[var(--aq-color)] opacity-45 blur-md"
        />
      ) : null}

      <span
        aria-hidden="true"
        className={cn(
          'aq-swatch relative flex size-8 items-center justify-center rounded-full',
          patternClassFor(category),
          // A NEUTRAL ring, not one in the band colour: the marker has to
          // separate from whatever the base map happens to be underneath, and
          // a same-colour ring separates from nothing.
          'shadow-marker ring-surface ring-2',
          'transition-transform duration-150',
          'group-hover:scale-110 group-focus-visible:scale-110',
          'group-data-[selected=true]:scale-[1.15] group-data-[selected=true]:ring-[3px]',
          // Dashed = modelled. Distinct from every solid band texture, and
          // still visible in greyscale and in forced-colours mode.
          modelled && 'outline-border-strong outline-2 outline-offset-2 outline-dashed',
        )}
      >
        <Icon className="size-4" aria-hidden="true" />

        {notLive ? (
          <span
            aria-hidden="true"
            className="bg-surface text-foreground ring-border absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full ring-1"
          >
            <StatusIcon className="size-2.5" />
          </span>
        ) : null}
      </span>

      {showLabel ? (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute top-full left-1/2 mt-1 -translate-x-1/2',
            'rounded-sm px-1.5 py-0.5 text-[11px] leading-tight font-semibold whitespace-nowrap',
            // An opaque plate rather than bare text: the label sits over
            // arbitrary map content and has to stay readable on all of it.
            'bg-surface/90 text-foreground shadow-marker ring-border ring-1 backdrop-blur-[2px]',
          )}
        >
          {station.name}
        </span>
      ) : null}
    </button>
  );
}

export default StationMarker;
