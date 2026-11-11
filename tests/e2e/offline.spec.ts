import { expect, test, type Page, type Response } from '@playwright/test';

import deSettings from '../../src/locales/de/settings.json';
import deShell from '../../src/locales/de/shell.json';
import { bootstrapDatabase, navigateToPage, reloadAndUnlock, type AppPageId } from './helpers/bootstrap';

/**
 * Offline mode: runs only through playwright.offline.config.ts
 * (`pnpm run test:e2e:offline`), against the production build served by
 * scripts/serve-dist.mjs, because `next dev` never registers the service
 * worker. Offline mode is opt-in: nothing is saved until the user turns it on
 * in Settings → Preferences. Then the host is taken down (every request 503,
 * browser offline); the app must still reload, unlock, open every page and
 * load another language entirely from the service worker's cache.
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

test('with offline mode turned on, the built app reloads, unlocks and opens every page with the host down', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(300_000);
  await bootstrapDatabase(page, { loadSampleData: true, sampleDataTransactionLimit: 200 });

  // Off by default: the app loads lazily and nothing is saved for offline use.
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  expect(await page.evaluate(async () => (await caches.keys()).length)).toBe(0);

  // Settings → Preferences → Offline mode: says what it downloads, then saves the whole build with progress.
  await navigateToPage(page, 'settings');
  await page.getByTestId('settings-tab-preferences').click();
  await expect(page.getByTestId('settings-offline-size')).toContainText(/Downloads about \d+ MB \(\d+ files\) once/);
  await page.getByTestId('settings-offline-switch').locator('input').check();
  await expect(page.getByTestId('settings-offline-ready')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('offline-notice')).toContainText('works offline');
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('budgetTracker_offlineMode'))).toBe('on');
  await page.getByRole('button', { name: 'Close settings' }).click();
  const isolatedOnline = await page.evaluate(() => self.crossOriginIsolated);

  // Take the host down (every request that reaches it gets 503) and tell the browser it is offline.
  await page.request.get('/__serve-dist/offline');
  expect((await page.request.get('/')).status()).toBe(503);
  await context.setOffline(true);
  await expect(page.getByTestId('network-offline-chip')).toBeVisible();
  await expect(page.getByTestId('offline-notice')).toHaveAttribute('data-notice', 'wentOffline');

  const failures = trackFailures(page, new URL(baseURL!).origin);
  await reloadAndUnlock(page);
  expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(isolatedOnline);
  await expect(page.getByTestId('network-offline-chip')).toBeVisible();

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
  await context.setOffline(false);
  await page.request.get('/__serve-dist/online');
});

test('without offline mode, a page never opened explains itself offline and loads once back online', async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  await bootstrapDatabase(page, { loadSampleData: false });
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);

  await page.request.get('/__serve-dist/offline');
  await context.setOffline(true);
  await expect(page.getByTestId('offline-notice')).toContainText("pages you haven't opened yet may not load");

  // Loans was never opened, and nothing is saved: its code cannot arrive. The app keeps running.
  await navigateToPage(page, 'loans');
  const unavailable = page.getByTestId('page-unavailable');
  await expect(unavailable).toContainText('Not available offline yet');
  await expect(unavailable).toHaveAttribute('data-online', 'false');
  await expect(page.getByTestId('page-unavailable-retry')).toBeDisabled();
  await expect(page.getByTestId('database-status-text')).toHaveText('Connected');
  await navigateToPage(page, 'dashboard');
  await expect(page.getByTestId('app-bar-title')).toHaveText('Dashboard');
  await navigateToPage(page, 'loans');
  await expect(unavailable).toBeVisible();

  // Back online: the page loads by itself.
  await page.request.get('/__serve-dist/online');
  await context.setOffline(false);
  await expect(unavailable).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId('app-bar-title')).toHaveText('Loans');
  await expect(page.getByTestId('offline-notice')).toHaveAttribute('data-notice', 'backOnline');
});

test('turning offline mode off removes the saved app', async ({ page }) => {
  test.setTimeout(300_000);
  await bootstrapDatabase(page, { loadSampleData: false });
  await navigateToPage(page, 'settings');
  await page.getByTestId('settings-tab-preferences').click();

  const offlineSwitch = page.getByTestId('settings-offline-switch').locator('input');
  await offlineSwitch.check();
  await expect(page.getByTestId('settings-offline-ready')).toBeVisible({ timeout: 120_000 });
  expect(await page.evaluate(async () => (await caches.keys()).length)).toBe(1);

  await offlineSwitch.uncheck();
  await expect(page.getByTestId('settings-offline-ready')).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  // The saved files are deleted right after the worker is unregistered.
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).length)).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('budgetTracker_offlineMode'))).toBeNull();
});
