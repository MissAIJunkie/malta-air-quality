import type { Metadata } from 'next';
import Link from 'next/link';

import {
  BulletList,
  Callout,
  ContentPage,
  ContentSection,
  Paragraph,
  TableScroll,
} from '@/components/layout/content-page';
import { POLLUTANTS, POLLUTANT_CODES } from '@/config/pollutants';
import { POLLUTANT_GUIDES } from '@/config/pollutant-guides';
import { STATIONS } from '@/config/stations';
import { AQI_BREAKPOINTS } from '@/config/thresholds';
import { getDictionary, t } from '@/lib/i18n';

const PAGE_TITLE = 'The five pollutants';
const PAGE_DESCRIPTION =
  'What PM2.5, PM10, NO₂, O₃ and SO₂ are, where each comes from in Malta, what they do to you, and how each one becomes an index band.';

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: '/pollutants' },
  openGraph: { title: PAGE_TITLE, description: PAGE_DESCRIPTION, type: 'website' },
};

/**
 * /pollutants — the hub for the five guide pages.
 *
 * This is not a link list with a sentence at the top. The comparison table is
 * the thing that cannot be got from any of the five child pages individually,
 * and the point it makes is the one readers most often get wrong: the bands are
 * not a common scale. 20 µg/m³ is Moderate as PM2.5, Fair as PM10 and Good as
 * ozone, and that is visible here in a way it is not anywhere else on the site.
 *
 * Those three bands are read off `AQI_BREAKPOINTS` — PM2.5 Moderate is 16–50,
 * PM10 Fair is 16–45, ozone Good is 1–60 — and not from an impression of how
 * the scales compare. An earlier draft of this comment said "Poor as PM2.5",
 * which is two bands out, in the one paragraph on the site whose whole job is
 * to stop people misreading a band.
 */
export default function PollutantsIndexPage() {
  const dict = getDictionary();
  const activeStations = STATIONS.filter((station) => station.active);

  return (
    <ContentPage
      title={PAGE_TITLE}
      lead="The European Air Quality Index is built from five pollutants. A location takes the band of whichever one is worst, so the number you see is only ever as good as the worst thing in the air."
    >
      <ContentSection id="why" heading="Why five, and why the worst one wins">
        <Paragraph>
          The index does not average the five pollutants. It measures each one, assigns each its own
          band, and reports the worst. That is a deliberate design choice: averaging would let a
          genuinely bad ozone afternoon be cancelled out by clean particles, and the point of a
          public index is to describe the thing that might affect you.
        </Paragraph>
        <Paragraph>
          The practical consequence is that the band on the front page is a statement about one
          pollutant at a time, and which one it is changes through the day and through the year.
          Nitrogen dioxide tends to set it in the morning rush beside a road; ozone on a hot still
          afternoon inland; coarse particles during a dust episode, at every station at once.
        </Paragraph>
        <Callout>
          Each pollutant also has its own band boundaries. They are not a common scale, and reading
          one pollutant&apos;s number against another&apos;s thresholds is the most common way to
          misread this index — which is what the table below is for.
        </Callout>
      </ContentSection>

      <ContentSection id="compare" heading="The same number means different things">
        <Paragraph>
          These are the inclusive upper bounds of each band, in µg/m³, for each of the five
          pollutants. Read down a column and the scales diverge sharply: the ceiling of
          &ldquo;Good&rdquo; is 5 for fine particles and 60 for ozone — a twelve-fold difference in
          what counts as unremarkable air.
        </Paragraph>
        <TableScroll label="European Air Quality Index band ceilings for all five pollutants">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">
              Inclusive upper bound of each index band, per pollutant, in micrograms per cubic metre
            </caption>
            <thead>
              <tr className="border-border border-b text-left">
                <th scope="col" className="text-foreground p-3 font-semibold">
                  Band
                </th>
                {POLLUTANT_CODES.map((code) => (
                  <th key={code} scope="col" className="text-foreground p-3 font-semibold">
                    {POLLUTANTS[code].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {AQI_BREAKPOINTS['PM2.5'].breakpoints.map((band, row) => (
                <tr key={band.bandId} className="border-border/60 border-b last:border-0">
                  <th scope="row" className="text-foreground p-3 text-left font-medium">
                    {band.category}
                  </th>
                  {POLLUTANT_CODES.map((code) => (
                    <td key={code} className="text-muted-foreground p-3 font-mono">
                      {AQI_BREAKPOINTS[code].breakpoints[row]?.max}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
        <p className="text-subtle text-xs">
          Source: {AQI_BREAKPOINTS['PM2.5'].reference}. Each figure is the inclusive top of that
          band; a concentration is rounded to the nearest whole µg/m³ before it is matched.
        </p>
      </ContentSection>

      <ContentSection id="guides" heading="One page each">
        <Paragraph>
          Each guide covers what the pollutant is, where it comes from on these islands
          specifically, what it does to the people most affected by it, its own band scale, the
          legal limits and WHO guidelines that apply to it, and which of the {activeStations.length}{' '}
          stations measure it.
        </Paragraph>
        <div className="flex flex-col gap-4">
          {POLLUTANT_CODES.map((code) => {
            const pollutant = POLLUTANTS[code];
            const measuring = activeStations.filter((station) =>
              station.expectedPollutants.includes(code),
            ).length;

            return (
              <Link
                key={code}
                href={`/pollutants/${pollutant.slug}`}
                className="rounded-card border-border bg-surface hover:border-border-strong flex flex-col gap-1.5 border p-4 transition-colors"
              >
                <span className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-foreground font-mono text-lg font-semibold">
                    {pollutant.label}
                  </span>
                  <span className="text-foreground text-base font-medium">
                    {t(dict, `pollutant.${pollutant.slug}.name`)}
                  </span>
                  <span className="text-subtle text-xs">
                    {measuring} of {activeStations.length} stations
                  </span>
                </span>
                <span className="text-muted-foreground text-sm leading-relaxed">
                  {POLLUTANT_GUIDES[code].lead}
                </span>
              </Link>
            );
          })}
        </div>
      </ContentSection>

      <ContentSection id="next" heading="Read next">
        <BulletList>
          <li>
            <Link href="/" className="text-primary underline underline-offset-4">
              Current readings across Malta and Gozo
            </Link>{' '}
            — every station, with which pollutant is leading the index at each.
          </li>
          <li>
            <Link href="/methodology" className="text-primary underline underline-offset-4">
              {t(dict, 'nav.methodology')}
            </Link>{' '}
            — how a concentration becomes a band, verified against the upstream index.
          </li>
          <li>
            <Link href="/saharan-dust" className="text-primary underline underline-offset-4">
              Saharan dust and Malta&apos;s air
            </Link>{' '}
            — the regional source behind most of the islands&apos; highest particle readings.
          </li>
        </BulletList>
      </ContentSection>
    </ContentPage>
  );
}
