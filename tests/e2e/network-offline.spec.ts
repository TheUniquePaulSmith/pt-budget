import { expect, test } from '@playwright/test';

import { bootstrapDatabase, navigateToPage } from './helpers/bootstrap';

/**
 * Losing the connection (src/lib/networkStatus.ts) with offline mode off, the
 * default: the status bar and a notice say so, features that need the
 * internet explain that they wait for it instead of failing, and everything
 * returns when the browser is online again. Runs on the dev server, where
 * offline mode itself is not available; offline.spec.ts covers offline mode
 * and the page that was never loaded on the production build (Turbopack's dev
 * chunk loader waits for the connection instead of failing).
 */

test('going offline pauses the cloud features with an explanation, and coming back restores them', async ({
  page,
  context,
}) => {
  await bootstrapDatabase(page, { loadSampleData: false });
  await expect(page.getByTestId('network-offline-chip')).toHaveCount(0);

  // Settings is opened once while online, so its code is loaded; Loans is not.
  await navigateToPage(page, 'settings');
  await page.getByRole('tab', { name: 'Database Source' }).click();
  await expect(page.getByRole('button', { name: 'Open from Google Drive' })).toBeEnabled();
  await page.getByRole('button', { name: 'Close settings' }).click();

  await context.setOffline(true);
  await expect(page.getByTestId('network-offline-chip')).toBeVisible();
  await expect(page.getByTestId('network-offline-chip')).toHaveText('Offline');
  const notice = page.getByTestId('offline-notice');
  await expect(notice).toHaveAttribute('data-notice', 'wentOffline');
  // Offline mode is not on, so the notice also says unopened pages may not load.
  await expect(notice).toContainText("pages you haven't opened yet may not load");

  // Settings → Database Source: cloud actions wait for the connection.
  await navigateToPage(page, 'settings');
  await page.getByRole('tab', { name: 'Database Source' }).click();
  await expect(page.getByTestId('offline-feature-cloudSync')).toContainText(
    'Cloud sync needs an internet connection.'
  );
  await expect(page.getByRole('button', { name: 'Open from Google Drive' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Open from OneDrive' })).toBeDisabled();

  // Offline mode is not available under next dev (and could not be turned on offline anyway).
  await page.getByTestId('settings-tab-preferences').click();
  await expect(page.getByTestId('settings-offline-dev')).toBeVisible();

  // Back online: the chip goes, the notice says so, cloud actions return.
  await context.setOffline(false);
  await expect(page.getByTestId('network-offline-chip')).toHaveCount(0);
  await expect(notice).toHaveAttribute('data-notice', 'backOnline');
  await page.getByRole('tab', { name: 'Database Source' }).click();
  await expect(page.getByTestId('offline-feature-cloudSync')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open from Google Drive' })).toBeEnabled();
});
