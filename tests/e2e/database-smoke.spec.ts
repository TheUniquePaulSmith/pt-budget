import { expect, test, type Page } from '@playwright/test';

const browserCompatibilityResults = {
  sharedWorkerSupport: true,
  wasmSupport: true,
  sqliteSupport: true,
  vfsSupport: true,
  overallCompatible: true,
};

const DEFAULT_SAMPLE_DATA_EXPENSE_ACCOUNT_NAME = 'Household Checking';
const SMOKE_SAMPLE_DATA_TRANSACTION_LIMIT = 1000;

async function seedBrowserCompatibility(page: Page) {
  await page.addInitScript((results) => {
    window.localStorage.setItem(
      'budgetApp_browserTestPassed',
      JSON.stringify(results)
    );
  }, browserCompatibilityResults);
}

async function bootstrapDatabase(page: Page) {
  await seedBrowserCompatibility(page);

  await page.goto(
    `/?loadSampleData&sampleDataTransactionLimit=${SMOKE_SAMPLE_DATA_TRANSACTION_LIMIT}`
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

    // New: the password setup screen appears after clicking Create New Database.
    const passwordInput = page.getByLabel('Password');
    const isPasswordScreen = await passwordInput
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);

    if (isPasswordScreen) {
      await passwordInput.fill('TestPassword1!');
      await page.getByLabel('Confirm Password').fill('TestPassword1!');
      await page.getByRole('button', { name: 'Create Database' }).click();
    }
  }

  await expect(sqlQueryButton).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('database-status-text')).toHaveText(
    'Connected',
    { timeout: 120_000 }
  );
}

async function runQuery(page: Page, sql: string) {
  await page.getByRole('button', { name: 'SQL Query' }).click();
  await page.getByTestId('sql-query-input').fill(sql);
  await page.getByRole('button', { name: 'Execute Query' }).click();
  await expect(page.getByTestId('sql-query-results')).toBeVisible();
}

async function runQueryAndReadFirstCell(page: Page, sql: string) {
  await runQuery(page, sql);

  return (await page.locator('tbody td').first().textContent())?.trim() ?? '';
}

async function addTrip(page: Page, tripName: string) {
  await page.getByRole('button', { name: 'Trips' }).click();
  await page.getByRole('button', { name: 'Add Trip' }).click();

  const tripDialog = page.getByRole('dialog');
  await tripDialog.getByLabel('Trip Name').fill(tripName);
  await tripDialog.getByRole('button', { name: 'Add' }).click();

  await expect(tripDialog).not.toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(tripName)).toBeVisible({ timeout: 120_000 });
}

async function addTransactionFromDashboard(
  page: Page,
  description: string,
  amount: string,
  accountName: string,
  projectName?: string
) {
  await page.getByRole('button', { name: 'Dashboard' }).click();
  await page.getByRole('button', { name: 'Add Transaction' }).first().click();

  const transactionDialog = page.getByRole('dialog', { name: 'Add New Transaction' });
  await transactionDialog.getByRole('textbox', { name: 'Description' }).fill(description);
  await transactionDialog.getByRole('spinbutton', { name: 'Amount' }).fill(amount);

  if (projectName) {
    await transactionDialog
      .getByRole('combobox', { name: 'House Project (Optional)' })
      .click();
    await page.getByRole('option', { name: new RegExp(projectName, 'i') }).click();
  }

  await transactionDialog.locator('[role="combobox"]').last().click();
  await page.getByRole('option', { name: new RegExp(accountName, 'i') }).click();
  await transactionDialog.getByRole('button', { name: 'Add Transaction' }).click();

  await expect(transactionDialog).not.toBeVisible({ timeout: 120_000 });
}

async function createProject(page: Page, projectName: string) {
  await page.getByRole('button', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'Add Project' }).click();

  const projectDialog = page.getByRole('dialog');
  await projectDialog.getByLabel('Project Name').fill(projectName);
  await projectDialog.getByLabel('Company Name').fill('Playwright Builders');
  await projectDialog.getByLabel('Contact Details').fill('builder@example.com');
  await projectDialog.getByRole('button', { name: 'Add Project' }).click();

  await expect(projectDialog).not.toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(projectName)).toBeVisible({ timeout: 120_000 });
}

test('@smoke creates and reopens the browser-backed database', async ({ page }) => {
  await bootstrapDatabase(page);

  const initialCount = Number(
    await runQueryAndReadFirstCell(
      page,
      'SELECT COUNT(*) AS count FROM transactions;'
    )
  );
  expect(initialCount).toBeGreaterThan(0);

  await page.reload();
  await expect(
    page.getByRole('button', { name: 'SQL Query' })
  ).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('database-status-text')).toHaveText(
    'Connected',
    { timeout: 120_000 }
  );

  const reloadedCount = Number(
    await runQueryAndReadFirstCell(
      page,
      'SELECT COUNT(*) AS count FROM transactions;'
    )
  );
  expect(reloadedCount).toBe(initialCount);
});

