import { expect, test, type Page } from '@playwright/test';

import {
  bootstrapDatabase as bootstrapDatabaseWithOptions,
  reloadAndUnlock,
  runQueryAndReadFirstCell,
} from './helpers/bootstrap';

const SMOKE_SAMPLE_DATA_TRANSACTION_LIMIT = 500;

async function bootstrapDatabase(page: Page) {
  await bootstrapDatabaseWithOptions(page, {
    sampleDataTransactionLimit: SMOKE_SAMPLE_DATA_TRANSACTION_LIMIT,
  });
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
    page.getByRole('heading', { name: 'Subscriptions', exact: true, level: 4 })
  ).toBeVisible({ timeout: 120_000 });
});

test('runs a subscription scan and persists a user-created merchant rule', async ({ page }) => {
  await bootstrapDatabase(page);

  await page.getByRole('button', { name: 'Subscriptions' }).click();
  await expect(
    page.getByRole('heading', { name: 'Subscriptions', exact: true, level: 4 })
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
  await reloadAndUnlock(page);

  const reloadedRuleCount = Number(
    await runQueryAndReadFirstCell(
      page,
      `SELECT COUNT(*) AS count FROM merchant_rules WHERE source = 'user' AND pattern = 'PLAYWRIGHTFLIX';`
    )
  );
  expect(reloadedRuleCount).toBe(1);
});

test('shows a Card column on the series table and links a series to a newly created company', async ({ page }) => {
  await bootstrapDatabase(page);

  await page.getByRole('button', { name: 'Subscriptions' }).click();
  await expect(
    page.getByRole('heading', { name: 'Subscriptions', exact: true, level: 4 })
  ).toBeVisible({ timeout: 120_000 });

  await page.getByRole('button', { name: 'Rescan' }).click();
  await expect(page.getByText(/Scan complete/)).toBeVisible({ timeout: 120_000 });

  // The series grid renders a Card column header (proves cardColumn wiring
  // survives a real render, even though sample data has no cards assigned).
  await expect(page.getByRole('columnheader', { name: 'Card' }).first()).toBeVisible({
    timeout: 30_000,
  });

  // Open the first series' detail dialog via its "View transactions" action.
  await page.getByRole('button', { name: 'View transactions' }).first().click();

  const companyField = page.getByRole('combobox', { name: 'Company' });
  await expect(companyField).toBeVisible({ timeout: 30_000 });

  const newCompanyName = `Playwright Merge Co ${Date.now()}`;
  await companyField.fill(newCompanyName);
  await companyField.press('Enter');

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 30_000 });

  const linkedCount = Number(
    await runQueryAndReadFirstCell(
      page,
      `SELECT COUNT(*) AS count FROM recurring_series rs
       JOIN companies c ON c.id = rs.company_id
       WHERE c.name = '${newCompanyName}';`
    )
  );
  expect(linkedCount).toBe(1);
});

test('stores autopay and due day from the series dialog and shows them in the Payment column', async ({ page }) => {
  await bootstrapDatabase(page);

  await page.getByRole('button', { name: 'Subscriptions' }).click();
  await expect(
    page.getByRole('heading', { name: 'Subscriptions', exact: true, level: 4 })
  ).toBeVisible({ timeout: 120_000 });

  await page.getByRole('button', { name: 'Rescan' }).click();
  await expect(page.getByText(/Scan complete/)).toBeVisible({ timeout: 120_000 });

  // Every series starts as manually paid (schema default is_autopay = 0).
  await expect(page.getByRole('columnheader', { name: 'Payment' }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Manual', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'View transactions' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 30_000 });

  const autopay = dialog.getByTestId('series-autopay-switch');
  await expect(autopay).not.toBeChecked();
  await autopay.check();
  await dialog.getByTestId('series-due-day').fill('15');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  await expect(page.getByText('Autopay', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  const storedCount = Number(
    await runQueryAndReadFirstCell(
      page,
      `SELECT COUNT(*) AS count FROM recurring_series WHERE is_autopay = 1 AND due_day = 15;`
    )
  );
  expect(storedCount).toBe(1);

  // Reopening the dialog shows the stored values.
  await page.getByRole('button', { name: 'Subscriptions' }).click();
  await page.getByRole('button', { name: 'View transactions' }).first().click();
  await expect(page.getByRole('dialog').getByTestId('series-autopay-switch')).toBeChecked({ timeout: 30_000 });
  await expect(page.getByRole('dialog').getByTestId('series-due-day')).toHaveValue('15');
});
