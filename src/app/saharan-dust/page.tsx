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
} from '@/components/layout/content-page';
import { POLLUTANTS } from '@/config/pollutants';
import { STATIONS } from '@/config/stations';
import { AQI_BREAKPOINTS } from '@/config/thresholds';
import { CONTEXT_RULES } from '@/lib/environmental-context/classify-event';
import { getDictionary, t } from '@/lib/i18n';

const PAGE_TITLE = 'Saharan dust and Malta’s air';
const PAGE_DESCRIPTION =
  'Malta sits on the main dust corridor between the Sahara and southern Europe. What an intrusion does to the readings, how to recognise one, and why “it was only dust” is both true and a bad excuse.';

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: '/saharan-dust' },
  openGraph: { title: PAGE_TITLE, description: PAGE_DESCRIPTION, type: 'article' },
};

/**
 * /saharan-dust
 *
 * The one regional phenomenon that explains more of Malta's extreme particle
 * readings than anything local, and the thing this site's own context pipeline
 * is mostly built to handle.
 *
 * The numbers here are read from the code that actually makes the judgement —
 * `CONTEXT_RULES.saharanDust` for the detection thresholds, `AQI_BREAKPOINTS`
 * for the band ceilings — rather than retyped. If the classifier is retuned,
 * this page changes with it instead of quietly becoming wrong.
 */
