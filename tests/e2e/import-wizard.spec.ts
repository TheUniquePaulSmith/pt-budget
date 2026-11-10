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
  waitForWizardStep,
} from './helpers/importFlow';

// The guided import (Import page → Files, Account, Check how we read it,
// Things to check, Summary, Done). Fixtures are synthetic; the account numbers
// are sample-data card numbers (the Parker household).
const fixture = (name: string) => path.join(__dirname, 'fixtures', name);
const SAMPLE_CSV = fixture('sample-import.csv');
// Same header as sample-import.csv: its three rows again plus two new ones.
const REPEAT_CSV = fixture('sample-import-repeat.csv');
// A card export: the Visa's last four in an account column, charges printed as positive numbers.
const CARD_CSV = fixture('sample-import-card.csv');
const BAD_ROWS_CSV = fixture('sample-import-bad-rows.csv');
const DEBIT_CREDIT_CSV = fixture('sample-import-debit-credit.csv');
// The header of sample-import.csv again, but a card's rows: its last four, charges as positive numbers.
const CARD_SAME_HEADER_CSV = fixture('sample-import-card-same-header.csv');
const UNKNOWN_ACCOUNTS_CSV = fixture('sample-import-unknown-accounts.csv');
const OFX_FILE = fixture('sample-import.ofx');
const CHECKING = 'Household Checking';

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test('@smoke imports a card file: the assumed account is confirmed and positive charges become spending', async ({ page }) => {
  await bootstrapDatabase(page);

  // The rail's quick action opens the full-screen Import page.
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeVisible();
  await openImportWizard(page);
  await expect(page.getByRole('heading', { name: 'Import transactions' })).toBeVisible();

  // Files: the card says what was recognised.
  await addStatementFiles(page, CARD_CSV);
  const fileCard = page.getByTestId('import-file-card');
  await expect(fileCard).toContainText('sample-import-card.csv');
  await expect(fileCard.getByTestId('import-file-rows')).toHaveText('3 rows');
  await expect(fileCard).toContainText('New format');

  // Account: 9034 is only the last four of the Rewards Visa card, so it is an
  // assumption, shown with its reason, that waits for a yes.
  expect(await startImport(page)).toBe('account');
  const account = page.getByTestId('import-account-0');
  await expect(account).toHaveAttribute('data-status', 'assumed');
  await expect(account).toContainText('In the file: 9034');
  await expect(account.locator('[data-issue-code="accountAssumedByLastFour"]')).toBeVisible();
  await expect(page.getByTestId('import-account-0-select')).toContainText('Rewards Visa');
  await expect(page.getByTestId('import-next')).toBeDisabled();
  await page.getByTestId('import-account-0-confirm').click();
  await nextWizardStep(page, 'layout');

  // Check how we read it: the sign is confirmed with a worded example. This
  // bank prints a charge as a positive number, so the reading must be "money out".
  const signExample = page.getByTestId('import-sign-example');
  await expect(signExample).toContainText('Playwright Card Coffee');
  await expect(page.getByTestId('import-setting-amountSign')).toHaveAttribute('data-pending', 'true');
  await expect(page.getByTestId('import-next')).toBeDisabled();
  if ((await signExample.textContent())?.includes('is read as money in: you received $25.40')) {
    await page.getByTestId('import-flip-sign').click();
  } else {
    await page.getByTestId('import-confirm-amountSign').click();
  }
  await expect(signExample).toContainText('“Playwright Card Coffee” (25.40) is read as money out: you paid $25.40.');
  await expect(page.getByTestId('import-setting-amountSign')).toHaveAttribute('data-pending', 'false');
  await confirmReadingSettings(page);
  // The preview shows the rows as they will be imported.
  const firstRow = page.getByTestId('import-interpreted-row').first();
  await expect(firstRow).toContainText('Mar 1, 2030');
  await expect(firstRow).toContainText('$25.40');

  await nextWizardStep(page, 'review');
  await expect(page.getByTestId('import-review-status')).toHaveAttribute('data-blocked', 'false');

  await nextWizardStep(page, 'summary');
  await expect(page.getByTestId('import-summary-accounts')).toContainText('Rewards Visa');
  await expect(page.getByTestId('import-summary-money-out')).toHaveText(/\$86\.55/);
  await expect(page.getByTestId('import-remember')).toBeChecked();
  await expect(page.getByTestId('import-run')).toHaveText('Import 3 transactions', { timeout: 30_000 });

  await runImport(page);
  await expect(page.getByTestId('import-result-0')).toContainText('3 transactions imported');
  await page.getByTestId('import-view-transactions').click();
  await expect(page.getByTestId('import-page')).toBeHidden();
  await expect(page.getByTestId('app-bar-title')).toHaveText('Transactions');

  // The charge is spending on the card, in one import batch that knows its format.
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT printf('%.2f', t.amount) || ':' || t.type || ':' || a.name FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.description = 'Playwright Card Coffee'"
    )
  ).toBe('-25.40:expense:Rewards Visa');
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT b.file_format || ':' || b.inserted_count || ':' || (b.profile_id IS NOT NULL) FROM import_batches b WHERE b.file_name = 'sample-import-card.csv'"
    )
  ).toBe('delimited:3:1');
  // Confirming the account remembered what the file calls it; the saved format carries the sign.
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT i.kind || ':' || i.value || ':' || a.name FROM account_identifiers i JOIN accounts a ON a.id = i.account_id WHERE i.source = 'import'"
    )
  ).toBe('number:9034:Rewards Visa');
  expect(
    await runQueryAndReadFirstCell(page, "SELECT COUNT(*) || ':' || MAX(json_extract(config_json, '$.layout.amountSign')) FROM import_profiles")
  ).toBe('1:inverted');
});

