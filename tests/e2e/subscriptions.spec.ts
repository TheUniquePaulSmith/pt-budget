import { expect, test, type Page } from '@playwright/test';

const browserCompatibilityResults = {
  sharedWorkerSupport: true,
  wasmSupport: true,
  sqliteSupport: true,
  vfsSupport: true,
  overallCompatible: true,
};

const SMOKE_SAMPLE_DATA_TRANSACTION_LIMIT = 500;

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

    // exact: true — a bare 'Password' label also matches 'Confirm Password'
    const passwordInput = page.getByLabel('Password', { exact: true });
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

async function runQueryAndReadFirstCell(page: Page, sql: string) {
  await page.getByRole('button', { name: 'SQL Query' }).click();
  await page.getByTestId('sql-query-input').fill(sql);
  await page.getByRole('button', { name: 'Execute Query' }).click();
  await expect(page.getByTestId('sql-query-results')).toBeVisible();

  return (await page.locator('tbody td').first().textContent())?.trim() ?? '';
}

test('@smoke seeds community merchant rules and renders the Subscriptions page', async ({ page }) => {
  await bootstrapDatabase(page);

  // The migration runner created merchant_rules and the seeder populated it
  const communityRuleCount = Number(
    await runQueryAndReadFirstCell(
      page,
      `SELECT COUNT(*) AS count FROM merchant_rules WHERE source = 'community';`
    )
  );
  expect(communityRuleCount).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Subscriptions' }).click();
  await expect(
    page.getByRole('heading', { name: 'Subscriptions' })
  ).toBeVisible({ timeout: 120_000 });
});

test('runs a subscription scan and persists a user-created merchant rule', async ({ page }) => {
  await bootstrapDatabase(page);

  await page.getByRole('button', { name: 'Subscriptions' }).click();
  await expect(
    page.getByRole('heading', { name: 'Subscriptions' })
  ).toBeVisible({ timeout: 120_000 });

  // The header Rescan button always exists (the empty-state CTA can detach
  // while unmatched clusters load, so it is not a stable click target)
  await page.getByRole('button', { name: 'Rescan' }).click();
  await expect(page.getByText(/Scan complete/)).toBeVisible({ timeout: 120_000 });

  // Create a user rule via the rule editor
  await page.getByRole('button', { name: 'Add Rule' }).click();
  const ruleDialog = page.getByRole('dialog', { name: 'Create Merchant Rule' });
  await ruleDialog.getByLabel('Pattern').fill('PLAYWRIGHTFLIX');
  await ruleDialog.getByLabel('Merchant').fill('Playwrightflix');
  await ruleDialog.getByRole('button', { name: 'Create Rule' }).click();
  await expect(ruleDialog).not.toBeVisible({ timeout: 120_000 });

  const userRuleCount = Number(
    await runQueryAndReadFirstCell(
      page,
      `SELECT COUNT(*) AS count FROM merchant_rules WHERE source = 'user' AND pattern = 'PLAYWRIGHTFLIX';`
    )
  );
  expect(userRuleCount).toBe(1);

  // The rule survives a reload (persisted through the worker VFS)
  await page.reload();
  await expect(page.getByTestId('database-status-text')).toHaveText(
    'Connected',
    { timeout: 120_000 }
  );

  const reloadedRuleCount = Number(
    await runQueryAndReadFirstCell(
      page,
      `SELECT COUNT(*) AS count FROM merchant_rules WHERE source = 'user' AND pattern = 'PLAYWRIGHTFLIX';`
    )
  );
  expect(reloadedRuleCount).toBe(1);
});
