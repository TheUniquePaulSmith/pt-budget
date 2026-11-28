import fs from 'node:fs';
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
  runImport,
  startImport,
  waitForWizardStep,
} from './helpers/importFlow';

/**
 * Schema v8: a payment the device's date calls overdue is only "not
 * confirmed" until an import covers its due date. Re-importing a file that
 * runs past it without the payment confirms it; importing the payment closes it.
 */

const ACCOUNT = 'Household Checking';
const BILL = 'LUMEN ELECTRIC CO-OP';

/** Local calendar date as yyyy-MM-dd (same convention as src/lib/dateOnly.ts). */
function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** The same day of the month `monthsAgo` months back (day 28 at most, so every month has it). */
function monthsAgo(months: number): string {
  const today = new Date();
  return isoDate(new Date(today.getFullYear(), today.getMonth() - months, Math.min(today.getDate(), 28)));
}

function writeStatement(directory: string, name: string, dates: string[]): string {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, name);
  const lines = ['Date,Description,Amount', ...dates.map((date) => `${date},${BILL},-88.40`)];
  fs.writeFileSync(file, `${lines.join('\r\n')}\r\n`);
  return file;
}

async function rescanNotifications(page: Page) {
  await navigateToPage(page, 'notifications');
  await page.getByTestId('notifications-rescan').click();
  await expect(page.getByTestId('notifications-rescan')).toBeEnabled();
}

async function query(page: Page, sql: string): Promise<string> {
  return runQueryAndReadFirstCell(page, sql);
}

test('a missed payment stays "not confirmed" until an import covers its due date', async ({ page }, testInfo) => {
  await bootstrapDatabase(page);

  // Three monthly bills, the last two months ago: by the device's date the
  // next one was due a month ago (well past the posting grace).
  const paidDates = [monthsAgo(4), monthsAgo(3), monthsAgo(2)];
  const missedDue = monthsAgo(1);
  const statement = writeStatement(testInfo.outputPath('statements'), 'lumen-electric.csv', paidDates);

  // Import it, saying the file only covers its own rows (up to two months ago).
  await openImportWizard(page);
  await addStatementFiles(page, statement);
  expect(await startImport(page)).toBe('account');
  await chooseImportAccount(page, 0, ACCOUNT);
  await nextWizardStep(page, 'layout');
  await confirmReadingSettings(page);
  await nextWizardStep(page, 'review');
  await nextWizardStep(page, 'summary');
  const coversThrough = page.getByTestId('import-summary-covers-through');
  await expect(coversThrough).toHaveValue(isoDate(new Date()));
  await coversThrough.fill(paidDates[2]);
  await runImport(page);
  await closeImport(page);

  expect(await query(page, `SELECT data_through || '/' || through_source FROM account_data_checkpoints ORDER BY id DESC LIMIT 1`)).toBe(
    `${paidDates[2]}/user`
  );

  // The import's subscription scan found the bill; make it an active bill paid by hand.
  const seriesName = await query(
    page,
    `SELECT rs.name FROM recurring_series rs
       JOIN transaction_series_links l ON l.series_id = rs.id
       JOIN transactions t ON t.id = l.transaction_id
      WHERE t.description = '${BILL}' LIMIT 1`
  );
  await navigateToPage(page, 'subscriptions');
  await page
    .getByRole('row')
    .filter({ has: page.getByText(seriesName, { exact: true }) })
    .first()
    .getByRole('button', { name: 'View transactions' })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('h2').first()).toHaveText(seriesName);
  await dialog.getByRole('combobox', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'Active', exact: true }).click();
  await expect(dialog.getByTestId('series-autopay-switch')).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  const seriesId = await query(page, `SELECT id FROM recurring_series WHERE name = '${seriesName.replace(/'/g, "''")}'`);
  expect(await query(page, `SELECT next_expected_date FROM recurring_series WHERE id = ${seriesId}`)).toBe(missedDue);
  // Not confirmed on the Subscriptions page either.
  await navigateToPage(page, 'subscriptions');
  await expect(page.getByTestId(`series-not-confirmed-${seriesId}`).first()).toBeVisible();

  // The alert is raised, amber and "not confirmed", with an Import action.
  await rescanNotifications(page);
  const alertKey = `overdue:series:${seriesId}:${missedDue}`;
  const alertId = await query(page, `SELECT id FROM notifications WHERE dedupe_key = '${alertKey}'`);
  await navigateToPage(page, 'notifications');
  const alertRow = page.getByRole('row').filter({ has: page.getByTestId(`notification-import-${alertId}`) });
  await expect(alertRow).toContainText('Not confirmed');
  await expect(alertRow).toContainText(`${seriesName} was due`);
  await expect(alertRow).toContainText(`${ACCOUNT} is imported through`);

  // The Accounts page shows how far the account is imported.
  await navigateToPage(page, 'accounts');
  await page.getByRole('row').filter({ has: page.getByText(ACCOUNT, { exact: true }) }).first().click();
  await expect(page.getByTestId('account-import-status-data-through')).toBeVisible();

  // The Import action opens the Import page.
  await navigateToPage(page, 'notifications');
  await page.getByTestId(`notification-import-${alertId}`).click();
  await waitForWizardStep(page, 'files');
  await closeImport(page);

  // The same file imported today: nothing new, but it now covers the due date, so the miss is confirmed.
  expect(await importStatementFile(page, statement, { accountName: ACCOUNT })).toEqual({ inserted: 0, duplicates: 3 });
  expect(await query(page, `SELECT COUNT(*) FROM account_data_checkpoints WHERE import_batch_id IS NULL`)).toBe('1');
  await rescanNotifications(page);
  await expect(page.getByTestId(`notification-import-${alertId}`)).toBeHidden();
  const confirmedRow = page.getByRole('row').filter({ has: page.getByTestId(`notification-done-${alertId}`) });
  await expect(confirmedRow).toContainText('days overdue');
  expect(await query(page, `SELECT json_extract(payload_json, '$.data_through') FROM notifications WHERE id = ${alertId}`)).toBe(
    isoDate(new Date())
  );

  // A statement with the payment closes the alert.
  const paid = writeStatement(testInfo.outputPath('statements'), 'lumen-electric-paid.csv', [...paidDates, missedDue]);
  expect(await importStatementFile(page, paid, { accountName: ACCOUNT })).toEqual({ inserted: 1, duplicates: 3 });
  await rescanNotifications(page);
  expect(await query(page, `SELECT status FROM notifications WHERE id = ${alertId}`)).toBe('done');
});

