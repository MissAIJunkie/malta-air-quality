import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
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
 * Inter for the interface, JetBrains Mono for figures.
 *
 * `display: 'swap'` so a slow font never blanks a health-relevant reading, and
 * both are self-hosted by `next/font` — no request leaves the browser for Google
 * Fonts, which is one fewer third party for the privacy page to declare.
 */
const sans = Inter({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-app-sans',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf8f3' },
    { media: '(prefers-color-scheme: dark)', color: '#08192a' },
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
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
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
