import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { bootstrapDatabase, navigateToPage, runQueryAndReadFirstCell } from './helpers/bootstrap';
import {
  addStatementFiles,
  closeImport,
  confirmReadingSettings,
  nextWizardStep,
  openImportWizard,
  runImport,
  startImport,
} from './helpers/importFlow';

// Two weekly card payments (checking → Rewards Visa), one grocery charge and
// one merchant credit on the card. The account numbers are sample-data card
// numbers, so the import ties both values to their accounts: the checking
// card's full number is recognised (two sample cards end in 4821, so the last
// four alone would be ambiguous) and the Visa's unique last four, 9034, is an
// assumption the user confirms.
const TRANSFERS_CSV_PATH = path.join(__dirname, 'fixtures', 'sample-import-transfers.csv');
const CHECKING_ACCOUNT_NAME = 'Household Checking';

/** Walks the Import page with the transfers file up to "Things to check". */
async function reviewTransfersCsv(page: Page) {
  await openImportWizard(page);
  await addStatementFiles(page, TRANSFERS_CSV_PATH);
  expect(await startImport(page)).toBe('account');

  await expect(page.getByTestId('import-account-0')).toHaveAttribute('data-status', 'recognised');
  await expect(page.getByTestId('import-account-0-select')).toContainText(CHECKING_ACCOUNT_NAME);
  await expect(page.getByTestId('import-account-1')).toHaveAttribute('data-status', 'assumed');
  await expect(page.getByTestId('import-account-1-select')).toContainText('Rewards Visa');
  await page.getByTestId('import-account-1-confirm').click();

  await nextWizardStep(page, 'layout');
  await confirmReadingSettings(page);
  await nextWizardStep(page, 'review');
}

test('@smoke detects transfer pairs and a refund while importing a file, and lets the user confirm them', async ({ page }) => {
  await bootstrapDatabase(page);

  await reviewTransfersCsv(page);

  // Both card payments pair up (checking out ↔ card in, one day apart, transfer
  // wording on both sides); the lone merchant credit on the card is a refund.
  // The pairs are listed with their legs; both are checked by default.
  const transfers = page.getByTestId('import-review-transfers');
  await expect(transfers).toBeVisible();
  const pairs = transfers.getByTestId('import-transfer-pair');
  await expect(pairs).toHaveCount(2);
  await expect(pairs.first()).toContainText('PYMT BY FUNDS TRANSFER');
  await expect(pairs.first()).toContainText('PAYMENT - THANK YOU');
  await expect(transfers.getByRole('checkbox').first()).toBeChecked();
  await expect(transfers.getByTestId('import-refunds')).toHaveText('1 refund detected.');

  await nextWizardStep(page, 'summary');
  await expect(page.getByTestId('import-summary-transfers')).toHaveText(/2$/);
  await expect(page.getByTestId('import-run')).toHaveText('Import 6 transactions');
  await runImport(page);
  const result = page.getByTestId('import-result-0');
  await expect(result).toContainText('6 transactions imported');
  await expect(result).toContainText('2 transfers between your accounts');
  await expect(result).toContainText('1 refund detected');
  await closeImport(page);

  // Both legs of each payment are transfers sharing a group, in different accounts.
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM transactions WHERE description IN ('PYMT BY FUNDS TRANSFER', 'PAYMENT - THANK YOU') AND type = 'transfer' AND type_source = 'pair' AND transfer_group_id IS NOT NULL"
    )
  ).toBe('4');
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM transactions a JOIN transactions b ON b.transfer_group_id = a.transfer_group_id AND b.id > a.id WHERE a.account_id != b.account_id AND a.amount = -b.amount AND a.description IN ('PYMT BY FUNDS TRANSFER', 'PAYMENT - THANK YOU')"
    )
  ).toBe('2');
  // The card payments count as neither income nor spending...
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM transactions WHERE description = 'PAYMENT - THANK YOU' AND type = 'income'"
    )
  ).toBe('0');
  // ...the merchant credit is a refund, and the grocery charge stays an expense.
  expect(
    await runQueryAndReadFirstCell(page, "SELECT type || ':' || type_source FROM transactions WHERE description = 'Playwright Merchant Credit'")
  ).toBe('refund:inferred');
  expect(
    await runQueryAndReadFirstCell(page, "SELECT type || ':' || type_source FROM transactions WHERE description = 'Playwright Transfer Grocery Store'")
  ).toBe('expense:sign');

  // The Transactions page points at the automatically typed rows for review...
  await navigateToPage(page, 'transactions');
  const banner = page.getByTestId('type-review-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('typed automatically');
  await banner.getByRole('button', { name: 'Review' }).click();
  await expect(page.getByRole('checkbox', { name: 'Needs type review' })).toBeChecked();

  // ...where an unconfirmed transfer carries a dashed "Transfer?" chip and can be confirmed from its menu.
  const row = page.getByRole('row').filter({ has: page.getByText('PAYMENT - THANK YOU') }).first();
  await expect(row).toBeVisible();
  await expect(row.getByTestId('indicator-transfer')).toHaveText(/Transfer\?/);
  await row.getByTitle('More Actions').click();
  await page.getByTestId('row-action-confirm-type').click();
  await expect(page.getByRole('menuitem', { name: /Confirm as Transfer/ })).not.toBeVisible();

  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM transactions WHERE description = 'PAYMENT - THANK YOU' AND type = 'transfer' AND type_locked = 1 AND type_source = 'manual'"
    )
  ).toBe('1');
});

