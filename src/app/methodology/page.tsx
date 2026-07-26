import type { Metadata } from 'next';
import Link from 'next/link';

import {
  BulletList,
  Callout,
  ContentPage,
  ContentSection,
  Definition,
  DefinitionList,
  Paragraph,
  SubHeading,
  TableScroll,
} from '@/components/layout/content-page';
import { getCapabilities } from '@/config/env';
import { POLLUTANTS, POLLUTANT_CODES } from '@/config/pollutants';
import { STATIONS } from '@/config/stations';
import {
  AIR_QUALITY_CATEGORIES,
  AQI_BREAKPOINTS,
  CATEGORY_PRESENTATION,
  EU_LIMIT_VALUES,
  WHO_GUIDELINES,
} from '@/config/thresholds';
import { FRESHNESS_THRESHOLDS } from '@/lib/air-quality/freshness';
import { categoryLabelKey, getDictionary, hasKey, t } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'Methodology',
  description:
    'How maqua.app collects Maltese air-quality data, calculates the European Air Quality Index, ' +
    'handles missing and modelled values, and decides what it will and will not claim.',
  alternates: { canonical: '/methodology' },
};

/**
 * /methodology — the page that has to be right.
 *
 * Everything asserted here is drawn from the configuration the application
 * actually runs on: the band tables come from `AQI_BREAKPOINTS`, the freshness
 * ladder from `FRESHNESS_THRESHOLDS`, the limits from `EU_LIMIT_VALUES`. If a
 * threshold changes in code, this page changes with it — a methodology page that
 * documents an earlier version of the software is worse than none.
 */
