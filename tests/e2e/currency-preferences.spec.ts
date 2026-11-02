import { expect, test, type Page } from '@playwright/test';

import { bootstrapDatabase, navigateToPage, runQueryAndReadFirstCell } from './helpers/bootstrap';

/**
 * Multi-currency accounts (schema v6): the default currency, per-account
 * currencies, manual exchange rates and the dashboard's missing-rate notice.
 */

async function openPreferencesTab(page: Page) {
  await navigateToPage(page, 'settings');
  await page.getByRole('tab', { name: 'Preferences' }).click();
  await expect(page.getByTestId('settings-default-currency')).toBeAttached({ timeout: 30_000 });
}

/** Settings is a full-screen page with no navigation rail; leave it before using the SQL page. */
async function closeSettings(page: Page) {
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.getByRole('button', { name: 'SQL Query' })).toBeVisible({ timeout: 30_000 });
}

async function addAccount(page: Page, name: string, currency: string) {
  await navigateToPage(page, 'accounts');
  await page.getByRole('button', { name: 'Add Account' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add New Account' });
  await dialog.getByLabel(/Account Name/).fill(name);
  await dialog.getByLabel('Currency').click();
  await page.getByRole('option', { name: new RegExp(`^${currency}`) }).click();
  await dialog.getByLabel(/Card \/ Account Number/).fill('7777');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30_000 });
}

test('@smoke a fresh database stores accounts in USD with no exchange rates and no notice', async ({ page }) => {
  await bootstrapDatabase(page, { sampleDataTransactionLimit: 200 });

  expect(await runQueryAndReadFirstCell(page, "SELECT COUNT(*) FROM accounts WHERE currency = 'USD'")).not.toBe('0');
  expect(await runQueryAndReadFirstCell(page, "SELECT COUNT(*) FROM accounts WHERE currency != 'USD'")).toBe('0');
  expect(await runQueryAndReadFirstCell(page, 'SELECT COUNT(*) FROM exchange_rates')).toBe('0');
  expect(
    await runQueryAndReadFirstCell(page, "SELECT COUNT(*) FROM app_metadata WHERE key = 'preferences.defaultCurrency'")
  ).toBe('0');

  await navigateToPage(page, 'dashboard');
  await expect(page.getByTestId('missing-rates-notice')).toHaveCount(0);
});

test('a foreign-currency account is excluded from totals until a rate is entered, then converted', async ({ page }) => {
  await bootstrapDatabase(page, { sampleDataTransactionLimit: 200 });

  await addAccount(page, 'Euro Wallet', 'EUR');
  expect(await runQueryAndReadFirstCell(page, "SELECT currency FROM accounts WHERE name = 'Euro Wallet'")).toBe('EUR');

  // The dashboard says the EUR account is left out while no rate exists.
  await navigateToPage(page, 'dashboard');
  await expect(page.getByTestId('missing-rates-notice')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('missing-rates-notice')).toContainText('EUR');

  // A EUR expense contributes nothing to spending yet (NULL rate → skipped by SUM).
  await page.getByRole('button', { name: 'Add Transaction' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add New Transaction' });
  await dialog.getByRole('textbox', { name: 'Description' }).fill('Paris bakery');
  await dialog.getByRole('spinbutton', { name: 'Amount' }).fill('100');
  await dialog.getByRole('combobox', { name: 'Account' }).click();
  await page.getByRole('option', { name: /Euro Wallet/ }).click();
  await dialog.getByRole('button', { name: 'Add Transaction' }).click();
  await expect(dialog).not.toBeVisible({ timeout: 60_000 });

  const spendSql = (where: string) =>
    `SELECT COALESCE(SUM(CASE WHEN t.type IN ('expense', 'refund') AND t.is_excluded = 0 THEN -t.amount * (SELECT CASE WHEN xa.currency = COALESCE((SELECT value FROM app_metadata WHERE key = 'preferences.defaultCurrency'), 'USD') THEN 1.0 ELSE xr.rate END FROM accounts xa LEFT JOIN exchange_rates xr ON xr.currency = xa.currency WHERE xa.id = t.account_id) ELSE 0 END), 0) FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE ${where}`;
  expect(await runQueryAndReadFirstCell(page, spendSql("a.name = 'Euro Wallet'"))).toBe('0');

  // Enter 1 EUR = 1.25 USD in Settings → Preferences.
  await openPreferencesTab(page);
  await expect(page.getByTestId('exchange-rate-EUR')).toBeVisible();
  await page.getByTestId('exchange-rate-input-EUR').fill('1.25');
  await page.getByTestId('exchange-rate-save-EUR').click();
  await expect(page.getByTestId('settings-missing-rates')).toHaveCount(0, { timeout: 30_000 });
  await closeSettings(page);
  expect(await runQueryAndReadFirstCell(page, "SELECT rate FROM exchange_rates WHERE currency = 'EUR'")).toBe('1.25');

  // Now the EUR expense counts as 125 USD and the notice is gone.
  expect(await runQueryAndReadFirstCell(page, spendSql("a.name = 'Euro Wallet'"))).toBe('125');
  await navigateToPage(page, 'dashboard');
  await expect(page.getByTestId('missing-rates-notice')).toHaveCount(0);
});

test('changing the default currency rebases the known rates and re-expresses the old default', async ({ page }) => {
  await bootstrapDatabase(page, { sampleDataTransactionLimit: 100 });

  await addAccount(page, 'Euro Wallet', 'EUR');
  await openPreferencesTab(page);
  await page.getByTestId('exchange-rate-input-EUR').fill('1.25');
  await page.getByTestId('exchange-rate-save-EUR').click();
  await expect(page.getByTestId('settings-missing-rates')).toHaveCount(0, { timeout: 30_000 });

  // Switch the default to EUR: USD gets 1 / 1.25 = 0.8, EUR's own row disappears.
  await page.getByTestId('settings-default-currency').locator('..').click();
  await page.getByRole('option', { name: /^EUR/ }).click();
  await page.getByTestId('confirm-default-currency').click();
  await expect(page.getByTestId('exchange-rate-USD')).toBeVisible({ timeout: 30_000 });
  await closeSettings(page);

  expect(
    await runQueryAndReadFirstCell(page, "SELECT value FROM app_metadata WHERE key = 'preferences.defaultCurrency'")
  ).toBe('EUR');
  expect(await runQueryAndReadFirstCell(page, "SELECT COUNT(*) FROM exchange_rates WHERE currency = 'EUR'")).toBe('0');
  expect(await runQueryAndReadFirstCell(page, "SELECT ROUND(rate, 4) FROM exchange_rates WHERE currency = 'USD'")).toBe('0.8');

  // Dashboard totals now carry the "Totals in EUR" caption and no notice (USD has a rate).
  await navigateToPage(page, 'dashboard');
  await expect(page.getByTestId('missing-rates-notice')).toHaveCount(0);
  await expect(page.getByText('Totals in EUR')).toBeVisible({ timeout: 30_000 });
});
