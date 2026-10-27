import fs from 'node:fs';
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
// Same procedure from the schema-version-2 build (devel/latest at 75f6835):
// sample data plus a completed subscription scan, password TEST_PASSWORD.
const V2_ARCHIVE_PATH = path.join(__dirname, 'fixtures', 'v2-budget-tracker.zip');

async function loadArchiveAndUnlock(page: Page, archivePath: string = V1_ARCHIVE_PATH) {
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
  await fileChooser.setFiles(archivePath);

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
  expect(await runQueryAndReadFirstCell(page, 'SELECT user_version FROM pragma_user_version')).toBe('4');

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

  // Version 3: notification and AI tool tables, plus nullable/defaulted
  // columns on tables that version 2 had already created fresh.
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('notifications', 'notification_settings', 'ai_tool_packs', 'ai_tool_settings')"
    )
  ).toBe('4');
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM pragma_table_info('recurring_series') WHERE name IN ('is_autopay', 'due_day')"
    )
  ).toBe('2');
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM pragma_table_info('budget_plan_categories') WHERE name IN ('carry_mode', 'carry_reset')"
    )
  ).toBe('2');
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name IN ('budget_category_id', 'monthly_contribution', 'contribution_start_month')"
    )
  ).toBe('3');
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM pragma_table_info('trips') WHERE name IN ('budget_category_id', 'monthly_contribution', 'contribution_start_month')"
    )
  ).toBe('3');
  // Existing series default to "not autopay" so payment reminders can start from them.
  expect(
    await runQueryAndReadFirstCell(page, 'SELECT COUNT(*) FROM recurring_series WHERE is_autopay != 0')
  ).toBe('0');
  // The v3 indexes exist after the post-migration ensureIndexes pass.
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name IN ('idx_notifications_status_due', 'idx_recurring_series_autopay')"
    )
  ).toBe('2');

  // Version 4: transaction classification. The rules table exists, every row
  // carries a type provenance (hand-picked types were backfilled as manual) and
  // the staging table was recreated with the classification columns.
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'classification_rules'"
    )
  ).toBe('1');
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM pragma_table_info('transactions') WHERE name IN ('type_source', 'type_confidence')"
    )
  ).toBe('2');
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM pragma_table_info('temp_import_transactions') WHERE name IN ('transfer_group_id', 'type_source', 'type_confidence')"
    )
  ).toBe('3');
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM transactions WHERE type_locked = 1 AND type_source != 'manual'"
    )
  ).toBe('0');
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name IN ('idx_transactions_type_review', 'idx_classification_rules_enabled')"
    )
  ).toBe('2');
});

test('upgrades a schema v2 archive to the current version, keeping rows and adding only the v3 and v4 changes', async ({ page }) => {
  test.skip(!fs.existsSync(V2_ARCHIVE_PATH), 'v2 baseline archive not captured (see tests/e2e-tools)');
  await loadArchiveAndUnlock(page, V2_ARCHIVE_PATH);

  expect(await runQueryAndReadFirstCell(page, 'SELECT user_version FROM pragma_user_version')).toBe('4');

  // Rows survive: the v2 archive carries transactions, series and links.
  expect(Number(await runQueryAndReadFirstCell(page, 'SELECT COUNT(*) FROM transactions'))).toBeGreaterThan(0);
  expect(Number(await runQueryAndReadFirstCell(page, 'SELECT COUNT(*) FROM recurring_series'))).toBeGreaterThan(0);
  expect(
    Number(await runQueryAndReadFirstCell(page, 'SELECT COUNT(*) FROM transaction_series_links'))
  ).toBeGreaterThan(0);
  expect(
    await runQueryAndReadFirstCell(
      page,
      'SELECT COUNT(*) FROM transaction_series_links l LEFT JOIN transactions t ON t.id = l.transaction_id WHERE t.id IS NULL'
    )
  ).toBe('0');
  // Versions 3 and 4 do not rehash: every row keeps the hash the archive carried.
  // (The baseline was exported from sample fixtures, so hash length is not asserted here.)
  expect(
    await runQueryAndReadFirstCell(page, 'SELECT COUNT(*) FROM transactions WHERE transaction_hash IS NULL')
  ).toBe('0');

  // v3 additions on a database whose v2 tables were created by the v2 migration
  // itself (CREATE TABLE IF NOT EXISTS must be a no-op for them here).
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('notifications', 'notification_settings', 'ai_tool_packs', 'ai_tool_settings')"
    )
  ).toBe('4');
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM pragma_table_info('recurring_series') WHERE name IN ('is_autopay', 'due_day')"
    )
  ).toBe('2');
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM pragma_table_info('budget_plan_categories') WHERE name IN ('carry_mode', 'carry_reset')"
    )
  ).toBe('2');
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name IN ('budget_category_id', 'monthly_contribution', 'contribution_start_month')"
    )
  ).toBe('3');
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM pragma_table_info('trips') WHERE name IN ('budget_category_id', 'monthly_contribution', 'contribution_start_month')"
    )
  ).toBe('3');
  // Legacy plan categories default to no carry-over.
  expect(
    await runQueryAndReadFirstCell(page, "SELECT COUNT(*) FROM budget_plan_categories WHERE carry_mode != 'none' OR carry_reset != 0")
  ).toBe('0');
  // Nothing was notified yet.
  expect(await runQueryAndReadFirstCell(page, 'SELECT COUNT(*) FROM notifications')).toBe('0');

  // Version 4: transaction classification. The rules table exists, every row
  // carries a type provenance (hand-picked types were backfilled as manual) and
  // the staging table was recreated with the classification columns.
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'classification_rules'"
    )
  ).toBe('1');
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM pragma_table_info('transactions') WHERE name IN ('type_source', 'type_confidence')"
    )
  ).toBe('2');
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM pragma_table_info('temp_import_transactions') WHERE name IN ('transfer_group_id', 'type_source', 'type_confidence')"
    )
  ).toBe('3');
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM transactions WHERE type_locked = 1 AND type_source != 'manual'"
    )
  ).toBe('0');
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name IN ('idx_transactions_type_review', 'idx_classification_rules_enabled')"
    )
  ).toBe('2');
});
