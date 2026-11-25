import { expect, test, type Page } from '@playwright/test';

import {
  bootstrapDatabase as bootstrapDatabaseWithOptions,
  navigateToPage,
  reloadAndUnlock,
  runQueryAndReadFirstCell,
} from './helpers/bootstrap';

const SAMPLE_DATA_TRANSACTION_LIMIT = 500;
/** CADENCE_HALF_WINDOW_DAYS.monthly in src/lib/notificationService.ts. */
const MONTHLY_PAYMENT_HALF_WINDOW_DAYS = 15;
const NO_UNPAID_SERIES = '(none)';
const SAMPLE_DATA_EXPENSE_ACCOUNT_NAME = 'Household Checking';

/**
 * The sample household is not free of notifications. From about the middle of
 * a month it has spent past several of its budget categories, and the scan
 * that runs when the database opens raises one "Budget overspend" alert for
 * each (none early in a month, up to eight late in it). A test that loads the
 * sample data must not expect an empty Notifications page or an exact bell
 * count as it stands: it reads the starting count, or saves its own budget
 * plan for this month, or bootstraps with bootstrapEmptyDatabase instead.
 */
async function bootstrapDatabase(page: Page) {
  await bootstrapDatabaseWithOptions(page, { sampleDataTransactionLimit: SAMPLE_DATA_TRANSACTION_LIMIT });
}

/** A new database with no sample data: no accounts, no transactions, and so nothing for the scan to raise. */
async function bootstrapEmptyDatabase(page: Page) {
  await bootstrapDatabaseWithOptions(page, { loadSampleData: false });
}

/** Local calendar date `days` from today as yyyy-MM-dd (same convention as src/lib/dateOnly.ts). */
function localDatePlusDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function badgeOf(page: Page) {
  return page.getByTestId('notification-bell-badge').locator('.MuiBadge-badge');
}

/** The bell shows `count` due items; with nothing due the badge is hidden. */
async function expectBadgeCount(page: Page, count: number) {
  if (count === 0) {
    await expect(badgeOf(page)).toHaveClass(/MuiBadge-invisible/);
    return;
  }
  await expect(badgeOf(page)).toHaveText(String(count));
  await expect(badgeOf(page)).not.toHaveClass(/MuiBadge-invisible/);
}

/**
 * Runs the scan from the Notifications page and waits until it has finished.
 * The button is disabled while any scan runs, so this also waits out the scan
 * that starts when the database opens or after a change.
 */
async function rescanNotifications(page: Page) {
  await navigateToPage(page, 'notifications');
  await page.getByTestId('notifications-rescan').click();
  await expect(page.getByTestId('notifications-rescan')).toBeEnabled();
}

/** The number in the Due tab label, "Due (4)". */
async function readDueCount(page: Page): Promise<number> {
  const label = (await page.getByTestId('notifications-tab-due').textContent()) ?? '';
  const match = /^Due \((\d+)\)$/.exec(label.trim());
  expect(match, `the Due tab label "${label}" carries a count`).not.toBeNull();
  return Number(match![1]);
}

/** Dashboard → Add Transaction: an expense dated today in a category typed by name (created when it is new). */
async function addExpenseFromDashboard(page: Page, expense: { description: string; amount: string; category: string }) {
  await navigateToPage(page, 'dashboard');
  await page.getByRole('button', { name: 'Add Transaction' }).first().click();

  const dialog = page.getByRole('dialog', { name: 'Add New Transaction' });
  await dialog.getByRole('textbox', { name: 'Description' }).fill(expense.description);
  await dialog.getByRole('spinbutton', { name: 'Amount' }).fill(expense.amount);
  await dialog.getByRole('combobox', { name: 'Category' }).fill(expense.category);
  await dialog.getByRole('combobox', { name: 'Account' }).click();
  await page.getByRole('option', { name: new RegExp(SAMPLE_DATA_EXPENSE_ACCOUNT_NAME, 'i') }).click();
  await dialog.getByRole('button', { name: 'Add Transaction' }).click();
  await expect(dialog).toBeHidden();
}

