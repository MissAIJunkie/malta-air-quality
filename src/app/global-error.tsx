'use client';

import { getDictionary, t } from '@/lib/i18n';
import './globals.css';

/**
 * Last-resort error boundary.
 *
 * `error.tsx` sits INSIDE the root layout and therefore cannot catch a failure
 * in the root layout itself — in the font loader, the providers or the metadata.
 * This boundary replaces the entire document when that happens, which is why it
 * has to render its own `<html>` and `<body>`.
 *
 * Consequences of that position, all intentional: there is no header, no footer
 * and no theme provider here, so the styling is written inline against the
 * default (light) tokens and cannot depend on anything that may itself be
 * broken. Only the dictionary is imported, and it is a plain object of strings
 * with no runtime dependencies.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const dict = getDictionary();

  return (
    <html lang="en" dir="ltr">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          background: '#faf8f3',
          color: '#08192a',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        <main style={{ maxWidth: '34rem' }}>
          <h1 style={{ fontSize: '1.75rem', margin: '0 0 0.75rem', letterSpacing: '-0.011em' }}>
            {t(dict, 'errors.generic.title')}
          </h1>
          <p style={{ margin: '0 0 1rem', lineHeight: 1.6 }}>
            {t(dict, 'errors.generic.description')}
          </p>
          <p style={{ margin: '0 0 1.5rem', lineHeight: 1.6, color: '#4c5b66' }}>
            {t(dict, 'errors.dataUnavailableHint')}
          </p>

          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: '2.75rem',
              padding: '0 1.25rem',
              borderRadius: '0.875rem',
              border: 'none',
              background: '#17496d',
              color: '#ffffff',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t(dict, 'errors.reload')}
          </button>

          {error.digest ? (
            <p style={{ marginTop: '1.5rem', fontSize: '0.75rem', color: '#5a6875' }}>
              {t(dict, 'errors.details')}: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