test('takes a file in a known format straight to the summary, with the details one click away', async ({ page }) => {
  await bootstrapDatabase(page);
  expect(await importStatementFile(page, SAMPLE_CSV, { accountName: CHECKING })).toEqual({ inserted: 3, duplicates: 0 });

  // The same bank's next export: two clicks from the file to the import.
  await openImportWizard(page);
  await addStatementFiles(page, REPEAT_CSV);
  await expect(page.getByTestId('import-file-saved-format')).toContainText('Same format as last time');
  expect(await startImport(page)).toBe('summary');
  await expect(page.getByTestId('import-fast-path')).toContainText('Same format as last time');
  await expect(page.getByTestId('import-summary-accounts')).toContainText(CHECKING);
  await expect(page.getByTestId('import-summary-total')).toHaveText(/5$/);
  await expect(page.getByTestId('import-summary-already')).toHaveText(/3$/, { timeout: 30_000 });
  await expect(page.getByTestId('import-run')).toHaveText('Import 2 transactions');
  await runImport(page);
  expect(await readImportResult(page)).toEqual({ inserted: 2, duplicates: 3 });
  await expect(page.getByTestId('import-result-0')).toContainText('3 rows were already imported and were left out');
  await closeImport(page);

  // The format was updated in place, and both imports point at it.
  expect(await runQueryAndReadFirstCell(page, 'SELECT COUNT(*) FROM import_profiles')).toBe('1');
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(DISTINCT b.id) || ':' || COUNT(DISTINCT b.profile_id) FROM import_batches b WHERE b.file_name LIKE 'sample-import%'"
    )
  ).toBe('2:1');

  // A third time there is nothing new, and the details are one click away.
  await openImportWizard(page);
  await addStatementFiles(page, REPEAT_CSV);
  expect(await startImport(page)).toBe('summary');
  await expect(page.getByTestId('import-nothing-new')).toContainText('All 5 rows in this file are already imported.', { timeout: 30_000 });
  await page.getByTestId('import-review-details').click();
  await waitForWizardStep(page, 'account');
  // Off the fast path the remembered account is shown as what it is: an assumption to confirm.
  await expect(page.getByTestId('import-account-0')).toHaveAttribute('data-status', 'assumed');
  await expect(page.getByTestId('import-account-0-select')).toContainText(CHECKING);
  await chooseImportAccount(page, 0, CHECKING);
  await nextWizardStep(page, 'layout');
  await expect(page.getByTestId('import-layout-saved')).toBeVisible();
  // A saved format was confirmed when it was saved: nothing is asked again.
  await expect(page.locator('[data-testid^="import-setting-"][data-pending="true"]')).toHaveCount(0);

  // Things to check says how the file lines up with what the account already has.
  await nextWizardStep(page, 'review');
  const coverage = page.getByTestId('import-review-coverage');
  await expect(coverage).toContainText('This account already has');
  await expect(coverage.locator('[data-testid="import-issue"][data-issue-code="overlapsExisting"]')).toContainText(
    'Part of this file is already in the account'
  );
  await page.getByTestId('import-back').click();
  await waitForWizardStep(page, 'layout');

  // Leaving with a file loaded asks first.
  await page.getByTestId('import-close').click();
  await expect(page.getByRole('dialog', { name: 'Discard this import?' })).toBeVisible();
  await page.getByTestId('import-leave-stay').click();
  await expect(page.getByTestId('import-wizard')).toHaveAttribute('data-step', 'layout');
  await closeImport(page, { discard: true });
  expect(await runQueryAndReadFirstCell(page, "SELECT COUNT(*) FROM transactions WHERE description LIKE 'Playwright CSV Import %'")).toBe('5');
});