/** Budget → Manage Plan: budgets `category` at `amount` in the plan effective this month. */
async function budgetCategoryThisMonth(page: Page, category: string, amount: string) {
  await navigateToPage(page, 'budget');
  await page.getByRole('button', { name: 'Manage Plan' }).click();

  const planDialog = page.getByRole('dialog', { name: 'Budget Plan' });
  const firstRow = planDialog.getByTestId('budget-plan-row-0');
  await firstRow.getByRole('combobox', { name: 'Category', exact: true }).click();
  await page.getByRole('option', { name: category, exact: true }).click();
  await firstRow.getByRole('spinbutton', { name: 'Amount' }).fill(amount);
  await planDialog.getByRole('button', { name: 'Save' }).click();
  await expect(planDialog).toBeHidden();
}

test('a reminder due in 3 days with a 7-day lead shows on the dashboard card and bell, and dismissing clears the badge', async ({ page }) => {
  // No sample data: the empty state and the exact counts below hold on any day of the month.
  await bootstrapEmptyDatabase(page);

  await navigateToPage(page, 'notifications');
  await expect(page.getByTestId('notifications-page')).toBeVisible();
  await expect(page.getByTestId('notifications-empty')).toHaveText('No notifications yet.');
  await expect(badgeOf(page)).toHaveClass(/MuiBadge-invisible/);

  // Create the reminder: due in three days, custom lead of seven days → due now.
  const title = `Renew passport ${Date.now()}`;
  await page.getByTestId('notifications-new-reminder').click();
  const editor = page.getByRole('dialog', { name: 'New reminder' });
  await editor.getByTestId('reminder-title').fill(title);
  await editor.getByTestId('reminder-date').fill(localDatePlusDays(3));
  await editor.getByTestId('reminder-lead-override').check();
  await editor.getByTestId('reminder-lead-days').fill('7');
  await editor.getByTestId('reminder-save').click();
  await expect(editor).toBeHidden();

  // Due tab lists it as due in 3 days; the bell shows one due item.
  await expect(page.getByTestId('notifications-tab-due')).toContainText('Due (1)');
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await expect(page.getByText('Due in 3 days', { exact: true })).toBeVisible();
  await expect(badgeOf(page)).toHaveText('1');
  await expect(badgeOf(page)).not.toHaveClass(/MuiBadge-invisible/);

  // Hovering the bell previews the due rows without leaving the page.
  await page.getByTestId('notification-bell-button').hover();
  const preview = page.getByTestId('notification-bell-preview');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText(title);
  await page.mouse.move(10, 300);
  await expect(preview).toBeHidden();

  // The dashboard card shows it with inline actions.
  await navigateToPage(page, 'dashboard');
  const card = page.getByTestId('notifications-dashboard-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText(title);
  await expect(card).toContainText('1 due');

  // Dismiss from the card: the card disappears and the badge clears.
  await card.getByRole('button', { name: `Dismiss ${title}` }).click();
  await expect(card).toBeHidden();
  await expect(badgeOf(page)).toHaveClass(/MuiBadge-invisible/);

  const dismissedCount = Number(
    await runQueryAndReadFirstCell(
      page,
      `SELECT COUNT(*) AS count FROM notifications WHERE title = '${title}' AND status = 'dismissed' AND kind = 'reminder' AND lead_days = 7;`
    )
  );
  expect(dismissedCount).toBe(1);

  // History keeps it; Due is empty again.
  await navigateToPage(page, 'notifications');
  await expect(page.getByTestId('notifications-tab-due')).toContainText('Due (0)');
  await expect(page.getByTestId('notifications-tab-history')).toContainText('History (1)');
});

test('a manually paid series with a due day in range raises a payment alert, which Done resolves', async ({ page }) => {
  await bootstrapDatabase(page);

  // The household's own budget alerts (see bootstrapDatabase) share the Due
  // tab and the bell with the alert this test raises. Count them once the
  // scan has finished; nothing below changes what the household has spent.
  await rescanNotifications(page);
  const dueBefore = await readDueCount(page);
  await expectBadgeCount(page, dueBefore);

  // Detect recurring series from the sample data.
  await page.getByRole('button', { name: 'Subscriptions' }).click();
  await expect(page.getByRole('heading', { name: 'Subscriptions', exact: true, level: 4 })).toBeVisible();
  await page.getByRole('button', { name: 'Rescan' }).click();
  await expect(page.getByText(/Scan complete/)).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Payment' }).first()).toBeVisible();

  // The scan counts a bill as paid when a linked payment lands within half a
  // cycle of its due date (src/lib/notificationService.ts, hasPaymentInWindow),
  // so a series charged in the last 15 days raises no alert when made due
  // today. Pick the monthly series whose latest payment is the oldest and
  // check it is outside that window. The sample bills fall on days spread
  // across the month, so one always is, whatever today's date.
  const seriesName = await runQueryAndReadFirstCell(
    page,
    `SELECT COALESCE((
       SELECT rs.name FROM recurring_series rs
         JOIN transaction_series_links tsl ON tsl.series_id = rs.id
         JOIN transactions t ON t.id = tsl.transaction_id
        WHERE rs.cadence = 'monthly'
        GROUP BY rs.id
       HAVING MAX(t.date) < '${localDatePlusDays(-MONTHLY_PAYMENT_HALF_WINDOW_DAYS)}'
        ORDER BY MAX(t.date) ASC, rs.id ASC
        LIMIT 1
     ), '${NO_UNPAID_SERIES}') AS name;`
  );
  expect(seriesName, 'a monthly sample series with no payment in the last 15 days').not.toBe(NO_UNPAID_SERIES);

  // Open that series and make it an active, manually paid bill due today.
  await navigateToPage(page, 'subscriptions');
  await page
    .getByRole('row')
    .filter({ has: page.getByText(seriesName, { exact: true }) })
    .first()
    .getByRole('button', { name: 'View transactions' })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('h2').first()).toHaveText(seriesName);

  await dialog.getByRole('combobox', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'Active', exact: true }).click();
  await expect(dialog.getByTestId('series-autopay-switch')).not.toBeChecked();
  const todayDay = String(new Date().getDate());
  await dialog.getByTestId('series-due-day').fill(todayDay);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByText(`Manual · day ${todayDay}`).first()).toBeVisible();

  // The notifications scan (on change, or via Rescan) raises the alert: one
  // more due item than before, on the page and on the bell.
  await rescanNotifications(page);
  const alertTitle = `${seriesName} due today`;
  await expect(page.getByText(alertTitle, { exact: true })).toBeVisible();
  await expect(page.getByTestId('notifications-tab-due')).toHaveText(`Due (${dueBefore + 1})`);
  await expectBadgeCount(page, dueBefore + 1);

  const alertCount = Number(
    await runQueryAndReadFirstCell(
      page,
      `SELECT COUNT(*) AS count FROM notifications
       WHERE kind = 'alert' AND type = 'overdue_payment' AND source = 'system' AND status = 'active'
         AND dedupe_key LIKE 'overdue:series:%' AND entity_table = 'recurring_series';`
    )
  );
  expect(alertCount).toBe(1);

  // A second scan is idempotent: still exactly one row for the key.
  await rescanNotifications(page);
  const afterRescan = Number(
    await runQueryAndReadFirstCell(page, `SELECT COUNT(*) AS count FROM notifications WHERE type = 'overdue_payment';`)
  );
  expect(afterRescan).toBe(1);

  // Done closes the alert: the Due tab and the bell are back to where they started.
  await navigateToPage(page, 'notifications');
  await page.getByRole('button', { name: `Mark ${alertTitle} done` }).click();
  await expect(page.getByText(alertTitle, { exact: true })).toBeHidden();
  await expect(page.getByTestId('notifications-tab-due')).toHaveText(`Due (${dueBefore})`);
  await expectBadgeCount(page, dueBefore);
});

