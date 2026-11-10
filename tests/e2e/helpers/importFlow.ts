import { expect, type Page } from '@playwright/test';

import { navigateToPage } from './bootstrap';

/**
 * Importing a statement file through the real UI: the Import page's guided
 * import (src/components/import-wizard/wizard).
 *
 * `importStatementFile` is for specs that need imported rows but are not about
 * the import screens themselves (transfer detection, import history,
 * landing-page screenshots): they call it instead of clicking through the
 * wizard, so they survive changes to it. The smaller helpers below are the
 * building blocks specs about the wizard share.
 */

export interface ImportStatementOptions {
  /** Name of an existing account; every row of the file goes into it. */
  accountName: string;
}

export interface ImportStatementResult {
  /** Rows written to `transactions`. */
  inserted: number;
  /** Rows of the file that were already stored and were left out. */
  duplicates: number;
}

export type ImportWizardStep = 'files' | 'account' | 'layout' | 'review' | 'summary' | 'done';

const READING_SETTINGS = ['dateOrder', 'decimal', 'amountSign'] as const;

/** Opens the Import page from the rail (or the phone's More sheet) on its first step. */
export async function openImportWizard(page: Page) {
  await navigateToPage(page, 'import');
  await expect(page.getByTestId('import-wizard')).toHaveAttribute('data-step', 'files');
}

/** Adds one or more files on the Files step and waits until each has been read. */
export async function addStatementFiles(page: Page, filePaths: string | string[]) {
  const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
  const cards = page.getByTestId('import-file-card');
  const before = await cards.count();
  await page.getByTestId('import-file-input').setInputFiles(paths);
  await expect(cards).toHaveCount(before + paths.length);
  await expect(page.locator('[data-testid="import-file-card"][data-status="reading"]')).toHaveCount(0, { timeout: 30_000 });
}

/** Waits until the wizard shows `step` and is not busy (looking up accounts, importing). */
export async function waitForWizardStep(page: Page, step: ImportWizardStep, timeout = 30_000) {
  await expect(page.getByTestId('import-wizard')).toHaveAttribute('data-step', step, { timeout });
  await expect(page.getByTestId('import-busy')).toBeHidden({ timeout });
}

/**
 * Presses Next on the Files step and resolves with where the wizard went: the
 * Account step, or straight to the Summary for a file in a known format.
 */
export async function startImport(page: Page): Promise<ImportWizardStep> {
  const wizard = page.getByTestId('import-wizard');
  await page.getByTestId('import-next').click();
  await expect(wizard).not.toHaveAttribute('data-step', 'files');
  await expect(page.getByTestId('import-busy')).toBeHidden({ timeout: 30_000 });
  return (await wizard.getAttribute('data-step')) as ImportWizardStep;
}

/** Presses Next and waits for the step that follows. */
export async function nextWizardStep(page: Page, step: ImportWizardStep) {
  await expect(page.getByTestId('import-next')).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId('import-next').click();
  await waitForWizardStep(page, step);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Settles the account of the `index`-th value on the Account step as
 * `accountName`: picks it, or confirms it when the wizard already proposed it.
 */
export async function chooseImportAccount(page: Page, index: number, accountName: string) {
  const card = page.getByTestId(`import-account-${index}`);
  const select = page.getByTestId(`import-account-${index}-select`);
  const confirm = page.getByTestId(`import-account-${index}-confirm`);
  if ((await select.textContent())?.includes(accountName)) {
    if (await confirm.isVisible()) await confirm.click();
  } else {
    await select.click();
    // The option reads "<owner> - <account name>", then its type and bank.
    await page.getByRole('option', { name: new RegExp(`(^| - )${escapeRegExp(accountName)}`) }).first().click();
  }
  await expect(card).toHaveAttribute('data-status', /^(chosen|recognised)$/, { timeout: 30_000 });
}

/** On "Check how we read it": accepts every reading setting the wizard asks about. */
export async function confirmReadingSettings(page: Page) {
  for (const subject of READING_SETTINGS) {
    const button = page.getByTestId(`import-confirm-${subject}`);
    if (await button.isVisible()) await button.click();
  }
  await expect(page.locator('[data-testid^="import-setting-"][data-pending="true"]')).toHaveCount(0);
}

/** Presses Import on the Summary and waits for the Done step (the scans run before it shows). */
export async function runImport(page: Page) {
  await expect(page.getByTestId('import-run')).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId('import-run').click();
  await waitForWizardStep(page, 'done', 120_000);
}

/** The combined result on the Done step. */
export async function readImportResult(page: Page): Promise<ImportStatementResult> {
  const done = page.getByTestId('import-done');
  await expect(done).toBeVisible();
  return {
    inserted: Number(await done.getAttribute('data-inserted')),
    duplicates: Number(await done.getAttribute('data-duplicates')),
  };
}

/** Leaves the Import page; `discard` answers the "Discard this import?" question when it comes up. */
export async function closeImport(page: Page, { discard = false }: { discard?: boolean } = {}) {
  await page.getByTestId('import-close').click();
  if (discard) await page.getByTestId('import-leave-discard').click();
  await expect(page.getByTestId('import-page')).toBeHidden();
}

/**
 * Imports one file into one account and waits until the import (and the scans
 * that follow it) has finished and the Import page is closed again.
 */
export async function importStatementFile(
  page: Page,
  filePath: string,
  { accountName }: ImportStatementOptions
): Promise<ImportStatementResult> {
  await openImportWizard(page);
  await addStatementFiles(page, filePath);

  let step = await startImport(page);
  if (step === 'summary' && !(await page.getByTestId('import-summary-accounts').textContent())?.includes(accountName)) {
    // A known format that remembers another account: walk the steps instead.
    await page.getByTestId('import-review-details').click();
    await waitForWizardStep(page, 'account');
    step = 'account';
  }
  if (step === 'account') {
    // One account for the whole file, whatever values the file uses for it.
    const values = await page.locator('[data-testid^="import-account-"][data-status]').count();
    for (let index = 0; index < values; index += 1) {
      await chooseImportAccount(page, index, accountName);
    }
    await nextWizardStep(page, 'layout');
    await confirmReadingSettings(page);
    await nextWizardStep(page, 'review');
    await nextWizardStep(page, 'summary');
  }

  await runImport(page);
  const result = await readImportResult(page);
  await closeImport(page);
  return result;
}