export default function SaharanDustPage() {
  const dict = getDictionary();
  const dustRules = CONTEXT_RULES.saharanDust;
  const pm10 = AQI_BREAKPOINTS.PM10.breakpoints;
  const pm10Good = pm10[0]?.max;
  const pm10Moderate = pm10[2]?.max;
  const pm10Top = pm10[pm10.length - 1]?.max;
  const gharb = STATIONS.find((station) => station.slug === 'gharb');

  return (
    <ContentPage
      title={PAGE_TITLE}
      lead="Dust lifted from North Africa recurs over the central Mediterranean through the year, and Malta sits directly on the corridor between the Sahara and southern Europe. An intrusion is a feature of the islands’ climate rather than an exceptional event, and it is the regional source behind most of the highest coarse-particle readings on this site."
    >
      <ContentSection id="what" heading="What a dust intrusion actually is">
        <Paragraph>
          Strong winds over the Sahara lift fine mineral material — clay, quartz, iron oxides — high
          enough into the atmosphere to be carried for thousands of kilometres. When the circulation
          over the Mediterranean is in the right configuration, that dust-laden air moves north
          across the sea and over the islands between North Africa and southern Europe. Malta is one
          of those islands, and it is close to the middle of the main track.
        </Paragraph>
        <Paragraph>
          The dust arrives as an air mass rather than as a plume from a point source. That is the
          single most important fact about it for anyone reading a monitor, and almost everything
          else on this page follows from it: an air mass sits over the whole of Malta and Gozo at
          once, so it raises every station together.
        </Paragraph>
        <Paragraph>
          Desert dust is predominantly coarse. It registers most strongly in {POLLUTANTS.PM10.label}{' '}
          — particles up to 10 micrometres — and much less in {POLLUTANTS['PM2.5'].label}. Both
          rise, but not equally, and the ratio between them is part of how an intrusion is
          recognised.
        </Paragraph>
      </ContentSection>

      <ContentSection id="effect" heading="What it does to the readings">
        <Paragraph>
          The effect is large. The {POLLUTANTS.PM10.label} band scale has &ldquo;Good&rdquo; ending
          at {pm10Good} µg/m³ and &ldquo;Moderate&rdquo; running up to {pm10Moderate}, and its top
          band reaches {pm10Top} — a ceiling that exists for dust events, not for anything urban
          traffic produces. During a significant intrusion the coarse-particle figure can move
          several bands in a few hours.
        </Paragraph>
        <Paragraph>
          What it does <em>not</em> do is change what the measurement means. A microgram of mineral
          dust in your lungs is not meaningfully gentler than a microgram of brake dust. The
          particles are natural in origin and they affect the airways in much the same way as any
          other coarse particulate matter, which is why this site reports the band exactly as
          measured during an episode rather than discounting it.
        </Paragraph>
        <Callout tone="warning">
          Dust is context, never a measurement. It may explain an elevated {POLLUTANTS.PM10.label}{' '}
          reading; it never contributes to one. Every station&apos;s band comes from that
          station&apos;s own measured concentration and nothing else — no model value is ever mixed
          into, compared against, or substituted for a measurement.
        </Callout>
      </ContentSection>

      <ContentSection id="recognise" heading="How to recognise one from the readings">
        <Paragraph>
          You do not need a forecast to spot a dust episode. The signature is in the pattern across
          stations, and once you know it you can read it off the front page.
        </Paragraph>
        <DefinitionList>
          <Definition term="Every station rises together">
            {t(dict, 'context.saharanDust')} Local traffic cannot do this. A roadside source raises
            the Traffic stations and leaves the Background ones comparatively alone; an air mass
            raises all five.
          </Definition>
          <Definition term="The rural station rises too">
            {gharb ? `${gharb.name}, on ${gharb.island},` : 'Għarb, on Gozo,'} is the network&apos;s
            only Rural-Regional site and the closest thing to a baseline for the islands. Elevated
            coarse particles there, as high as at the urban sites, is the clearest single indication
            that the cause is regional rather than local.
          </Definition>
          <Definition term="Coarse rises much more than fine">
            {POLLUTANTS.PM10.label} climbing sharply while {POLLUTANTS['PM2.5'].label} climbs
            modestly points at mineral dust. A combustion event — smoke, heavy traffic, burning —
            tends to do the opposite, because burning makes fine particles and abrasion makes coarse
            ones.
          </Definition>
          <Definition term="It lasts a day or two, not a season">
            An intrusion is an air mass passing over. It builds, peaks and clears on a timescale of
            hours to a couple of days, which is quite unlike the slow seasonal rise and fall of
            ozone.
          </Definition>
        </DefinitionList>
      </ContentSection>

      <ContentSection id="forecast" heading="Where the dust forecast on this site comes from">
        <Paragraph>
          Alongside the measurements, this site shows a modelled dust forecast so an elevated
          reading can be put in context before it happens. It comes from the Copernicus Atmosphere
          Monitoring Service, reached through the Open-Meteo Air Quality API, and it is a modelling
          system rather than a measurement network.
        </Paragraph>
        <Paragraph>
          That distinction is load-bearing and this site is strict about it. The forecast is always
          labelled as modelled, always names CAMS, and always shows when it was retrieved. It is
          never presented as an observation, and it never adjusts a measured value.
        </Paragraph>
        <SubHeading>When this site says there is dust</SubHeading>
        <Paragraph>
          The judgement is deterministic rather than editorial, and the thresholds are the ones the
          classifier actually applies:
        </Paragraph>
        <BulletList>
          <li>
            Modelled dust at or above{' '}
            <strong className="text-foreground font-medium">{dustRules.minDustUgm3} µg/m³</strong>{' '}
            sustained for at least{' '}
            <strong className="text-foreground font-medium">{dustRules.minHours} hours</strong>{' '}
            raises a dust forecast at all. A single model hour is noise, not an episode.
          </li>
          <li>
            At or above{' '}
            <strong className="text-foreground font-medium">
              {dustRules.strongDustUgm3} µg/m³
            </strong>{' '}
            it is reported as significant rather than routine.
          </li>
          <li>
            If the dust field is missing, the panel is omitted rather than showing zero — the same
            rule the measurements follow.
          </li>
        </BulletList>
        <Callout>
          Dust transport is one of the harder things atmospheric models get right. The figure is
          directional rather than precise, and the wording on the card is hedged on purpose:
          elevated modelled dust <em>can</em> raise coarse particles. It is never stated as the
          cause of a particular reading.
        </Callout>
      </ContentSection>

      <ContentSection id="excuse" heading="“It was only dust”">
        <Paragraph>
          This phrase deserves its own section, because it is simultaneously a real phenomenon and a
          convenient excuse — and the two are easy to confuse deliberately.
        </Paragraph>
        <Paragraph>
          The real part: dust is a natural source, Malta cannot prevent it, and an exceedance driven
          by a documented intrusion is genuinely not evidence of a local failure. European air
          quality law recognises this, and allows Member States to account for exceedances
          attributable to natural sources separately when assessing compliance.
        </Paragraph>
        <Paragraph>
          The excuse part: none of that changes what you breathed. The health effect of a coarse
          particle does not depend on whether it came from the Sahara or from a quarry, and an
          episode attributed to dust is still a day on which strenuous outdoor exercise was a worse
          idea than usual. &ldquo;Natural&rdquo; is a statement about provenance and compliance
          accounting, not about your lungs.
        </Paragraph>
        <Paragraph>
          It is also only sometimes true. A high coarse-particle reading can be dust, a dry windy
          day lifting local material, or genuinely dirty local air — and the three are
          distinguishable from the pattern across stations, which is why the pattern is worth
          learning rather than taking an attribution on trust.
        </Paragraph>
      </ContentSection>

      <ContentSection id="what-to-do" heading="What to do during an episode">
        <Paragraph>
          The sensible response is the ordinary one for a bad-air day, and none of it requires
          knowing the number to a microgram.
        </Paragraph>
        <BulletList>
          <li>
            Reduce strenuous outdoor exertion while levels are high — this matters most for people
            with asthma or other respiratory conditions, for whom coarse particles are a known
            trigger.
          </li>
          <li>
            Keep windows shut on the windward side while the episode passes. Dust intrusions are
            short, so this is a measure for a day, not a season.
          </li>
          <li>
            If you have asthma, have reliever medication to hand. Coarse-particle effects tend to be
            upper-airway and fast-onset rather than slow.
          </li>
          <li>
            Check whether the rise is dust before concluding anything about local air quality — or
            about a local improvement, once it clears.
          </li>
        </BulletList>
        <Callout tone="warning">{t(dict, 'disclaimer.medical')}</Callout>
      </ContentSection>

      <ContentSection id="next" heading="Read next">
        <BulletList>
          <li>
            <Link
              href={`/pollutants/${POLLUTANTS.PM10.slug}`}
              className="text-primary underline underline-offset-4"
            >
              {POLLUTANTS.PM10.label} — coarse particulate matter
            </Link>{' '}
            — the pollutant a dust intrusion moves most, and its full band scale.
          </li>
          <li>
            <Link
              href={`/pollutants/${POLLUTANTS['PM2.5'].slug}`}
              className="text-primary underline underline-offset-4"
            >
              {POLLUTANTS['PM2.5'].label} — fine particulate matter
            </Link>{' '}
            — which also rises during an episode, by less.
          </li>
          <li>
            <Link href="/" className="text-primary underline underline-offset-4">
              Current readings across Malta and Gozo
            </Link>{' '}
            — all five stations at once, which is how a dust signature is spotted.
          </li>
          <li>
            <Link href="/methodology" className="text-primary underline underline-offset-4">
              {t(dict, 'nav.methodology')}
            </Link>{' '}
            — including how modelled context is kept separate from measurement.
          </li>
        </BulletList>
      </ContentSection>
    </ContentPage>
  );
}