test('spending past a category budget raises an overspend alert, and a budget that covers the spend clears it', async ({ page }) => {
  await bootstrapDatabase(page);

  // A category of its own, so no alert for it can exist yet whatever the
  // sample household has spent this month.
  const category = 'Pottery studio';
  await addExpenseFromDashboard(page, { description: 'Wheel throwing course', amount: '80', category });

  // A plan effective this month replaces the sample plan for this month, and
  // it budgets this category only: the household's own overspend alerts (see
  // bootstrapDatabase) no longer apply, so the counts below hold on any day.
  await budgetCategoryThisMonth(page, category, '50');
  const budgetRow = page.getByTestId('budget-category-table').getByRole('row').filter({ hasText: category });
  await expect(budgetRow.getByTestId('budget-category-budgeted')).toHaveText('$50.00');
  await expect(budgetRow.getByTestId('budget-category-spent')).toHaveText('$80.00');
  await expect(budgetRow.getByTestId('budget-category-remaining')).toHaveText('$30.00 over');

  // The scan raises one alert that quotes what the Budget page shows.
  await rescanNotifications(page);
  const alertTitle = `${category} is over budget`;
  const alertRow = page.getByRole('row').filter({ has: page.getByText(alertTitle, { exact: true }) });
  await expect(alertRow).toContainText('Budget overspend');
  await expect(alertRow).toContainText('Spent $80.00 of $50.00');
  await expect(alertRow).toContainText('($30.00 over)');
  await expect(page.getByTestId('notifications-tab-due')).toHaveText('Due (1)');
  await expectBadgeCount(page, 1);

  // The dashboard card lists it too.
  await navigateToPage(page, 'dashboard');
  const card = page.getByTestId('notifications-dashboard-card');
  await expect(card).toContainText(alertTitle);
  await expect(card).toContainText('1 due');

  const alertKey = `budget:${localDatePlusDays(0).slice(0, 7)}:`;
  const alertStatusQuery = `SELECT n.status FROM notifications n JOIN categories c ON c.id = n.entity_id
     WHERE n.kind = 'alert' AND n.type = 'budget_overspend' AND n.source = 'system' AND n.entity_table = 'categories'
       AND c.name = '${category}' AND n.dedupe_key = '${alertKey}' || c.id;`;
  expect(await runQueryAndReadFirstCell(page, alertStatusQuery)).toBe('active');

  // A second scan is idempotent: still one alert per over-budget category.
  await rescanNotifications(page);
  await expect(page.getByTestId('notifications-tab-due')).toHaveText('Due (1)');
  const activeOverspendAlerts = Number(
    await runQueryAndReadFirstCell(
      page,
      `SELECT COUNT(*) AS count FROM notifications WHERE type = 'budget_overspend' AND status = 'active';`
    )
  );
  expect(activeOverspendAlerts).toBe(1);

  // A budget that covers the spend: the next scan resolves the alert by itself.
  await budgetCategoryThisMonth(page, category, '100');
  await expect(budgetRow.getByTestId('budget-category-remaining')).toHaveText('$20.00');
  await rescanNotifications(page);
  await expect(page.getByTestId('notifications-tab-due')).toHaveText('Due (0)');
  await expectBadgeCount(page, 0);
  expect(await runQueryAndReadFirstCell(page, alertStatusQuery)).toBe('done');
});

