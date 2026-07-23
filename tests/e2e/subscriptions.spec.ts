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
  await reloadAndUnlock(page);

  const reloadedRuleCount = Number(
    await runQueryAndReadFirstCell(
      page,
      `SELECT COUNT(*) AS count FROM merchant_rules WHERE source = 'user' AND pattern = 'PLAYWRIGHTFLIX';`
    )
  );
  expect(reloadedRuleCount).toBe(1);
});