export default function MethodologyPage() {
  const dict = getDictionary();
  const s = (key: string, fallback: string): string =>
    hasKey(dict, key) ? t(dict, key) : fallback;

  /**
   * `getCapabilities()` parses the whole environment and throws on any malformed
   * variable. That is right at boot, but it must not take this page down: the
   * methodology is fixed reference material and does not depend on which
   * optional services a deployment happens to have.
   */
  let aiConfigured: boolean | null = null;
  try {
    aiConfigured = getCapabilities().ai;
  } catch {
    aiConfigured = null;
  }

  const trafficStations = STATIONS.filter((station) => station.stationType === 'Traffic');
  const backgroundStations = STATIONS.filter((station) => station.stationType === 'Background');

  return (
    <ContentPage
      title={t(dict, 'methodology.title')}
      lead={s(
        'methodology.lead',
        'Every figure on this site comes from a published measurement and a documented calculation. This page sets out both, including the places where the honest answer is that we cannot tell you.',
      )}
    >
      {/* ---------------------------------------------------------------- */}
      <ContentSection
        id="collection"
        heading={s('methodology.collectionHeading', 'Where the data comes from')}
      >
        <Paragraph>
          Malta&apos;s Environment and Resources Authority (ERA) operates the five automatic
          monitoring stations that appear on this site. ERA owns the measurements. Malta reports
          them to the European Environment Agency (EEA) under the Ambient Air Quality Directive, and
          the EEA republishes them hourly through its European Air Quality Index dissemination
          layer. maqua.app reads that published feed.
        </Paragraph>
        <Paragraph>
          There is no direct ERA integration, and we do not claim one. Every attempt to reach
          era.org.mt from a server returns HTTP 403 — the site is behind bot protection that rejects
          non-browser clients — so no ERA endpoint has ever been observed from this application, and
          none has been invented. The provider interface is in place should that change.
        </Paragraph>
        <Paragraph>
          Readings are fetched server-side and cached, so a visitor&apos;s browser never contacts
          the upstream source directly. That keeps load on a public resource proportionate and means
          the site can keep serving the last good reading, clearly labelled, when the feed is
          briefly unavailable.
        </Paragraph>
        <Callout>
          {s(
            'methodology.provisionalNote',
            'Near-real-time data is published before validation. ERA verifies it afterwards, and figures may be revised or withdrawn. Nothing here should be treated as a final, quality-assured record.',
          )}
        </Callout>
      </ContentSection>

      {/* ---------------------------------------------------------------- */}
      <ContentSection id="index" heading={t(dict, 'methodology.indexHeading')}>
        <Paragraph>{t(dict, 'methodology.indexBody')}</Paragraph>
        <Paragraph>
          The calculation is deliberately mechanical, and it runs in this application rather than
          being taken on trust from the feed:
        </Paragraph>
        <BulletList>
          <li>
            The concentration is rounded to the nearest whole microgram per cubic metre. This step
            decides the band for any value within half a unit of a boundary — 15.48 µg/m³ of PM10 is
            Good, because it rounds to 15.
          </li>
          <li>
            The rounded value is matched against inclusive whole-number ranges, not against
            half-open real intervals. The distinction looks academic and is not: modelling the bands
            as intervals misclassifies values near every boundary.
          </li>
          <li>
            A location takes the band of its <em>worst</em> pollutant. Bands are never averaged
            across pollutants.
          </li>
        </BulletList>
        <Paragraph>
          The result was checked against 6,760 published concentration-and-index pairs from the five
          Malta stations, with no mismatches. That check runs in continuous integration against
          captured real data, so a regression fails the build rather than reaching a reader.
        </Paragraph>

        <SubHeading>{s('methodology.bandsHeading', 'The six bands')}</SubHeading>
        <Paragraph>
          Inclusive upper bounds in µg/m³ for each pollutant. The top band&apos;s ceiling is the
          scale&apos;s saturation point: concentrations above it stay in that band rather than
          running off the scale.
        </Paragraph>
        <TableScroll
          label={s('methodology.bandsTableLabel', 'Air-quality index bands by pollutant')}
        >
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <caption className="sr-only">
              {s(
                'methodology.bandsTableCaption',
                'Inclusive upper concentration bound, in micrograms per cubic metre, for each band and pollutant.',
              )}
            </caption>
            <thead>
              <tr className="border-border bg-surface-sunken border-b">
                <th scope="col" className="text-foreground px-3 py-2 text-left font-semibold">
                  {s('methodology.bandColumn', 'Band')}
                </th>
                {POLLUTANT_CODES.map((code) => (
                  <th
                    key={code}
                    scope="col"
                    className="text-foreground px-3 py-2 text-right font-semibold"
                  >
                    <span aria-hidden="true">{POLLUTANTS[code].label}</span>
                    <span className="sr-only">{POLLUTANTS[code].ariaLabel}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {AIR_QUALITY_CATEGORIES.map((category) => {
                const presentation = CATEGORY_PRESENTATION[category];
                return (
                  <tr key={category} className="border-border border-b last:border-b-0">
                    <th scope="row" className="px-3 py-2 text-left font-medium">
                      <span className="flex items-center gap-2">
                        {/* Colour is paired with the written band name, never used alone. */}
                        <span
                          className="aq-dot"
                          data-aq-band={presentation.bandId}
                          aria-hidden="true"
                        />
                        <span className="text-foreground">
                          {t(dict, categoryLabelKey(category))}
                        </span>
                      </span>
                    </th>
                    {POLLUTANT_CODES.map((code) => {
                      const band = AQI_BREAKPOINTS[code].breakpoints.find(
                        (breakpoint) => breakpoint.category === category,
                      );
                      return (
                        <td
                          key={code}
                          className="text-muted-foreground tabular px-3 py-2 text-right"
                        >
                          {band ? `${band.min}–${band.max}` : t(dict, 'common.notAvailableShort')}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
        <Paragraph>
          A band identifier of zero is not a seventh, better-than-Good band. It means no index could
          be calculated, and the site renders it as &ldquo;No data&rdquo;.
        </Paragraph>
      </ContentSection>

      {/* ---------------------------------------------------------------- */}
      <ContentSection id="sub-index" heading={t(dict, 'methodology.subIndexHeading')}>
        <Paragraph>{t(dict, 'methodology.subIndexBody')}</Paragraph>
        <Paragraph>
          A sub-index is the band number plus the value&apos;s fractional position within that band,
          capped just below the next whole number so a concentration sitting exactly on a ceiling
          stays in the band it belongs to. A station at 3.1 has only just entered Moderate; one at
          3.9 is close to Poor. Both are labelled Moderate, and the difference between them is real.
        </Paragraph>
      </ContentSection>

      {/* ---------------------------------------------------------------- */}
      <ContentSection
        id="pollutants"
        heading={s('methodology.pollutantsHeading', 'The five pollutants')}
      >
        <Paragraph>
          Each station reports what its instruments actually measure. Coverage differs by site, and
          a pollutant is never shown for a station merely because similar stations report it.
        </Paragraph>
        <DefinitionList>
          {POLLUTANT_CODES.map((code) => {
            const pollutant = POLLUTANTS[code];
            return (
              <Definition
                key={code}
                term={`${pollutant.label} — ${t(dict, `pollutant.${pollutant.slug}.name`)}`}
              >
                <span className="flex flex-col gap-2">
                  <span>{t(dict, pollutant.descriptionKey)}</span>
                  <span>
                    <strong className="text-foreground font-medium">
                      {t(dict, 'pollutant.whereFrom')}:
                    </strong>{' '}
                    {t(dict, pollutant.sourcesKey)}
                  </span>
                  <span>
                    <strong className="text-foreground font-medium">
                      {t(dict, 'pollutant.healthEffects')}:
                    </strong>{' '}
                    {t(dict, pollutant.healthEffectsKey)}
                  </span>
                  <span className="text-subtle text-sm">
                    {t(dict, 'pollutant.averagingPeriod')}: {pollutant.averagingPeriod} ·{' '}
                    {pollutant.unit}
                  </span>
                </span>
              </Definition>
            );
          })}
        </DefinitionList>
      </ContentSection>

      {/* ---------------------------------------------------------------- */}
      <ContentSection
        id="station-versus-area"
        heading={s('methodology.stationAreaHeading', 'A station is not an area')}
      >
        <Paragraph>
          Five stations cannot describe every street in Malta and Gozo. What a station measures is
          the air at that instrument, and how far that generalises depends entirely on why the
          station is there.
        </Paragraph>
        <DefinitionList>
          <Definition term={t(dict, 'station.type.background')}>
            {t(dict, 'station.type.backgroundExplain')} On this site that is{' '}
            {backgroundStations.map((station) => station.name).join(', ')}. A background reading is
            a reasonable guide to general conditions across the surrounding area.
          </Definition>
          <Definition term={t(dict, 'station.type.traffic')}>
            {t(dict, 'station.type.trafficExplain')} On this site that is{' '}
            {trafficStations.map((station) => station.name).join(' and ')}. Nitrogen dioxide in
            particular falls away sharply within tens of metres of a busy road, so a traffic reading
            describes the roadside — not the neighbourhood behind it, and not a garden two streets
            away.
          </Definition>
        </DefinitionList>
        <Paragraph>
          Għarb is the only station on Gozo, and it is rural. Conditions in Victoria or along the
          Mġarr road are not measured. Where there is no nearby station, the site says so rather
          than interpolating a number across a gap it has no evidence for.
        </Paragraph>
        <Callout>
          {s(
            'methodology.noInterpolation',
            'maqua.app does not interpolate between stations, and does not produce a value for a location that has no instrument. Every figure shown belongs to a named station at a named hour.',
          )}
        </Callout>
      </ContentSection>

      {/* ---------------------------------------------------------------- */}
      <ContentSection id="latency" heading={s('methodology.latencyHeading', 'Timing and latency')}>
        <Paragraph>
          The feed publishes hourly. Measured against the source on 26 July 2026, the newest hour
          containing a genuinely measured value was about 58 minutes old at the moment of
          publication. A reading that is one to two hours old is therefore normal operation, not a
          fault.
        </Paragraph>
        <Paragraph>
          Three different times are shown, because they answer three different questions:
        </Paragraph>
        <DefinitionList>
          <Definition term={t(dict, 'freshness.measuredAtLabel')}>
            The hour the air was sampled. This is the time the reading actually describes.
          </Definition>
          <Definition term={t(dict, 'freshness.retrievedAtLabel')}>
            When maqua.app last obtained the figure from the source. A recent retrieval does not
            make an old measurement current.
          </Definition>
          <Definition term={t(dict, 'freshness.ageLabel')}>
            How much time has passed since the measurement hour, which is what decides whether the
            reading still describes the present.
          </Definition>
        </DefinitionList>
        <Paragraph>All times are shown in Malta time on a 24-hour clock.</Paragraph>
      </ContentSection>

      {/* ---------------------------------------------------------------- */}
      <ContentSection id="stale" heading={s('methodology.staleHeading', 'Stale and missing data')}>
        <Paragraph>
          A reading is classified by age, and the label is never softened. The word
          &ldquo;live&rdquo; is reserved for readings inside the normal publication window and is
          used nowhere else.
        </Paragraph>
        <DefinitionList>
          <Definition term={t(dict, 'freshness.fresh.label')}>
            {t(dict, 'freshness.fresh.description')} Up to {FRESHNESS_THRESHOLDS.freshMaxHours}{' '}
            hours old.
          </Definition>
          <Definition term={t(dict, 'freshness.delayed.label')}>
            {t(dict, 'freshness.delayed.description')} Between {FRESHNESS_THRESHOLDS.freshMaxHours}{' '}
            and {FRESHNESS_THRESHOLDS.delayedMaxHours} hours old.
          </Definition>
          <Definition term={t(dict, 'freshness.stale.label')}>
            {t(dict, 'freshness.stale.description')} Between {FRESHNESS_THRESHOLDS.delayedMaxHours}{' '}
            and {FRESHNESS_THRESHOLDS.staleMaxHours} hours old.
          </Definition>
          <Definition term={t(dict, 'freshness.unavailable.label')}>
            {t(dict, 'freshness.unavailable.description')} Older than{' '}
            {FRESHNESS_THRESHOLDS.staleMaxHours} hours, or no reading at all.
          </Definition>
        </DefinitionList>
        <Paragraph>{t(dict, 'methodology.missingDataBody')}</Paragraph>
        <Callout tone="warning">{t(dict, 'errors.dataUnavailableHint')}</Callout>
      </ContentSection>

      {/* ---------------------------------------------------------------- */}
      <ContentSection id="aggregation" heading={t(dict, 'methodology.aggregationHeading')}>
        <Paragraph>{t(dict, 'header.aggregationExplain')}</Paragraph>
        <Paragraph>
          The summary also states how many of the {STATIONS.length} stations are currently
          reporting. If that number is low, the headline is describing a smaller part of the islands
          than it appears to, and the figure is there so you can judge it.
        </Paragraph>
      </ContentSection>

      {/* ---------------------------------------------------------------- */}
      <ContentSection id="forecast" heading={t(dict, 'methodology.forecastHeading')}>
        <Paragraph>{t(dict, 'forecast.description')}</Paragraph>
        <Paragraph>
          The same file that carries the observations also carries roughly 48 hours of modelled
          values ahead of the present, produced by the Copernicus Atmosphere Monitoring Service.
          maqua.app does not run a model of its own and does not adjust these numbers.
        </Paragraph>
        <Paragraph>
          Telling a forecast from an observation cannot be done by looking at the clock. The feed
          also fills gaps in <em>past</em> hours by modelling, when an instrument did not report.
          Both cases are identified from the provenance flag the feed itself provides, and both are
          labelled as estimates.
        </Paragraph>
        <Callout tone="warning">{t(dict, 'forecast.notObservation')}</Callout>
      </ContentSection>

      {/* ---------------------------------------------------------------- */}
      <ContentSection
        id="context"
        heading={s('methodology.contextHeading', 'Environmental context')}
      >
        <Paragraph>
          Alongside the readings, the site may show context that helps explain them: weather
          conditions, and known regional events such as Saharan dust reaching the islands. Weather
          and dust data come from open services — Open-Meteo for meteorology and the Copernicus
          atmosphere service for dust — under their own licences.
        </Paragraph>
        <Paragraph>
          Context is offered as explanation, never as measurement. A dust advisory does not change a
          single concentration or band on this site; the readings are what they are, and the context
          is there to say why they might look as they do. Where context is unavailable, it is simply
          absent — nothing is inferred to fill the space.
        </Paragraph>
      </ContentSection>

      {/* ---------------------------------------------------------------- */}
      <ContentSection id="limits" heading={t(dict, 'methodology.limitsHeading')}>
        <Paragraph>{t(dict, 'methodology.limitsBody')}</Paragraph>
        <Paragraph>{t(dict, 'threshold.legalNote')}</Paragraph>
        <TableScroll
          label={s('methodology.limitsTableLabel', 'EU limit values and WHO guidelines')}
        >
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <caption className="sr-only">
              {s(
                'methodology.limitsTableCaption',
                'EU limit values and WHO guideline values, with the averaging period each applies to and whether a single hourly reading can assess it.',
              )}
            </caption>
            <thead>
              <tr className="border-border bg-surface-sunken border-b">
                <th scope="col" className="text-foreground px-3 py-2 text-left font-semibold">
                  {t(dict, 'pollutant.selectorLabel')}
                </th>
                <th scope="col" className="text-foreground px-3 py-2 text-left font-semibold">
                  {s('methodology.referenceColumn', 'Reference')}
                </th>
                <th scope="col" className="text-foreground px-3 py-2 text-right font-semibold">
                  {s('methodology.valueColumn', 'Value')}
                </th>
                <th scope="col" className="text-foreground px-3 py-2 text-left font-semibold">
                  {s('methodology.periodColumn', 'Averaging period')}
                </th>
                <th scope="col" className="text-foreground px-3 py-2 text-left font-semibold">
                  {s('methodology.assessableColumn', 'One hourly reading can assess it?')}
                </th>
              </tr>
            </thead>
            <tbody>
              {EU_LIMIT_VALUES.map((limit) => (
                <tr
                  key={`eu-${limit.pollutant}-${limit.averagingPeriod}`}
                  className="border-border border-b last:border-b-0"
                >
                  <th scope="row" className="text-foreground px-3 py-2 text-left font-medium">
                    {POLLUTANTS[limit.pollutant].label}
                  </th>
                  <td className="text-muted-foreground px-3 py-2">
                    {t(dict, 'threshold.euLimit')}
                  </td>
                  <td className="text-muted-foreground tabular px-3 py-2 text-right">
                    {limit.value} {limit.unit}
                  </td>
                  <td className="text-muted-foreground px-3 py-2">
                    {limit.averagingPeriod}
                    {limit.permittedExceedances !== null ? (
                      <span className="text-subtle">
                        {' '}
                        ({s(
                          'methodology.permittedExceedances',
                          'exceedances permitted per year',
                        )}: {limit.permittedExceedances})
                      </span>
                    ) : null}
                  </td>
                  <td className="text-muted-foreground px-3 py-2">
                    {limit.assessableFromSingleReading
                      ? t(dict, 'common.yes')
                      : t(dict, 'common.no')}
                  </td>
                </tr>
              ))}
              {WHO_GUIDELINES.map((guideline) => (
                <tr
                  key={`who-${guideline.pollutant}-${guideline.averagingPeriod}`}
                  className="border-border border-b last:border-b-0"
                >
                  <th scope="row" className="text-foreground px-3 py-2 text-left font-medium">
                    {POLLUTANTS[guideline.pollutant].label}
                  </th>
                  <td className="text-muted-foreground px-3 py-2">
                    {t(dict, 'threshold.whoGuideline')}
                  </td>
                  <td className="text-muted-foreground tabular px-3 py-2 text-right">
                    {guideline.value} {guideline.unit}
                  </td>
                  <td className="text-muted-foreground px-3 py-2">{guideline.averagingPeriod}</td>
                  <td className="text-muted-foreground px-3 py-2">
                    {guideline.assessableFromSingleReading
                      ? t(dict, 'common.yes')
                      : t(dict, 'common.no')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
        <Callout tone="warning">
          {s(
            'methodology.noLegalClaim',
            'maqua.app never states that a legal limit has been breached on the strength of a single hourly reading. Where a comparison cannot settle the question, it says so instead of implying an answer.',
          )}
        </Callout>
        <Paragraph>{t(dict, 'threshold.whoNote')}</Paragraph>
      </ContentSection>

      {/* ---------------------------------------------------------------- */}
      <ContentSection id="ai" heading={s('methodology.aiHeading', 'How AI is used')}>
        <Paragraph>
          {aiConfigured === null
            ? 'Whether this particular deployment has an AI service configured could not be determined. The boundary below applies either way.'
            : aiConfigured
              ? 'This deployment can generate plain-language explanations of a reading using a large language model, accessed through OpenRouter.'
              : 'This deployment has no AI service configured. Explanations, where offered, are assembled deterministically from the measured data with no model involved.'}
        </Paragraph>
        <Paragraph>
          The boundary is absolute, and it is enforced in code rather than by prompt wording:
        </Paragraph>
        <BulletList>
          <li>
            No index value, band, threshold comparison or timestamp is ever produced by a model. All
            of those are calculated by this application from the published concentrations.
          </li>
          <li>
            A model receives figures that have already been calculated and shown on the page, and
            its only job is to put them into sentences.
          </li>
          <li>
            Generated text is labelled as such, and carries the reminder that it is general
            information rather than medical advice.
          </li>
          <li>
            If the model is unavailable, rate-limited or returns something that fails validation,
            the site falls back to a deterministic explanation. It never silently drops the numbers.
          </li>
        </BulletList>
        <Callout tone="warning">{t(dict, 'ai.doesNotCompute')}</Callout>
      </ContentSection>

      {/* ---------------------------------------------------------------- */}
      <ContentSection
        id="health"
        heading={s('methodology.healthHeading', 'Health guidance and its limits')}
      >
        <Paragraph>
          Health guidance on this site follows the advice published alongside the European Air
          Quality Index. It is deliberately general and precautionary: it describes what a band
          typically means for most people and for those who are more sensitive to air pollution, and
          it does not attempt to say anything about any individual.
        </Paragraph>
        <Paragraph>{t(dict, 'health.generalGuidance')}</Paragraph>
        <BulletList>
          <li>No guidance here is tailored to a person, a condition or a medication.</li>
          <li>Nothing here is a diagnosis, a prognosis or a treatment recommendation.</li>
          <li>
            This is not an emergency service and not an official public-health warning channel. If
            an authority issues instructions, follow those.
          </li>
        </BulletList>
        <Callout tone="warning">{t(dict, 'disclaimer.medical')}</Callout>
        <Paragraph>{t(dict, 'health.emergencyNote')}</Paragraph>
      </ContentSection>

      {/* ---------------------------------------------------------------- */}
      <ContentSection id="further" heading={s('methodology.furtherHeading', 'Related pages')}>
        <BulletList>
          <li>
            <Link href="/about" className="text-primary underline underline-offset-4">
              {t(dict, 'footer.aboutLink')}
            </Link>{' '}
            — what this project is and who runs it.
          </li>
          <li>
            <Link href="/privacy" className="text-primary underline underline-offset-4">
              {t(dict, 'footer.privacyLink')}
            </Link>{' '}
            — what data the site handles about you, and what it does not.
          </li>
        </BulletList>
        <Paragraph>{t(dict, 'footer.attribution')}</Paragraph>
      </ContentSection>
    </ContentPage>
  );
}
