import path from 'node:path';

import { expect, test } from '@playwright/test';

import { bootstrapDatabase, runQueryAndReadFirstCell } from './helpers/bootstrap';
import { importStatementFile } from './helpers/importFlow';

const SAMPLE_IMPORT_CSV_PATH = path.join(__dirname, 'fixtures', 'sample-import.csv');

// The helper is what other specs use to get imported rows; this proves it does
// what it says, against whatever import UI is current.
test('importStatementFile imports a file into one account and reports what happened', async ({ page }) => {
  await bootstrapDatabase(page);

  const first = await importStatementFile(page, SAMPLE_IMPORT_CSV_PATH, { accountName: 'Household Checking' });
  expect(first).toEqual({ inserted: 3, duplicates: 0 });

  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT COUNT(*) FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.name = 'Household Checking' AND t.description LIKE 'Playwright CSV Import %'"
    )
  ).toBe('3');
  // One import run, stamped on its rows; the batch row says what kind of file it was.
  expect(
    await runQueryAndReadFirstCell(
      page,
      "SELECT b.inserted_count || '|' || COUNT(t.id) || '|' || COALESCE(b.file_format, 'none') FROM import_batches b JOIN transactions t ON t.import_batch_id = b.id WHERE b.file_name = 'sample-import.csv' GROUP BY b.id"
    )
  ).toBe('3|3|delimited');

  // The same file again adds nothing, and leaves no empty import run behind.
  const second = await importStatementFile(page, SAMPLE_IMPORT_CSV_PATH, { accountName: 'Household Checking' });
  expect(second).toEqual({ inserted: 0, duplicates: 3 });
  expect(await runQueryAndReadFirstCell(page, "SELECT COUNT(*) FROM import_batches WHERE file_name = 'sample-import.csv'")).toBe('1');
});
