import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { bootstrapDatabase, navigateToPage, runQueryAndReadFirstCell } from './helpers/bootstrap';

const SAMPLE_IMPORT_CSV_PATH = path.join(__dirname, 'fixtures', 'sample-import.csv');
const UNKNOWN_ACCOUNTS_CSV_PATH = path.join(__dirname, 'fixtures', 'sample-import-unknown-accounts.csv');
const DIRECT_ACCOUNT_NAME = 'Household Checking';

async function openImportDialog(page: Page) {
  await page.getByRole('button', { name: 'Import CSV' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import Transactions from CSV' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('@smoke imports a CSV file and resets the dialog state on reopen', async ({ page }) => {
  await bootstrapDatabase(page);

  const dialog = await openImportDialog(page);

  await dialog.locator('input[type="file"]').setInputFiles(SAMPLE_IMPORT_CSV_PATH);

  // The fixture's "Account" header doesn't satisfy autoDetectColumnMapping's
  // account+number regex, so map it directly to a real account instead.
  await dialog.getByTestId('csv-account-column-select').click();
  await page.getByRole('option', { name: new RegExp(DIRECT_ACCOUNT_NAME, 'i') }).click();

  // Date/Amount/Description all auto-detect from the fixture's headers.
  // Exact match: the (disabled) Import button's placeholder label is
  // "Analyze File First", which also contains the substring "Analyze File".
  await dialog.getByRole('button', { name: 'Analyze File', exact: true }).click();
  await expect(dialog.getByText('Analysis Complete:')).toBeVisible({ timeout: 30_000 });

  await dialog.getByRole('button', { name: /^Import \d+ Transactions?$/ }).click();

  // The result summary stays on screen until the user dismisses it; only then
  // does the parent learn about the success and close the dialog. Import also
  // triggers a subscription rescan before the summary shows, so give it room.
  const result = dialog.getByTestId('csv-import-result');
  await expect(result).toBeVisible({ timeout: 120_000 });
  await expect(result).toContainText('Import completed');
  await expect(dialog.getByTestId('csv-import-result-inserted')).toHaveText(/Imported: 3/);
  await expect(dialog.getByTestId('csv-import-result-duplicates')).toHaveText(/duplicates\): 0/);
  await expect(dialog.getByTestId('csv-import-result-skipped')).toHaveText(/accounts\): 0/);
  await expect(dialog.getByTestId('csv-import-result-rejected')).toHaveText(/read\): 0/);

  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).not.toBeVisible();

  // Reopening must show a fresh dialog, not the just-closed import result —
  // this is the bug the resetImportState-on-open effect guards against.
  const reopenedDialog = await openImportDialog(page);
  await expect(reopenedDialog.getByRole('button', { name: 'Choose CSV File' })).toBeVisible();
  await expect(reopenedDialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(reopenedDialog.getByText(/Import completed/)).not.toBeVisible();
});

