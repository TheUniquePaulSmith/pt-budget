import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { bootstrapDatabase, runQueryAndReadFirstCell } from './helpers/bootstrap';

test('exports custom merchant rules to JSON and re-imports them from Settings', async ({ page }) => {
  await bootstrapDatabase(page, { loadSampleData: false });

  // Create one user rule via the Subscriptions page rule editor.
  await page.getByRole('button', { name: 'Subscriptions' }).click();
  await expect(page.getByRole('heading', { name: 'Subscriptions' })).toBeVisible({
    timeout: 120_000,
  });

  await page.getByRole('button', { name: 'Add Rule' }).click();
  const ruleDialog = page.getByRole('dialog', { name: 'Create Merchant Rule' });
  await ruleDialog.getByLabel('Pattern').fill('BACKUPTESTCO');
  await ruleDialog.getByLabel('Merchant').fill('Backup Test Co');
  await ruleDialog.getByRole('button', { name: 'Create Rule' }).click();
  await expect(ruleDialog).not.toBeVisible({ timeout: 120_000 });

  // Open Settings -> Data & Backup -> Merchant Rules.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: /data & backup/i }).click();
  await expect(page.getByText(/1 of your own/)).toBeVisible({ timeout: 30_000 });

  const exportButton = page.getByRole('button', { name: 'Export Custom Rules' });
  await expect(exportButton).toBeEnabled();

  const downloadPromise = page.waitForEvent('download');
  await exportButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^merchant-rules-custom-\d{4}-\d{2}-\d{2}\.json$/);

  const workDir = mkdtempSync(path.join(tmpdir(), 'merchant-rules-e2e-'));
  const exportedPath = path.join(workDir, download.suggestedFilename());
  await download.saveAs(exportedPath);

  const exported = JSON.parse(readFileSync(exportedPath, 'utf-8'));
  expect(exported.table).toBe('merchant_rules');
  expect(exported.data).toHaveLength(1);
  expect(exported.data[0]).toMatchObject({
    pattern: 'BACKUPTESTCO',
    merchant_name: 'Backup Test Co',
    priority: 50,
    enabled: true,
  });
  const ruleKey = exported.data[0].rule_key as string;
  expect(ruleKey.startsWith('user:')).toBe(true);

  // Edit the export and re-import it: the same rule_key must update the
  // existing row in place rather than creating a duplicate.
  exported.data[0].priority = 5;
  exported.data[0].merchant_name = 'Renamed Backup Co';
  const importedPath = path.join(workDir, 'reimport.json');
  writeFileSync(importedPath, JSON.stringify(exported));

  await page.locator('#import-custom-rules-input').setInputFiles(importedPath);
  await expect(page.getByText(/Imported 1 rule\.?$/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/2 of your own/)).not.toBeVisible();

  // Leave Settings to reach the SQL Query page for verification.
  await page.getByRole('button', { name: 'Close settings' }).click();

  const matchingRowCount = Number(
    await runQueryAndReadFirstCell(
      page,
      `SELECT COUNT(*) AS count FROM merchant_rules WHERE rule_key = '${ruleKey}';`
    )
  );
  expect(matchingRowCount).toBe(1);

  const updatedName = await runQueryAndReadFirstCell(
    page,
    `SELECT merchant_name FROM merchant_rules WHERE rule_key = '${ruleKey}';`
  );
  expect(updatedName).toBe('Renamed Backup Co');

  const updatedPriority = await runQueryAndReadFirstCell(
    page,
    `SELECT priority FROM merchant_rules WHERE rule_key = '${ruleKey}';`
  );
  expect(updatedPriority).toBe('5');
});