test('notification settings persist across a reload', async ({ page }) => {
  await bootstrapDatabase(page);

  await navigateToPage(page, 'settings');
  await page.getByRole('tab', { name: 'Notifications' }).click();
  const tab = page.getByTestId('notifications-settings-tab');
  await expect(tab).toBeVisible();

  const birthdayLead = tab.getByTestId('notification-setting-birthday-lead');
  await expect(birthdayLead).toHaveValue('14');
  await birthdayLead.fill('21');
  await birthdayLead.press('Tab');

  const seasonalEnabled = tab.getByTestId('notification-setting-seasonal-enabled');
  await expect(seasonalEnabled).toBeChecked();
  await seasonalEnabled.click();
  await expect(seasonalEnabled).not.toBeChecked();

  // Settings is full-screen (no nav bar); close it before using the SQL page.
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect
    .poll(
      async () =>
        Number(await runQueryAndReadFirstCell(page, `SELECT lead_days FROM notification_settings WHERE type = 'birthday';`))
    )
    .toBe(21);

  await reloadAndUnlock(page);

  await navigateToPage(page, 'settings');
  await page.getByRole('tab', { name: 'Notifications' }).click();
  await expect(page.getByTestId('notification-setting-birthday-lead')).toHaveValue('21');
  await expect(page.getByTestId('notification-setting-seasonal-enabled')).not.toBeChecked();
  await page.getByRole('button', { name: 'Close settings' }).click();

  const seasonalRow = await runQueryAndReadFirstCell(
    page,
    `SELECT enabled FROM notification_settings WHERE type = 'seasonal';`
  );
  expect(Number(seasonalRow)).toBe(0);
});