test('shares the browser-backed database across two pages in one context', async ({ page }) => {
  await bootstrapDatabase(page);

  const secondPage = await page.context().newPage();
  await bootstrapDatabase(secondPage);

  const tripName = `Playwright Trip ${Date.now()}`;
  const verifyTripQuery = `SELECT COUNT(*) AS count FROM trips WHERE name = '${tripName}';`;

  await addTrip(page, tripName);

  await expect(secondPage.getByTestId('database-status-text')).toHaveText(
    'Connected',
    { timeout: 120_000 }
  );

  const secondPageCount = Number(
    await runQueryAndReadFirstCell(secondPage, verifyTripQuery)
  );
  expect(secondPageCount).toBe(1);
});

test('creates a transaction through the dashboard dialog and persists it', async ({ page }) => {
  await bootstrapDatabase(page);

  const description = `Playwright Expense ${Date.now()}`;
  await addTransactionFromDashboard(
    page,
    description,
    '123.45',
    DEFAULT_SAMPLE_DATA_EXPENSE_ACCOUNT_NAME
  );

  const insertedCount = Number(
    await runQueryAndReadFirstCell(
      page,
      `SELECT COUNT(*) AS count FROM transactions WHERE description = '${description}';`
    )
  );
  expect(insertedCount).toBe(1);

  const insertedAmount = Number(
    await runQueryAndReadFirstCell(
      page,
      `SELECT amount FROM transactions WHERE description = '${description}' ORDER BY id DESC LIMIT 1;`
    )
  );
  expect(insertedAmount).toBeCloseTo(-123.45, 2);
});

test('updates a transaction label from the report and can clear it again', async ({ page }) => {
  await bootstrapDatabase(page);

  const projectName = `Playwright Label Project ${Date.now()}`;
  const description = `Label Expense ${Date.now()}`;

  await createProject(page, projectName);
  await addTransactionFromDashboard(
    page,
    description,
    '42.75',
    DEFAULT_SAMPLE_DATA_EXPENSE_ACCOUNT_NAME
  );

  await page.getByRole('button', { name: 'Transactions' }).click();
  await page.getByRole('textbox', { name: 'Search' }).fill(description);

  let transactionRow = page.locator('tr').filter({
    has: page.getByText(description),
  }).first();
  await transactionRow.getByTitle('Label Transaction').click();

  let labelDialog = page.getByRole('dialog', { name: 'Label Transaction' });
  await labelDialog.locator('[role="combobox"]').first().click();
  await page.getByRole('option', { name: 'Project' }).click();
  await labelDialog.getByLabel('Select Project').click();
  await page.getByRole('option', { name: new RegExp(projectName, 'i') }).click();
  await labelDialog.getByRole('button', { name: 'Update Label' }).click();

  await expect(labelDialog).not.toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(`Project: ${projectName}`)).toBeVisible({
    timeout: 120_000,
  });

  transactionRow = page.locator('tr').filter({
    has: page.getByText(description),
  }).first();
  await transactionRow.getByTitle('Label Transaction').click();

  labelDialog = page.getByRole('dialog', { name: 'Label Transaction' });
  await labelDialog.locator('[role="combobox"]').first().click();
  await page.getByRole('option', { name: 'No Label' }).click();
  await labelDialog.getByRole('button', { name: 'Update Label' }).click();

  await expect(labelDialog).not.toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(`Project: ${projectName}`)).toHaveCount(0);
});

test('creates a project-linked transaction and shows the project label in the report', async ({ page }) => {
  await bootstrapDatabase(page);

  const projectName = `Playwright Project ${Date.now()}`;
  const description = `Project Expense ${Date.now()}`;

  await createProject(page, projectName);
  await addTransactionFromDashboard(
    page,
    description,
    '88.10',
    DEFAULT_SAMPLE_DATA_EXPENSE_ACCOUNT_NAME,
    projectName
  );

  await page.getByRole('button', { name: 'Transactions' }).click();
  await page.getByRole('textbox', { name: 'Search' }).fill(description);

  await expect(page.getByText(description)).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(`Project: ${projectName}`)).toBeVisible({ timeout: 120_000 });
});

test('shows worker disconnection and recovers after reload', async ({ page }) => {
  await bootstrapDatabase(page);

  await page.evaluate(() => {
    window.__budgetTrackerTestApi?.disconnectWorker();
  });

  await expect(page.getByTestId('database-status-text')).toHaveText('Disconnected', {
    timeout: 120_000,
  });

  await page.reload();

  await expect(page.getByTestId('database-status-text')).toHaveText('Connected', {
    timeout: 120_000,
  });
});