import { ExternalLink, MapPin } from 'lucide-react';
import Link from 'next/link';
import type * as React from 'react';

import { BandRail } from '@/components/air-quality/band-rail';
import { CategoryBadge } from '@/components/air-quality/category-badge';
import { FreshnessIndicator } from '@/components/air-quality/freshness-indicator';
import { ThresholdComparison } from '@/components/air-quality/threshold-comparison';
import { DangerBanner } from '@/components/health-guidance/danger-banner';
import { HealthGuidance } from '@/components/health-guidance/health-guidance';
import { PollutantValue } from '@/components/pollutants/pollutant-value';
import {
  areaLabel,
  islandLabel,
  stationHref,
  stationTypeExplanation,
  stationTypeLabel,
  type StationDescriptor,
} from '@/components/stations/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { POLLUTANT_CODES, POLLUTANTS, type PollutantCode } from '@/config/pollutants';
import type { StationReading } from '@/lib/air-quality/types';
import {
  formatCoordinates,
  formatNumber,
  formatSubIndex,
  getDictionary,
  t,
  type Dictionary,
} from '@/lib/i18n';
import { isSafeExternalLink } from '@/lib/security/allowlist';
import { cn } from '@/lib/utils/cn';

type HeadingLevel = 'h2' | 'h3';

const SUB_HEADING: Record<HeadingLevel, 'h3' | 'h4'> = { h2: 'h3', h3: 'h4' };

export type StationPanelProps = Omit<React.ComponentProps<'div'>, 'children'> & {
  station: StationDescriptor;
  /** `null` when the station published nothing usable for this hour. */
  reading: StationReading | null | undefined;
  /**
   * Pollutants this station is expected to report, normally
   * `StationDefinition.expectedPollutants` or `AirQualityStation.pollutantsMeasured`.
   *
   * Used to show an expected pollutant that is missing this hour, so a gap is
   * visible rather than silent. It never restricts the list: a pollutant that
   * turns up unexpectedly in the payload is still rendered.
   */
  expectedPollutants?: readonly PollutantCode[];
  /** Link to the station's full page. Defaults to `stationHref(station)`. */
  href?: string;
  /** Set false where a surrounding dialog already renders the station name. */
  showHeader?: boolean;
  /** Set false where the panel opens inside something that announces itself. */
  announceDanger?: boolean;
  /**
   * Set false where the surrounding page already gives health guidance.
   *
   * The home page does: its headline carries the islands-wide advice, which is
   * taken from the worst reporting station and is therefore never laxer than
   * this station's own. Rendering both put "What this means for you" on the page
   * twice, word for word, whenever the selected station was the driving one.
   */
  showGuidance?: boolean;
  showStationLink?: boolean;
  headingLevel?: HeadingLevel;
  dict?: Dictionary;
};

/**
 * Everything known about one station at one hour.
 *
 * The pollutant list is the union of what the station is expected to report and
 * what the payload actually contains. `src/config/stations.ts` is explicit that
 * the expected list is advisory: a station never shows a pollutant merely
 * because it is listed there, and never hides one that unexpectedly appears.
 * Rendering only the payload would hide an outage; rendering only the expected
 * list would drop a real measurement.
 */
