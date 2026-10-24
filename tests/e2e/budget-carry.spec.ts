import { expect, test, type Page } from '@playwright/test';

import { bootstrapDatabase, navigateToPage, runQueryAndReadFirstCell } from './helpers/bootstrap';

const DEFAULT_SAMPLE_DATA_EXPENSE_ACCOUNT_NAME = 'Household Checking';

function monthKey(offset: number) {
  const now = new Date();
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth() + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

const currency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

async function openBudgetPage(page: Page) {
  await navigateToPage(page, 'budget');
  await expect(page.getByRole('heading', { name: 'Budget' })).toBeVisible({ timeout: 120_000 });
}

async function addTransactionFromDashboard(page: Page, description: string, amount: string) {
  await navigateToPage(page, 'dashboard');
  await page.getByRole('button', { name: 'Add Transaction' }).first().click();

  const transactionDialog = page.getByRole('dialog', { name: 'Add New Transaction' });
  await transactionDialog.getByRole('textbox', { name: 'Description' }).fill(description);
  await transactionDialog.getByRole('spinbutton', { name: 'Amount' }).fill(amount);
  await transactionDialog.getByRole('combobox', { name: 'Account' }).click();
  await page.getByRole('option', { name: new RegExp(DEFAULT_SAMPLE_DATA_EXPENSE_ACCOUNT_NAME, 'i') }).click();
  await transactionDialog.getByRole('button', { name: 'Add Transaction' }).click();
  await expect(transactionDialog).not.toBeVisible({ timeout: 120_000 });
}

test('a category set to carry surplus rolls last month\'s unspent budget into this month', async ({ page }) => {
  await bootstrapDatabase(page, { sampleDataTransactionLimit: 500 });
  await openBudgetPage(page);

  // Plan effective last month: Groceries 100,000 (far above any sample spend), carrying surplus.
  await page.getByRole('button', { name: 'Manage Plan' }).click();
  const planDialog = page.getByRole('dialog', { name: 'Budget Plan' });
  await planDialog.getByLabel('Effective Month', { exact: true }).fill(monthKey(-1));
  const firstRow = planDialog.getByTestId('budget-plan-row-0');
  await firstRow.getByRole('combobox', { name: 'Category', exact: true }).click();
  await page.getByRole('option', { name: 'Groceries' }).click();
  await firstRow.getByRole('spinbutton', { name: 'Amount' }).fill('100000');
  await firstRow.getByRole('combobox', { name: 'Carry-over' }).click();
  await page.getByRole('option', { name: 'Carry surplus' }).click();
  await planDialog.getByRole('button', { name: 'Save' }).click();
  await expect(planDialog).not.toBeVisible({ timeout: 30_000 });

  // This month (month 2): the unspent part of last month's 100,000 is carried in.
  const groceriesRow = page.getByTestId('budget-category-table').getByRole('row').filter({ hasText: 'Groceries' });
  await expect(groceriesRow).toBeVisible({ timeout: 60_000 });
  await expect(groceriesRow.getByTestId('budget-category-carry-badge')).toHaveText('Carries surplus');
  await expect(groceriesRow.getByTestId('budget-category-budgeted')).toHaveText('$100,000.00');
  await expect(groceriesRow.getByTestId('budget-category-carried-in')).toHaveText(/^\+\$[\d,]+\.\d{2}$/);

  const carriedInText = await groceriesRow.getByTestId('budget-category-carried-in').textContent();
  const carriedIn = Number(carriedInText!.replace(/[^\d.]/g, ''));
  expect(carriedIn).toBeGreaterThan(0);
  expect(carriedIn).toBeLessThanOrEqual(100_000);

  const effectiveText = await groceriesRow.getByTestId('budget-category-effective').textContent();
  const effective = Number(effectiveText!.replace(/[^\d.]/g, ''));
  expect(effective).toBeCloseTo(100_000 + carriedIn, 2);
  await expect(page.getByTestId('budget-carried-in-total')).toContainText(`+${currency(carriedIn)}`);

  // Month 1 (the plan's own month) starts from the plan amount: nothing carried in yet.
  await page.getByRole('button', { name: 'Previous period' }).click();
  const previousRow = page.getByTestId('budget-category-table').getByRole('row').filter({ hasText: 'Groceries' });
  await expect(previousRow.getByTestId('budget-category-carried-in')).toHaveText('$0.00', { timeout: 60_000 });
  await expect(previousRow.getByTestId('budget-category-effective')).toHaveText('$100,000.00');

  // Switching the category back to no carry-over drops the carried balance.
  await page.getByRole('button', { name: 'Next period' }).click();
  await page.getByRole('button', { name: 'Manage Plan' }).click();
  await planDialog.getByLabel('Effective Month', { exact: true }).fill(monthKey(-1));
  await expect(planDialog.getByTestId('budget-plan-row-0').getByRole('spinbutton', { name: 'Amount' })).toHaveValue('100000');
  await planDialog.getByTestId('budget-plan-row-0').getByRole('combobox', { name: 'Carry-over' }).click();
  await page.getByRole('option', { name: 'No carry-over' }).click();
  await planDialog.getByRole('button', { name: 'Save' }).click();
  await expect(planDialog).not.toBeVisible({ timeout: 30_000 });
  await expect(groceriesRow.getByTestId('budget-category-carried-in')).toHaveText('—', { timeout: 60_000 });
  await expect(groceriesRow.getByTestId('budget-category-effective')).toHaveText('$100,000.00');

  // Persisted through the worker.
  const carryMode = await runQueryAndReadFirstCell(
    page,
    `SELECT bpc.carry_mode FROM budget_plan_categories bpc JOIN budget_plans bp ON bp.id = bpc.plan_id JOIN categories c ON c.id = bpc.category_id WHERE bp.effective_month = '${monthKey(-1)}' AND c.name = 'Groceries';`
  );
  expect(carryMode).toBe('none');
});

test('a trip linked to a budget category builds a fund that its spend draws down', async ({ page }) => {
  await bootstrapDatabase(page, { sampleDataTransactionLimit: 500 });

  // A trip saving $100/month into Travel for the last four months (incl. this one).
  await navigateToPage(page, 'trips');
  await expect(page.getByRole('heading', { name: 'Manage Trips' })).toBeVisible({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Add Trip' }).click();
  const tripDialog = page.getByRole('dialog', { name: 'Add New Trip' });
  await tripDialog.getByLabel('Trip Name').fill('Fund Trip');
  await tripDialog.getByLabel('Estimated Cost').fill('1200');
  await tripDialog.getByRole('combobox', { name: 'Linked Budget Category' }).click();
  await page.getByRole('option', { name: 'Travel' }).click();
  await tripDialog.getByLabel('Monthly Contribution').fill('100');
  await tripDialog.getByLabel('Contribution Start Month').fill(monthKey(-3));
  await tripDialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(tripDialog).not.toBeVisible({ timeout: 30_000 });

  const tripCard = page.locator('[data-testid^="fund-summary-trip-"]').first();
  await expect(tripCard).toBeVisible({ timeout: 60_000 });
  await expect(tripCard.getByTestId('fund-summary-balance')).toHaveText(`balance ${currency(400)}`);
  await expect(tripCard).toContainText(`Saved ${currency(400)}`);
  await expect(tripCard).toContainText(`${currency(800)} to goal`);

  // Spend on the trip: a new expense labelled with the trip reduces the fund balance.
  const description = `Fund Trip Dinner ${Date.now()}`;
  await addTransactionFromDashboard(page, description, '65.5');
  await navigateToPage(page, 'transactions');
  const row = page.getByRole('row').filter({ has: page.getByText(description) }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.getByTitle('Label Transaction').click();
  const labelDialog = page.getByRole('dialog', { name: 'Label Transaction' });
  // The Label Type select (not owned here) has no accessible name; it is the only combobox showing 'No Label'.
  await labelDialog.getByRole('combobox').filter({ hasText: 'No Label' }).click();
  await page.getByRole('option', { name: 'Trip' }).click();
  await labelDialog.getByLabel('Select Trip').fill('Fund Trip');
  await page.getByRole('option', { name: 'Fund Trip' }).click();
  await labelDialog.getByRole('button', { name: 'Update Label' }).click();
  await expect(labelDialog).not.toBeVisible({ timeout: 30_000 });

  await navigateToPage(page, 'trips');
  await expect(tripCard.getByTestId('fund-summary-balance')).toHaveText(`balance ${currency(334.5)}`, { timeout: 60_000 });

  // The Budget page's Funds card agrees, and Travel shows the contribution as planned spend.
  await openBudgetPage(page);
  const fundCard = page.getByTestId('budget-funds-card').locator('[data-testid^="budget-fund-trip-"]').first();
  await expect(fundCard).toBeVisible({ timeout: 60_000 });
  await expect(fundCard.getByTestId('budget-fund-balance')).toHaveText(`Balance ${currency(334.5)}`);
  await expect(fundCard.getByTestId('budget-fund-contributed')).toContainText(`Saved ${currency(400)}`);
  await expect(fundCard.getByTestId('budget-fund-goal')).toContainText(`${currency(800)} to goal · 8 months to go`);

  await page.getByRole('button', { name: 'Manage Plan' }).click();
  const planDialog = page.getByRole('dialog', { name: 'Budget Plan' });
  const firstRow = planDialog.getByTestId('budget-plan-row-0');
  await firstRow.getByRole('combobox', { name: 'Category', exact: true }).click();
  await page.getByRole('option', { name: 'Travel' }).click();
  await firstRow.getByRole('spinbutton', { name: 'Amount' }).fill('500');
  await planDialog.getByRole('button', { name: 'Save' }).click();
  await expect(planDialog).not.toBeVisible({ timeout: 30_000 });

  const travelRow = page.getByTestId('budget-category-table').getByRole('row').filter({ hasText: 'Travel' });
  await expect(travelRow.getByTestId('budget-category-fund-badge')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('budget-fund-contributions-total')).toContainText(currency(100));

  const linked = await runQueryAndReadFirstCell(
    page,
    `SELECT COUNT(*) FROM transactions t JOIN trips tr ON tr.id = t.trip_id JOIN categories c ON c.id = tr.budget_category_id WHERE tr.name = 'Fund Trip' AND c.name = 'Travel' AND tr.monthly_contribution = 100;`
  );
  expect(Number(linked)).toBe(1);
});
