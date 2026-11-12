import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { bootstrapDatabase, navigateToPage, runQueryAndReadFirstCell } from './helpers/bootstrap';
import {
  addStatementFiles,
  chooseImportAccount,
  closeImport,
  confirmReadingSettings,
  importStatementFile,
  nextWizardStep,
  openImportWizard,
  readImportResult,
  runImport,
  startImport,
} from './helpers/importFlow';

// The Import page's "History & formats" view: import history with undo, saved
// formats, and what files call each account.
//
// The fixture has three rows dated 2030-01-15..17 (two charges, one paycheck)
// whose account column says "9999". No sample account has that number, so the
// import asks which account the file is for and remembers the answer.
const SAMPLE_IMPORT_CSV_PATH = path.join(__dirname, 'fixtures', 'sample-import.csv');
const ACCOUNT_NAME = 'Household Checking';

const IMPORTED_ROWS_SQL = "SELECT COUNT(*) FROM transactions WHERE description LIKE 'Playwright CSV Import %'";
// Every transaction and what they add up to: what the dashboard totals are built from.
const LEDGER_SQL = "SELECT COUNT(*) || ' rows, ' || printf('%.2f', TOTAL(amount)) FROM transactions";

/** Import page → "History & formats". */
async function openHistoryAndFormats(page: Page) {
  await navigateToPage(page, 'import');
  await page.getByTestId('import-view-manage').click();
  await expect(page.getByTestId('import-manage')).toBeVisible();
}

/** Walks a file that is not in a known format from the Files step to the Done step, all rows into one account. */
async function importThroughEveryStep(page: Page, filePath: string, accountName: string) {
  await addStatementFiles(page, filePath);
  expect(await startImport(page)).toBe('account');
  const values = await page.locator('[data-testid^="import-account-"][data-status]').count();
  for (let index = 0; index < values; index += 1) await chooseImportAccount(page, index, accountName);
  await nextWizardStep(page, 'layout');
  await confirmReadingSettings(page);
  await nextWizardStep(page, 'review');
  await nextWizardStep(page, 'summary');
  await runImport(page);
}

test('an import shows up in the history with its counts, and undoing it removes its transactions', async ({ page }) => {
  await bootstrapDatabase(page);
  const ledgerBefore = await runQueryAndReadFirstCell(page, LEDGER_SQL);

  await test.step('before any import the view explains itself and leads to the import', async () => {
    await openHistoryAndFormats(page);
    const empty = page.getByTestId('import-manage-empty');
    await expect(empty.getByRole('heading', { name: 'Nothing imported yet' })).toBeVisible();
    await empty.getByRole('button', { name: 'Start an import' }).click();
    await expect(page.getByTestId('import-view-wizard')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('import-wizard')).toHaveAttribute('data-step', 'files');
  });

  await test.step('"Undo" on the Done step opens the history with that import on top', async () => {
    await importThroughEveryStep(page, SAMPLE_IMPORT_CSV_PATH, ACCOUNT_NAME);
    expect(await readImportResult(page)).toEqual({ inserted: 3, duplicates: 0 });

    await page.getByTestId('import-undo').click();
    await expect(page.getByTestId('import-view-manage')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('import-history-row').first().getByTestId('import-history-file')).toHaveText(
      'sample-import.csv'
    );
  });

  const row = page.getByTestId('import-history-row').filter({ hasText: 'sample-import.csv' });

  await test.step('the history row says what the import did', async () => {
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId('import-history-accounts')).toHaveText(ACCOUNT_NAME);
    await expect(row.getByTestId('import-history-range')).toHaveText('Transactions from Jan 15, 2030 to Jan 17, 2030');
    await expect(row.getByTestId('import-history-count-imported')).toHaveText('3');
    await expect(row.getByTestId('import-history-count-duplicates')).toHaveText('0');
    await expect(row.getByTestId('import-history-count-skipped')).toHaveText('0');
    await expect(row.getByTestId('import-history-count-rejected')).toHaveText('0');
    // Read as a text file, with the format the import just saved.
    await expect(row.getByTestId('import-history-details')).toContainText('Text file (CSV) · Saved format:');
    // The fixture is dated 2030: the analysis said so about each row, in the catalog's own words.
    const findings = row.getByTestId('import-history-findings');
    await expect(findings).toContainText('3 rows are dated in the future');
    await expect(findings).not.toContainText('{{');
  });

  await test.step('the import left a saved format and the account number behind', async () => {
    await expect(page.getByTestId('import-format-row')).toHaveCount(1);
    await expect(page.getByTestId('import-format-account')).toHaveText(`Goes into: ${ACCOUNT_NAME}`);
    const group = page.getByTestId('import-identifier-group').filter({ hasText: ACCOUNT_NAME });
    await expect(group.getByTestId('import-identifier-text')).toHaveText('Number ending in 9999');
  });

  await test.step('the view fits a phone without scrolling sideways', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(row).toBeVisible();
    await expect(page.getByTestId('import-identifiers')).toBeVisible();
    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  await test.step('undo shows what will be removed, then removes it', async () => {
    await row.getByRole('button', { name: 'Undo this import' }).click();
    const dialog = page.getByRole('dialog', { name: 'Undo this import?' });
    await expect(dialog.getByTestId('import-undo-transactions')).toHaveText('3');
    await expect(dialog.getByTestId('import-undo-edited')).toHaveText('0');
    await expect(dialog.getByTestId('import-undo-loan-payments')).toHaveText('0');
    await expect(dialog.getByTestId('import-undo-transfer-pairs')).toHaveText('0');
    await expect(dialog.getByTestId('import-undo-irreversible')).toContainText('This cannot be reversed.');
    await dialog.getByTestId('import-undo-confirm').click();

    // The subscription rescan runs before the confirmation closes.
    await expect(page.getByTestId('import-manage-notice-undone')).toContainText(
      'The import of sample-import.csv was undone. Transactions removed: 3.'
    );
    await expect(dialog).toHaveCount(0);
    await expect(row).toHaveCount(0);
    await expect(page.getByTestId('import-history-empty')).toContainText('No imports yet.');
  });

  await closeImport(page);
  expect(await runQueryAndReadFirstCell(page, IMPORTED_ROWS_SQL)).toBe('0');
  expect(
    await runQueryAndReadFirstCell(page, "SELECT COUNT(*) FROM import_batches WHERE file_name = 'sample-import.csv'")
  ).toBe('0');
  // Nothing else moved: the ledger is what it was before the import.
  expect(await runQueryAndReadFirstCell(page, LEDGER_SQL)).toBe(ledgerBefore);
});

