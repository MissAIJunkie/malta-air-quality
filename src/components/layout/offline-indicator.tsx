'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { CloudOff, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DEFAULT_LOCALE,
  formatMeasuredAt,
  getDictionary,
  t,
  toDateTimeAttribute,
  type Locale,
} from '@/lib/i18n';
import { readCachedReadings, type OfflineReadingsInfo } from '@/lib/pwa/offline';
import { registerServiceWorker } from '@/lib/pwa/register';
import { cn } from '@/lib/utils/cn';

/**
 * Connection banner, and the place the service worker gets registered.
 *
 * ## What it must say
 *
 * Going offline does not stop the page rendering readings — the server-rendered
 * markup and the cached API response are both still there. So the moment the
 * connection drops, this states four things at once: that the device is offline,
 * when the readings on screen were measured, when this device last downloaded
 * them, and that they are not live. Anything less would leave figures on screen
 * with nothing to distinguish them from current ones.
 *
 * "Not live" is text beside an icon, never a colour. The interface avoids
 * colour-only encoding everywhere, and this is the banner somebody most needs to
 * notice.
 *
 * ## Why registration happens here
 *
 * The worker is what makes the offline state possible, so the component that
 * reports that state is also what installs it. Registration is production-only
 * and cannot throw — see `lib/pwa/register.ts`.
 */

/** How long the "back online" acknowledgement stays before the banner leaves. */
const RESTORED_NOTICE_MS = 4000;

function subscribeToConnection(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

function readOnlineStatus(): boolean {
  return navigator.onLine;
}

/**
 * The server has no connection status, so it renders as though online.
 *
 * Reading `navigator.onLine` into initial state instead would make the server
 * and the client disagree and produce a hydration mismatch; `useSyncExternalStore`
 * is the supported way to subscribe to a browser API without one.
 */
function assumeOnline(): boolean {
  return true;
}

export type OfflineIndicatorProps = {
  locale?: Locale;
  className?: string;
};

export function OfflineIndicator({ locale = DEFAULT_LOCALE, className }: OfflineIndicatorProps) {
  const dict = getDictionary(locale);
  const router = useRouter();

  const isOnline = useSyncExternalStore(subscribeToConnection, readOnlineStatus, assumeOnline);

  const [restored, setRestored] = useState(false);
  const [cached, setCached] = useState<OfflineReadingsInfo | null>(null);

  /** Whether this session has actually been offline, so a spurious `online`
   *  event cannot produce a "back online" notice out of nowhere. */
  const hasBeenOffline = useRef(false);

  useEffect(() => {
    void registerServiceWorker();
  }, []);

  useEffect(() => {
    // A page that loads while already offline never receives an `offline`
    // event, so the flag is seeded here rather than only in the listener.
    if (typeof navigator !== 'undefined' && !navigator.onLine) hasBeenOffline.current = true;

    const handleOffline = () => {
      hasBeenOffline.current = true;
    };

    const handleOnline = () => {
      if (!hasBeenOffline.current) return;
      hasBeenOffline.current = false;
      setRestored(true);
      setCached(null);
      // Re-render the server components against live data rather than leaving
      // the page showing what was cached when the connection dropped.
      router.refresh();
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [router]);

  useEffect(() => {
    if (!restored) return;
    const timer = setTimeout(() => setRestored(false), RESTORED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [restored]);

  useEffect(() => {
    if (isOnline) return;

    const controller = new AbortController();
    void readCachedReadings(controller.signal).then((info) => {
      if (!controller.signal.aborted) setCached(info);
    });

    return () => controller.abort();
  }, [isOnline]);

  const retry = useCallback(() => {
    if (navigator.onLine) {
      hasBeenOffline.current = false;
      setRestored(true);
      setCached(null);
      router.refresh();
      return;
    }

    // Still offline: re-read what the worker holds, so the instants on screen
    // stay accurate rather than silently ageing.
    void readCachedReadings().then(setCached);
  }, [router]);

  if (isOnline && !restored) return null;

  const showRestored = isOnline && restored;

  return (
    <div
      // `status` rather than `alert`: assistive technology announces it without
      // interrupting whatever the reader is in the middle of.
      role="status"
      aria-live="polite"
      className={cn(
        'fixed inset-x-0 bottom-0 z-50 print:hidden',
        'border-border bg-surface-raised text-foreground border-t shadow-lg',
        'animate-fade-in',
        className,
      )}
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-start gap-x-4 gap-y-3 px-4 py-3">
        <CloudOff
          aria-hidden="true"
          className={cn(
            'mt-0.5 size-5 shrink-0',
            showRestored ? 'text-success' : 'text-muted-foreground',
          )}
        />

        <div className="min-w-0 flex-1 text-sm">
          {showRestored ? (
            <p className="font-medium">{t(dict, 'offline.backOnline')}</p>
          ) : (
            <>
              <p className="font-medium">{t(dict, 'offline.title')}</p>
              <p className="text-muted-foreground mt-0.5">{t(dict, 'offline.description')}</p>

              {cached?.measuredAt ? (
                <p className="text-muted-foreground mt-1">
                  {t(dict, 'offline.cachedNotice', {
                    time: formatMeasuredAt(cached.measuredAt, dict),
                  })}
                </p>
              ) : null}

              <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                {/* Text, not a colour: the banner never relies on hue to say
                    that these figures are out of date. */}
                <span className="text-foreground inline-flex items-center gap-1.5 font-medium">
                  <span aria-hidden="true">•</span>
                  {t(dict, 'freshness.notLive')}
                </span>

                <span>
                  {t(dict, 'freshness.retrievedAtLabel')}{' '}
                  <time dateTime={toDateTimeAttribute(cached?.downloadedAt)}>
                    {formatMeasuredAt(cached?.downloadedAt ?? null, dict)}
                  </time>
                </span>
              </p>
            </>
          )}
        </div>

        {showRestored ? null : (
          <Button variant="outline" size="sm" onClick={retry} className="shrink-0">
            <RefreshCw aria-hidden="true" />
            {t(dict, 'offline.retry')}
          </Button>
        )}
      </div>
    </div>
  );
}