test('applies a type rule created from the Transactions page on the next auto-classification', async ({ page }) => {
  await bootstrapDatabase(page);

  // A hand-entered expense whose description the rule will match.
  await page.getByRole('button', { name: 'Dashboard' }).click();
  await page.getByRole('button', { name: 'Add Transaction' }).first().click();
  const addDialog = page.getByRole('dialog', { name: 'Add New Transaction' });
  await addDialog.getByRole('textbox', { name: 'Description' }).fill('Playwright Zelle To Self 7731');
  await addDialog.getByRole('spinbutton', { name: 'Amount' }).fill('40');
  await addDialog.getByRole('combobox', { name: 'Account' }).click();
  await page.getByRole('option', { name: new RegExp(CHECKING_ACCOUNT_NAME, 'i') }).click();
  await addDialog.getByRole('button', { name: 'Add Transaction' }).click();
  await expect(addDialog).not.toBeVisible();

  await navigateToPage(page, 'transactions');
  await page.getByTestId('transactions-type-rules').click();
  const rulesDialog = page.getByRole('dialog', { name: 'Type Rules' });
  await expect(rulesDialog).toBeVisible();
  await rulesDialog.getByTestId('type-rules-add').click();

  const editor = page.getByRole('dialog', { name: 'Create Type Rule' });
  await editor.getByLabel('Description pattern').fill('Playwright Zelle To Self');
  // Transfer is the default type; the preview counts the row entered above.
  await expect(editor.getByTestId('type-rule-preview')).toContainText('would apply to 1 existing transaction');
  await editor.getByRole('button', { name: 'Create Rule' }).click();
  await expect(editor).not.toBeVisible();
  await expect(rulesDialog).toContainText('PLAYWRIGHT ZELLE TO SELF');
  await rulesDialog.getByRole('button', { name: 'Close' }).click();

  await page.getByTestId('transactions-auto-classify').click();
  const scanSummary = page.getByTestId('auto-classify-summary');
  await expect(scanSummary).toBeVisible();
  await expect(scanSummary).toContainText(/1 typed by rules/);

  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT type || ':' || type_source FROM transactions WHERE description = 'Playwright Zelle To Self 7731'"
    )
  ).toBe('transfer:rule');
  expect(
    await runQueryAndReadFirstCell(page, "SELECT COUNT(*) FROM classification_rules WHERE pattern = 'PLAYWRIGHT ZELLE TO SELF' AND type = 'transfer'")
  ).toBe('1');
});
