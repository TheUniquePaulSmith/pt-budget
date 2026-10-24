import { expect, test } from '@playwright/test';

import { bootstrapDatabase, navigateToPage, runQueryAndReadFirstCell } from './helpers/bootstrap';

// iPhone 12/13/14-class viewport.
const MOBILE_VIEWPORT = { width: 390, height: 844 };

test('edits an account and its cards through the master-detail form', async ({ page }) => {
  await bootstrapDatabase(page);
  await navigateToPage(page, 'accounts');

  const layout = page.getByTestId('accounts-master-detail');
  await expect(layout).toHaveAttribute('data-layout', 'desktop');
  await expect(page.getByTestId('people-panel')).toBeVisible();

  // Sample data ships several accounts; pick the Rewards Visa row.
  const grid = layout.getByRole('grid');
  const visaRow = grid.getByRole('row').filter({ hasText: 'Rewards Visa' }).first();
  await expect(visaRow).toBeVisible({ timeout: 30_000 });
  await visaRow.click();

  const form = page.getByTestId('account-detail-form');
  await expect(form.getByTestId('account-detail-title')).toHaveText('Rewards Visa');
  await expect(form.getByTestId('account-save-button')).toBeDisabled();

  // Edit the institution and the credit limit (a credit-card-only field).
  const institution = `Metro Credit Union ${Date.now()}`;
  await form.getByLabel('Institution (Optional)').fill(institution);
  await form.getByLabel('Credit Limit').fill('7500');
  await expect(form.getByTestId('account-save-button')).toBeEnabled();
  await form.getByTestId('account-save-button').click();
  await expect(form.getByTestId('account-saved-alert')).toBeVisible();

  // The grid's computed Institution column refreshes from the collection.
  await expect(grid.getByRole('row').filter({ hasText: 'Rewards Visa' }).first()).toContainText(institution);

  // Add a card inline from the Cards sub-grid.
  const cardsTable = form.getByTestId('account-cards-table');
  await cardsTable.getByTestId('add-card-button').click();
  await cardsTable.getByTestId('card-add-number').fill('4111 1111 1111 9876');
  await cardsTable.getByTestId('card-add-nickname').fill('Travel card');
  await cardsTable.getByRole('button', { name: 'Save new card' }).click();
  await expect(cardsTable).toContainText('••••9876');
  await expect(cardsTable).toContainText('Travel card');

  // Verify through the read-only SQL page.
  expect(
    await runQueryAndReadFirstCell(page, `SELECT institution FROM accounts WHERE name = 'Rewards Visa';`)
  ).toBe(institution);
  expect(
    await runQueryAndReadFirstCell(
      page,
      `SELECT CAST(credit_limit AS INTEGER) FROM accounts WHERE name = 'Rewards Visa';`
    )
  ).toBe('7500');
  expect(
    await runQueryAndReadFirstCell(
      page,
      `SELECT COUNT(*) FROM account_cards c JOIN accounts a ON a.id = c.account_id WHERE a.name = 'Rewards Visa' AND c.last_four = '9876';`
    )
  ).toBe('1');
});

test('adds a person from the People panel and sorts the Institution column', async ({ page }) => {
  await bootstrapDatabase(page);
  await navigateToPage(page, 'accounts');

  const peoplePanel = page.getByTestId('people-panel');
  await peoplePanel.getByTestId('add-user-button').click();
  const personName = `Casey ${Date.now()}`;
  const dialog = page.getByRole('dialog', { name: 'Add New User' });
  await dialog.getByLabel('Display Name').fill(personName);
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(peoplePanel).toContainText(personName);
  await expect(peoplePanel.locator('[data-testid^="person-row-"]').filter({ hasText: personName })).toContainText('0 owned • 0 cardholder');

  // Sorting by the computed Institution column reorders the grid.
  const grid = page.getByTestId('accounts-master-detail').getByRole('grid');
  const header = grid.getByRole('columnheader', { name: 'Institution' });
  await header.click();
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
});

test('on a phone the accounts list opens the form full-screen with a back button', async ({ page }) => {
  await bootstrapDatabase(page);
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.getByTestId('mobile-bottom-nav').getByTestId('nav-accounts').click();

  const layout = page.getByTestId('accounts-master-detail');
  await expect(layout).toHaveAttribute('data-layout', 'mobile-master');
  const list = page.getByTestId('accounts-list');
  await expect(list).toBeVisible();
  await expect(page.getByTestId('people-panel')).toBeVisible();

  await list.getByRole('button').filter({ hasText: 'Rewards Visa' }).first().click();
  await expect(layout).toHaveAttribute('data-layout', 'mobile-detail');
  await expect(page.getByTestId('account-detail-form')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Rewards Visa' }).first()).toBeVisible();

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

  await page.getByRole('button', { name: 'Back to list' }).click();
  await expect(layout).toHaveAttribute('data-layout', 'mobile-master');
  await expect(list).toBeVisible();
});
