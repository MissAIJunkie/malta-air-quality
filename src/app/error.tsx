'use client';

import { RefreshCw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { getDictionary, t } from '@/lib/i18n';

/**
 * Route-level error boundary.
 *
 * Catches anything thrown while rendering a page beneath the root layout, so
 * the header, the footer and the attribution all survive a failure and the
 * reader keeps a way out.
 *
 * `digest` is Next's server-side correlation id. It is the only technical
 * detail shown, deliberately: the message itself may name an internal host or
 * carry a stack, and none of that belongs on a public page.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const dict = getDictionary();

  useEffect(() => {
    // Reaches the browser console and any client monitoring; the server has
    // already logged the original with its full context.
    console.error('maqua.app render error', error);
  }, [error]);

  return (
    <main id="main" className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-16 sm:px-6">
      <div className="flex items-start gap-3">
        <TriangleAlert className="text-danger mt-1 size-6 shrink-0" aria-hidden="true" />
        <div className="flex flex-col gap-2">
          <h1 className="text-foreground text-2xl font-semibold tracking-tight sm:text-3xl">
            {t(dict, 'errors.generic.title')}
          </h1>
          <p className="text-muted-foreground text-base leading-relaxed">
            {t(dict, 'errors.generic.description')}
          </p>
        </div>
      </div>

      {/* An error page must never leave the impression that the air is fine. */}
      <p className="border-border-strong bg-surface text-foreground rounded-card border p-4 text-sm leading-relaxed">
        {t(dict, 'errors.dataUnavailableHint')}
      </p>

      <div className="flex flex-wrap gap-3">
        <Button onClick={reset}>
          <RefreshCw className="size-4" aria-hidden="true" />
          {t(dict, 'errors.tryAgain')}
        </Button>
        <Button asChild variant="outline">
          <Link href="/">{t(dict, 'errors.goHome')}</Link>
        </Button>
      </div>

      {error.digest ? (
        <p className="text-muted-foreground text-xs">
          {t(dict, 'errors.details')}: <span className="tabular">{error.digest}</span>
        </p>
      ) : null}
    </main>
  );
}
