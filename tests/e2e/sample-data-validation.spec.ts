import fs from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { bootstrapDatabase, navigateToPage, runQueryAndReadFirstCell } from './helpers/bootstrap';
import { incomeExpr, spendExpr } from '../../src/lib/sqlMoneyExpressions';

// End-to-end half of the sample-data validation (the `sample-data` skill).
// The generator writes public/sample-data/expectations.json next to the
// fixtures: what the app should show once ?loadSampleData has imported them
// and its own scans (classification on open, loan rules on the Loans page,
// subscription detection on Rescan) have run. This spec loads the whole set
// and reads the app back through the SQL page and the feature pages.
//
// Companion: src/lib/sampleDataExpectations.test.ts does the same against
// the real DatabaseService on Node's SQLite, in seconds.

interface Manifest {
  natural: boolean;
  reason?: string;
  window: { referenceDate: string; completeMonths: string[] };
  transactions: { total: number };
  months: Array<{ month: string; rowCount: number; income: number; expenses: number; spendByCategory: Record<string, number> }>;
  accounts: Array<{ id: number; name: string; endingBalance: number; tracksBalanceBySnapshots: boolean }>;
  transfers: { pairCount: number; expectedTransferRowCount: number };
  refunds: unknown[];
  loans: Array<{ id: number; name: string; ruleLinked: boolean; expectedPaymentCount: number; originalPrincipal: number; paymentDescription: string }>;
  subscriptions: Array<{ description: string; detectable: boolean }>;
  budget: { funds: Array<{ name: string }> };
  projects: Array<{ id: number; linkedRows: number }>;
  trips: Array<{ id: number; linkedRows: number }>;
}

const MANIFEST_PATH = path.join(__dirname, '..', '..', 'public', 'sample-data', 'expectations.json');
const manifest: Manifest | null = fs.existsSync(MANIFEST_PATH) ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) : null;