export function StationPanel({
  station,
  reading,
  expectedPollutants = [],
  href,
  showHeader = true,
  announceDanger = true,
  showGuidance = true,
  showStationLink = true,
  headingLevel = 'h2',
  dict = getDictionary(),
  className,
  ...props
}: StationPanelProps) {
  const Heading = headingLevel;
  const SubHeading = SUB_HEADING[headingLevel];

  const reported = Object.keys(reading?.pollutants ?? {}) as PollutantCode[];
  const codes = POLLUTANT_CODES.filter(
    (code) => expectedPollutants.includes(code) || reported.includes(code),
  );

  const dominant = reading?.dominantPollutant ?? null;
  const dominantReading = dominant ? (reading?.pollutants[dominant] ?? null) : null;

  const typeExplanation = stationTypeExplanation(station.stationType, dict);
  const resolvedHref = href ?? stationHref(station);
  const sourceIsSafe = isSafeExternalLink(station.sourceUrl);

  return (
    <div
      data-slot="station-panel"
      data-station={station.id}
      className={cn('flex flex-col gap-6', className)}
      {...props}
    >
      {showHeader ? (
        <header className="flex flex-col gap-2">
          <Heading className="text-xl leading-tight font-semibold">{station.name}</Heading>

          <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm">
            <MapPin className="size-4 shrink-0" aria-hidden="true" />
            <span>{station.locality}</span>
            <span aria-hidden="true">{t(dict, 'common.separator')}</span>
            <span>{islandLabel(station.island, dict)}</span>
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" size="sm" title={typeExplanation ?? undefined}>
              {stationTypeLabel(station.stationType, dict)}
            </Badge>
            <Badge variant="subtle" size="sm">
              {areaLabel(station.areaClassification, dict)}
            </Badge>
            <Badge variant={reading ? 'accent' : 'outline'} size="sm">
              {t(dict, reading ? 'station.reporting' : 'station.notReporting')}
            </Badge>
            {!station.active ? (
              <Badge variant="outline" size="sm">
                {t(dict, 'station.inactive')}
              </Badge>
            ) : null}
          </div>
        </header>
      ) : null}

      {reading ? (
        <DangerBanner
          category={reading.overallCategory}
          pollutant={dominant}
          measuredAt={reading.measuredAt}
          provisional={reading.provisional}
          modelled={dominantReading?.modelled ?? false}
          stationName={station.name}
          announce={announceDanger}
          dict={dict}
        />
      ) : null}

      {reading ? (
        <section className="flex flex-col gap-3">
          <SubHeading className="sr-only">{t(dict, 'station.overall')}</SubHeading>

          <div className="flex flex-wrap items-center gap-3">
            <CategoryBadge
              category={reading.overallCategory}
              size="lg"
              subIndex={reading.overallSubIndex}
              srPrefix={station.name}
              dict={dict}
            />

            {dominant ? (
              <p className="text-sm">
                <span aria-hidden="true">
                  {t(dict, 'header.dominantPollutant', {
                    pollutant: POLLUTANTS[dominant].label,
                  })}
                </span>
                <span className="sr-only">
                  {t(dict, 'header.dominantPollutant', {
                    pollutant: POLLUTANTS[dominant].ariaLabel,
                  })}
                </span>
              </p>
            ) : null}
          </div>

          {/* The same scale as the headline, at the same size, so a reader who
              has taken in the islands-wide rail can place this station against
              it without relearning anything. This is also where the sub-index
              in the sentence below stops being an abstract figure. */}
          <BandRail
            subIndex={reading.overallSubIndex}
            category={reading.overallCategory}
            size="lg"
            forLabel={station.name}
            dict={dict}
          />

          <p className="text-muted-foreground text-xs leading-relaxed">
            {t(dict, 'station.overallExplain')}
          </p>

          {reading.overallSubIndex !== null ? (
            <p className="text-muted-foreground text-xs leading-relaxed">
              {t(dict, 'station.subIndex', {
                value: formatSubIndex(reading.overallSubIndex, dict),
              })}
              {t(dict, 'common.separator')}
              {t(dict, 'station.subIndexExplain')}
            </p>
          ) : null}

          <FreshnessIndicator
            freshness={reading.freshness}
            measuredAt={reading.measuredAt}
            fetchedAt={reading.fetchedAt}
            ageHours={reading.ageHours}
            size="sm"
            dict={dict}
          />

          <div className="flex flex-wrap items-center gap-2">
            {reading.provisional ? (
              <Badge variant="outline" size="sm" title={t(dict, 'station.provisionalExplain')}>
                {t(dict, 'station.provisional')}
              </Badge>
            ) : null}
            {reading.partial ? (
              <Badge variant="outline" size="sm" title={t(dict, 'station.partialExplain')}>
                {t(dict, 'station.partial')}
              </Badge>
            ) : null}
          </div>

          <div className="text-muted-foreground flex flex-col gap-1 text-xs leading-relaxed">
            {reading.provisional ? <p>{t(dict, 'station.provisionalExplain')}</p> : null}
            {reading.partial ? <p>{t(dict, 'station.partialExplain')}</p> : null}
          </div>
        </section>
      ) : (
        <section className="border-border bg-surface-sunken rounded-card flex flex-col gap-1 border p-4">
          <SubHeading className="text-base font-semibold">
            {t(dict, 'station.noReading')}
          </SubHeading>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t(dict, 'station.noReadingHint')}
          </p>
          {/* Said explicitly, because an empty panel would otherwise read as
              reassurance. */}
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t(dict, 'errors.dataUnavailableHint')}
          </p>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <SubHeading className="text-base font-semibold">{t(dict, 'station.pollutants')}</SubHeading>

        {codes.length === 0 ? (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t(dict, 'station.noPollutants')}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {codes.map((code) => (
              <li key={code} className="border-border rounded-card border p-3">
                <PollutantValue
                  pollutant={code}
                  reading={reading?.pollutants[code] ?? null}
                  variant="detail"
                  dominant={code === dominant}
                  dict={dict}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {dominant && dominantReading ? (
        <ThresholdComparison
          pollutant={dominant}
          value={dominantReading.value}
          headingLevel={SUB_HEADING[headingLevel]}
          dict={dict}
        />
      ) : null}

      {showGuidance ? (
        <HealthGuidance
          category={reading?.overallCategory ?? null}
          headingLevel={SUB_HEADING[headingLevel]}
          dict={dict}
        />
      ) : null}

      <section className="border-border flex flex-col gap-3 border-t pt-4">
        <SubHeading className="sr-only">{t(dict, 'station.panelTitle')}</SubHeading>

        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex flex-col">
            <dt className="text-muted-foreground text-xs font-medium">{t(dict, 'station.type')}</dt>
            <dd>{stationTypeLabel(station.stationType, dict)}</dd>
          </div>

          <div className="flex flex-col">
            <dt className="text-muted-foreground text-xs font-medium">{t(dict, 'station.area')}</dt>
            <dd>{areaLabel(station.areaClassification, dict)}</dd>
          </div>

          <div className="flex flex-col">
            <dt className="text-muted-foreground text-xs font-medium">
              {t(dict, 'station.altitude')}
            </dt>
            <dd className="tabular">
              {t(dict, 'station.altitudeValue', {
                metres: formatNumber(station.altitudeMetres, 0, dict),
              })}
            </dd>
          </div>

          <div className="flex flex-col">
            <dt className="text-muted-foreground text-xs font-medium">
              {t(dict, 'station.coordinates')}
            </dt>
            <dd className="tabular">{formatCoordinates(station.latitude, station.longitude)}</dd>
          </div>

          <div className="flex flex-col sm:col-span-2">
            <dt className="text-muted-foreground text-xs font-medium">
              {t(dict, 'station.operator')}
            </dt>
            <dd>{station.operator}</dd>
          </div>
        </dl>

        {typeExplanation ? (
          <p className="text-muted-foreground text-xs leading-relaxed">{typeExplanation}</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          {showStationLink ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={resolvedHref}>{t(dict, 'common.viewDetails')}</Link>
            </Button>
          ) : null}

          {/* Only ever an https link with no embedded credentials — checked
              rather than trusted, because the URL is data. */}
          {sourceIsSafe ? (
            <Button asChild variant="ghost" size="sm">
              <a href={station.sourceUrl} target="_blank" rel="noopener noreferrer">
                {t(dict, 'station.sourceLink')}
                <ExternalLink className="size-4" aria-hidden="true" />
                <span className="sr-only">{t(dict, 'a11y.newWindow')}</span>
              </a>
            </Button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
