import path from 'node:path';

import { expect, test } from '@playwright/test';

import { bootstrapDatabase } from './helpers/bootstrap';

const SAMPLE_IMPORT_CSV_PATH = path.join(__dirname, 'fixtures', 'sample-import.csv');
const DIRECT_ACCOUNT_NAME = 'Household Checking';

test('@smoke imports a CSV file and resets the dialog state on reopen', async ({ page }) => {
  await bootstrapDatabase(page);

  await page.getByRole('button', { name: 'Import CSV' }).click();

  const dialog = page.getByRole('dialog', { name: 'Import Transactions from CSV' });
  await expect(dialog).toBeVisible();

  await dialog.locator('input[type="file"]').setInputFiles(SAMPLE_IMPORT_CSV_PATH);

  // The fixture's "Account" header doesn't satisfy autoDetectColumnMapping's
  // account+number regex, so map it directly to a real account instead.
  // This Select isn't wired with a labelId/InputLabel id pairing, so its
  // accessible name is blank — neither getByRole('combobox', { name }) nor
  // getByLabel resolves it. Scope by the containing FormControl instead.
  const accountColumnControl = dialog
    .locator('.MuiFormControl-root')
    .filter({ hasText: 'Account Number Column' });
  await accountColumnControl.locator('[aria-haspopup="listbox"]').click();
  await page.getByRole('option', { name: new RegExp(DIRECT_ACCOUNT_NAME, 'i') }).click();

  // Date/Amount/Description all auto-detect from the fixture's headers.
  // Exact match: the (disabled) Import button's placeholder label is
  // "Analyze File First", which also contains the substring "Analyze File".
  await dialog.getByRole('button', { name: 'Analyze File', exact: true }).click();
  await expect(dialog.getByText('Analysis Complete:')).toBeVisible({ timeout: 30_000 });

  await dialog.getByRole('button', { name: /^Import \d+ Transactions?$/ }).click();

  // Dashboard's onSuccess handler closes the dialog directly
  // (setCsvImportOpen(false)) without routing through CSVImport's own
  // handleClose, which is what made the stale-state bug possible. Import
  // also triggers a subscription rescan before closing, so give it room.
  await expect(dialog).not.toBeVisible({ timeout: 120_000 });

  // Reopening must show a fresh dialog, not the just-closed import result —
  // this is the bug the resetImportState-on-open effect guards against.
  await page.getByRole('button', { name: 'Import CSV' }).click();
  const reopenedDialog = page.getByRole('dialog', { name: 'Import Transactions from CSV' });
  await expect(reopenedDialog).toBeVisible();
  await expect(reopenedDialog.getByRole('button', { name: 'Choose CSV File' })).toBeVisible();
  await expect(reopenedDialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(reopenedDialog.getByText(/Import completed:/)).not.toBeVisible();
});