test('keeps Import out of reach until unreadable rows are fixed or left out', async ({ page }) => {
  await bootstrapDatabase(page);
  await openImportWizard(page);
  await addStatementFiles(page, BAD_ROWS_CSV);
  expect(await startImport(page)).toBe('account');
  const values = await page.locator('[data-testid^="import-account-"][data-status]').count();
  for (let index = 0; index < values; index += 1) await chooseImportAccount(page, index, CHECKING);
  await nextWizardStep(page, 'layout');
  await confirmReadingSettings(page);
  await nextWizardStep(page, 'review');

  // April has no 31st and "abc" is not an amount: both rows block the import.
  await expect(page.getByTestId('import-review-status')).toHaveAttribute('data-blocked', 'true');
  const badDate = page.locator('[data-testid="import-issue"][data-issue-code="unreadableDate"]');
  const badAmount = page.locator('[data-testid="import-issue"][data-issue-code="unreadableAmount"]');
  await expect(badDate).toContainText('Playwright Bad Rows Bad Date');
  await expect(badDate).toContainText('2030-04-31');
  await expect(badAmount).toContainText('abc');
  await expect(page.getByTestId('import-next')).toBeDisabled();

  // Fix the date in place; the file itself is never rewritten.
  await badDate.getByTestId('import-row-fix').click();
  await page.getByTestId('import-row-date').fill('2030-04-30');
  await page.getByTestId('import-row-save').click();
  await expect(badDate).toHaveCount(0);
  await expect(page.getByTestId('import-next')).toBeDisabled();

  // Leave the other row out.
  await badAmount.getByTestId('import-row-skip').click();
  await expect(page.getByTestId('import-review-status')).toHaveAttribute('data-blocked', 'false');
  const changes = page.getByTestId('import-review-changes');
  await expect(changes).toContainText('Line 3: fixed');
  await expect(changes).toContainText('Line 4: left out');

  await nextWizardStep(page, 'summary');
  await expect(page.getByTestId('import-summary-skipped')).toHaveText(/1$/);
  await expect(page.getByTestId('import-run')).toHaveText('Import 2 transactions', { timeout: 30_000 });
  await runImport(page);
  expect(await readImportResult(page)).toEqual({ inserted: 2, duplicates: 0 });
  await expect(page.getByTestId('import-result-0')).toContainText('1 row was left out');
  await closeImport(page);

  expect(await runQueryAndReadFirstCell(page, "SELECT date FROM transactions WHERE description = 'Playwright Bad Rows Bad Date'")).toBe(
    '2030-04-30'
  );
  expect(await runQueryAndReadFirstCell(page, "SELECT COUNT(*) FROM transactions WHERE description = 'Playwright Bad Rows Bad Amount'")).toBe('0');
  // The batch records what happened to every row and how many were fixed.
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT total_rows || ':' || inserted_count || ':' || skipped_count || ':' || json_extract(issues_json, '$.fixedRows') FROM import_batches WHERE file_name = 'sample-import-bad-rows.csv'"
    )
  ).toBe('3:2:1:1');
});

