import fs from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { bootstrapDatabase, navigateToPage, runQueryAndReadFirstCell } from './helpers/bootstrap';

// Trip business expenses (schema v9): a trip marked business + personal, its
// charges split into a business part to be paid back and a personal rest,
// the reimbursement received, and the trip's Insights with the business part
// filtered out.

const currency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

interface TripExpectation {
  id: number;
  name: string;
  linkedSpend: number;
  expenseMode?: string;
  businessShare?: number;
  personalShare?: number;
  received?: number;
}

const MANIFEST_PATH = path.join(__dirname, '..', '..', 'public', 'sample-data', 'expectations.json');
const manifest: { natural: boolean; trips?: TripExpectation[] } | null = fs.existsSync(MANIFEST_PATH)
  ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  : null;
const seededMixedTrip = manifest?.natural ? manifest.trips?.find((trip) => trip.expenseMode === 'mixed') : undefined;

async function addTransactionFromDashboard(page: Page, description: string, amount: string) {
  await page.getByRole('button', { name: 'Dashboard' }).click();
  await page.getByRole('button', { name: 'Add Transaction' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add New Transaction' });
  await dialog.getByRole('textbox', { name: 'Description' }).fill(description);
  await dialog.getByRole('spinbutton', { name: 'Amount' }).fill(amount);
  await dialog.getByRole('combobox', { name: 'Account' }).click();
  await page.getByRole('option', { name: /Household Checking/i }).click();
  await dialog.getByRole('button', { name: 'Add Transaction' }).click();
  await expect(dialog).not.toBeVisible();
}

async function openTrip(page: Page, name: string) {
  await navigateToPage(page, 'trips');
  await page.getByRole('button', { name: `View details of ${name}` }).click();
  await expect(page.getByTestId('trip-detail')).toBeVisible();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

test('@smoke the seeded work trip shows business, personal and what came back', async ({ page }) => {
  test.skip(!seededMixedTrip, 'needs natural sample-data fixtures with expectations.json');
  const trip = seededMixedTrip!;
  await bootstrapDatabase(page);

  await navigateToPage(page, 'trips');
  await expect(page.getByTestId(`trip-card-personal-${trip.id}`)).toContainText(currency(trip.personalShare ?? 0));

  await openTrip(page, trip.name);
  await expect(page.getByTestId('trip-figure-spent')).toHaveText(currency(trip.linkedSpend));
  await expect(page.getByTestId('trip-figure-business')).toHaveText(currency(trip.businessShare ?? 0));
  await expect(page.getByTestId('trip-figure-personal')).toHaveText(currency(trip.personalShare ?? 0));
  await expect(page.getByTestId('trip-figure-received')).toHaveText(currency(trip.received ?? 0));

  // Insights opens on the personal part: what the trip really cost.
  await page.getByTestId('trip-tab-insights').click();
  await expect(page.getByTestId('trip-insights-total')).toHaveText(currency(trip.personalShare ?? 0));
  await page.getByTestId('trip-insights-view-business').click();
  await expect(page.getByTestId('trip-insights-total')).toHaveText(currency(trip.businessShare ?? 0));
  await page.getByTestId('trip-insights-view-all').click();
  await expect(page.getByTestId('trip-insights-total')).toHaveText(currency(trip.linkedSpend));
});

test('assigns charges to a mixed trip, splits them and records the reimbursement', async ({ page }) => {
  await bootstrapDatabase(page);
  const stamp = Date.now();
  const tripName = `Denver Offsite ${stamp}`;
  const flight = `Offsite Flight ${stamp}`;
  const hotel = `Offsite Hotel ${stamp}`;
  const souvenirs = `Offsite Souvenirs ${stamp}`;

  // A trip for both: some charges go on the expense report, some are ours.
  await navigateToPage(page, 'trips');
  await page.getByRole('button', { name: 'Add Trip' }).click();
  const tripDialog = page.getByRole('dialog', { name: 'Add New Trip' });
  await tripDialog.getByLabel('Trip Name').fill(tripName);
  await tripDialog.getByRole('combobox', { name: 'Expenses' }).click();
  await page.getByRole('option', { name: 'Business + personal' }).click();
  await tripDialog.getByLabel('Reimbursed by').fill('Acme Corp');
  await tripDialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(tripDialog).not.toBeVisible();

  await addTransactionFromDashboard(page, flight, '400.25');
  await addTransactionFromDashboard(page, hotel, '600');
  await addTransactionFromDashboard(page, souvenirs, '80.5');

  // Transactions page: filter to the three charges and put them on the trip in one go.
  await navigateToPage(page, 'transactions');
  await page.getByRole('textbox', { name: 'Search' }).fill(`Offsite`);
  const rows = page.getByRole('row').filter({ hasText: String(stamp) });
  await expect(rows).toHaveCount(3);
  for (const row of await rows.all()) {
    await row.getByRole('checkbox').check();
  }
  await page.getByTestId('bulk-set-trip').click();
  const bulkDialog = page.getByRole('dialog', { name: 'Set Trip' });
  await bulkDialog.getByTestId('bulk-trip-select').fill(tripName);
  await page.getByRole('option', { name: tripName }).click();
  await bulkDialog.getByTestId('bulk-trip-apply').click();
  await expect(bulkDialog).not.toBeVisible();

  // The trip filter finds them again.
  await page.getByTestId('transactions-filter-trips').fill(tripName);
  await page.getByRole('option', { name: tripName }).click();
  await expect(page.getByRole('row').filter({ hasText: String(stamp) })).toHaveCount(3);

  // A mixed trip starts personal: the flight is all business, the hotel half.
  await openTrip(page, tripName);
  await expect(page.getByTestId('trip-figure-spent')).toHaveText(currency(1080.75));
  await expect(page.getByTestId('trip-figure-business')).toHaveText(currency(0));

  await page.getByTestId('trip-tab-transactions').click();
  const flightRow = page.getByRole('row').filter({ hasText: flight });
  await flightRow.getByRole('checkbox').check();
  await page.getByTestId('trip-bulk-business').click();
  await expect(flightRow.locator('[data-testid^="trip-row-business-"]')).toHaveText(currency(400.25));
  await expect(flightRow.locator('[data-testid^="trip-row-personal-"]')).toHaveText(currency(0));

  await page.getByRole('button', { name: `Split ${hotel}` }).click();
  const splitDialog = page.getByRole('dialog', { name: 'Business and personal' });
  await splitDialog.getByTestId('trip-split-business-amount').fill('300');
  await expect(splitDialog.getByText(`Personal: ${currency(300)}`)).toBeVisible();
  await splitDialog.getByTestId('trip-split-save').click();
  await expect(splitDialog).not.toBeVisible();

  // Overview: business 700.25 is owed; 380.50 was ours.
  await page.getByTestId('trip-tab-overview').click();
  await expect(page.getByTestId('trip-figure-business')).toHaveText(currency(700.25));
  await expect(page.getByTestId('trip-figure-personal')).toHaveText(currency(380.5));
  await expect(page.getByTestId('trip-figure-outstanding')).toHaveText(currency(700.25));

  // The employer paid back a little less than claimed, inside a paycheck we can't point at.
  await page.getByTestId('trip-record-reimbursement').click();
  const reimburseDialog = page.getByRole('dialog', { name: 'Record reimbursement' });
  await reimburseDialog.getByTestId('trip-reimbursement-amount').fill('690');
  await reimburseDialog.getByTestId('trip-reimbursement-save').click();
  await expect(reimburseDialog).not.toBeVisible();
  await expect(page.getByTestId('trip-figure-received')).toHaveText(currency(690));
  await expect(page.getByTestId('trip-figure-outstanding')).toHaveText(currency(10.25));
  await expect(page.getByTestId('trip-figure-net-cost')).toHaveText(currency(390.75));
  await expect(page.getByTestId('trip-status-count-reimbursed')).toContainText('Reimbursed: 2');

  // Insights, personal view: the half hotel and the souvenirs.
  await page.getByTestId('trip-tab-insights').click();
  await expect(page.getByTestId('trip-insights-total')).toHaveText(currency(380.5));
  await expect(page.getByTestId('trip-insights-rows')).toContainText(souvenirs);
  await expect(page.getByTestId('trip-insights-rows')).not.toContainText(flight);

  // What the UI persisted.
  expect(
    await runQueryAndReadFirstCell(
      page,
      `SELECT printf('%.2f', SUM(ea.business_amount)) FROM trip_expense_allocations ea JOIN trips tr ON tr.id = ea.trip_id WHERE tr.name = '${tripName}' AND ea.status = 'reimbursed'`
    )
  ).toBe('700.25');
});
