import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

import { STATIONS } from './helpers';

/**
 * The content pages, and the policy that now governs every page.
 *
 * Two things are being guarded here, both of which were real defects rather
 * than hypotheses.
 *
 * 1. **No page may break under the nonce-based CSP.** The policy moved from a
 *    static header in `next.config.ts` to a per-request one in `src/proxy.ts`
 *    so AdSense can serve at all. Several plausible mistakes in that change
 *    fail silently or near-silently — a nonce missing from the request headers
 *    blanks every route, a nonce added to `style-src` breaks every Radix
 *    popover, a nonce missing from the `next-themes` script merely makes the
 *    page flash the wrong theme. A console listener catches all of them.
 *
 * 2. **No page may reintroduce `<article>` on a context card.** Those cards
 *    were the only `<article>` elements on any page, and `<article>` is the
 *    strongest main-content signal boilerplate strippers follow, so
 *    recall-favouring extraction returned 444 characters of Copernicus dust
 *    forecast in place of the whole page. A unit test asserts the component;
 *    this asserts the rendered pages.
 */

/** Every route a reader can reach, including the five pollutant guides. */
const CONTENT_ROUTES = [
  '/about',
  '/methodology',
  '/privacy',
  '/contact',
  '/terms',
  '/pollutants',
  '/pollutants/pm25',
  '/pollutants/pm10',
  '/pollutants/no2',
  '/pollutants/o3',
  '/pollutants/so2',
  '/saharan-dust',
] as const;

/**
 * Known-benign console errors that are artefacts of running locally.
 *
 * Vercel serves `/_vercel/insights/*` and `/_vercel/speed-insights/*` only on
 * its own platform. Locally those paths 404, and the browser then refuses to
 * execute an HTML error page as a script — a MIME-type refusal, with no CSP
 * directive involved. It is expected, it is documented in `next.config.ts`,
 * and it predates the move to a nonce-based policy.
 *
 * Nothing else belongs in this list. An entry here is a test being told to
 * ignore something, so each one needs a reason that survives review.
 */
const EXPECTED_LOCAL_ERRORS = [/_vercel\/(insights|speed-insights)\/script\.js/];

/**
 * Collect CSP violations and page errors.
 *
 * A genuine CSP refusal always names the policy — "because it violates the
 * following Content Security Policy directive" — so that phrase is the signal.
 * Matching "Refused to execute" on its own is too broad: it also catches MIME
 * sniffing refusals, which is how this test first failed on 24 pages for a
 * reason that had nothing to do with the policy.
 */
function watchForViolations(page: Page): string[] {
  const problems: string[] = [];

  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (EXPECTED_LOCAL_ERRORS.some((pattern) => pattern.test(text))) return;
    if (/Content Security Policy/i.test(text)) {
      problems.push(`CSP: ${text}`);
    }
  });

  page.on('pageerror', (error) => {
    if (EXPECTED_LOCAL_ERRORS.some((pattern) => pattern.test(error.message))) return;
    problems.push(`pageerror: ${error.message}`);
  });

  return problems;
}

test.describe('the content pages', () => {
  for (const route of CONTENT_ROUTES) {
    test(`${route} renders under the CSP, with one main heading`, async ({ page }) => {
      const problems = watchForViolations(page);

      const response = await page.goto(route);
      expect(response?.status(), `${route} should be reachable`).toBe(200);

      // The policy is per request now, so it must actually be present.
      const csp = response?.headers()['content-security-policy'];
      expect(csp, `${route} should carry a CSP`).toBeTruthy();
      expect(csp, `${route} should carry a per-request nonce`).toMatch(/'nonce-[^']+'/);

      // A page that rendered is a page whose scripts were not all refused.
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.locator('main')).toBeVisible();

      expect(problems, `${route} reported console/CSP problems`).toEqual([]);
    });
  }

  test('the pollutant guides differ from one another in substance', async ({ page }) => {
    /*
     * Five pages from one template is how the station pages ended up 65–88%
     * identical. This is a floor, not a target: it only catches the case where
     * a guide loses its own prose and falls back to the shared frame.
     */
    const texts: string[] = [];
    for (const slug of ['pm25', 'pm10', 'no2', 'o3', 'so2']) {
      await page.goto(`/pollutants/${slug}`);
      texts.push((await page.locator('main').innerText()).replace(/\s+/g, ' '));
    }

    for (const text of texts) {
      expect(text.length).toBeGreaterThan(2000);
    }
    // Every guide must be distinct from every other.
    expect(new Set(texts).size).toBe(texts.length);
  });
});

test.describe('main-content extraction', () => {
  test('no page presents a context card as an <article>', async ({ page }) => {
    for (const route of ['/', `/station/${STATIONS[4].slug}`]) {
      await page.goto(route);
      /*
       * Zero, not "fewer than before". There is no legitimate `<article>` on
       * these pages: the context cards are not independently distributable,
       * because the qualifier that makes one honest — modelled values, not
       * measurements — lives in the parent widget outside the card.
       */
      await expect(page.locator('article'), `${route} should contain no <article>`).toHaveCount(0);
    }
  });
});

test.describe('the nav reflects what the deployment can do', () => {
  test('does not link /alerts when alerts cannot be sent', async ({ page }) => {
    await page.goto('/');

    const alertsLinks = page.getByRole('link', { name: /^Alerts$/i });
    const response = await page.request.get('/api/health');
    const health = (await response.json()) as {
      email?: { configured?: boolean };
      database?: { configured?: boolean };
    };
    const enabled = Boolean(health.email?.configured && health.database?.configured);

    if (enabled) {
      // The feature works, so the menu is entitled to advertise it.
      expect(await alertsLinks.count()).toBeGreaterThan(0);
      return;
    }

    /*
     * The feature is off. A header and footer link on every page pointing at a
     * page that explains it cannot work is what an unfinished site looks like,
     * and is one of the things AdSense was reacting to.
     */
    await expect(alertsLinks).toHaveCount(0);
  });
});
