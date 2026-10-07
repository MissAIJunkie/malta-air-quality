'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useState, type ReactNode } from 'react';

import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * Query defaults.
 *
 * Tuned to the upstream cadence rather than to library defaults. The EEA
 * republishes hourly with roughly an hour of lag, so refetching every few
 * seconds would only re-download the same reading and add load to a public
 * resource we do not own.
 *
 * `retry: 1` because a failed reading must surface quickly as "unavailable".
 * Retrying five times behind a spinner leaves someone staring at a loading
 * state while believing the air is fine.
 */
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        refetchInterval: 10 * 60 * 1000,
        refetchOnWindowFocus: true,
        retry: 1,
      },
    },
  });
}

/**
 * Client providers for the whole application.
 *
 * The QueryClient is created inside `useState` rather than at module scope. A
 * module-level client is shared between every request on the server, which
 * would leak one visitor's cached data into another's render.
 *
 * `ThemeProvider` uses the class strategy to match the `@custom-variant dark`
 * rule in globals.css, and `disableTransitionOnChange` so switching theme does
 * not animate every colour on the page at once.
 *
 * `nonce` is the per-request CSP nonce, threaded down from the root layout.
 * next-themes emits an inline script into the document head to resolve the
 * theme before first paint — without it the page flashes the wrong theme on
 * every load — and under the nonce-based policy in `src/proxy.ts` an inline
 * script without the nonce is blocked. So this prop is what keeps the theme
 * from flashing, and dropping it would not fail loudly: the site would render
 * correctly and merely flicker white on every navigation in dark mode.
 */
export function Providers({ children, nonce }: { children: ReactNode; nonce?: string }) {
  const [queryClient] = useState(makeQueryClient);

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="maqua-theme"
      nonce={nonce}
    >
      <QueryClientProvider client={queryClient}>
        {/* 500 ms is long enough not to fire on a pointer passing through, short
            enough that a deliberate hover feels responsive. */}
        <TooltipProvider delayDuration={500}>{children}</TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
