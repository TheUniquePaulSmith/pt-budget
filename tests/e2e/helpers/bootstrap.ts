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
  /** Extra raw query string (e.g. 'syncDebounceMs=1000') appended to the initial navigation. */
  extraQueryParams?: string;
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
  const { loadSampleData = true, sampleDataTransactionLimit = 500, extraQueryParams } = options;

  await seedBrowserCompatibility(page);

  const baseUrl = loadSampleData
    ? `/?loadSampleData&sampleDataTransactionLimit=${sampleDataTransactionLimit}`
    : '/';
  const url = extraQueryParams
    ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${extraQueryParams}`
    : baseUrl;

  await page.goto(url);

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

      // Password setup always lands on the initial-account screen next;
      // default e2e runs skip it unless a test explicitly wants an account.
      await page.getByTestId('skip-initial-account').click();

      // Then the storage-choice screen; default e2e runs to a local
      // database unless a test explicitly drives the cloud-storage flow.
      await page.getByTestId('storage-choice-local').click();
    }
  }

  await expect(sqlQueryButton).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('database-status-text')).toHaveText(
    'Connected',
    { timeout: 120_000 }
  );
}

/**
 * Reloads the page and, if a SharedWorker with no other connected tabs was
 * torn down as a result, re-enters the password at the needs-unlock screen
 * (the encrypting VFS requires it before the database can be opened again).
 * Safe to call when another page in the same context kept the worker alive
 * too — in that case the app skips straight to Connected.
 */
export async function reloadAndUnlock(page: Page, password: string = TEST_PASSWORD) {
  await page.reload();

  const passwordInput = page.getByLabel('Password', { exact: true });
  const sqlQueryButton = page.getByRole('button', { name: 'SQL Query' });

  await Promise.race([
    passwordInput.waitFor({ state: 'visible', timeout: 120_000 }),
    sqlQueryButton.waitFor({ state: 'visible', timeout: 120_000 }),
  ]);

  if (await passwordInput.isVisible().catch(() => false)) {
    await passwordInput.fill(password);
    await page.getByRole('button', { name: 'Unlock' }).click();
  }

  await expect(sqlQueryButton).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('database-status-text')).toHaveText(
    'Connected',
    { timeout: 120_000 }
  );
}

export async function runQuery(page: Page, sql: string) {
  await page.getByRole('button', { name: 'SQL Query' }).click();
  // The query box is a CodeMirror editor: `sql-query-input` tags its outer
  // wrapper, but `.fill()` needs the actual contenteditable `.cm-content`
  // node inside it.
  await page.getByTestId('sql-query-input').locator('.cm-content').fill(sql);
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
