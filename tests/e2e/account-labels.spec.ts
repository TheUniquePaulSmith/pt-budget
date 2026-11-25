import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { bootstrapDatabase, navigateToPage, runQueryAndReadFirstCell } from './helpers/bootstrap';
import { addStatementFiles, chooseImportAccount, openImportWizard, startImport } from './helpers/importFlow';

// How an account is named on screen: the Account Name is optional (bank + type
// when left empty), and two accounts with one name are told apart by their
// owner, type or card number, with the rest one hover or click away.

// Two account values (8801, 7702) no sample-data card has: the Account step asks.
const UNKNOWN_ACCOUNTS_CSV = path.join(__dirname, 'fixtures', 'sample-import-unknown-accounts.csv');

interface NewAccount {
  institution: string;
  /** Left out: the name field stays empty. */
  name?: string;
  /** The option of the Account Type select; Checking when left out. */
  type?: string;
  cardNumber: string;
}

/** Opens Add Account on the Accounts page and fills it in; the caller checks the dialog and presses Add. */
async function openAddAccount(page: Page, account: NewAccount) {
  await page.getByTestId('add-account-button').click();
  const dialog = page.getByRole('dialog', { name: 'Add New Account' });
  await dialog.getByLabel('Institution (Optional)').fill(account.institution);
  if (account.type) {
    await dialog.getByRole('combobox', { name: 'Account Type' }).click();
    await page.getByRole('option', { name: account.type, exact: true }).click();
  }
  if (account.name !== undefined) await dialog.getByLabel('Account Name').fill(account.name);
  await dialog.getByLabel(/Card \/ Account Number/).fill(account.cardNumber);
  return dialog;
}

test('an account saved without a name is called after its bank and type', async ({ page }) => {
  await bootstrapDatabase(page);
  await navigateToPage(page, 'accounts');

  const dialog = await openAddAccount(page, { institution: 'Huntington', cardNumber: '1111' });
  // The name is optional: the field shows what it will be, and the preview how the account will read.
  await expect(dialog.getByLabel('Account Name')).toHaveValue('');
  await expect(dialog.getByLabel('Account Name')).toHaveAttribute('placeholder', 'Huntington Checking');
  await expect(dialog.getByText('Optional. Leave empty to use “Huntington Checking”, or type your own.')).toBeVisible();
  const preview = dialog.getByTestId('account-label-preview');
  await expect(preview).toContainText('Huntington Checking');
  await expect(preview.getByTestId('account-detail-line')).toContainText('••1111');
  await expect(dialog.getByTestId('account-label-same-name')).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog).toBeHidden();

  expect(await runQueryAndReadFirstCell(page, "SELECT name FROM accounts WHERE institution = 'Huntington'")).toBe(
    'Huntington Checking'
  );
});

test('two accounts with the same name are told apart when a statement is imported', async ({ page }) => {
  await bootstrapDatabase(page);
  await navigateToPage(page, 'accounts');

  const checking = await openAddAccount(page, { institution: 'Huntington', name: 'Huntington', cardNumber: '1111' });
  await checking.getByRole('button', { name: 'Add' }).click();
  await expect(checking).toBeHidden();

  // The second "Huntington": the form says the name is taken and shows what will tell the two apart.
  const credit = await openAddAccount(page, {
    institution: 'Huntington',
    name: 'Huntington',
    type: 'Credit Card',
    cardNumber: '2222',
  });
  await expect(credit.getByTestId('account-label-same-name')).toContainText('Another account is already named “Huntington”.');
  await expect(credit.getByTestId('account-label-preview')).toContainText('Huntington · Credit Card');
  await credit.getByRole('button', { name: 'Add' }).click();
  await expect(credit).toBeHidden();

  await openImportWizard(page);
  await addStatementFiles(page, UNKNOWN_ACCOUNTS_CSV);
  expect(await startImport(page)).toBe('account');

  // Same name, same owner: each option carries its type and its card number.
  const select = page.getByTestId('import-account-0-select');
  await select.click();
  const checkingOption = page.getByRole('option', { name: /^Huntington · Checking/ });
  const creditOption = page.getByRole('option', { name: /^Huntington · Credit Card/ });
  await expect(checkingOption.getByTestId('account-detail-line')).toContainText('••1111');
  await expect(creditOption.getByTestId('account-detail-line')).toContainText('••2222');
  await page.keyboard.press('Escape');
  await expect(creditOption).toBeHidden();

  await chooseImportAccount(page, 0, 'Huntington', '••2222');
  await expect(select).toContainText('Huntington · Credit Card');
  await expect(select.getByTestId('account-detail-line')).toContainText('••2222');

  // The rest of the account is one click away, and Escape puts it away again.
  await page.getByTestId('import-account-0-details').click();
  const details = page.getByTestId('account-details-card');
  await expect(details).toBeVisible();
  await expect(details).toContainText('Credit Card');
  await expect(details).toContainText('Huntington');
  await expect(details).toContainText('••2222');
  await page.keyboard.press('Escape');
  await expect(details).toBeHidden();
});
