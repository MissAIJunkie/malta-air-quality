import { expect, test } from '@playwright/test';

import {
  STATIONS,
  findStationListing,
  findThemeToggle,
  firstVisible,
  guardAgainstPageErrors,
  isDarkMode,
  revealListing,
  skipBecauseAbsent,
  visit,
} from './helpers';

test.describe('the accessible list view', () => {
  guardAgainstPageErrors();

  test.beforeEach(async ({ page }) => {
    await visit(page, '/');
    await revealListing(page);
  });

  test('presents every station as text, not only as a coloured marker', async ({ page }) => {
    const listing = await findStationListing(page);
    expect(listing, 'the network is not available in an accessible, non-map form').not.toBeNull();

    for (const station of STATIONS) {
      await expect(page.getByText(station.pattern).first()).toBeVisible();
    }
  });

  test('never relies on colour alone to convey the band', async ({ page }) => {
    // Every band shown as a swatch must also be written out. This is what makes
    // the app usable in greyscale, in forced-colours mode and by a colour-blind
    // reader.
    const bands = page.locator('[data-aq-band]');
    const count = await bands.count();
    if (count === 0) skipBecauseAbsent('no band swatches rendered yet');

    const bandWords = /Good|Fair|Moderate|Poor|Very poor|Extremely poor|No data/i;
    for (let i = 0; i < Math.min(count, 12); i += 1) {
      const text = (await bands.nth(i).innerText()).trim();
      expect(text, `band swatch ${i} carries no written label`).toMatch(bandWords);
    }
  });

  test('gives every interactive control an accessible name', async ({ page }) => {
    const unnamed = await page.evaluate(() => {
      const selector = 'a[href], button, [role="button"], input, select, textarea, [role="tab"]';
      const problems: string[] = [];

      for (const el of Array.from(document.querySelectorAll(selector))) {
        const element = el as HTMLElement;
        if (element.getAttribute('aria-hidden') === 'true') continue;
        if (element.hasAttribute('hidden')) continue;
        if ((element as HTMLInputElement).type === 'hidden') continue;

        /*
         * An approximation of the accessible-name algorithm, in precedence
         * order. It has to include BOTH label forms: `<input>` is a void
         * element with no textContent of its own, so a correctly labelled
         * radio or checkbox looks anonymous to a naive textContent check and
         * the audit reports a failure that does not exist.
         */
        const labelledBy = element.getAttribute('aria-labelledby');
        const labels = (element as HTMLInputElement).labels;

        const name =
          element.getAttribute('aria-label') ??
          (labelledBy ? document.getElementById(labelledBy)?.textContent : null) ??
          (labels && labels.length > 0
            ? Array.from(labels)
                .map((l) => l.textContent ?? '')
                .join(' ')
            : null) ??
          element.closest('label')?.textContent ??
          (element.textContent?.trim() ? element.textContent : null) ??
          element.getAttribute('title') ??
          (element as HTMLInputElement).value ??
          '';

        if (name.trim() === '') {
          problems.push(`${element.tagName.toLowerCase()}#${element.id || '(no id)'}`);
        }
      }
      return problems;
    });

    expect(unnamed, 'controls with no accessible name').toEqual([]);
  });

  test('gives touch targets at least 44 CSS pixels', async ({ page }) => {
    // 44px is the project's own requirement, stricter than WCAG 2.2's Level AA
    // minimum of 24×24 (SC 2.5.8) and matching its Level AAA target (SC 2.5.5).
    // Inline links inside a paragraph are exempt, so only standalone controls
    // are measured.
    const tooSmall = await page.evaluate(() => {
      const problems: string[] = [];
      const controls = document.querySelectorAll('button, [role="button"], [role="tab"], summary');

      for (const el of Array.from(controls)) {
        const element = el as HTMLElement;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.width < 44 || rect.height < 44) {
          problems.push(
            `${element.tagName.toLowerCase()} "${(element.textContent ?? '').trim().slice(0, 24)}" ${Math.round(rect.width)}x${Math.round(rect.height)}`,
          );
        }
      }
      return problems;
    });

    expect(tooSmall, 'controls smaller than the 44px minimum target').toEqual([]);
  });

  test('keeps heading levels in order, with no gaps', async ({ page }) => {
    const levels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((h) =>
        Number(h.tagName.slice(1)),
      ),
    );

    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    for (let i = 1; i < levels.length; i += 1) {
      // Jumping h2 → h4 leaves a screen-reader user guessing at the structure.
      expect(
        levels[i] - levels[i - 1],
        `heading level jumps from h${levels[i - 1]} to h${levels[i]}`,
      ).toBeLessThanOrEqual(1);
    }
  });

  test('declares its language', async ({ page }) => {
    // Required so a screen reader picks the right pronunciation — which matters
    // rather a lot for "Għarb".
    await expect(page.locator('html')).toHaveAttribute('lang', /^(en|mt|fr)/);
  });

  test('gives every image a text alternative', async ({ page }) => {
    const missing = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img'))
        .filter((img) => img.getAttribute('alt') === null && img.getAttribute('role') !== 'none')
        .map((img) => img.getAttribute('src') ?? '(no src)'),
    );
    expect(missing, 'images with no alt attribute').toEqual([]);
  });
});