test('a deleted format and a removed account number are asked for again by the next import', async ({ page }) => {
  await bootstrapDatabase(page);
  expect(await importStatementFile(page, SAMPLE_IMPORT_CSV_PATH, { accountName: ACCOUNT_NAME })).toEqual({
    inserted: 3,
    duplicates: 0,
  });

  await openHistoryAndFormats(page);
  const historyDetails = page.getByTestId('import-history-row').getByTestId('import-history-details');

  await test.step('delete the saved format', async () => {
    const formats = page.getByTestId('import-format-row');
    await expect(formats).toHaveCount(1);
    await expect(formats.getByTestId('import-format-account')).toHaveText(`Goes into: ${ACCOUNT_NAME}`);
    await expect(historyDetails).toContainText('Saved format:');

    await formats.getByTestId('import-format-delete').click();
    const dialog = page.getByRole('dialog', { name: 'Delete this saved format?' });
    await expect(dialog).toContainText('The next time you import a file like this, the import will ask how to read it again.');
    await expect(dialog.getByTestId('import-format-delete-account')).toHaveText(`Goes into: ${ACCOUNT_NAME}`);
    await dialog.getByTestId('import-format-delete-confirm').click();

    await expect(formats).toHaveCount(0);
    await expect(page.getByTestId('import-formats-empty')).toContainText('No saved formats yet.');
    // The history keeps the import; it just no longer names a format.
    await expect(page.getByTestId('import-history-row')).toHaveCount(1);
    await expect(historyDetails).not.toContainText('Saved format:');
  });

  await test.step('remove the account number the file was recognised by', async () => {
    const group = page.getByTestId('import-identifier-group').filter({ hasText: ACCOUNT_NAME });
    const identifier = group.getByTestId('import-identifier-row').filter({ hasText: 'Number ending in 9999' });
    await expect(identifier).toHaveCount(1);

    await identifier.getByTestId('import-identifier-remove').click();
    const dialog = page.getByRole('dialog', { name: `Remove from ${ACCOUNT_NAME}?` });
    await expect(dialog).toContainText('The next file that uses it will ask which account it belongs to.');
    await dialog.getByTestId('import-identifier-remove-confirm').click();

    await expect(identifier).toHaveCount(0);
    await expect(page.getByTestId('import-identifiers-empty')).toContainText('Nothing remembered yet.');
  });

  await closeImport(page);
  expect(await runQueryAndReadFirstCell(page, 'SELECT COUNT(*) FROM import_profiles')).toBe('0');
  expect(await runQueryAndReadFirstCell(page, 'SELECT COUNT(*) FROM account_identifiers')).toBe('0');

  await test.step('the next import of the same file is set up from scratch', async () => {
    await openImportWizard(page);
    await addStatementFiles(page, SAMPLE_IMPORT_CSV_PATH);
    // Not "Same format as last time" any more.
    await expect(page.getByTestId('import-file-saved-format')).toHaveCount(0);
    await expect(page.getByTestId('import-file-card')).toContainText('New format');

    // No shortcut to the Summary, and nothing known about "9999": the account is asked for.
    expect(await startImport(page)).toBe('account');
    await expect(page.getByTestId('import-account-0')).toHaveAttribute('data-status', 'open');
    await expect(page.getByTestId('import-next')).toBeDisabled();
    await chooseImportAccount(page, 0, ACCOUNT_NAME);

    // And how to read the file is asked again, instead of coming from a saved format.
    await nextWizardStep(page, 'layout');
    await expect(page.getByTestId('import-layout-saved')).toHaveCount(0);
    await expect(page.getByTestId('import-setting-amountSign')).toHaveAttribute('data-pending', 'true');
    await expect(page.getByTestId('import-next')).toBeDisabled();

    await closeImport(page, { discard: true });
  });

  // Looking was all that happened: the three rows of the first import are still the only ones.
  expect(await runQueryAndReadFirstCell(page, IMPORTED_ROWS_SQL)).toBe('3');
  expect(await runQueryAndReadFirstCell(page, 'SELECT COUNT(*) FROM import_profiles')).toBe('0');
});
