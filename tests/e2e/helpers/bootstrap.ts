import { expect, type Page } from '@playwright/test';

export const TEST_PASSWORD = 'TestPassword1!';
export const TEST_PRIMARY_USER_NAME = 'TestUser';

const browserCompatibilityResults = {
  sharedWorkerSupport: true,
  wasmSupport: true,
  sqliteSupport: true,
  vfsSupport: true,
  overallCompatible: true,
};

export async function seedBrowserCompatibility(page: Page) {
  await page.addInitScript((results) => {
    window.localStorage.setItem(
      'budgetApp_browserTestPassed',
      JSON.stringify(results)
    );
  }, browserCompatibilityResults);
}

export interface BootstrapDatabaseOptions {
  /** Appends ?loadSampleData to the initial navigation (default true). */
  loadSampleData?: boolean;
  /** Caps imported sample transactions to keep runs fast (default 500). */
  sampleDataTransactionLimit?: number;
  primaryUserName?: string;
  password?: string;
}

/**
 * Fills the database setup screen (primary user + password fields) without
 * submitting it.
 */
export async function fillDatabaseSetupForm(
  page: Page,
  {
    primaryUserName = TEST_PRIMARY_USER_NAME,
    password = TEST_PASSWORD,
  }: Pick<BootstrapDatabaseOptions, 'primaryUserName' | 'password'> = {}
) {
  await page.getByLabel('Primary User Name').fill(primaryUserName);
  // exact: true — a bare 'Password' label also matches 'Confirm Password'
  // and trips Playwright's strict mode.
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm Password').fill(password);
}

/**
 * Creates (or reuses) the browser-backed database and waits until the app
 * shell reports Connected. Safe to call on a second page in the same
 * context: when the worker already holds the encryption key the setup
 * screen is skipped by the app.
 */
export async function bootstrapDatabase(
  page: Page,
  options: BootstrapDatabaseOptions = {}
) {
  const { loadSampleData = true, sampleDataTransactionLimit = 500 } = options;

  await seedBrowserCompatibility(page);

  await page.goto(
    loadSampleData
      ? `/?loadSampleData&sampleDataTransactionLimit=${sampleDataTransactionLimit}`
      : '/'
  );

  const createDatabaseButton = page.getByRole('button', {
    name: 'Create New Database',
  });
  const sqlQueryButton = page.getByRole('button', { name: 'SQL Query' });

  await Promise.race([
    createDatabaseButton.waitFor({ state: 'visible', timeout: 120_000 }),
    sqlQueryButton.waitFor({ state: 'visible', timeout: 120_000 }),
  ]);

  if (await createDatabaseButton.isVisible().catch(() => false)) {
    await createDatabaseButton.click();

    // The database setup screen (primary user name + password) appears after
    // clicking Create New Database — unless another page in this context
    // already supplied the encryption key, in which case the app skips it.
    const primaryUserInput = page.getByLabel('Primary User Name');
    const isSetupScreen = await primaryUserInput
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);

    if (isSetupScreen) {
      await fillDatabaseSetupForm(page, options);
      await page.getByRole('button', { name: 'Create Database' }).click();
    }
  }

  await expect(sqlQueryButton).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('database-status-text')).toHaveText(
    'Connected',
    { timeout: 120_000 }
  );
}

export async function runQuery(page: Page, sql: string) {
  await page.getByRole('button', { name: 'SQL Query' }).click();
  await page.getByTestId('sql-query-input').fill(sql);
  await page.getByRole('button', { name: 'Execute Query' }).click();
  await expect(page.getByTestId('sql-query-results')).toBeVisible();
}

/**
 * Runs a query on the SQL page and returns the first data cell of the
 * results DataGrid (first column of the first row).
 */
export async function runQueryAndReadFirstCell(page: Page, sql: string) {
  await runQuery(page, sql);

  const firstCell = page
    .getByTestId('sql-query-results')
    .getByRole('gridcell')
    .first();
  await firstCell.waitFor({ state: 'visible', timeout: 30_000 });
  return (await firstCell.textContent())?.trim() ?? '';
}
