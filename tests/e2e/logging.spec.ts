import { readFile } from 'node:fs/promises';

import { expect, test, type Download, type Page } from '@playwright/test';

import { bootstrapDatabase, navigateToPage, runQuery } from './helpers/bootstrap';

const CORRELATION_ID_PATTERN = /^[a-z0-9]+:\d+$/;
const EXPORT_NAME_PATTERN = /^logs-\d{4}-\d{2}-\d{2}\.(ndjson|txt)$/;

async function openDeveloperConsole(page: Page) {
  await navigateToPage(page, 'developer-console');
  await expect(page.getByTestId('developer-console')).toBeVisible();
  // Stop live refreshes so the rows under test stay put.
  const follow = page.getByTestId('log-follow-toggle');
  if (await follow.isChecked()) await follow.click();
}

test('@smoke app and worker log rows share a correlation id and the export downloads both files', async ({ page }) => {
  await bootstrapDatabase(page, { extraQueryParams: 'debug=true' });

  // A user action that round-trips the SharedWorker.
  await navigateToPage(page, 'sql-query');
  await runQuery(page, 'SELECT 42 AS answer');

  await openDeveloperConsole(page);

  // The worker wrote its own rows (source=worker) under the request's correlation id.
  const workerRow = page
    .locator('[data-testid="log-row"][data-source="worker"]')
    .filter({ has: page.getByTestId('log-correlation-chip') })
    .first();
  await expect(workerRow).toBeVisible({ timeout: 30_000 });
  const correlationId = (await workerRow.getAttribute('data-correlation-id')) ?? '';
  expect(correlationId).toMatch(CORRELATION_ID_PATTERN);

  // Clicking the id narrows the view to that request: the app row that sent it and the worker rows handling it.
  await workerRow.getByTestId('log-correlation-chip').click();
  await expect(page.getByTestId('log-correlation-filter')).toHaveValue(correlationId);
  const correlatedRows = page.locator(`[data-testid="log-row"][data-correlation-id="${correlationId}"]`);
  await expect(correlatedRows.locator('visible=true').first()).toBeVisible();
  await expect(page.locator('[data-testid="log-row"][data-source="app"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="log-row"][data-source="worker"]').first()).toBeVisible();
  await expect(page.locator(`[data-testid="log-row"]:not([data-correlation-id="${correlationId}"])`)).toHaveCount(0);

  // The app row names the page the request came from.
  await expect(page.locator('[data-testid="log-row"][data-source="app"]').first()).toContainText('sql-query');

  // Export: logs-<date>.ndjson + logs-<date>.txt, the latter a merged [APP]/[WORKER] timeline.
  const downloads: Download[] = [];
  page.on('download', (download) => downloads.push(download));
  await page.getByTestId('log-export').click();
  await expect.poll(() => downloads.length, { timeout: 30_000 }).toBe(2);

  const names = downloads.map((download) => download.suggestedFilename()).sort();
  expect(names[0]).toMatch(EXPORT_NAME_PATTERN);
  expect(names[1]).toMatch(EXPORT_NAME_PATTERN);
  expect(names[0].replace(/\.ndjson$/, '')).toBe(names[1].replace(/\.txt$/, ''));

  const textDownload = downloads.find((download) => download.suggestedFilename().endsWith('.txt'))!;
  const timeline = await readFile((await textDownload.path())!, 'utf8');
  expect(timeline).toContain('[APP]');
  expect(timeline).toContain('[WORKER]');
  expect(timeline).toContain(correlationId);

  const ndjsonDownload = downloads.find((download) => download.suggestedFilename().endsWith('.ndjson'))!;
  const ndjson = await readFile((await ndjsonDownload.path())!, 'utf8');
  const records = ndjson
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { context: { source?: string; correlationId?: string } });
  expect(records.some((record) => record.context.source === 'app' && record.context.correlationId === correlationId)).toBe(true);
  expect(records.some((record) => record.context.source === 'worker' && record.context.correlationId === correlationId)).toBe(true);
});

test('records UI interactions and lets Settings manage retention and clear the store', async ({ page }) => {
  await bootstrapDatabase(page, { extraQueryParams: 'debug=true' });

  await navigateToPage(page, 'budget');
  await openDeveloperConsole(page);

  // The capture-phase tracer recorded the nav click with the control's test id.
  await page.getByTestId('log-search-input').fill('ui.interaction');
  const interactionRow = page.locator('[data-testid="log-row"]').filter({ hasText: 'nav-budget' }).first();
  await expect(interactionRow).toBeVisible({ timeout: 30_000 });

  // Settings → Developer: retention controls and clear.
  await page.getByRole('button', { name: 'Back to application' }).click();
  await navigateToPage(page, 'settings');
  await page.getByRole('tab', { name: 'Developer' }).click();
  await expect(page.getByTestId('log-stored-count')).not.toHaveText('0');
  await expect(page.getByTestId('log-retention-entries')).toBeVisible();
  await expect(page.getByTestId('log-retention-age')).toBeVisible();
  await expect(page.getByTestId('reset-include-logs')).not.toBeChecked();

  await page.getByTestId('log-clear-settings').click();
  await page.getByTestId('log-clear-confirm').click();
  // Only the handful of records written after the clear remain.
  await expect
    .poll(async () => Number((await page.getByTestId('log-stored-count').textContent())?.replace(/[^\d]/g, '') ?? '0'), {
      timeout: 15_000,
    })
    .toBeLessThan(20);
});