test('an account not imported for the set number of months raises an alert until the setting allows longer', async ({ page }, testInfo) => {
  await bootstrapDatabase(page);
  const account = 'Household Joint';
  const lastRow = monthsAgo(8);
  const statement = writeStatement(testInfo.outputPath('statements'), 'old-statement.csv', [monthsAgo(9), lastRow]);

  // An old statement that covers only its own rows: the account's data ends eight months ago.
  await openImportWizard(page);
  await addStatementFiles(page, statement);
  expect(await startImport(page)).toBe('account');
  await chooseImportAccount(page, 0, account);
  await nextWizardStep(page, 'layout');
  await confirmReadingSettings(page);
  await nextWizardStep(page, 'review');
  await nextWizardStep(page, 'summary');
  await page.getByTestId('import-summary-covers-through').fill(lastRow);
  await runImport(page);
  await closeImport(page);

  // Past the default of six months: the alert is raised, with an Import action.
  await rescanNotifications(page);
  const alertId = await query(page, `SELECT id FROM notifications WHERE type = 'stale_account' AND dedupe_key LIKE '%:${lastRow}'`);
  await navigateToPage(page, 'notifications');
  const alertRow = page.getByRole('row').filter({ has: page.getByTestId(`notification-import-${alertId}`) });
  await expect(alertRow).toContainText(`${account}`);
  await expect(alertRow).toContainText('needs a new import');
  await expect(alertRow).toContainText('Account not imported');

  // Twelve months instead: the account is not stale yet, so the alert closes.
  await navigateToPage(page, 'settings');
  await page.getByRole('tab', { name: 'Notifications' }).click();
  const months = page.getByTestId('notification-setting-stale_account-months');
  await expect(months).toHaveValue('6');
  await months.fill('12');
  await months.press('Tab');
  await page.getByRole('button', { name: 'Close settings' }).click();
  await rescanNotifications(page);
  expect(await query(page, `SELECT status FROM notifications WHERE id = ${alertId}`)).toBe('done');
  expect(await query(page, `SELECT value FROM app_metadata WHERE key = 'notifications.staleAccountMonths'`)).toBe('12');
});