test('imports a file with separate money-out and money-in columns', async ({ page }) => {
  await bootstrapDatabase(page);
  await openImportWizard(page);
  await addStatementFiles(page, DEBIT_CREDIT_CSV);
  expect(await startImport(page)).toBe('account');
  await chooseImportAccount(page, 0, CHECKING);
  await nextWizardStep(page, 'layout');

  // The two money columns are worked out from the file, and the wizard says how.
  await expect(page.getByTestId('import-layout-missing')).toBeHidden();
  await expect(page.getByTestId('import-column-2-role')).toHaveText('Money out');
  await expect(page.getByTestId('import-column-3-role')).toHaveText('Money in');
  await expect(page.getByTestId('import-column-4-role')).toHaveText('Balance');
  await expect(page.locator('[data-testid="import-columns-reason"][data-assumption-code="debitCreditColumns"]')).toHaveText(
    'Money out is read from “Debit” and money in from “Credit”.'
  );
  // Two columns say which way the money went, the dates are year-first and the amounts have a
  // decimal point: there is nothing to confirm.
  await expect(page.getByTestId('import-sign-example')).toHaveText('Money out is read from “Debit” and money in from “Credit”.');
  await expect(page.locator('[data-testid^="import-setting-"][data-pending="true"]')).toHaveCount(0);
  await expect(page.getByTestId('import-next')).toBeEnabled();
  const rows = page.getByTestId('import-interpreted-row');
  await expect(rows.nth(0)).toContainText('$1,200.00');
  await expect(rows.nth(1)).toContainText('$2,500.00');

  await nextWizardStep(page, 'review');
  await nextWizardStep(page, 'summary');
  await expect(page.getByTestId('import-summary-money-in')).toHaveText(/\$2,500\.00/);
  await expect(page.getByTestId('import-summary-money-out')).toHaveText(/\$1,284\.25/);
  await runImport(page);
  expect(await readImportResult(page)).toEqual({ inserted: 3, duplicates: 0 });
  await closeImport(page);

  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT GROUP_CONCAT(printf('%.2f', amount), '|') FROM (SELECT amount FROM transactions WHERE description LIKE 'Playwright DC %' ORDER BY date)"
    )
  ).toBe('-1200.00|2500.00|-84.25');
});

test('imports an OFX file: the account is recognised by its number and nothing has to be confirmed', async ({ page }) => {
  await bootstrapDatabase(page);
  await openImportWizard(page);
  await addStatementFiles(page, OFX_FILE);
  const fileCard = page.getByTestId('import-file-card');
  await expect(fileCard).toContainText('OFX / QFX');
  await expect(fileCard.getByTestId('import-file-rows')).toHaveText('3 rows');
  await expect(fileCard).toContainText('Jun 3, 2030 – Jun 15, 2030');
  await expect(fileCard).toContainText('Account in file: 400000000004821');

  // <ACCTID> is the checking card's full number: recognised, no confirmation.
  expect(await startImport(page)).toBe('account');
  await expect(page.getByTestId('import-account-0')).toHaveAttribute('data-status', 'recognised');
  await expect(page.getByTestId('import-account-0')).toContainText('Account recognised');
  await expect(page.getByTestId('import-account-0-select')).toContainText(CHECKING);
  await nextWizardStep(page, 'layout');
  // OFX fields are fixed: nothing to guess, nothing to confirm, no columns to choose.
  await expect(page.locator('[data-testid^="import-setting-"][data-pending="true"]')).toHaveCount(0);
  await expect(page.getByTestId('import-column-roles')).toHaveCount(0);
  await expect(page.getByTestId('import-advanced')).toHaveCount(0);
  await expect(page.getByTestId('import-interpreted-row').first()).toContainText('Playwright OFX Bakery');
  await expect(page.getByTestId('import-interpreted-row').first()).toContainText('$18.75');
  await nextWizardStep(page, 'review');
  await nextWizardStep(page, 'summary');
  await expect(page.getByTestId('import-summary-money-in')).toHaveText(/\$1,500\.00/);
  await expect(page.getByTestId('import-summary-money-out')).toHaveText(/\$268\.75/);
  await runImport(page);
  expect(await readImportResult(page)).toEqual({ inserted: 3, duplicates: 0 });
  await closeImport(page);

  // <FITID> travels as the bank's own transaction id.
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT printf('%.2f', t.amount) || ':' || t.external_id || ':' || b.file_format FROM transactions t JOIN import_batches b ON b.id = t.import_batch_id WHERE t.description LIKE 'Playwright OFX Bakery%'"
    )
  ).toBe('-18.75:PW-OFX-0001:ofx');
});

