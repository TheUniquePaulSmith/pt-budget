import { expect, test, type Page, type Response } from '@playwright/test';

import deSettings from '../../src/locales/de/settings.json';
import deShell from '../../src/locales/de/shell.json';
import { bootstrapDatabase, navigateToPage, reloadAndUnlock, type AppPageId } from './helpers/bootstrap';

/**
 * Offline mode: runs only through playwright.offline.config.ts
 * (`npm run test:e2e:offline`), against the production build served by
 * scripts/serve-dist.mjs, because `next dev` never registers the service
 * worker. After one online visit the host is taken down (every request 503);
 * the app must still reload, unlock, open every page and load another
 * language entirely from the service worker's cache.
 */

const GERMAN_DASHBOARD = (deShell as { nav: { dashboard: string } }).nav.dashboard;
const GERMAN_CLOSE_SETTINGS = (deSettings as { page: { close: string } }).page.close;

const SHELL_PAGES: Array<[AppPageId, string]> = [
  ['dashboard', 'Dashboard'],
  ['projects', 'Projects'],
  ['trips', 'Trips'],
  ['budget', 'Budget'],
  ['accounts', 'Accounts'],
  ['loans', 'Loans'],
  ['transactions', 'Transactions'],
  ['subscriptions', 'Subscriptions'],
  ['notifications', 'Notifications'],
  ['sql-query', 'SQL Query'],
];

/** Same-origin responses the page got that were not successful. */
function trackFailures(page: Page, origin: string) {
  const failures: string[] = [];
  page.on('response', (response: Response) => {
    if (response.url().startsWith(origin) && response.status() >= 400) {
      failures.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on('requestfailed', (request) => {
    if (request.url().startsWith(origin)) failures.push(`failed ${request.url()}`);
  });
  return failures;
}

test('after one visit the built app reloads, unlocks and opens every page with the host down', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(300_000);
  await bootstrapDatabase(page, { loadSampleData: true, sampleDataTransactionLimit: 200 });

  // The first visit installs the worker; it saves the whole build, then takes control.
  await expect(page.getByTestId('offline-notice')).toContainText('works offline', { timeout: 120_000 });
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  const isolatedOnline = await page.evaluate(() => self.crossOriginIsolated);

  // Take the host down: from here on every request that reaches it gets 503.
  await page.request.get('/__serve-dist/offline');
  expect((await page.request.get('/')).status()).toBe(503);

  const failures = trackFailures(page, new URL(baseURL!).origin);
  await reloadAndUnlock(page);
  expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(isolatedOnline);

  // The installed app needs its manifest and icons offline too.
  const install = await page.evaluate(async () => {
    const href = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href;
    if (!href) return { href: null, icons: [] as Array<[string, number]> };
    const manifest = (await (await fetch(href)).json()) as { icons: Array<{ src: string }> };
    const icons = await Promise.all(
      manifest.icons.map(async (icon) => [icon.src, (await fetch(icon.src)).status] as [string, number]),
    );
    return { href, icons };
  });
  expect(install.href).toMatch(/\/manifest\.webmanifest$/);
  expect(install.icons.length).toBeGreaterThanOrEqual(4);
  for (const [src, status] of install.icons) expect(status, src).toBe(200);

  for (const [id, title] of SHELL_PAGES) {
    await navigateToPage(page, id);
    await expect(page.getByTestId('app-bar-title')).toHaveText(title);
  }

  await navigateToPage(page, 'import');
  await expect(page.getByTestId('import-close')).toBeVisible();
  await page.getByTestId('import-close').click();

  // A language that was never loaded online comes from the cache too.
  await navigateToPage(page, 'settings');
  await page.getByTestId('settings-tab-preferences').click();
  await page.getByTestId('settings-language').locator('..').click();
  await page.getByTestId('settings-language-option-de').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'de-DE');
  await page.getByRole('button', { name: GERMAN_CLOSE_SETTINGS }).click();
  await expect(page.getByTestId('nav-dashboard').first()).toHaveAccessibleName(GERMAN_DASHBOARD, { timeout: 30_000 });

  await navigateToPage(page, 'developer-console');
  await expect(page.getByTestId('developer-console')).toBeVisible();

  expect(failures).toEqual([]);
  await page.request.get('/__serve-dist/online');
});
