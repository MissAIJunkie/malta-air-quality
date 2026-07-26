import { expect, test, type Locator, type Page, type Response } from '@playwright/test';

/**
 * Shared end-to-end helpers.
 *
 * Two rules run through all of them.
 *
 * 1. **Query by role and accessible name, never by CSS class.** A spec that
 *    breaks when a Tailwind class changes tests the stylesheet; a spec that
 *    breaks when a button loses its accessible name tests something a user
 *    would notice. The second is what we want.
 *
 * 2. **Skip rather than fail when an OPTIONAL feature is absent.** The map, the
 *    theme toggle and the pollutant filter are enhancements. A build without one
 *    of them is a smaller product, not a broken one, and a red suite would then
 *    hide real regressions. Anything the brief makes non-negotiable — the
 *    attribution, the freshness labelling, keyboard access — is asserted
 *    outright and never skipped.
 */

/** The five verified stations. ASCII alternatives cover any unaccented render. */
export const STATIONS = [
  { slug: 'zejtun', name: 'Żejtun', pattern: /Ż?ejtun/i },
  { slug: 'gharb', name: 'Għarb', pattern: /G(ħ|h)arb/i },
  { slug: 'attard', name: 'Attard', pattern: /Attard/i },
  { slug: 'st-pauls-bay', name: "St Paul's Bay", pattern: /St\.?\s*Paul'?s\s*Bay/i },
  { slug: 'msida', name: 'Msida', pattern: /Msida/i },
] as const;

/** Msida does not measure ozone. The UI must say so rather than showing a zero. */
export const STATION_WITHOUT_OZONE = STATIONS[4];

export const POLLUTANT_PATTERNS = {
  'PM2.5': /PM\s*2\.5/i,
  PM10: /PM\s*10/i,
  NO2: /NO(₂|2)/i,
  O3: /O(₃|3)|Ozone/i,
  SO2: /SO(₂|2)/i,
} as const;

/** Wording that would be a lie about data the app knows to be old. */
export const LIVENESS_CLAIM = /\b(live|real[- ]time|up to the minute|current as of now)\b/i;

/** Load a path and assert the server did not error. */
export async function visit(page: Page, path = '/'): Promise<Response | null> {
  const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
  if (response) expect(response.status(), `GET ${path}`).toBeLessThan(400);
  await expect(page.locator('body')).toBeVisible();
  return response;
}

/** The first candidate that is actually on the page, or `null`. */
export async function firstVisible(...candidates: Locator[]): Promise<Locator | null> {
  for (const candidate of candidates) {
    const first = candidate.first();
    if (await first.isVisible().catch(() => false)) return first;
  }
  return null;
}

/**
 * Skip the current test because an optional feature is not present.
 *
 * Always call with a reason: a silently skipped test is indistinguishable from
 * a test that never ran, which is exactly the confusion this avoids.
 */
export function skipBecauseAbsent(reason: string): never {
  test.skip(true, reason);
  // `test.skip(true, …)` throws; this only satisfies the type checker.
  throw new Error(reason);
}

/** Links or buttons that open a station, in whatever shape the UI uses. */
export function stationTargets(page: Page, pattern: RegExp): Locator {
  return page
    .getByRole('link', { name: pattern })
    .or(page.getByRole('button', { name: pattern }))
    .or(page.getByRole('listitem').filter({ hasText: pattern }).getByRole('link'));
}

/** Any station-shaped affordance on the page, or `null` if none exists yet. */
export async function findAnyStationTarget(page: Page): Promise<Locator | null> {
  for (const station of STATIONS) {
    const target = await firstVisible(stationTargets(page, station.pattern));
    if (target) return target;
  }
  return null;
}

/**
 * The accessible, non-map presentation of the network.
 *
 * The brief requires the map never to be the only way to reach the data, so this
 * looks for a table, a list or a set of headings naming the stations. Its
 * absence is a real failure, not an optional feature.
 */
export async function findStationListing(page: Page): Promise<Locator | null> {
  const listing = await firstVisible(
    page.getByRole('table'),
    page.getByRole('list').filter({ hasText: STATIONS[0].pattern }),
    page.getByRole('list').filter({ hasText: STATIONS[2].pattern }),
    page.getByRole('region', { name: /station/i }),
  );
  if (listing) return listing;

  // A grid of cards is a legitimate listing too, as long as every station is
  // named in text somewhere on the page.
  const named = await Promise.all(
    STATIONS.map((s) =>
      page
        .getByText(s.pattern)
        .first()
        .isVisible()
        .catch(() => false),
    ),
  );
  return named.every(Boolean) ? page.locator('body') : null;
}

/** Reveal a listing that a mobile layout may have put behind a control. */
export async function revealListing(page: Page): Promise<void> {
  if (await findStationListing(page)) return;

  const toggle = await firstVisible(
    page.getByRole('tab', { name: /list|stations|table/i }),
    page.getByRole('button', { name: /list view|show list|view as list|all stations/i }),
    page.getByRole('link', { name: /^stations$/i }),
  );
  if (!toggle) return;

  await toggle.click();
  await page.waitForLoadState('domcontentloaded');
}

/** The theme control, if this build has one. */
export async function findThemeToggle(page: Page): Promise<Locator | null> {
  return firstVisible(
    page.getByRole('button', { name: /theme|dark mode|light mode|appearance/i }),
    page.getByRole('switch', { name: /theme|dark|light/i }),
    page.getByRole('combobox', { name: /theme|appearance/i }),
  );
}

/** The pollutant filter, if this build has one. */
export async function findPollutantFilter(page: Page): Promise<Locator | null> {
  return firstVisible(
    page.getByRole('combobox', { name: /pollutant/i }),
    page.getByRole('group', { name: /pollutant/i }),
    page.getByRole('tablist', { name: /pollutant/i }),
    page.getByRole('radiogroup', { name: /pollutant/i }),
  );
}

/** Whether the document is currently in dark mode (next-themes class strategy). */
export async function isDarkMode(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return root.classList.contains('dark') || root.dataset.theme === 'dark';
  });
}

/**
 * Tab forwards until the focused element matches, then return its accessible
 * name. Returns `null` if the target is not reachable within `maxTabs`.
 *
 * Bounded on purpose: an unbounded loop on a page with a focus trap would hang
 * the run instead of reporting the trap.
 */
export async function tabUntil(
  page: Page,
  matches: (info: { role: string; name: string; tag: string }) => boolean,
  maxTabs = 60,
): Promise<string | null> {
  for (let i = 0; i < maxTabs; i += 1) {
    await page.keyboard.press('Tab');

    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return { role: '', name: '', tag: '' };
      return {
        role: el.getAttribute('role') ?? '',
        name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 200),
        tag: el.tagName.toLowerCase(),
      };
    });

    if (matches(info)) return info.name;
  }
  return null;
}

/**
 * Fail any test in the enclosing `describe` whose page threw an uncaught error.
 *
 * Call once at describe scope, NOT inside a test. Throwing from inside a
 * `page.on('pageerror')` callback does nothing useful — Playwright does not
 * route an exception raised in an event-emitter callback to the test result, so
 * a listener that throws is silently swallowed and guarantees nothing. The
 * errors are therefore collected and asserted in an `afterEach`, which is a
 * place a failure can actually be reported from.
 */
export function guardAgainstPageErrors(): void {
  const errors: string[] = [];

  test.beforeEach(({ page }) => {
    errors.length = 0;
    page.on('pageerror', (error) => errors.push(error.message));
  });

  test.afterEach(() => {
    expect(errors, 'the page threw uncaught errors').toEqual([]);
  });
}
