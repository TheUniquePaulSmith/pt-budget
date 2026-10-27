/**
 * E2E tests for the debug-only Reset App control (Settings → Developer).
 *
 * Reset App must end the shared database worker itself — not just this tab's
 * connection to it — so the reloaded app never reconnects to a worker that
 * still holds the old decryption key and open IndexedDB handles.
 */

import { expect, test, type Page } from '@playwright/test';

import {
  bootstrapDatabase,
  fillDatabaseSetupForm,
  navigateToPage,
  runQueryAndReadFirstCell,
  TEST_PRIMARY_USER_NAME,
} from './helpers/bootstrap';

const FIRST_PASSWORD = 'ResetFirst99!';
const SECOND_PASSWORD = 'ResetSecond99!';

async function resetFromDeveloperSettings(page: Page) {
  await navigateToPage(page, 'settings');
  await page.getByRole('tab', { name: 'Developer' }).click();
  await page.getByRole('button', { name: 'Reset App' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reset App' }).click();
}

async function lockFromSettings(page: Page) {
  await navigateToPage(page, 'settings');
  await page.getByRole('tab', { name: 'Security' }).click();
  await page.getByRole('button', { name: 'Lock Database' }).click();
  await expect(page.getByText('Enter Password')).toBeVisible({ timeout: 30_000 });
}

test('Reset App on the lock screen needs the correct database password', async ({ page }) => {
  await bootstrapDatabase(page, {
    loadSampleData: false,
    password: FIRST_PASSWORD,
    extraQueryParams: 'debug=true',
  });
  await lockFromSettings(page);

  // A wrong password is refused, in the dialog, and nothing is touched.
  await page.getByRole('button', { name: 'Reset App' }).click();
  const dialog = page.getByRole('dialog');
  const confirm = dialog.getByRole('button', { name: 'Reset App' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Database password').fill('NotThePassword1!');
  await confirm.click();
  await expect(dialog.getByText('Incorrect password')).toBeVisible();
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();

  // The database survived: the real password still unlocks it, data intact.
  await page.getByLabel('Password', { exact: true }).fill(FIRST_PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByTestId('database-status-text')).toHaveText('Connected', { timeout: 60_000 });
  const primaryUser = await runQueryAndReadFirstCell(
    page,
    `SELECT display_name FROM users WHERE is_primary = 1;`
  );
  expect(primaryUser).toBe(TEST_PRIMARY_USER_NAME);

  // The correct password resets it.
  await lockFromSettings(page);
  await page.getByRole('button', { name: 'Reset App' }).click();
  await dialog.getByLabel('Database password').fill(FIRST_PASSWORD);
  await dialog.getByRole('button', { name: 'Reset App' }).click();

  await expect(page.getByRole('button', { name: 'Create New Database' })).toBeVisible({
    timeout: 60_000,
  });
});

test('Reset App terminates the shared worker for every tab and comes back as a fresh install', async ({
  page,
  context,
}) => {
  await bootstrapDatabase(page, {
    loadSampleData: false,
    password: FIRST_PASSWORD,
    extraQueryParams: 'debug=true',
  });

  // A second tab on the same SharedWorker. Before this change it kept the
  // worker — and its key and storage handles — alive across the reset.
  const otherTab = await context.newPage();
  await bootstrapDatabase(otherTab, { loadSampleData: false, extraQueryParams: 'debug=true' });
  await expect(otherTab.getByTestId('database-status-text')).toHaveText('Connected');

  await resetFromDeveloperSettings(page);

  // The worker told the other tab it was gone at once; the heartbeat
  // fallback would take 15s, so a shorter timeout proves the broadcast.
  await expect(otherTab.getByTestId('database-status-text')).toHaveText('Disconnected', {
    timeout: 10_000,
  });

  // The reloaded tab starts a brand-new worker with no database and no key.
  await expect(page.getByRole('button', { name: 'Create New Database' })).toBeVisible({
    timeout: 60_000,
  });
  const leftovers = await page.evaluate(async () => {
    const names = (await indexedDB.databases()).map((database) => database.name);
    return names.filter((name) => name === 'ptbudgetapp-keys');
  });
  expect(leftovers).toEqual([]);

  // And it is usable: a new database under a different password.
  await page.getByRole('button', { name: 'Create New Database' }).click();
  await fillDatabaseSetupForm(page, { password: SECOND_PASSWORD, primaryUserName: 'AfterReset' });
  await page.getByRole('button', { name: 'Create Database' }).click();
  await page.getByTestId('skip-initial-account').click();
  await page.getByTestId('storage-choice-local').click();

  await expect(page.getByTestId('database-status-text')).toHaveText('Connected', { timeout: 60_000 });
  const primaryUser = await runQueryAndReadFirstCell(
    page,
    `SELECT display_name FROM users WHERE is_primary = 1;`
  );
  expect(primaryUser).toBe('AfterReset');
});