test('asks which way the money goes again when a known format is used for another account', async ({ page }) => {
  await bootstrapDatabase(page);
  // The checking export is imported and its format remembered: negative numbers are money out.
  expect(await importStatementFile(page, SAMPLE_CSV, { accountName: CHECKING })).toEqual({ inserted: 3, duplicates: 0 });

  // The same bank's card export has the same header, but lists charges as positive numbers.
  await openImportWizard(page);
  await addStatementFiles(page, CARD_SAME_HEADER_CSV);
  await expect(page.getByTestId('import-file-saved-format')).toBeVisible();
  // A known format, yet no fast path: it was saved for another account.
  expect(await startImport(page)).toBe('account');
  await expect(page.getByTestId('import-account-0')).toHaveAttribute('data-status', 'assumed');
  await expect(page.getByTestId('import-account-0-select')).toContainText('Rewards Visa');
  await page.getByTestId('import-account-0-confirm').click();
  await nextWizardStep(page, 'layout');

  // The columns come from the saved format; the sign is the one thing asked again.
  await expect(page.getByTestId('import-layout-saved-other')).toBeVisible();
  await expect(page.locator('[data-testid^="import-setting-"][data-pending="true"]')).toHaveCount(1);
  await expect(page.getByTestId('import-setting-amountSign')).toHaveAttribute('data-pending', 'true');
  await expect(page.getByTestId('import-next')).toBeDisabled();
  const signExample = page.getByTestId('import-sign-example');
  await expect(signExample).toContainText('Playwright Same Header Streaming');
  if ((await signExample.textContent())?.includes('is read as money in: you received $19.99')) {
    await page.getByTestId('import-flip-sign').click();
  } else {
    await page.getByTestId('import-confirm-amountSign').click();
  }
  await expect(signExample).toContainText('“Playwright Same Header Streaming” (19.99) is read as money out: you paid $19.99.');

  await nextWizardStep(page, 'review');
  await nextWizardStep(page, 'summary');
  await expect(page.getByTestId('import-summary-money-out')).toHaveText(/\$72\.24/);
  await runImport(page);
  expect(await readImportResult(page)).toEqual({ inserted: 3, duplicates: 0 });
  await closeImport(page);

  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT printf('%.2f', t.amount) || ':' || t.type || ':' || a.name FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.description = 'Playwright Same Header Streaming'"
    )
  ).toBe('-19.99:expense:Rewards Visa');
  // Each account keeps its own format, with its own direction of money.
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT GROUP_CONCAT(a.name || '=' || json_extract(p.config_json, '$.layout.amountSign'), '|') FROM (SELECT * FROM import_profiles ORDER BY id) p JOIN accounts a ON a.id = p.account_id"
    )
  ).toBe('Household Checking=asIs|Rewards Visa=inverted');
});

