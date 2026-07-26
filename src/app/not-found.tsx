import type { Metadata } from 'next';
import Link from 'next/link';

import { ALL_NAV } from '@/components/layout/nav-items';
import { STATIONS } from '@/config/stations';
import { getDictionary, hasKey, t } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'Page not found',
  // A 404 carries no useful content for a search index.
  robots: { index: false, follow: true },
};

/**
 * 404.
 *
 * Offers the routes that do exist and names the five stations, because the most
 * common way to land here is a mistyped or out-of-date station URL.
 */
export default function NotFound() {
  const dict = getDictionary();
  const s = (key: string, fallback: string): string =>
    hasKey(dict, key) ? t(dict, key) : fallback;

  return (
    <main id="main" className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-16 sm:px-6">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground tabular text-sm font-medium">404</p>
        <h1 className="text-foreground text-2xl font-semibold tracking-tight sm:text-3xl">
          {t(dict, 'errors.notFound.title')}
        </h1>
        <p className="text-muted-foreground text-base leading-relaxed">
          {t(dict, 'errors.notFound.description')}
        </p>
      </header>

      <nav aria-labelledby="not-found-nav" className="flex flex-col gap-2">
        <h2 id="not-found-nav" className="text-foreground text-base font-semibold">
          {s('errors.notFoundPages', 'Pages on maqua.app')}
        </h2>
        <ul className="flex flex-col gap-1">
          {ALL_NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="rounded-card hover:bg-muted flex min-h-11 flex-col justify-center gap-0.5 px-3 py-2 transition-colors"
              >
                <span className="text-foreground text-sm font-medium">
                  {t(dict, item.labelKey)}
                </span>
                <span className="text-muted-foreground text-xs leading-snug">
                  {t(dict, item.descriptionKey)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section aria-labelledby="not-found-stations" className="flex flex-col gap-2">
        <h2 id="not-found-stations" className="text-foreground text-base font-semibold">
          {t(dict, 'station.allStations')}
        </h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t(dict, 'errors.stationNotFound.description')}
        </p>
        <ul className="text-muted-foreground flex flex-wrap gap-x-2 gap-y-1 text-sm">
          {STATIONS.map((station, index) => (
            <li key={station.id}>
              {station.name}
              <span className="text-subtle">
                {' '}
                ({t(dict, `station.island.${station.island.toLowerCase()}`)})
              </span>
              {index < STATIONS.length - 1 ? <span aria-hidden="true">,</span> : null}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
