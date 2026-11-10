import { expect, type Page } from '@playwright/test';

/**
 * Importing a statement file through the real UI, for specs that need imported
 * rows but are not about the import screens themselves (transfer detection,
 * import history, landing-page screenshots). They call this instead of
 * clicking through the import UI, so they survive changes to it.
 *
 * Today it drives the "Import CSV" dialog. The wizard-flow agent of the Import
 * Wizard program rewrites the body for the wizard; the signature stays.
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

function firstNumber(text: string | null, label: string): number {
  const match = (text ?? '').match(/:\s*(\d+)/);
  if (!match) throw new Error(`No ${label} count in "${text}"`);
  return Number(match[1]);
}

/**
 * Imports one file into one account and waits until the import (and the scans
 * that follow it) has finished and the import UI is closed again.
 */
export async function importStatementFile(
  page: Page,
  filePath: string,
  { accountName }: ImportStatementOptions
): Promise<ImportStatementResult> {
  await page.getByRole('button', { name: 'Import CSV' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import Transactions from CSV' });
  await expect(dialog).toBeVisible();

  await dialog.locator('input[type="file"]').setInputFiles(filePath);

  // One account for the whole file, whatever account column the file has.
  await dialog.getByTestId('csv-account-column-select').click();
  // The option reads "<owner> - <account name> - <card last four>", owner and card optional.
  const escapedName = accountName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page.getByRole('option', { name: new RegExp(`(^| - )${escapedName}( - |$)`) }).first().click();

  await dialog.getByRole('button', { name: 'Analyze File', exact: true }).click();
  await expect(dialog.getByText('Analysis Complete:')).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole('button', { name: /^Import \d+ Transactions?$/ }).click();

  // The import runs the loan rules and a subscription rescan before the summary shows.
  await expect(dialog.getByTestId('csv-import-result')).toBeVisible({ timeout: 120_000 });
  const result: ImportStatementResult = {
    inserted: firstNumber(await dialog.getByTestId('csv-import-result-inserted').textContent(), 'imported'),
    duplicates: firstNumber(await dialog.getByTestId('csv-import-result-duplicates').textContent(), 'duplicate'),
  };

  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).not.toBeVisible();
  return result;
}
