import Link from 'next/link';
import { MapPin } from 'lucide-react';

import { STATIONS } from '@/config/stations';
import { getDictionary, t } from '@/lib/i18n';

/**
 * An address that does not name one of the five stations.
 *
 * Rendered instead of a bare 404, and instead of guessing at what was meant.
 * There are exactly five monitoring stations in Malta and Gozo, the list is
 * short enough to show in full, and showing it turns a dead end into the one
 * click the reader was trying to make.
 */
export default function StationNotFound() {
  const dict = getDictionary();

  return (
    /* Own the main landmark, matching every other page: the skip link in the
       root layout targets `#main` and the layout does not provide one. */
    <main id="main" className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold">{t(dict, 'errors.stationNotFound.title')}</h1>

      <p className="text-muted-foreground text-sm leading-relaxed">
        {t(dict, 'errors.stationNotFound.description')}
      </p>

      <nav aria-label={t(dict, 'station.allStations')}>
        <ul className="flex flex-col gap-2">
          {STATIONS.map((station) => (
            <li key={station.id}>
              <Link
                href={`/station/${station.slug}`}
                className="rounded-card border-border bg-surface hover:bg-muted flex min-h-11 items-center gap-2 border px-3 py-2 text-sm"
              >
                <MapPin className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                <span>
                  <span className="font-medium">{station.name}</span>
                  <span className="text-muted-foreground block text-xs">
                    {station.locality} · {t(dict, `station.island.${station.island.toLowerCase()}`)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <p>
        <Link
          href="/"
          className="text-primary inline-flex min-h-11 items-center text-sm underline decoration-from-font underline-offset-4"
        >
          {t(dict, 'errors.goHome')}
        </Link>
      </p>
    </main>
  );
}
