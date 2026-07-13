import { expect, test } from '@playwright/test';

import { bootstrapDatabase, runQueryAndReadFirstCell } from './helpers/bootstrap';

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

test('creates a budget plan and reports over/under across month, quarter, and year views', async ({ page }) => {
  await bootstrapDatabase(page, { sampleDataTransactionLimit: 500 });

  await page.getByRole('button', { name: 'Budget', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Budget' })).toBeVisible({ timeout: 120_000 });

  // Create (or update) the plan effective this month.
  await page.getByRole('button', { name: 'Manage Plan' }).click();
  const planDialog = page.getByRole('dialog', { name: 'Budget Plan' });
  await planDialog.getByLabel('Total Amount').fill('2500');
  await planDialog.getByRole('button', { name: 'Save' }).click();
  await expect(planDialog).not.toBeVisible({ timeout: 30_000 });

  // The status panel reflects the saved plan with an over/under chip.
  await expect(page.getByText('Budget Status')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('$2,500.00').first()).toBeVisible();
  await expect(page.getByText(/(left|over)$/).first()).toBeVisible();

  // History shows previous months with over/under (or no plan) chips.
  await expect(page.getByText('History')).toBeVisible();
  await expect(
    page.getByText(new RegExp(`${currentMonthKey()}: .*(under|over)$`)).first()
  ).toBeVisible({ timeout: 30_000 });

  // Quarter and year viewpoints roll up the monthly budgets.
  await page.getByRole('button', { name: 'Quarter' }).click();
  await expect(page.getByText(/^\d{4}-Q[1-4]$/).first()).toBeVisible();
  await expect(page.getByText('Budget Status')).toBeVisible();

  await page.getByRole('button', { name: 'Year' }).click();
  await expect(page.getByText(String(new Date().getFullYear()), { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Budget Status')).toBeVisible();

  // Persisted through the worker (upsert keeps a single row per month).
  const planCount = Number(
    await runQueryAndReadFirstCell(
      page,
      `SELECT COUNT(*) AS count FROM budget_plans WHERE effective_month = '${currentMonthKey()}';`
    )
  );
  expect(planCount).toBe(1);
});

test('adds a recurring salary income source that feeds expected income', async ({ page }) => {
  await bootstrapDatabase(page, { sampleDataTransactionLimit: 500 });

  await page.getByRole('button', { name: 'Budget', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Budget' })).toBeVisible({ timeout: 120_000 });

  await expect(page.getByRole('heading', { name: 'Income Sources' })).toBeVisible();
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  const incomeDialog = page.getByRole('dialog', { name: 'Add Income Source' });
  await incomeDialog.getByLabel('Name').fill('Playwright Salary');
  await incomeDialog.getByLabel('Amount', { exact: true }).fill('1234');
  await incomeDialog.getByRole('button', { name: 'Add' }).click();
  await expect(incomeDialog).not.toBeVisible({ timeout: 30_000 });

  await expect(page.getByText('Playwright Salary')).toBeVisible({ timeout: 30_000 });

  const sourceCount = Number(
    await runQueryAndReadFirstCell(
      page,
      `SELECT COUNT(*) AS count FROM income_sources WHERE name = 'Playwright Salary' AND kind = 'recurring_salary';`
    )
  );
  expect(sourceCount).toBe(1);
});
