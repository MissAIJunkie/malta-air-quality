import type { Metadata, Viewport } from 'next';
import { Archivo, IBM_Plex_Mono, Public_Sans } from 'next/font/google';
import type { ReactNode } from 'react';

import { SiteFooter } from '@/components/layout/footer';
import { SiteHeader } from '@/components/layout/header';
import { OfflineIndicator } from '@/components/layout/offline-indicator';
import { SkipLink } from '@/components/layout/skip-link';
import { MALTA_TIMEZONE } from '@/config/stations';
import { AnalyticsScripts, absoluteUrl, siteUrl } from '@/lib/analytics';
import { getDictionary, t } from '@/lib/i18n';
import { Providers } from './providers';
import './globals.css';

/**
 * Three faces, three jobs.
 *
 * Archivo states the reading. It is a grotesque drawn for signage and headlines,
 * and it gives the one sentence at the top of the page the flat, civic authority
 * of a public notice rather than the soft neutrality of a product dashboard.
 * Used large and sparingly — headings only, never body copy.
 *
 * Public Sans carries the prose. It was commissioned for public-information text
 * and is drawn for legibility at small sizes, which is what long health guidance
 * actually needs; its open apertures and wide default tracking keep a paragraph
 * of caveats readable where a tighter UI face turns grey.
 *
 * IBM Plex Mono sets the figures. Concentrations, sub-indices and timestamps are
 * compared down a column, so they need fixed advance widths; Plex Mono's is a
 * measured, instrument-like drawing rather than a coding face.
 *
 * `latin-ext` on both text faces is not optional: Maltese uses ħ, ġ, ż and ċ, and
 * Għarb and Żejtun are station names that must not fall back mid-word.
 *
 * `display: 'swap'` so a slow font never blanks a health-relevant reading, and
 * all three are self-hosted by `next/font` — no request leaves the browser for
 * Google Fonts, which is one fewer third party for the privacy page to declare.
 */
const display = Archivo({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-app-display',
  display: 'swap',
});

const sans = Public_Sans({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-app-sans',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin', 'latin-ext'],
  // Not a variable font, so the weights actually used are listed explicitly.
  weight: ['400', '500', '600'],
  variable: '--font-app-mono',
  display: 'swap',
});

const TITLE = 'Malta Air Quality Map | maqua.app';
const DESCRIPTION =
  'Live air quality for Malta and Gozo. Hourly readings from all five official monitoring stations, ' +
  'with the European Air Quality Index for PM2.5, PM10, NO₂, O₃ and SO₂, each labelled with how ' +
  'current it is.';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: TITLE,
    // Page titles keep the brand without repeating the whole banner.
    template: '%s | maqua.app',
  },
  description: DESCRIPTION,
  applicationName: 'maqua.app',
  category: 'science',
  keywords: [
    'Malta air quality',
    'Gozo air quality',
    'European Air Quality Index',
    'PM2.5',
    'PM10',
    'nitrogen dioxide',
    'ozone',
    'ERA',
    'EEA',
  ],
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    siteName: 'maqua.app',
    title: TITLE,
    description: DESCRIPTION,
    url: siteUrl,
    locale: 'en_GB',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
  /**
   * Declared explicitly rather than relying on file conventions alone, so the
   * SVG mark is offered first — it stays crisp at any tab size — with the raster
   * sizes behind it for platforms that will not take SVG.
   */
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/icon-512.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  manifest: '/manifest.webmanifest',
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
  formatDetection: {
    // Station names and concentrations are not phone numbers or addresses.
    telephone: false,
    address: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  /**
   * Zoom is never disabled. Pinch-zoom is an accessibility requirement, and the
   * map carries its own zoom controls that do not depend on it.
   */
  maximumScale: 5,
  // Kept in step with `--background` in globals.css, so the browser chrome does
  // not sit on a different colour from the page beneath it.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1015' },
  ],
  // The map runs edge to edge; the header and footer add their own safe-area padding.
  viewportFit: 'cover',
};

/**
 * Structured data.
 *
 * Modest and truthful: what the site is, who publishes it, that it is free, and
 * where the measurements originate. No aggregate ratings, no invented
 * organisation identity, and no implied affiliation with ERA or the EEA.
 */
function structuredData() {
  const website = {
    '@type': 'WebSite',
    '@id': absoluteUrl('/#website'),
    name: 'maqua.app',
    alternateName: 'Malta Air Quality Map',
    url: siteUrl,
    description: DESCRIPTION,
    inLanguage: 'en-GB',
    publisher: { '@id': absoluteUrl('/#publisher') },
  };

  const publisher = {
    '@type': 'Organization',
    '@id': absoluteUrl('/#publisher'),
    name: 'maqua.app',
    url: siteUrl,
    logo: absoluteUrl('/icon-512.png'),
    description:
      'An independent, non-commercial project publishing Maltese air-quality measurements. ' +
      'Not operated by, affiliated with, or endorsed by ERA or the EEA.',
  };

  const application = {
    '@type': 'WebApplication',
    '@id': absoluteUrl('/#app'),
    name: 'maqua.app',
    url: siteUrl,
    applicationCategory: 'HealthApplication',
    operatingSystem: 'Any',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    about: { '@type': 'Thing', name: 'Ambient air quality in Malta and Gozo' },
    spatialCoverage: {
      '@type': 'Place',
      name: 'Malta',
      address: { '@type': 'PostalAddress', addressCountry: 'MT' },
    },
    creditText:
      "Air-quality data provided by Malta's Environment and Resources Authority (ERA), " +
      'disseminated via the European Environment Agency (EEA).',
  };

  return { '@context': 'https://schema.org', '@graph': [website, publisher, application] };
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const dict = getDictionary();

  return (
    /**
     * `suppressHydrationWarning` is required by next-themes: its inline script
     * writes the resolved theme class onto <html> before React hydrates, so the
     * server markup and the first client render legitimately differ on this one
     * element. It suppresses the warning for <html>'s own attributes only, not
     * for the tree beneath it.
     */
    <html
      lang="en"
      dir="ltr"
      suppressHydrationWarning
      className={`${display.variable} ${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <script
          type="application/ld+json"
          /* Serialised from a literal object built in this file — no user input
             reaches it — and `<` is escaped so a future string value could not
             close the script tag. */
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(structuredData()).replace(/</g, '\\u003c'),
          }}
        />

        <Providers>
          <SkipLink />
          <SiteHeader />
          {/* Above the page content and below the header: losing the connection
              means the readings on screen have stopped being current, which the
              reader needs to know before reading them, not after. This component
              is also what registers the service worker. */}
          <OfflineIndicator />
          {children}
          <SiteFooter />
        </Providers>

        <AnalyticsScripts />

        {/* Stated once in the document, so "all times are Malta time" is not
            something a reader has to infer from the timestamps themselves. */}
        <span className="sr-only">
          {t(dict, 'time.timezoneNote')} ({MALTA_TIMEZONE})
        </span>
      </body>
    </html>
  );
}
