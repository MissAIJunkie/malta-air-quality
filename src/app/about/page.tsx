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
} from '@/components/layout/content-page';
import { STATIONS } from '@/config/stations';
import { getDictionary, hasKey, t } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'About',
  description:
    'What maqua.app is, who runs it, where the data comes from, and the limitations it will not paper over.',
  alternates: { canonical: '/about' },
};

const SOURCE_REPOSITORY = 'https://github.com/maqua-app/malta-air-quality';

export default function AboutPage() {
  const dict = getDictionary();
  const s = (key: string, fallback: string): string =>
    hasKey(dict, key) ? t(dict, key) : fallback;

  return (
    <ContentPage
      title={t(dict, 'about.title')}
      lead={s(
        'about.lead',
        'A calm, public-service view of what is in the air over Malta and Gozo — built on the official monitoring network, and careful about what it claims.',
      )}
    >
      <ContentSection id="what" heading={t(dict, 'about.whatHeading')}>
        <Paragraph>{t(dict, 'about.whatBody')}</Paragraph>
        <Paragraph>
          Malta and Gozo have five automatic air-quality monitoring stations. Their measurements are
          public, but they are published as an index across the whole of Europe, in a form built for
          continental comparison rather than for someone in Msida deciding whether to run this
          evening. maqua.app takes the same measurements and presents them for the islands: which
          station, which hour, which pollutant, how old the reading is, and what the band
          conventionally means for health.
        </Paragraph>
        <Paragraph>
          It is free, carries no advertising, and sells nothing. There is no account to create, and
          the map works without giving anything away about yourself.
        </Paragraph>
      </ContentSection>

      <ContentSection id="who" heading={t(dict, 'about.whoHeading')}>
        <Paragraph>{t(dict, 'about.whoBody')}</Paragraph>
        <Callout tone="warning">{t(dict, 'disclaimer.notOfficial')}</Callout>
        <Paragraph>
          Nothing on this site should be read as an ERA or EEA statement. Where an official position
          matters — a compliance question, an incident, a formal complaint — ERA is the authority to
          approach, and its own publications take precedence over anything here.
        </Paragraph>
      </ContentSection>

      <ContentSection id="data" heading={t(dict, 'about.dataHeading')}>
        <Paragraph>{t(dict, 'about.dataBody')}</Paragraph>
        <Paragraph>The five stations, all operated by ERA:</Paragraph>
        <DefinitionList>
          {STATIONS.map((station) => (
            <Definition key={station.id} term={`${station.name}, ${station.island}`}>
              {t(dict, `station.type.${station.stationType.toLowerCase()}Explain`)}{' '}
              {station.altitudeMetres} m above sea level. Station code {station.id}.
            </Definition>
          ))}
        </DefinitionList>
        <Paragraph>
          The{' '}
          <Link href="/methodology" className="text-primary underline underline-offset-4">
            {t(dict, 'nav.methodology')}
          </Link>{' '}
          page sets out exactly how a concentration becomes a band, how forecasts are separated from
          observations, and where the calculation was verified against real published data.
        </Paragraph>
      </ContentSection>

      <ContentSection
        id="principles"
        heading={s('about.principlesHeading', 'How this site behaves')}
      >
        <Paragraph>
          A few rules are load-bearing. They are the reason some readings look less confident here
          than elsewhere.
        </Paragraph>
        <BulletList>
          <li>
            A missing value is never rendered as zero. Zero is a measurement claim; an absent
            reading is the absence of one.
          </li>
          <li>
            Stale data is never described as live. Every reading shows when it was measured, when it
            was retrieved, and how old that makes it.
          </li>
          <li>
            A forecast is never presented as an observation. Estimates are labelled as estimates.
          </li>
          <li>
            Colour never carries meaning on its own. Every band is shown with a colour, a texture,
            an icon and a written label.
          </li>
          <li>
            A single hourly reading is never described as proof that an annual or daily legal limit
            has been breached.
          </li>
          <li>
            AI explains; it never calculates. No index, threshold or timestamp on this site is
            produced by a language model.
          </li>
        </BulletList>
      </ContentSection>

      <ContentSection id="limitations" heading={t(dict, 'about.limitationsHeading')}>
        <Paragraph>{t(dict, 'about.limitationsBody')}</Paragraph>
        <BulletList>
          <li>
            <strong className="text-foreground font-medium">Coverage.</strong> Five stations cannot
            describe every locality. Għarb is the only station on Gozo. Wherever you are, the
            nearest station may be several kilometres and several road types away.
          </li>
          <li>
            <strong className="text-foreground font-medium">Provisional figures.</strong>{' '}
            {t(dict, 'disclaimer.provisional')}
          </li>
          <li>
            <strong className="text-foreground font-medium">Gaps.</strong> Instruments go offline
            for maintenance and calibration. Some hours have no usable value, and some pollutants
            are not measured at every station.
          </li>
          <li>
            <strong className="text-foreground font-medium">One index among several.</strong> The
            European Air Quality Index is a communication scale. Other services use different scales
            and averaging periods, so a different number elsewhere is usually a different question
            being answered, not an error.
          </li>
        </BulletList>
      </ContentSection>

      <ContentSection id="openness" heading={s('about.opennessHeading', 'Open by construction')}>
        <Paragraph>
          The calculation, the thresholds and the wording of every health message are in the source
          code, and the same data this site renders is available from its own API. If you think a
          band is wrong, the arithmetic is there to check.
        </Paragraph>
        <BulletList>
          <li>
            <a
              href={SOURCE_REPOSITORY}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-4"
            >
              {t(dict, 'footer.sourceCodeLink')}
              <span className="sr-only"> ({t(dict, 'a11y.newWindow')})</span>
            </a>
          </li>
          <li>
            <code className="text-foreground font-mono text-sm">/api/air-quality</code> — current
            readings for every station, with the same metadata the pages use.
          </li>
        </BulletList>
      </ContentSection>

      <ContentSection id="contact" heading={t(dict, 'about.contactHeading')}>
        <Paragraph>
          Corrections are welcome, particularly about station siting, Maltese place names and
          orthography, or anything on this site that overstates what the data can support. The
          fastest route is an issue on the source repository.
        </Paragraph>
        <Paragraph>{t(dict, 'footer.attribution')}</Paragraph>
        <Callout>{t(dict, 'disclaimer.medical')}</Callout>
      </ContentSection>
    </ContentPage>
  );
}
