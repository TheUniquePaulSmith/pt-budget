import { expect, type Page } from '@playwright/test';

export const TEST_PASSWORD = 'TestPassword1!';
export const TEST_PRIMARY_USER_NAME = 'TestUser';

const browserCompatibilityResults = {
  sharedWorkerSupport: true,
  wasmSupport: true,
  sqliteSupport: true,
  vfsSupport: true,
  overallCompatible: true,
};

export async function seedBrowserCompatibility(page: Page) {
  await page.addInitScript((results) => {
    window.localStorage.setItem(
      'budgetApp_browserTestPassed',
      JSON.stringify(results)
    );
  }, browserCompatibilityResults);
}

export interface BootstrapDatabaseOptions {
  /** Appends ?loadSampleData to the initial navigation (default true). */
  loadSampleData?: boolean;
  /** Caps imported sample transactions to keep runs fast (default 500). */
  sampleDataTransactionLimit?: number;
  primaryUserName?: string;
  password?: string;
  /**
   * Which master secret protects the new database: a password (default) or
   * a generated 12-word recovery phrase. With 'recovery', bootstrapDatabase
   * returns the words so the test can unlock with them later.
   */
  masterType?: 'password' | 'recovery';
  /** Extra raw query string (e.g. 'syncDebounceMs=1000') appended to the initial navigation. */
  extraQueryParams?: string;
}

export interface BootstrapDatabaseResult {
  /** The recovery phrase the database was created with (masterType 'recovery' only). */
  recoveryWords?: string[];
}

/**
 * Drives the recovery-phrase setup step: reads the generated words, confirms
 * the three requested ones, and continues. Expects the setup screen with the
 * Primary User Name already filled.
 */
export async function completeRecoveryPhraseSetup(page: Page): Promise<string[]> {
  await page.getByTestId('master-type-recovery').click();
  await page.getByTestId('generate-recovery-phrase').click();

  const words: string[] = [];
  for (let i = 1; i <= 12; i += 1) {
    words.push((await page.getByTestId(`recovery-word-${i}`).innerText()).trim());
  }
  await page.getByTestId('recovery-saved-checkbox').check();
  await page.getByTestId('recovery-continue').click();

  // Three random positions are asked for; fill whichever appear.
  for (let i = 1; i <= 12; i += 1) {
    const input = page.getByTestId(`recovery-confirm-input-${i}`);
    if (await input.isVisible().catch(() => false)) {
      await input.fill(words[i - 1]);
    }
  }
  await page.getByTestId('recovery-confirm-submit').click();
  return words;
}

/**
 * Fills the database setup screen (primary user + password fields) without
 * submitting it.
 */
export async function fillDatabaseSetupForm(
  page: Page,
  {
    primaryUserName = TEST_PRIMARY_USER_NAME,
    password = TEST_PASSWORD,
  }: Pick<BootstrapDatabaseOptions, 'primaryUserName' | 'password'> = {}
) {
  await page.getByLabel('Primary User Name').fill(primaryUserName);
  // exact: true — a bare 'Password' label also matches 'Confirm Password'
  // and trips Playwright's strict mode.
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm Password').fill(password);
}

/**
 * Creates (or reuses) the browser-backed database and waits until the app
 * shell reports Connected. Safe to call on a second page in the same
 * context: when the worker already holds the encryption key the setup
 * screen is skipped by the app.
 */