function monthRange(month: string): [string, string] {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(lastDay).padStart(2, '0')}`];
}

const money = (value: number) => value.toFixed(2);

test.describe('Sample data validation', () => {
  test.skip(!manifest, 'public/sample-data/expectations.json is missing: run `node scripts/generate-sample-data.mjs --months=12 --seed=review`');
  test.skip(Boolean(manifest && !manifest.natural), `fixtures are not natural (${manifest?.reason ?? 'regenerate without --count'})`);

  test('the full sample set imports, classifies, links loans, detects series and matches the expectations manifest', async ({ page }) => {
    const expected = manifest as Manifest;
    const cell = (sql: string) => runQueryAndReadFirstCell(page, sql);

    // Every row: no transaction cap.
    await bootstrapDatabase(page, { sampleDataTransactionLimit: 1_000_000 });

    // 1. Import completeness.
    expect(await cell('SELECT COUNT(*) FROM transactions')).toBe(String(expected.transactions.total));
    expect(await cell('SELECT COUNT(*) FROM loans')).toBe(String(expected.loans.length));
    expect(await cell("SELECT COUNT(*) FROM classification_rules WHERE source = 'user'")).not.toBe('0');

    // 2. The one-time classification scan ran when the database opened.
    expect(await cell("SELECT COUNT(*) FROM transactions WHERE type = 'transfer'")).toBe(String(expected.transfers.expectedTransferRowCount));
    expect(await cell("SELECT COUNT(*) FROM transactions WHERE type = 'refund'")).toBe(String(expected.refunds.length));
    // Each pair: two legs, one group, two accounts, amounts that cancel.
    expect(
      await cell(
        "SELECT COUNT(*) FROM transactions a JOIN transactions b ON b.transfer_group_id = a.transfer_group_id AND b.id > a.id WHERE a.type = 'transfer' AND a.account_id != b.account_id AND a.amount = -b.amount"
      )
    ).toBe(String(expected.transfers.pairCount));
    // The rest are one-legged transfers typed by a classification rule (the 529 contribution).
    expect(await singleLegCount(page)).toBe(expected.transfers.expectedTransferRowCount - expected.transfers.pairCount * 2);

    // 3. Money: the last complete month through the app's own money expressions.
    const lastComplete = expected.window.completeMonths[expected.window.completeMonths.length - 1];
    const month = expected.months.find((candidate) => candidate.month === lastComplete)!;
    const [start, end] = monthRange(lastComplete);
    expect(
      await cell(
        `SELECT printf('%.2f|%.2f|%d', COALESCE(SUM(${incomeExpr()}), 0), COALESCE(SUM(${spendExpr()}), 0), COUNT(*)) FROM transactions t WHERE t.date BETWEEN '${start}' AND '${end}'`
      )
    ).toBe(`${money(month.income)}|${money(month.expenses)}|${month.rowCount}`);
    const groceries = month.spendByCategory['2'] ?? 0;
    expect(
      await cell(`SELECT printf('%.2f', COALESCE(SUM(${spendExpr()}), 0)) FROM transactions t WHERE t.category_id = 2 AND t.date BETWEEN '${start}' AND '${end}'`)
    ).toBe(money(groceries));

    // 4. Account balances: opening balance plus every row since.
    for (const account of expected.accounts.filter((candidate) => !candidate.tracksBalanceBySnapshots)) {
      expect(
        await cell(
          `SELECT printf('%.2f', a.opening_balance + COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.account_id = a.id AND t.date >= a.opening_balance_date), 0)) FROM accounts a WHERE a.id = ${account.id}`
        ),
        account.name
      ).toBe(money(account.endingBalance));
    }

    // 5. Projects and trips carry their linked spend.
    expect(await cell('SELECT COUNT(*) FROM transactions WHERE project_id IS NOT NULL')).toBe(
      String(expected.projects.reduce((sum, project) => sum + project.linkedRows, 0))
    );
    expect(await cell('SELECT COUNT(*) FROM transactions WHERE trip_id IS NOT NULL')).toBe(
      String(expected.trips.reduce((sum, trip) => sum + trip.linkedRows, 0))
    );

    // 6. Loans: opening the page applies the seeded rules; balances fall below principal.
    await navigateToPage(page, 'loans');
    const grid = page.getByTestId('loans-grid');
    for (const loan of expected.loans) {
      await expect(grid.getByText(loan.name)).toBeVisible();
    }
    for (const loan of expected.loans.filter((candidate) => candidate.ruleLinked)) {
      await expect(page.getByTestId(`loan-balance-${loan.id}`)).not.toHaveText(formatUsd(loan.originalPrincipal));
    }
    for (const loan of expected.loans) {
      expect(
        await cell(`SELECT COUNT(*) FROM loan_payments WHERE loan_id = ${loan.id} AND match_source = 'rule'`),
        loan.name
      ).toBe(String(loan.expectedPaymentCount));
    }

    // 7. Subscriptions: a rescan detects every fixed series and skips the linked loan payments.
    await navigateToPage(page, 'subscriptions');
    await expect(page.getByRole('heading', { name: 'Subscriptions', exact: true, level: 4 })).toBeVisible();
    await page.getByRole('button', { name: 'Rescan' }).click();
    await expect(page.getByText(/Scan complete/)).toBeVisible();
    const detectable = expected.subscriptions.filter((series) => series.detectable);
    expect(Number(await cell('SELECT COUNT(*) FROM recurring_series'))).toBeGreaterThanOrEqual(detectable.length);
    for (const series of detectable) {
      expect(
        await cell(`SELECT COUNT(*) FROM recurring_series WHERE match_key = 'desc:${series.description}'`),
        series.description
      ).toBe('1');
    }
    for (const loan of expected.loans.filter((candidate) => candidate.ruleLinked)) {
      expect(await cell(`SELECT COUNT(*) FROM recurring_series WHERE match_key = 'desc:${loan.paymentDescription}'`), loan.name).toBe('0');
    }

    // 8. Budget: the plans and the two savings funds are there and the status panel renders.
    await navigateToPage(page, 'budget');
    await expect(page.getByRole('heading', { name: 'Budget', exact: true })).toBeVisible();
    await expect(page.getByTestId('budget-status-panel')).toBeVisible();
    const fundsCard = page.getByTestId('budget-funds-card');
    await expect(fundsCard).toBeVisible();
    for (const fund of expected.budget.funds) {
      await expect(fundsCard).toContainText(fund.name);
    }

    // 9. Dashboard renders income and expense totals for the default range.
    await navigateToPage(page, 'dashboard');
    await expect(page.getByRole('heading', { name: 'Total Income' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Total Expenses' })).toBeVisible();
  });
});

async function singleLegCount(page: Page): Promise<number> {
  return Number(
    await runQueryAndReadFirstCell(page, "SELECT COUNT(*) FROM transactions WHERE type = 'transfer' AND transfer_group_id IS NULL")
  );
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
