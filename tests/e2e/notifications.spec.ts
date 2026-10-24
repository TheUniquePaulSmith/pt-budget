import { expect, test, type Page } from '@playwright/test';

import {
  bootstrapDatabase as bootstrapDatabaseWithOptions,
  navigateToPage,
  reloadAndUnlock,
  runQueryAndReadFirstCell,
} from './helpers/bootstrap';

const SAMPLE_DATA_TRANSACTION_LIMIT = 500;

async function bootstrapDatabase(page: Page) {
  await bootstrapDatabaseWithOptions(page, { sampleDataTransactionLimit: SAMPLE_DATA_TRANSACTION_LIMIT });
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

test('a reminder due in 3 days with a 7-day lead shows on the dashboard card and bell, and dismissing clears the badge', async ({ page }) => {
  await bootstrapDatabase(page);

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
  await expect(editor).toBeHidden({ timeout: 30_000 });

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
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText(title);
  await expect(card).toContainText('1 due');

  // Dismiss from the card: the card disappears and the badge clears.
  await card.getByRole('button', { name: `Dismiss ${title}` }).click();
  await expect(card).toBeHidden({ timeout: 30_000 });
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

  // Detect recurring series from the sample data.
  await page.getByRole('button', { name: 'Subscriptions' }).click();
  await expect(page.getByRole('heading', { name: 'Subscriptions', exact: true, level: 4 })).toBeVisible({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Rescan' }).click();
  await expect(page.getByText(/Scan complete/)).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('columnheader', { name: 'Payment' }).first()).toBeVisible({ timeout: 30_000 });

  // Open the first series and make it an active, manually paid bill due today.
  await page.getByRole('button', { name: 'View transactions' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  const seriesName = (await dialog.locator('h2').first().textContent())?.trim() ?? '';
  expect(seriesName.length).toBeGreaterThan(0);

  await dialog.getByRole('combobox', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'Active', exact: true }).click();
  await expect(dialog.getByTestId('series-autopay-switch')).not.toBeChecked();
  const todayDay = String(new Date().getDate());
  await dialog.getByTestId('series-due-day').fill(todayDay);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  await expect(page.getByText(`Manual · day ${todayDay}`).first()).toBeVisible({ timeout: 30_000 });

  // The notifications scan (on change, or via Rescan) raises the alert.
  await navigateToPage(page, 'notifications');
  await page.getByTestId('notifications-rescan').click();
  const alertTitle = `${seriesName} due today`;
  await expect(page.getByText(alertTitle, { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(badgeOf(page)).toHaveText('1');

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
  await navigateToPage(page, 'notifications');
  await page.getByTestId('notifications-rescan').click();
  await expect(page.getByTestId('notifications-rescan')).toBeEnabled({ timeout: 60_000 });
  const afterRescan = Number(
    await runQueryAndReadFirstCell(page, `SELECT COUNT(*) AS count FROM notifications WHERE type = 'overdue_payment';`)
  );
  expect(afterRescan).toBe(1);

  // Done closes the alert and clears the badge.
  await navigateToPage(page, 'notifications');
  await page.getByRole('button', { name: `Mark ${alertTitle} done` }).click();
  await expect(page.getByTestId('notifications-tab-due')).toContainText('Due (0)', { timeout: 30_000 });
  await expect(badgeOf(page)).toHaveClass(/MuiBadge-invisible/);
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
        Number(await runQueryAndReadFirstCell(page, `SELECT lead_days FROM notification_settings WHERE type = 'birthday';`)),
      { timeout: 30_000 }
    )
    .toBe(21);

  await reloadAndUnlock(page);

  await navigateToPage(page, 'settings');
  await page.getByRole('tab', { name: 'Notifications' }).click();
  await expect(page.getByTestId('notification-setting-birthday-lead')).toHaveValue('21', { timeout: 30_000 });
  await expect(page.getByTestId('notification-setting-seasonal-enabled')).not.toBeChecked();
  await page.getByRole('button', { name: 'Close settings' }).click();

  const seasonalRow = await runQueryAndReadFirstCell(
    page,
    `SELECT enabled FROM notification_settings WHERE type = 'seasonal';`
  );
  expect(Number(seasonalRow)).toBe(0);
});