test.describe('the dark-mode toggle', () => {
  guardAgainstPageErrors();

  test.beforeEach(async ({ page }) => {
    await visit(page, '/');
  });

  test('switches the theme and keeps it after a reload', async ({ page }) => {
    const toggle = await findThemeToggle(page);
    if (!toggle) skipBecauseAbsent('this build has no theme control');

    const before = await isDarkMode(page);
    await toggle.click();

    // A Radix menu or select opens rather than toggling; pick the opposite mode.
    const option = await firstVisible(
      page.getByRole('menuitem', { name: before ? /light/i : /dark/i }),
      page.getByRole('option', { name: before ? /light/i : /dark/i }),
    );
    if (option) await option.click();

    await expect
      .poll(() => isDarkMode(page), { message: 'the theme did not change', timeout: 5_000 })
      .toBe(!before);

    // next-themes persists to localStorage; the choice must survive a reload
    // rather than snapping back and flashing the wrong theme.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(() => isDarkMode(page), { timeout: 5_000 }).toBe(!before);
  });

  test('keeps the band labels readable in both themes', async ({ page }) => {
    const toggle = await findThemeToggle(page);
    if (!toggle) skipBecauseAbsent('this build has no theme control');

    const bands = page.locator('[data-aq-band]');
    if ((await bands.count()) === 0) skipBecauseAbsent('no band swatches rendered yet');

    const readableIn = async () => {
      const text = (await bands.first().innerText()).trim();
      const opacity = await bands.first().evaluate((el) => getComputedStyle(el).opacity);
      return text.length > 0 && Number(opacity) > 0.5;
    };

    expect(await readableIn()).toBe(true);
    await toggle.click();
    await page.waitForTimeout(300);
    expect(await readableIn()).toBe(true);
  });

  test('respects the operating system preference on first visit', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();
    await visit(page, '/');

    // No stored choice yet, so the OS preference decides. Overriding it would be
    // a small rudeness with a real accessibility cost.
    await expect.poll(() => isDarkMode(page), { timeout: 5_000 }).toBe(true);
    await context.close();
  });
});

test.describe('working without a mouse', () => {
  guardAgainstPageErrors();

  test('exposes a visible focus ring on every control reached by tabbing', async ({ page }) => {
    await visit(page, '/');

    const invisible: string[] = [];
    for (let i = 0; i < 15; i += 1) {
      await page.keyboard.press('Tab');
      const problem = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        const hasRing =
          style.outlineStyle !== 'none' ||
          Number.parseFloat(style.outlineWidth) > 0 ||
          style.boxShadow !== 'none';
        return hasRing
          ? null
          : `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 24)}"`;
      });
      if (problem) invisible.push(problem);
    }

    expect(invisible, 'controls with no visible focus indicator').toEqual([]);
  });

  test('closes an opened dialog with Escape and returns focus', async ({ page }) => {
    await visit(page, '/');
    await revealListing(page);

    const opener = await firstVisible(
      page.getByRole('button', { name: /details|about|more|explain|info/i }),
    );
    if (!opener) skipBecauseAbsent('no dialog-opening control on this page');

    await opener.click();
    const dialog = page.getByRole('dialog');
    if ((await dialog.count()) === 0) skipBecauseAbsent('the control did not open a dialog');

    await expect(dialog.first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog.first()).toBeHidden();
    // Focus must come back to where it was, or the user is dropped at the top
    // of the document.
    await expect(opener).toBeFocused();
  });
});

test.describe('reduced motion', () => {
  guardAgainstPageErrors();

  test('still renders the whole page when animation is switched off @reduced-motion', async ({
    page,
  }) => {
    // Runs under the `reduced-motion` project. A layout that depends on an
    // animation completing would leave a reader with vestibular sensitivity
    // looking at a blank panel.
    await visit(page, '/');
    await revealListing(page);

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const listing = await findStationListing(page);
    expect(listing, 'the station listing did not render with reduced motion').not.toBeNull();
  });
});