test('creates an account (and a person) for an unknown CSV account number and skips another', async ({ page }) => {
  await bootstrapDatabase(page);

  const dialog = await openImportDialog(page);
  await dialog.locator('input[type="file"]').setInputFiles(UNKNOWN_ACCOUNTS_CSV_PATH);

  // "Account Number" auto-detects, so the per-value mapping appears at once.
  // Neither 8801 nor 7702 matches a sample-data card, so both default to
  // "Create new account…" and nothing can be analyzed yet.
  const firstRow = dialog.getByTestId('csv-account-mapping-0');
  const secondRow = dialog.getByTestId('csv-account-mapping-1');
  await expect(firstRow).toContainText('CSV Account:8801');
  await expect(secondRow).toContainText('CSV Account:7702');
  await expect(dialog.getByTestId('csv-account-mapping-0-select')).toHaveText('Create new account…');
  await expect(dialog.getByTestId('csv-account-mapping-1-select')).toHaveText('Create new account…');

  const summary = dialog.getByTestId('csv-account-resolution-summary');
  await expect(summary).toContainText('0 of 3 rows will be imported');
  await expect(summary).toContainText('2 CSV accounts are not linked yet (3 rows)');
  await expect(dialog.getByRole('button', { name: 'Analyze File', exact: true })).toBeDisabled();

  // Create the account for 8801 from inside the import, owned by a new person.
  await dialog.getByTestId('csv-account-mapping-0-select').click();
  await page.getByRole('option', { name: 'Create new account…' }).click();

  const accountDialog = page.getByRole('dialog', { name: 'Add New Account' });
  await expect(accountDialog).toBeVisible();
  await expect(accountDialog.getByLabel(/Card \/ Account Number/)).toHaveValue('8801');

  // The Owner select is the first combobox of the add form (the shared field
  // set does not wire a labelId, so it has no accessible name).
  await accountDialog.getByRole('combobox').first().click();
  await page.getByRole('option', { name: '+ New person…' }).click();

  const personDialog = page.getByRole('dialog', { name: 'Add New User' });
  await expect(personDialog).toBeVisible();
  await personDialog.getByLabel('Display Name').fill('Import Person');
  await personDialog.getByRole('button', { name: 'Add' }).click();
  await expect(personDialog).not.toBeVisible();
  await expect(accountDialog.getByRole('combobox').first()).toHaveText('Import Person');

  await accountDialog.getByLabel(/Account Name/).fill('Imported Checking');
  await accountDialog.getByRole('button', { name: 'Add' }).click();
  await expect(accountDialog).not.toBeVisible({ timeout: 30_000 });

  // The new account is linked to 8801 and survives the accounts refresh.
  await expect(dialog.getByTestId('csv-account-mapping-0-select')).toContainText('Imported Checking', { timeout: 30_000 });
  await expect(summary).toContainText('2 of 3 rows will be imported');

  // Skip 7702 explicitly: its single row is accounted for before Analyze.
  await dialog.getByTestId('csv-account-mapping-1-select').click();
  await page.getByRole('option', { name: 'Skip this account' }).click();
  await expect(dialog.getByTestId('csv-account-mapping-1-select')).toHaveText('Skip this account');
  await expect(summary).toContainText('2 of 3 rows will be imported · 1 row will be skipped (7702)');

  await dialog.getByRole('button', { name: 'Analyze File', exact: true }).click();
  await expect(dialog.getByText('Analysis Complete:')).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText('Skipped (unmapped accounts): 1')).toBeVisible();

  await dialog.getByRole('button', { name: 'Import 2 Transactions' }).click();
  const result = dialog.getByTestId('csv-import-result');
  await expect(result).toBeVisible({ timeout: 120_000 });
  await expect(dialog.getByTestId('csv-import-result-inserted')).toHaveText(/Imported: 2/);
  await expect(dialog.getByTestId('csv-import-result-skipped')).toHaveText(/accounts\): 1/);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).not.toBeVisible();

  // Rows landed on the new account, which belongs to the new person.
  const rowCount = await runQueryAndReadFirstCell(
    page,
    "SELECT COUNT(*) FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.name = 'Imported Checking'"
  );
  expect(rowCount).toBe('2');
  const owner = await runQueryAndReadFirstCell(
    page,
    "SELECT u.display_name FROM accounts a JOIN users u ON u.id = a.owner_user_id WHERE a.name = 'Imported Checking'"
  );
  expect(owner).toBe('Import Person');
  const skippedCount = await runQueryAndReadFirstCell(
    page,
    "SELECT COUNT(*) FROM transactions WHERE description = 'Playwright Unknown Account Skipped Row'"
  );
  expect(skippedCount).toBe('0');

  // And the Accounts page lists it under its owner. The current page groups
  // accounts in one collapsed accordion per person; expand it when present
  // (a redesigned page that shows account names directly needs no click).
  await navigateToPage(page, 'accounts');
  const accountName = page.getByText('Imported Checking').first();
  await expect(accountName).toBeAttached({ timeout: 30_000 });
  if (!(await accountName.isVisible())) {
    await page.getByRole('button', { name: /Import Person/ }).first().click();
  }
  await expect(accountName).toBeVisible({ timeout: 30_000 });
});

test('offers "New account…" in the static account mapping and imports everything into it', async ({ page }) => {
  await bootstrapDatabase(page);

  const dialog = await openImportDialog(page);
  await dialog.locator('input[type="file"]').setInputFiles(SAMPLE_IMPORT_CSV_PATH);

  await dialog.getByTestId('csv-account-column-select').click();
  await page.getByRole('option', { name: 'New account…' }).click();

  const accountDialog = page.getByRole('dialog', { name: 'Add New Account' });
  await expect(accountDialog).toBeVisible();
  await accountDialog.getByRole('combobox').first().click();
  await page.getByRole('option', { name: 'TestUser' }).click();
  await accountDialog.getByLabel(/Account Name/).fill('Static Import Savings');
  await accountDialog.getByLabel(/Card \/ Account Number/).fill('4455');
  await accountDialog.getByRole('button', { name: 'Add' }).click();
  await expect(accountDialog).not.toBeVisible({ timeout: 30_000 });

  await expect(dialog.getByText(/All transactions will be imported to:/)).toContainText('Static Import Savings');
  await expect(dialog.getByTestId('csv-account-column-select')).toContainText('Static Import Savings');

  await dialog.getByRole('button', { name: 'Analyze File', exact: true }).click();
  await expect(dialog.getByText('Analysis Complete:')).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole('button', { name: 'Import 3 Transactions' }).click();
  await expect(dialog.getByTestId('csv-import-result-inserted')).toHaveText(/Imported: 3/, { timeout: 120_000 });
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).not.toBeVisible();

  const rowCount = await runQueryAndReadFirstCell(
    page,
    "SELECT COUNT(*) FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.name = 'Static Import Savings'"
  );
  expect(rowCount).toBe('3');
});
