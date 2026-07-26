import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * The suite runs against a PRODUCTION build with the fixture provider and AI
 * turned off. Three reasons, all deliberate:
 *
 *   - `pnpm build && pnpm start` is what ships. `next dev` has different
 *     hydration, caching and error behaviour, so testing it proves less.
 *   - `AIR_QUALITY_PROVIDER=fixture` means no test can ever contact ERA, the
 *     EEA, OpenRouter, Resend or a weather API. The run is hermetic and its
 *     results are reproducible.
 *   - No database, Redis, AI or email credential is supplied, which also proves
 *     the brief's requirement that the app works fully without them.
 */

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3000);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  /** A stray `test.only` must never quietly reduce CI coverage. */
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI
    ? [['github'], ['html', { open: 'never' }], ['list']]
    : [['list'], ['html', { open: 'never' }]],
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    /** Malta, so any date rendered by the browser matches the app's own zone. */
    timezoneId: 'Europe/Malta',
    locale: 'en-GB',
  },

  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Most people check air quality on a phone; the mobile layout is not a
      // secondary concern and is exercised as a first-class target.
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
    {
      // Only the specs tagged `@reduced-motion` — running the whole suite a
      // third time would triple the wall clock to re-prove things that do not
      // depend on animation.
      name: 'reduced-motion',
      // `reducedMotion` lives under `contextOptions` rather than at the top of
      // `use` — it is a browser-context option, not a test option.
      use: { ...devices['Desktop Chrome'], contextOptions: { reducedMotion: 'reduce' } },
      grep: /@reduced-motion/,
    },
  ],

  webServer: {
    command: 'pnpm build && pnpm start',
    url: baseURL,
    /**
     * Never adopt a server this config did not start.
     *
     * A `next dev` already listening on :3000 has no `AIR_QUALITY_PROVIDER`, so
     * `getEnv()` defaults it to `eea` — and the suite would then hit the real
     * EEA dissemination layer. Reusing it would trade a rebuild for a run that
     * is neither hermetic nor reproducible. Set `PLAYWRIGHT_REUSE_SERVER=1`
     * deliberately when iterating against a server you know is configured.
     */
    reuseExistingServer: !isCI && process.env.PLAYWRIGHT_REUSE_SERVER === '1',
    // A cold Next build is slow; a short timeout would fail the run for no
    // reason other than impatience.
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      AIR_QUALITY_PROVIDER: 'fixture',
      AI_EXPLANATIONS_ENABLED: 'false',
      AI_CONTEXT_SUMMARIES_ENABLED: 'false',
      WEATHER_PROVIDER: 'none',
      CONTEXT_REFRESH_ENABLED: 'false',
      NEXT_PUBLIC_APP_URL: baseURL,
      PORT: String(PORT),
    },
  },
});
