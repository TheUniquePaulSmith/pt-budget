import { expect, test, type Page } from '@playwright/test';

import {
  bootstrapDatabase,
  runQueryAndReadFirstCell,
  TEST_PRIMARY_USER_NAME,
} from './helpers/bootstrap';

const DEFAULT_SAMPLE_DATA_EXPENSE_ACCOUNT_NAME = 'Household Checking';

async function addTransactionFromDashboard(
  page: Page,
  description: string,
  amount: string
) {
  await page.getByRole('button', { name: 'Dashboard' }).click();
  await page.getByRole('button', { name: 'Add Transaction' }).first().click();

  const transactionDialog = page.getByRole('dialog', { name: 'Add New Transaction' });
  await transactionDialog.getByRole('textbox', { name: 'Description' }).fill(description);
  await transactionDialog.getByRole('spinbutton', { name: 'Amount' }).fill(amount);
  await transactionDialog.getByRole('combobox', { name: 'Account' }).click();
  await page
    .getByRole('option', { name: new RegExp(DEFAULT_SAMPLE_DATA_EXPENSE_ACCOUNT_NAME, 'i') })
    .click();
  await transactionDialog.getByRole('button', { name: 'Add Transaction' }).click();

  await expect(transactionDialog).not.toBeVisible({ timeout: 120_000 });
}

test('renders the recent transactions grid with user, account, and card columns', async ({ page }) => {
  await bootstrapDatabase(page);

  const grid = page.getByRole('grid').first();
  await expect(grid).toBeVisible({ timeout: 120_000 });
  await expect(grid.getByRole('columnheader', { name: 'User' })).toBeVisible();
  await expect(grid.getByRole('columnheader', { name: 'Account' })).toBeVisible();
  await expect(grid.getByRole('columnheader', { name: 'Card' })).toBeVisible();
  await expect(grid.getByRole('columnheader', { name: 'Company' })).toBeVisible();
  await expect(grid.getByRole('columnheader', { name: 'Indicators' })).toBeVisible();

  // The footer sums the (filtered) rows.
  await expect(page.getByText(/\d+ shown • Net /)).toBeVisible();
});

test('quick-applies a category and a newly created company from the row menu', async ({ page }) => {
  await bootstrapDatabase(page);

  const description = `Grid Quick Apply ${Date.now()}`;
  await addTransactionFromDashboard(page, description, '55.25');

  const row = page.getByRole('row').filter({ has: page.getByText(description) }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });

  // Quick-apply a category through the row menu.
  await row.getByTitle('More Actions').click();
  await page.getByRole('menuitem', { name: 'Set Category' }).click();
  const categoryDialog = page.getByRole('dialog', { name: 'Set Category' });
  await categoryDialog.getByLabel('Category').click();
  await page.getByRole('option', { name: 'Groceries' }).click();
  await categoryDialog.getByRole('button', { name: 'Apply' }).click();
  await expect(categoryDialog).not.toBeVisible({ timeout: 30_000 });

  // Quick-apply a company that does not exist yet (search-or-create modal).
  const companyName = `Playwright Widgets ${Date.now()}`;
  const refreshedRow = page.getByRole('row').filter({ has: page.getByText(description) }).first();
  await expect(refreshedRow).toBeVisible({ timeout: 30_000 });
  await refreshedRow.getByTitle('More Actions').click();
  await page.getByRole('menuitem', { name: 'Set Company' }).click();
  const companyDialog = page.getByRole('dialog', { name: 'Set Company' });
  await companyDialog.getByLabel('Company').fill(companyName);
  await page.getByRole('option', { name: `Create "${companyName}"` }).click();
  await companyDialog.getByRole('button', { name: /Apply/ }).click();
  await expect(companyDialog).not.toBeVisible({ timeout: 30_000 });

  // Both quick-applies persisted through the worker.
  const categoryCount = Number(
    await runQueryAndReadFirstCell(
      page,
      `SELECT COUNT(*) AS count FROM transactions t JOIN categories c ON c.id = t.category_id WHERE t.description = '${description}' AND c.name = 'Groceries';`
    )
  );
  expect(categoryCount).toBe(1);

  const companyCount = Number(
    await runQueryAndReadFirstCell(
      page,
      `SELECT COUNT(*) AS count FROM transactions t JOIN companies comp ON comp.id = t.company_id WHERE t.description = '${description}' AND comp.name = '${companyName}';`
    )
  );
  expect(companyCount).toBe(1);
});

test('marks the primary user and blocks deleting them', async ({ page }) => {
  await bootstrapDatabase(page);

  await page.getByRole('button', { name: 'Accounts' }).click();

  const primarySummary = page.getByRole('button', { name: new RegExp(TEST_PRIMARY_USER_NAME) });
  await expect(primarySummary).toBeVisible({ timeout: 30_000 });
  await expect(primarySummary.getByText('Primary', { exact: true })).toBeVisible();

  const deleteControl = primarySummary.getByTitle('Delete User');
  await expect(deleteControl).toHaveClass(/Mui-disabled/);
});

test('edits, flags and deletes a transaction from the right-click row menu', async ({ page }) => {
  await bootstrapDatabase(page);

  const description = `Grid Context Menu ${Date.now()}`;
  await addTransactionFromDashboard(page, description, '42.10');

  const rowFor = () => page.getByRole('row').filter({ has: page.getByText(description) }).first();
  await expect(rowFor()).toBeVisible({ timeout: 30_000 });

  // Edit the amount through the context menu (right-click on the row).
  await rowFor().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit…' }).click();
  const editDialog = page.getByRole('dialog', { name: 'Edit Transaction' });
  await expect(editDialog.getByRole('textbox', { name: 'Description' })).toHaveValue(description);
  await editDialog.getByRole('spinbutton', { name: 'Amount' }).fill('60.75');
  await editDialog.getByRole('button', { name: 'Save Changes' }).click();
  await expect(editDialog).not.toBeVisible({ timeout: 30_000 });

  expect(
    await runQueryAndReadFirstCell(page, `SELECT amount FROM transactions WHERE description = '${description}';`)
  ).toBe('-60.75');

  // Flag it for review.
  await page.getByRole('button', { name: 'Dashboard' }).click();
  await expect(rowFor()).toBeVisible({ timeout: 30_000 });
  await rowFor().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Flag for review' }).click();
  await expect(rowFor().getByText('Flagged')).toBeVisible({ timeout: 30_000 });

  expect(
    await runQueryAndReadFirstCell(page, `SELECT is_flagged FROM transactions WHERE description = '${description}';`)
  ).toBe('1');

  // Delete it, confirming in the dialog.
  await page.getByRole('button', { name: 'Dashboard' }).click();
  await expect(rowFor()).toBeVisible({ timeout: 30_000 });
  await rowFor().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  const deleteDialog = page.getByRole('dialog', { name: 'Delete transaction?' });
  await expect(deleteDialog.getByText(description)).toBeVisible();
  await deleteDialog.getByRole('button', { name: 'Delete' }).click();
  await expect(deleteDialog).not.toBeVisible({ timeout: 30_000 });

  expect(
    await runQueryAndReadFirstCell(page, `SELECT COUNT(*) FROM transactions WHERE description = '${description}';`)
  ).toBe('0');
});