test('imports two files in one run, one batch per file, with one combined result', async ({ page }) => {
  await bootstrapDatabase(page);
  await openImportWizard(page);
  await addStatementFiles(page, [SAMPLE_CSV, REPEAT_CSV]);
  await expect(page.getByTestId('import-file-card')).toHaveCount(2);

  // The first file walks the steps...
  expect(await startImport(page)).toBe('account');
  await expect(page.getByTestId('import-queue-label')).toHaveText('File 1 of 2: sample-import.csv');
  const values = await page.locator('[data-testid^="import-account-"][data-status]').count();
  for (let index = 0; index < values; index += 1) await chooseImportAccount(page, index, CHECKING);
  await nextWizardStep(page, 'layout');
  await confirmReadingSettings(page);
  await nextWizardStep(page, 'review');
  await nextWizardStep(page, 'summary');
  await expect(page.getByTestId('import-run')).toHaveText('Import 3 transactions', { timeout: 30_000 });
  await page.getByTestId('import-run').click();

  // ...and is committed before the second is touched, which then finds the
  // format the first one just saved and the rows it just wrote.
  await expect(page.getByTestId('import-queue-label')).toHaveText('File 2 of 2: sample-import-repeat.csv', { timeout: 60_000 });
  await waitForWizardStep(page, 'summary');
  await expect(page.getByTestId('import-fast-path')).toBeVisible();
  await expect(page.getByTestId('import-run')).toHaveText('Import 2 transactions', { timeout: 30_000 });
  await runImport(page);

  expect(await readImportResult(page)).toEqual({ inserted: 5, duplicates: 3 });
  await expect(page.getByTestId('import-result-0')).toContainText('3 transactions imported');
  await expect(page.getByTestId('import-result-1')).toContainText('2 transactions imported');
  await expect(page.getByTestId('import-result-1')).toContainText('3 rows were already imported and were left out');

  // Undo lives in the history view.
  await page.getByTestId('import-undo').click();
  await expect(page.getByTestId('import-view-manage')).toHaveAttribute('aria-selected', 'true');
  await closeImport(page);

  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT GROUP_CONCAT(file_name || '=' || inserted_count, '|') FROM (SELECT file_name, inserted_count FROM import_batches WHERE file_name LIKE 'sample-import%' ORDER BY id)"
    )
  ).toBe('sample-import.csv=3|sample-import-repeat.csv=2');
});