export async function bootstrapDatabase(
  page: Page,
  options: BootstrapDatabaseOptions = {}
): Promise<BootstrapDatabaseResult> {
  const { loadSampleData = true, sampleDataTransactionLimit = 500, extraQueryParams, masterType = 'password' } = options;
  const result: BootstrapDatabaseResult = {};

  await seedBrowserCompatibility(page);

  const baseUrl = loadSampleData
    ? `/?loadSampleData&sampleDataTransactionLimit=${sampleDataTransactionLimit}`
    : '/';
  const url = extraQueryParams
    ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${extraQueryParams}`
    : baseUrl;

  await page.goto(url);

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

    // The database setup screen (primary user name + password) appears after
    // clicking Create New Database — unless another page in this context
    // already supplied the encryption key, in which case the app skips it.
    const primaryUserInput = page.getByLabel('Primary User Name');
    const isSetupScreen = await primaryUserInput
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);

    if (isSetupScreen) {
      if (masterType === 'recovery') {
        await primaryUserInput.fill(options.primaryUserName ?? TEST_PRIMARY_USER_NAME);
        result.recoveryWords = await completeRecoveryPhraseSetup(page);
      } else {
        await fillDatabaseSetupForm(page, options);
        await page.getByRole('button', { name: 'Create Database' }).click();
      }

      // Password setup lands on the preferences screen (language + default
      // currency); default e2e runs keep English / USD by skipping it.
      await page.getByTestId('skip-preferences').click();

      // Then the initial-account screen;
      // default e2e runs skip it unless a test explicitly wants an account.
      await page.getByTestId('skip-initial-account').click();

      // Then the storage-choice screen; default e2e runs to a local
      // database unless a test explicitly drives the cloud-storage flow.
      await page.getByTestId('storage-choice-local').click();
    }
  }

  await expect(sqlQueryButton).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('database-status-text')).toHaveText(
    'Connected',
    { timeout: 120_000 }
  );
  return result;
}

/**
 * Reloads the page and, if a SharedWorker with no other connected tabs was
 * torn down as a result, re-enters the master secret at the needs-unlock
 * screen (the encrypting VFS requires it before the database can be opened
 * again). `secret` is the password, or the 12 recovery words for a
 * recovery-phrase database. Safe to call when another page in the same
 * context kept the worker alive too — in that case the app skips straight
 * to Connected.
 */
export async function reloadAndUnlock(page: Page, secret: string | string[] = TEST_PASSWORD) {
  await page.reload();

  const passwordInput = page.getByLabel('Password', { exact: true });
  const phraseInput = page.getByTestId('recovery-phrase-input');
  const sqlQueryButton = page.getByRole('button', { name: 'SQL Query' });

  await Promise.race([
    passwordInput.waitFor({ state: 'visible', timeout: 120_000 }),
    phraseInput.waitFor({ state: 'visible', timeout: 120_000 }),
    sqlQueryButton.waitFor({ state: 'visible', timeout: 120_000 }),
  ]);

  if (await phraseInput.isVisible().catch(() => false)) {
    await phraseInput.fill(Array.isArray(secret) ? secret.join(' ') : secret);
    await page.getByTestId('recovery-unlock').click();
  } else if (await passwordInput.isVisible().catch(() => false)) {
    await passwordInput.fill(Array.isArray(secret) ? secret.join(' ') : secret);
    await page.getByRole('button', { name: 'Unlock' }).click();
  }

  await expect(sqlQueryButton).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('database-status-text')).toHaveText(
    'Connected',
    { timeout: 120_000 }
  );
}

/**
 * Ids from the shell's page registry (src/components/common/Layout/pageRegistry.tsx).
 * Every control that navigates to a page carries `data-testid="nav-<id>"`.
 */
export type AppPageId =
  | 'dashboard'
  | 'projects'
  | 'trips'
  | 'budget'
  | 'accounts'
  | 'loans'
  | 'transactions'
  | 'import'
  | 'subscriptions'
  | 'notifications'
  | 'sql-query'
  | 'settings'
  | 'developer-console';

/**
 * Navigates via the shell's registry-driven controls. Works for the desktop
 * rail (expanded or collapsed), the phone bottom bar and the phone "More"
 * sheet alike, because they all carry the same test id; when several are
 * rendered the first visible one is used.
 */
export async function navigateToPage(page: Page, id: AppPageId) {
  const controls = page.getByTestId(`nav-${id}`);
  const count = await controls.count();
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    if (await control.isVisible().catch(() => false)) {
      try {
        await control.click({ timeout: 10_000 });
        return;
      } catch {
        // The control was inside a "More" sheet that was still sliding shut;
        // fall through and reopen the sheet.
      }
    }
  }
  // Nothing visible: on phones the remaining pages live in the "More" sheet.
  await openMobileMoreSheet(page);
  await controls.first().click();
}

/** Opens the phone bottom-navigation "More" sheet (no-op when it is already open). */
export async function openMobileMoreSheet(page: Page) {
  const sheet = page.getByTestId('mobile-more-sheet');
  const moreButton = page.getByTestId('nav-more');
  // `aria-expanded` reflects the shell's state, unlike visibility, which is
  // still true while the sheet animates shut.
  if ((await moreButton.getAttribute('aria-expanded')) !== 'true') {
    await moreButton.click();
  }
  await expect(sheet).toBeVisible();
  await expect(moreButton).toHaveAttribute('aria-expanded', 'true');
}

/**
 * Toggles the desktop navigation rail between its expanded (labels) and
 * collapsed (icons + tooltips) states and returns the new state.
 */
export async function toggleSidebar(page: Page): Promise<'expanded' | 'collapsed'> {
  const rail = page.getByTestId('sidebar-rail');
  const wasExpanded = (await rail.getAttribute('data-expanded')) === 'true';
  await page.getByTestId('sidebar-toggle').click();
  await expect(rail).toHaveAttribute('data-expanded', wasExpanded ? 'false' : 'true');
  return wasExpanded ? 'collapsed' : 'expanded';
}

export async function runQuery(page: Page, sql: string) {
  await page.getByRole('button', { name: 'SQL Query' }).click();
  // The query box is a CodeMirror editor: `sql-query-input` tags its outer
  // wrapper, but `.fill()` needs the actual contenteditable `.cm-content`
  // node inside it.
  await page.getByTestId('sql-query-input').locator('.cm-content').fill(sql);
  await page.getByRole('button', { name: 'Execute Query' }).click();
  await expect(page.getByTestId('sql-query-results')).toBeVisible();
}

/**
 * Runs a query on the SQL page and returns the first data cell of the
 * results DataGrid (first column of the first row).
 */
export async function runQueryAndReadFirstCell(page: Page, sql: string) {
  await runQuery(page, sql);

  const firstCell = page
    .getByTestId('sql-query-results')
    .getByRole('gridcell')
    .first();
  await firstCell.waitFor({ state: 'visible', timeout: 30_000 });
  return (await firstCell.textContent())?.trim() ?? '';
}
