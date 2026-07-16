/**
 * E2E test for the popup-hosted Google Drive OAuth flow: a real
 * window.open() popup, a real cross-origin navigation to the (intercepted)
 * Google authorize endpoint, a real redirect back to /auth/complete/, and a
 * real BroadcastChannel handoff to the opener — with only the network calls
 * to Google mocked (see helpers/cloudMock.ts). Everything else (the popup
 * window, the app's own pages, IndexedDB/SharedWorker) is real.
 *
 * OneDrive isn't covered here — see cloudMock.ts for why.
 */

import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import {
  bootstrapDatabase,
  seedBrowserCompatibility,
} from './helpers/bootstrap';
import { installGoogleDriveRoutes, MockGoogleDriveStore } from './helpers/cloudMock';

const TEST_PASSWORD = 'CloudAuthE2E1!';
const BACKUP_FILE_NAME = 'budget-tracker-backup.zip';

test('@smoke opens a Google Drive backup through the popup OAuth + file picker flow', async ({
  page,
  browser,
}) => {
  // Step 1: create a small local database and export it, so there's a real
  // encrypted archive to seed into the mock Drive below. loadSampleData is
  // off to keep the export (and therefore this test) fast.
  await bootstrapDatabase(page, { loadSampleData: false, password: TEST_PASSWORD });

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    (async () => {
      await page.getByRole('button', { name: 'Settings' }).click();
      await page.getByRole('tab', { name: 'Data & Backup' }).click({ timeout: 10_000 });
      await page.getByRole('button', { name: /Export Database/i }).click({ timeout: 10_000 });
    })(),
  ]);

  const exportedPath = await download.path();
  if (!exportedPath) {
    test.skip();
    return;
  }
  const archiveBytes = new Uint8Array(await readFile(exportedPath));

  // Step 2: a fresh browser context is a fresh device — no local database,
  // no cached OAuth token — wired to a mock Google Drive that already has
  // the archive exported above sitting in it, as if from another device.
  const freshContext = await browser.newContext();
  try {
    const freshPage = await freshContext.newPage();
    const store = new MockGoogleDriveStore();
    store.seedFile({ name: BACKUP_FILE_NAME, bytes: archiveBytes });
    await installGoogleDriveRoutes(freshPage, store);

    await seedBrowserCompatibility(freshPage);
    await freshPage.goto('/');

    const openFromGoogleDriveButton = freshPage.getByRole('button', {
      name: 'Open from Google Drive',
    });
    await expect(openFromGoogleDriveButton).toBeVisible({ timeout: 30_000 });
    await expect(openFromGoogleDriveButton).toBeEnabled();

    const [popup] = await Promise.all([
      freshContext.waitForEvent('page'),
      openFromGoogleDriveButton.click(),
    ]);

    // The popup does /auth/start/ -> (intercepted) accounts.google.com ->
    // /auth/complete/, posts the result over BroadcastChannel, then closes
    // itself — all real navigations, only the Google request is mocked.
    await popup.waitForEvent('close', { timeout: 30_000 });

    const picker = freshPage.getByTestId('cloud-file-picker-list');
    await expect(picker).toBeVisible({ timeout: 30_000 });
    await expect(picker.getByText(BACKUP_FILE_NAME)).toBeVisible();

    await freshPage.getByRole('button', { name: 'Open' }).click();

    // This is a brand-new worker with no encryption key yet, and the
    // downloaded archive is encrypted, so the password screen must appear
    // before anything is imported.
    await expect(freshPage.getByText('Enter Password')).toBeVisible({ timeout: 30_000 });
    await freshPage.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
    await freshPage.getByRole('button', { name: 'Unlock' }).click();

    await expect(freshPage.getByRole('button', { name: 'SQL Query' })).toBeVisible({
      timeout: 60_000,
    });
    await expect(freshPage.getByTestId('database-status-text')).toHaveText('Connected', {
      timeout: 60_000,
    });

    // The cloud link should be recorded, not just the data imported — the
    // sync status chip only appears once the source is a cloud provider.
    await expect(freshPage.getByTestId('cloud-sync-chip')).toBeVisible({ timeout: 30_000 });
  } finally {
    await freshContext.close();
  }
});

test('shows a clear error when Google sign-in is denied', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const store = new MockGoogleDriveStore();
    await installGoogleDriveRoutes(page, store);

    // Override just the authorize route for this test to simulate the user
    // clicking "Deny" on Google's consent screen.
    await context.route('https://accounts.google.com/o/oauth2/v2/auth**', async (route) => {
      const url = new URL(route.request().url());
      const state = url.searchParams.get('state') ?? '';
      const redirectUri = url.searchParams.get('redirect_uri') || 'http://localhost:3000/auth/complete/';
      const fragment = new URLSearchParams({ error: 'access_denied', state }).toString();
      await route.fulfill({ status: 302, headers: { Location: `${redirectUri}#${fragment}` } });
    });

    await seedBrowserCompatibility(page);
    await page.goto('/');

    const openFromGoogleDriveButton = page.getByRole('button', { name: 'Open from Google Drive' });
    await expect(openFromGoogleDriveButton).toBeEnabled({ timeout: 30_000 });

    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      openFromGoogleDriveButton.click(),
    ]);
    await popup.waitForEvent('close', { timeout: 30_000 });

    // The welcome screen (still needs-setup — nothing was ever authenticated)
    // should surface the failure instead of hanging silently.
    await expect(page.getByText(/sign-in|access_denied|denied/i)).toBeVisible({ timeout: 30_000 });
  } finally {
    await context.close();
  }
});