test('creates an account (and a person) without leaving the import, and leaves another account out', async ({ page }) => {
  await bootstrapDatabase(page);
  await openImportWizard(page);
  await addStatementFiles(page, UNKNOWN_ACCOUNTS_CSV);
  expect(await startImport(page)).toBe('account');

  // Neither 8801 nor 7702 matches a sample-data card: both need a decision.
  const first = page.getByTestId('import-account-0');
  const second = page.getByTestId('import-account-1');
  await expect(first).toContainText('In the file: 8801');
  await expect(first).toContainText('2 rows');
  await expect(first).toHaveAttribute('data-status', 'open');
  await expect(second).toContainText('In the file: 7702');
  await expect(second).toHaveAttribute('data-status', 'open');
  await expect(page.getByTestId('import-next')).toBeDisabled();

  // Create the account for 8801 here, owned by a new person.
  await page.getByTestId('import-account-0-select').click();
  await page.getByRole('option', { name: 'Create a new account…' }).click();
  const form = page.getByTestId('import-account-form');
  await expect(form).toBeVisible();
  await expect(form.getByLabel(/Card \/ Account Number/)).toHaveValue('8801');
  // The Owner select is the form's first combobox.
  await form.getByRole('combobox').first().click();
  await page.getByRole('option', { name: '+ New person…' }).click();
  const personDialog = page.getByRole('dialog', { name: 'Add New User' });
  await personDialog.getByLabel('Display Name').fill('Import Person');
  await personDialog.getByRole('button', { name: 'Add' }).click();
  await expect(personDialog).toBeHidden();
  await expect(form.getByRole('combobox').first()).toHaveText('Import Person');
  await form.getByLabel(/Account Name/).fill('Imported Checking');
  await form.getByTestId('import-account-create').click();
  await expect(first).toHaveAttribute('data-status', 'chosen', { timeout: 30_000 });
  await expect(page.getByTestId('import-account-0-select')).toContainText('Imported Checking');
  await expect(form).toBeHidden();

  // Leave 7702 out explicitly: its row is accounted for, not silently dropped.
  await page.getByTestId('import-account-1-select').click();
  await page.getByRole('option', { name: 'Leave these rows out' }).click();
  await expect(second).toHaveAttribute('data-status', 'skipped');
  await expect(second).toContainText('1 row will not be imported.');

  await nextWizardStep(page, 'layout');
  await confirmReadingSettings(page);
  await nextWizardStep(page, 'review');
  await nextWizardStep(page, 'summary');
  await expect(page.getByTestId('import-summary-accounts')).toContainText('Imported Checking');
  await expect(page.getByTestId('import-summary-skipped')).toHaveText(/1$/);
  await expect(page.getByTestId('import-run')).toHaveText('Import 2 transactions', { timeout: 30_000 });
  await runImport(page);
  expect(await readImportResult(page)).toEqual({ inserted: 2, duplicates: 0 });
  await closeImport(page);

  // Rows landed on the new account, which belongs to the new person.
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(t.id) || ':' || u.display_name FROM transactions t JOIN accounts a ON a.id = t.account_id JOIN users u ON u.id = a.owner_user_id WHERE a.name = 'Imported Checking'"
    )
  ).toBe('2:Import Person');
  expect(
    await runQueryAndReadFirstCell(page, "SELECT COUNT(*) FROM transactions WHERE description = 'Playwright Unknown Account Skipped Row'")
  ).toBe('0');

  // And the Accounts page lists it under its owner (grouped per person; expand when collapsed).
  await navigateToPage(page, 'accounts');
  const accountName = page.getByText('Imported Checking').first();
  await expect(accountName).toBeAttached({ timeout: 30_000 });
  if (!(await accountName.isVisible())) {
    await page.getByRole('button', { name: /Import Person/ }).first().click();
  }
  await expect(accountName).toBeVisible({ timeout: 30_000 });
});

test('works on a phone: every step fits a 390 px screen', async ({ page }) => {
  // Bootstrap at desktop size (it waits for the desktop navigation), then go phone.
  await bootstrapDatabase(page);
  await page.setViewportSize({ width: 390, height: 844 });

  // On phones Import sits in the More sheet.
  await openImportWizard(page);
  await expect(page.getByTestId('import-progress')).toContainText('Step 1 of 6');
  await expect(page.getByTestId('import-stepper')).toHaveCount(0);
  await addStatementFiles(page, SAMPLE_CSV);
  await noHorizontalOverflow(page);

  expect(await startImport(page)).toBe('account');
  await expect(page.getByTestId('import-progress')).toContainText('Step 2 of 6');
  const values = await page.locator('[data-testid^="import-account-"][data-status]').count();
  for (let index = 0; index < values; index += 1) await chooseImportAccount(page, index, CHECKING);
  await noHorizontalOverflow(page);

  await nextWizardStep(page, 'layout');
  await expect(page.getByTestId('import-interpreted-table')).toBeVisible();
  await noHorizontalOverflow(page);
  await confirmReadingSettings(page);
  // Back and Next stay within reach at the bottom edge.
  await expect(page.getByTestId('import-next')).toBeInViewport();

  await nextWizardStep(page, 'review');
  await noHorizontalOverflow(page);
  // A new step starts at its top, wherever the one before was scrolled to.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await nextWizardStep(page, 'summary');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByTestId('import-progress')).toContainText('Step 5 of 6');
  await noHorizontalOverflow(page);

  await runImport(page);
  await noHorizontalOverflow(page);
  expect(await readImportResult(page)).toEqual({ inserted: 3, duplicates: 0 });
  await page.getByTestId('import-view-transactions').click();
  await expect(page.getByTestId('import-page')).toBeHidden();
});
