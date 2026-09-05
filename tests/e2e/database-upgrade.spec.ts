import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import {
  TEST_PASSWORD,
  runQueryAndReadFirstCell,
  seedBrowserCompatibility,
} from './helpers/bootstrap';

// An encrypted export taken from the schema-version-1 build (sample data plus a
// completed subscription scan), password TEST_PASSWORD. Regenerate with a
// one-off Playwright run against the pre-migration build whenever a new
// baseline is needed; do not edit by hand.
const V1_ARCHIVE_PATH = path.join(__dirname, 'fixtures', 'v1-budget-tracker.zip');

async function loadArchiveAndUnlock(page: Page) {
  await seedBrowserCompatibility(page);
  await page.goto('/');

  const loadButton = page.getByRole('button', { name: 'Load from File' });
  await expect(loadButton).toBeVisible({ timeout: 60_000 });

  // The app opens a native file picker from a detached input element, so
  // intercept the file chooser rather than looking for an input in the DOM.
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10_000 }),
    loadButton.click(),
  ]);
  await fileChooser.setFiles(V1_ARCHIVE_PATH);

  await expect(page.getByText('Enter Password')).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();

  await expect(page.getByRole('button', { name: 'SQL Query' })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('database-status-text')).toHaveText('Connected', {
    timeout: 120_000,
  });
}

test('@smoke upgrades a schema v1 archive to the current schema without losing rows', async ({ page }) => {
  await loadArchiveAndUnlock(page);

  // Opening an older database runs the pending migrations before the app
  // reports Connected, so the version is already current here.
  expect(await runQueryAndReadFirstCell(page, 'SELECT user_version FROM pragma_user_version')).toBe('2');

  // Rebuilt tables carry the new columns...
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM pragma_table_info('transactions') WHERE name IN ('is_excluded', 'is_flagged', 'type_locked', 'transfer_group_id', 'external_id', 'import_batch_id')"
    )
  ).toBe('6');
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM pragma_table_info('accounts') WHERE name IN ('ownership', 'institution', 'opening_balance', 'opening_balance_date', 'credit_limit', 'is_active', 'include_in_net_worth', 'import_sign_inverted')"
    )
  ).toBe('8');

  // ...and every row survived the rebuild with a version-2 (SHA-256) hash.
  const transactionCount = Number(
    await runQueryAndReadFirstCell(page, 'SELECT COUNT(*) FROM transactions')
  );
  expect(transactionCount).toBeGreaterThan(0);
  expect(
    await runQueryAndReadFirstCell(
      page,
      'SELECT COUNT(*) FROM transactions WHERE transaction_hash IS NULL OR length(transaction_hash) != 64'
    )
  ).toBe('0');

  // Dropping the old transactions table must not cascade-delete the series
  // links that reference it (foreign keys are switched off for the rebuild).
  expect(
    Number(await runQueryAndReadFirstCell(page, 'SELECT COUNT(*) FROM transaction_series_links'))
  ).toBeGreaterThan(0);
  expect(
    await runQueryAndReadFirstCell(
      page,
      'SELECT COUNT(*) FROM transaction_series_links l LEFT JOIN transactions t ON t.id = l.transaction_id WHERE t.id IS NULL'
    )
  ).toBe('0');

  // "joint" stops being an account type and becomes an ownership.
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM accounts WHERE ownership = 'joint' AND type = 'checking'"
    )
  ).toBe('1');
  expect(
    await runQueryAndReadFirstCell(page, "SELECT COUNT(*) FROM accounts WHERE type = 'joint'")
  ).toBe('0');

  // Tables that version 1 forgot to migrate, plus the new version-2 tables.
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('budget_plans', 'budget_plan_categories', 'income_sources', 'import_batches', 'account_balance_snapshots')"
    )
  ).toBe('5');

  // Column additions on tables that were not rebuilt.
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM pragma_table_info('income_sources') WHERE name IN ('deposit_account_id', 'match_pattern')"
    )
  ).toBe('2');
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM pragma_table_info('merchant_rules') WHERE name = 'default_category_id'"
    )
  ).toBe('1');
});
