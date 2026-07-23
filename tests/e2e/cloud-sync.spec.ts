/**
 * E2E test for the cloud auto-sync lifecycle against a mocked Google Drive
 * (see helpers/cloudMock.ts): converting a local database to cloud storage,
 * an automatic debounced upload after an edit — tolerating the server-side
 * `version` drift the mock simulates after every upload — and a genuine
 * content conflict detected mid-sync that gets resolved through the real
 * Settings UI.
 *
 * Auth itself is short-circuited via window.__budgetTrackerTestApi's
 * injectGoogleToken seam (see DatabaseContext.tsx) rather than a real popup
 * round trip — that flow is covered end-to-end by auth-popup.spec.ts.
 */

import { expect, test, type Page } from '@playwright/test';

import { bootstrapDatabase, runQueryAndReadFirstCell } from './helpers/bootstrap';
import {
  installGoogleDriveRoutes,
  looksLikeEncryptedArchive,
  MockGoogleDriveStore,
} from './helpers/cloudMock';

const TEST_PASSWORD = 'CloudSyncE2E1!';
const DEFAULT_SAMPLE_DATA_EXPENSE_ACCOUNT_NAME = 'Household Checking';
const SYNC_DEBOUNCE_MS = 1000;

async function injectGoogleToken(page: Page) {
  await page.evaluate(() => {
    window.__budgetTrackerTestApi?.cloudSync?.injectGoogleToken(
      'mock-google-access-token',
      Date.now() + 60 * 60 * 1000
    );
  });
}

async function addTransactionFromDashboard(
  page: Page,
  description: string,
  amount: string,
  accountName: string
) {
  await page.getByRole('button', { name: 'Dashboard' }).click();
  await page.getByRole('button', { name: 'Add Transaction' }).first().click();

  const transactionDialog = page.getByRole('dialog', { name: 'Add New Transaction' });
  await transactionDialog.getByRole('textbox', { name: 'Description' }).fill(description);
  await transactionDialog.getByRole('spinbutton', { name: 'Amount' }).fill(amount);
  await transactionDialog.getByRole('combobox', { name: 'Account' }).click();
  await page.getByRole('option', { name: new RegExp(accountName, 'i') }).click();
  await transactionDialog.getByRole('button', { name: 'Add Transaction' }).click();

  await expect(transactionDialog).not.toBeVisible({ timeout: 120_000 });
}

async function closeSettings(page: Page) {
  await page.getByRole('button', { name: 'Close settings' }).click();
}

test('@smoke syncs edits to Google Drive automatically and resolves a conflict', async ({
  page,
}) => {
  const store = new MockGoogleDriveStore();
  await installGoogleDriveRoutes(page, store);

  await bootstrapDatabase(page, {
    password: TEST_PASSWORD,
    extraQueryParams: `syncDebounceMs=${SYNC_DEBOUNCE_MS}`,
  });

  // Short-circuits the interactive OAuth popup — see the file header.
  await injectGoogleToken(page);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Database Source' }).click();

  const convertButton = page.getByRole('button', { name: 'Convert Local to Google Drive' });
  await convertButton.click();
  // While migrating, the button's accessible name changes to "Converting…",
  // so this locator only resolves again once the migration has finished.
  await expect(convertButton).toBeEnabled({ timeout: 60_000 });

  await closeSettings(page);

  const syncChip = page.getByTestId('cloud-sync-chip');
  await expect(syncChip).toHaveText('Synced', { timeout: 30_000 });
  expect(store.uploads).toHaveLength(1);
  expect(looksLikeEncryptedArchive(store.uploads[0].bytes)).toBe(true);

  const linkedFileId = store.list()[0].id;
  const preEditBytes = store.uploads[0].bytes;

  // Editing the database should mark it dirty, then auto-upload once the
  // (overridden, 1s) debounce settles.
  const description = `Cloud Sync E2E ${Date.now()}`;
  await addTransactionFromDashboard(page, description, '12.34', DEFAULT_SAMPLE_DATA_EXPENSE_ACCOUNT_NAME);

  await expect(syncChip).toHaveText('Pending changes', { timeout: 15_000 });
  await expect(syncChip).toHaveText('Synced', { timeout: 30_000 });
  expect(store.uploads.length).toBeGreaterThanOrEqual(2);

  // Simulate the file changing on another device — conflict detection
  // compares the content checksum, and the pre-edit bytes differ from the
  // latest upload (every export re-encrypts freshly), so restoring them
  // remotely changes the checksum — then make another local edit so the
  // next auto-sync attempt collides with it.
  store.simulateRemoteEdit(linkedFileId, preEditBytes);
  const secondDescription = `${description} v2`;
  await addTransactionFromDashboard(page, secondDescription, '5.00', DEFAULT_SAMPLE_DATA_EXPENSE_ACCOUNT_NAME);

  await expect(syncChip).toHaveText('Resolve conflict', { timeout: 30_000 });

  await syncChip.click();
  await page.getByRole('tab', { name: 'Database Source' }).click();
  await page.getByRole('button', { name: 'Resolve…' }).click();

  const conflictDialog = page.getByTestId('cloud-conflict-dialog');
  await expect(conflictDialog).toBeVisible();
  await conflictDialog.getByRole('button', { name: 'Use Cloud Version' }).click();
  await conflictDialog
    .getByRole('button', { name: 'Confirm: Discard Local Changes' })
    .click();
  await expect(conflictDialog).not.toBeVisible({ timeout: 30_000 });

  await closeSettings(page);
  await expect(syncChip).toHaveText('Synced', { timeout: 30_000 });

  // The restored cloud copy predates both local-only edits above, so neither
  // transaction should still be present — proving real data was reloaded
  // from the mock's bytes, not just a status label flip.
  const remainingCount = Number(
    await runQueryAndReadFirstCell(
      page,
      `SELECT COUNT(*) AS count FROM transactions WHERE description LIKE '${description}%';`
    )
  );
  expect(remainingCount).toBe(0);

  // Boot-time reconcile drift tolerance (reconcileOnOpen → in-sync when
  // only `version` drifted) is covered by unit tests in
  // cloudSyncService.test.ts: reloading here would hit the needs-unlock
  // gate (the SharedWorker loses the encryption key with the page), and
  // handleUnlockSubmitted's post-unlock reconcile would re-download the
  // archive anyway, so it can't observe the no-download path.
});
