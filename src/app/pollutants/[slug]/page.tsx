import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

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
import { POLLUTANTS, POLLUTANT_CODES, pollutantFromSlug } from '@/config/pollutants';
import { POLLUTANT_GUIDES } from '@/config/pollutant-guides';
import { STATIONS } from '@/config/stations';
import { AQI_BREAKPOINTS, EU_LIMIT_VALUES, WHO_GUIDELINES } from '@/config/thresholds';
import { getDictionary, sensitiveGroupLabelKey, t } from '@/lib/i18n';

type RouteParams = { slug: string };

/**
 * The five guide routes.
 *
 * Every route in this application is dynamically rendered — the root layout
 * reads the per-request CSP nonce, which opts out of static generation — so
 * this does not currently prerender anything. It stays because it is the
 * declaration of which slugs exist: it documents the finite set, and if the
 * nonce requirement is ever lifted these five pages become static again with
 * no further change.
 */
export async function generateStaticParams(): Promise<RouteParams[]> {
  return POLLUTANT_CODES.map((code) => ({ slug: POLLUTANTS[code].slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { slug } = await params;
  const code = pollutantFromSlug(slug);
  if (!code) return {};

  const dict = getDictionary();
  const pollutant = POLLUTANTS[code];
  const title = `${pollutant.label} — ${t(dict, `pollutant.${pollutant.slug}.name`)} in Malta`;

  return {
    title,
    description: POLLUTANT_GUIDES[code].lead,
    alternates: { canonical: `/pollutants/${pollutant.slug}` },
    openGraph: { title, description: POLLUTANT_GUIDES[code].lead, type: 'article' },
  };
}

/**
 * Per-pollutant guide.
 *
 * One template, five pollutants — and the reason that is acceptable here, when
 * templated pages are exactly what this work set out to fix, is that almost
 * nothing on the rendered page is shared between the five. The prose comes from
 * `POLLUTANT_GUIDES`, which is written per pollutant; the band table, the legal
 * limits and the station list are all derived from that pollutant's own
 * records. What the template contributes is the order of the sections.
 *
 * Every number on this page is read from `src/config/thresholds.ts` at render
 * time rather than typed into prose. A limit value retyped into a sentence is a
 * limit value that will eventually disagree with the one the application
 * actually uses — and Directive (EU) 2024/2881 tightens several of these from
 * 2030, so that day is scheduled.
 */
export default async function PollutantGuidePage({ params }: { params: Promise<RouteParams> }) {
  const { slug } = await params;
  const code = pollutantFromSlug(slug);
  if (!code) notFound();

  const dict = getDictionary();
  const pollutant = POLLUTANTS[code];
  const guide = POLLUTANT_GUIDES[code];
  const name = t(dict, `pollutant.${pollutant.slug}.name`);

  const thresholds = AQI_BREAKPOINTS[code];
  const euLimits = EU_LIMIT_VALUES.filter((limit) => limit.pollutant === code);
  const whoGuidelines = WHO_GUIDELINES.filter((g) => g.pollutant === code);

  /* Which stations carry this pollutant, from the registry rather than prose. */
  const measuring = STATIONS.filter(
    (station) => station.active && station.expectedPollutants.includes(code),
  );
  const notMeasuring = STATIONS.filter(
    (station) => station.active && !station.expectedPollutants.includes(code),
  );

  return (
    <ContentPage
      title={`${pollutant.label} — ${name}`}
      lead={guide.lead}
      aside={
        <p className="text-subtle text-sm">
          Measured at {measuring.length} of the {STATIONS.filter((s) => s.active).length} monitoring
          stations in Malta and Gozo · averaged over {pollutant.averagingPeriod.toLowerCase()} ·{' '}
          {pollutant.unit}
        </p>
      }
    >
      <ContentSection id="what" heading={t(dict, 'pollutant.whatIsIt')}>
        <Paragraph>{t(dict, pollutant.descriptionKey)}</Paragraph>
        {guide.what.map((text) => (
          <Paragraph key={text.slice(0, 32)}>{text}</Paragraph>
        ))}
      </ContentSection>

      <ContentSection id="sources" heading={t(dict, 'pollutant.whereFrom')}>
        <Paragraph>{t(dict, pollutant.sourcesKey)}</Paragraph>
        {guide.sources.map((text) => (
          <Paragraph key={text.slice(0, 32)}>{text}</Paragraph>
        ))}
      </ContentSection>

      <ContentSection id="in-malta" heading={`${pollutant.label} in Malta and Gozo`}>
        {guide.inMalta.map((text) => (
          <Paragraph key={text.slice(0, 32)}>{text}</Paragraph>
        ))}
      </ContentSection>

      <ContentSection id="health" heading={t(dict, 'pollutant.healthEffects')}>
        <Paragraph>{t(dict, pollutant.healthEffectsKey)}</Paragraph>
        {guide.health.map((text) => (
          <Paragraph key={text.slice(0, 32)}>{text}</Paragraph>
        ))}
        <SubHeading>Who is most affected</SubHeading>
        <Paragraph>
          These are the groups for whom {pollutant.label} specifically is most relevant, in rough
          order. The ordering is a matter of which mechanism this pollutant acts through, not a
          ranking of how much anyone matters.
        </Paragraph>
        <BulletList>
          {guide.watchFor.map((group) => (
            <li key={group}>{t(dict, sensitiveGroupLabelKey(group))}</li>
          ))}
        </BulletList>
        <Callout tone="warning">{t(dict, 'disclaimer.medical')}</Callout>
      </ContentSection>

      <ContentSection id="bands" heading={`How a ${pollutant.label} reading becomes a band`}>
        {guide.reading.map((text) => (
          <Paragraph key={text.slice(0, 32)}>{text}</Paragraph>
        ))}
        <Paragraph>
          These are the European Air Quality Index bands for {pollutant.label} alone. Each band is
          an inclusive range of whole {pollutant.unit}: a concentration is rounded to the nearest
          whole number first, then matched. A station takes the band of its worst pollutant, so a
          single figure here does not by itself decide what the station reports.
        </Paragraph>
        <TableScroll label={`European Air Quality Index bands for ${pollutant.label}`}>
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">
              Index bands for {pollutant.label}, in {pollutant.unit}
            </caption>
            <thead>
              <tr className="border-border border-b text-left">
                <th scope="col" className="text-foreground p-3 font-semibold">
                  Band
                </th>
                <th scope="col" className="text-foreground p-3 font-semibold">
                  {pollutant.label} ({pollutant.unit})
                </th>
              </tr>
            </thead>
            <tbody>
              {thresholds.breakpoints.map((band) => (
                <tr key={band.bandId} className="border-border/60 border-b last:border-0">
                  <th scope="row" className="text-foreground p-3 text-left font-medium">
                    {band.category}
                  </th>
                  <td className="text-muted-foreground p-3 font-mono">
                    {band.min}–{band.max}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
        <p className="text-subtle text-xs">Source: {thresholds.reference}.</p>
      </ContentSection>

      <ContentSection id="limits" heading="Legal limits and health guidelines">
        <Paragraph>
          The index is a communication scale. It is not the law, and it is not the World Health
          Organization&apos;s advice — all three describe {pollutant.label} and none of them is a
          translation of the others.
        </Paragraph>
        {euLimits.length > 0 ? (
          <>
            <SubHeading>EU limit values — legally binding</SubHeading>
            <DefinitionList>
              {euLimits.map((limit) => (
                <Definition
                  key={`${limit.averagingPeriod}-${limit.value}`}
                  term={`${limit.value} ${limit.unit} — ${limit.averagingPeriod}`}
                >
                  {limit.permittedExceedances && limit.permittedExceedances > 0
                    ? `Up to ${limit.permittedExceedances} exceedances are permitted per calendar year before the limit is breached. `
                    : ''}
                  {limit.assessableFromSingleReading
                    ? 'This limit is defined over a single hour, so one reading can be compared against it — though a comparison is not a finding of breach while exceedances remain permitted. '
                    : 'This limit is an average over a longer period, so no single hourly reading can establish anything about it. '}
                  <span className="text-subtle">{limit.reference}.</span>
                </Definition>
              ))}
            </DefinitionList>
          </>
        ) : null}
        {whoGuidelines.length > 0 ? (
          <>
            <SubHeading>WHO guidelines — health guidance, not law</SubHeading>
            <DefinitionList>
              {whoGuidelines.map((g) => (
                <Definition
                  key={`${g.averagingPeriod}-${g.value}`}
                  term={`${g.value} ${g.unit} — ${g.averagingPeriod}`}
                >
                  A health-based guideline rather than a legal threshold. Nobody is in breach of a
                  WHO guideline; it describes where the evidence suggests harm begins.{' '}
                  <span className="text-subtle">{g.reference}.</span>
                </Definition>
              ))}
            </DefinitionList>
          </>
        ) : null}
        <Callout tone="warning">
          A single hourly reading above any of these figures is not a breach of a limit, and this
          site will never describe one as such. Most are averages over 24 hours or a calendar year,
          and several permit a fixed number of exceedances before the limit is breached at all.
          Directive (EU) 2024/2881 tightens several of them from 1 January 2030; the figures above
          are the ones in force today.
        </Callout>
      </ContentSection>

      <ContentSection id="where" heading={`Where ${pollutant.label} is measured`}>
        <Paragraph>
          Not every station measures every pollutant, and the ones that do are not interchangeable —
          a Traffic site is deliberately placed where exposure is highest, a Background site
          deliberately is not, so they answer different questions rather than competing to answer
          the same one.
        </Paragraph>
        <DefinitionList>
          {measuring.map((station) => (
            <Definition
              key={station.id}
              term={`${station.name}, ${station.island} — ${station.stationType}, ${station.areaClassification}`}
            >
              {t(dict, `station.type.${station.stationType.toLowerCase()}Explain`)}{' '}
              {station.altitudeMetres} m above sea level.{' '}
              <Link
                href={`/station/${station.slug}?pollutant=${pollutant.slug}`}
                className="text-primary underline underline-offset-4"
              >
                See the current {pollutant.label} reading
              </Link>
              .
            </Definition>
          ))}
        </DefinitionList>
        {notMeasuring.length > 0 ? (
          <Callout>
            {notMeasuring.map((s) => `${s.name}`).join(' and ')}{' '}
            {notMeasuring.length === 1 ? 'does' : 'do'} not report {pollutant.label}. An absent
            value there is the instrument not reporting — not a reading of zero, and not evidence of
            clean air. The station {notMeasuring.length === 1 ? 'page says' : 'pages say'} so
            plainly rather than leaving a blank.
          </Callout>
        ) : null}
      </ContentSection>

      <ContentSection id="elsewhere" heading="Read next">
        <BulletList>
          <li>
            <Link href="/" className="text-primary underline underline-offset-4">
              Current readings across Malta and Gozo
            </Link>{' '}
            — what {pollutant.label} is doing right now, at every station that measures it.
          </li>
          <li>
            <Link href="/pollutants" className="text-primary underline underline-offset-4">
              The other pollutants
            </Link>{' '}
            — the index takes the worst of the five, so the one setting your band may not be this
            one.
          </li>
          <li>
            <Link href="/methodology" className="text-primary underline underline-offset-4">
              {t(dict, 'nav.methodology')}
            </Link>{' '}
            — the arithmetic, the rounding rule, and how forecasts are kept separate from
            observations.
          </li>
          {code === 'PM10' || code === 'PM2.5' ? (
            <li>
              <Link href="/saharan-dust" className="text-primary underline underline-offset-4">
                Saharan dust and Malta&apos;s air
              </Link>{' '}
              — the recurring regional source behind most of the islands&apos; highest particle
              readings.
            </li>
          ) : null}
        </BulletList>
      </ContentSection>
    </ContentPage>
  );
}
