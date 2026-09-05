import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { bootstrapDatabase, runQueryAndReadFirstCell } from '../e2e/helpers/bootstrap';

// Developer tool (see playwright.fixture-export.config.ts): exports an
// encrypted database archive from the build currently being served, seeded
// with the local sample-data fixtures and a completed subscription scan, so a
// later schema migration can be tested against a real older-schema archive.
//
// Run from a checkout of the schema version to capture, with the sample-data
// fixtures generated at the generator's natural row count so monthly charges
// stay single rows and the scan produces recurring series:
//   npm run sample-data:generate -- --months=12 --count=130 --seed=review
//   npx playwright test --config playwright.fixture-export.config.ts
// Output: tests/e2e/fixtures/v1-budget-tracker.zip (password: TEST_PASSWORD)
const OUTPUT_PATH = path.join(__dirname, '..', 'e2e', 'fixtures', 'v1-budget-tracker.zip');

test('export a v1 database archive with sample data', async ({ page }) => {
  await bootstrapDatabase(page, { sampleDataTransactionLimit: 300 });

  // Run a subscription scan so the archive carries recurring_series rows and
  // transaction_series_links (the FK-cascade case the migration must preserve).
  await page.getByRole('button', { name: 'Subscriptions' }).click();
  await page.getByRole('button', { name: /Scan Transactions|Rescan/ }).first().click();
  await expect(page.getByText(/Scan complete/)).toBeVisible({ timeout: 120_000 });

  // The archive must carry series links so the migration's FK-cascade guard is
  // actually exercised by the upgrade test.
  const linkCount = Number(
    await runQueryAndReadFirstCell(page, 'SELECT COUNT(*) FROM transaction_series_links')
  );
  const seriesCount = Number(
    await runQueryAndReadFirstCell(page, 'SELECT COUNT(*) FROM recurring_series')
  );
  console.log(`Fixture will carry ${seriesCount} series and ${linkCount} links`);
  expect(linkCount).toBeGreaterThan(0);

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120_000 }),
    (async () => {
      await page.getByRole('button', { name: 'Settings' }).click();
      await page.getByRole('tab', { name: 'Data & Backup' }).click({ timeout: 10_000 });
      await page.getByRole('button', { name: /Export Database/i }).click({ timeout: 10_000 });
    })(),
  ]);

  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.copyFileSync(downloadedPath!, OUTPUT_PATH);
  console.log(`Wrote ${OUTPUT_PATH} (${fs.statSync(OUTPUT_PATH).size} bytes)`);
});
