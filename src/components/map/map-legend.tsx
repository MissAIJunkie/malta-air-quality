import { CircleHelp } from 'lucide-react';
import type * as React from 'react';

import { CATEGORY_ICONS, patternClassFor } from '@/components/air-quality/category-badge';
import { POLLUTANTS, type PollutantCode } from '@/config/pollutants';
import {
  AIR_QUALITY_CATEGORIES,
  CATEGORY_PRESENTATION,
  NO_DATA_PRESENTATION,
} from '@/config/thresholds';
import { OSM_COPYRIGHT_URL } from '@/lib/map/style';
import { categoryLabelKey, getDictionary, t, type Dictionary } from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';

export type MapLegendProps = Omit<React.ComponentProps<'section'>, 'children'> & {
  /** When set, the legend states which single pollutant the map is showing. */
  pollutant?: PollutantCode | null;
  /** Heading level, so the legend fits whatever outline the page has. */
  headingLevel?: 2 | 3 | 4;
  /** Show the data and base-map attribution block. */
  showAttribution?: boolean;
  dict?: Dictionary;
};

type LegendRow = {
  key: string;
  bandId: number;
  labelKey: string;
  patternClass: string;
  iconName: string;
};

const CATEGORY_ROWS: LegendRow[] = AIR_QUALITY_CATEGORIES.map((category) => ({
  key: category,
  bandId: CATEGORY_PRESENTATION[category].bandId,
  labelKey: categoryLabelKey(category),
  patternClass: patternClassFor(category),
  iconName: CATEGORY_PRESENTATION[category].icon,
}));

/**
 * Band 0 is the absence of an index, which is a different thing from Good, so
 * it gets its own row rather than being left out. A reader who sees a grey
 * marker must be able to find out what grey means.
 */
const NO_DATA_ROW: LegendRow = {
  key: 'no-data',
  bandId: 0,
  labelKey: 'map.legendNoData',
  patternClass: patternClassFor(null),
  iconName: NO_DATA_PRESENTATION.icon,
};

const LEGEND_ROWS: LegendRow[] = [...CATEGORY_ROWS, NO_DATA_ROW];

/**
 * The key to the map.
 *
 * Every row shows the band's colour, its texture and its icon next to the
 * written label, which is the same redundant encoding the markers use. Read in
 * greyscale, or with any form of colour vision, the rows remain distinguishable
 * from one another.
 *
 * A server component: no state, no interaction, nothing that needs the browser.
 * The page can render it beside a map that has not loaded, or in place of one
 * that never will.
 */
export function MapLegend({
  pollutant = null,
  headingLevel = 3,
  showAttribution = true,
  dict = getDictionary(),
  className,
  id = 'map-legend',
  ...props
}: MapLegendProps) {
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  const headingId = `${id}-heading`;

  const pollutantDefinition = pollutant ? POLLUTANTS[pollutant] : null;

  return (
    <section
      data-slot="map-legend"
      id={id}
      aria-labelledby={headingId}
      className={cn(
        'rounded-card border-border bg-surface shadow-card border p-4 text-sm',
        className,
      )}
      {...props}
    >
      <Heading id={headingId} className="text-base font-semibold">
        {t(dict, 'map.legendTitle')}
      </Heading>

      <p className="text-muted-foreground mt-1 text-sm">{t(dict, 'map.legendDescription')}</p>

      {/* The filter is stated in words rather than implied by the markers
          changing colour, so it is impossible to read a single-pollutant map as
          though it were the overall picture. */}
      <p className="mt-2 text-sm font-medium">
        <span className="text-muted-foreground">{t(dict, 'pollutant.selectorLabel')}: </span>
        {pollutantDefinition ? (
          <span>
            <span aria-hidden="true">{pollutantDefinition.label}</span>
            <span className="sr-only">{pollutantDefinition.ariaLabel}</span>
          </span>
        ) : (
          <span>{t(dict, 'pollutant.allPollutants')}</span>
        )}
      </p>

      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {LEGEND_ROWS.map((row) => {
          const Icon = CATEGORY_ICONS[row.iconName] ?? CircleHelp;

          return (
            <li key={row.key} data-aq-band={row.bandId} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  'aq-swatch ring-border flex size-6 shrink-0 items-center justify-center rounded-full ring-1',
                  row.patternClass,
                )}
              >
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0">{t(dict, row.labelKey)}</span>
            </li>
          );
        })}
      </ul>

      <p className="text-muted-foreground mt-3 text-xs">{t(dict, 'category.patternNote')}</p>
      <p className="sr-only">{t(dict, 'a11y.colourNotAlone')}</p>

      {showAttribution ? (
        <div className="border-border text-muted-foreground mt-4 space-y-2 border-t pt-3 text-xs">
          {/* Fixed text required by the upstream terms of use. Reproduced
              verbatim through the dictionary — never paraphrased, never
              abbreviated to fit a corner of the map. */}
          <p>{t(dict, 'footer.attribution')}</p>
          <p>
            <a
              href={OSM_COPYRIGHT_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="hover:text-foreground underline decoration-from-font underline-offset-2"
            >
              {t(dict, 'map.attributionBasemap')}
            </a>
            <span className="sr-only"> {t(dict, 'a11y.newWindow')}</span>
          </p>
        </div>
      ) : null}
    </section>
  );
}

export default MapLegend;
