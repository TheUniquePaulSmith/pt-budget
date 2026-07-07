# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: database-encryption.spec.ts >> Password setup screen >> is shown when clicking Create New Database
- Location: tests\e2e\database-encryption.spec.ts:61:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByLabel('Password')
Expected: visible
Error: strict mode violation: getByLabel('Password') resolved to 4 elements:
    1) <input value="" id="«r2»" type="password" aria-invalid="false" class="MuiInputBase-input MuiOutlinedInput-input MuiInputBase-inputAdornedEnd css-1dune0f-MuiInputBase-input-MuiOutlinedInput-input"/> aka getByRole('textbox', { name: 'Password', exact: true })
    2) <button tabindex="0" type="button" aria-label="Show password" class="MuiButtonBase-root MuiIconButton-root MuiIconButton-edgeEnd MuiIconButton-sizeMedium css-1ysp02-MuiButtonBase-root-MuiIconButton-root">…</button> aka getByRole('button', { name: 'Show password' }).first()
    3) <input value="" id="«r4»" type="password" aria-invalid="false" class="MuiInputBase-input MuiOutlinedInput-input MuiInputBase-inputAdornedEnd css-1dune0f-MuiInputBase-input-MuiOutlinedInput-input"/> aka getByRole('textbox', { name: 'Confirm Password' })
    4) <button tabindex="0" type="button" aria-label="Show password" class="MuiButtonBase-root MuiIconButton-root MuiIconButton-edgeEnd MuiIconButton-sizeMedium css-1ysp02-MuiButtonBase-root-MuiIconButton-root">…</button> aka getByRole('button', { name: 'Show password' }).nth(1)

Call log:
  - Expect "toBeVisible" with timeout 20000ms
  - waiting for getByLabel('Password')

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - alert [ref=e2]
  - button "Open Next.js Dev Tools" [ref=e8] [cursor=pointer]:
    - img [ref=e9]
  - generic [ref=e13]:
    - generic [ref=e14]:
      - img [ref=e15]
      - heading "Protect Your Database" [level=5] [ref=e17]
      - paragraph [ref=e18]: Your database is encrypted before it is saved or uploaded to cloud storage. Choose a strong password — it is the only way to open your backup. There is no password recovery, so store it somewhere safe.
    - generic [ref=e19]:
      - generic [ref=e20]: Password
      - generic [ref=e21]:
        - textbox "Password" [active] [ref=e22]
        - button "Show password" [ref=e24] [cursor=pointer]:
          - img [ref=e25]
        - group:
          - generic: Password
    - generic [ref=e27]:
      - generic: Confirm Password
      - generic [ref=e28]:
        - textbox "Confirm Password" [ref=e29]
        - button "Show password" [ref=e31] [cursor=pointer]:
          - img [ref=e32]
        - group:
          - generic: Confirm Password
    - button "Create Database" [disabled]
```

# Test source

```ts
  1   | /**
  2   |  * E2E tests for database encryption / decryption.
  3   |  *
  4   |  * These tests verify:
  5   |  *  1. The password setup screen is shown after clicking "Create New Database".
  6   |  *  2. The database is created successfully after password entry.
  7   |  *  3. Short or mismatched passwords are rejected by the UI.
  8   |  *  4. The export produces an encrypted archive that cannot be opened as a
  9   |  *     plain ZIP.
  10  |  *  5. Re-importing an encrypted archive prompts for the password.
  11  |  */
  12  | 
  13  | import { expect, test, type Page } from '@playwright/test';
  14  | 
  15  | const browserCompatibilityResults = {
  16  |   sharedWorkerSupport: true,
  17  |   wasmSupport: true,
  18  |   sqliteSupport: true,
  19  |   vfsSupport: true,
  20  |   overallCompatible: true,
  21  | };
  22  | 
  23  | const TEST_PASSWORD = 'EncryptTest99!';
  24  | const WRONG_PASSWORD = 'WrongPassword1!';
  25  | 
  26  | async function seedBrowserCompatibility(page: Page) {
  27  |   await page.addInitScript((results) => {
  28  |     window.localStorage.setItem(
  29  |       'budgetApp_browserTestPassed',
  30  |       JSON.stringify(results)
  31  |     );
  32  |   }, browserCompatibilityResults);
  33  | }
  34  | 
  35  | async function goToSetupPage(page: Page) {
  36  |   await seedBrowserCompatibility(page);
  37  |   await page.goto('/');
  38  | 
  39  |   const createDatabaseButton = page.getByRole('button', {
  40  |     name: 'Create New Database',
  41  |   });
  42  |   await expect(createDatabaseButton).toBeVisible({ timeout: 30_000 });
  43  |   return createDatabaseButton;
  44  | }
  45  | 
  46  | async function openPasswordSetupScreen(page: Page) {
  47  |   const createDatabaseButton = await goToSetupPage(page);
  48  |   await createDatabaseButton.click();
  49  | 
  50  |   // After clicking, the password setup screen should appear.
  51  |   await expect(page.getByText('Protect Your Database')).toBeVisible({
  52  |     timeout: 10_000,
  53  |   });
  54  | }
  55  | 
  56  | // ---------------------------------------------------------------------------
  57  | // Password setup screen
  58  | // ---------------------------------------------------------------------------
  59  | 
  60  | test.describe('Password setup screen', () => {
  61  |   test('is shown when clicking Create New Database', async ({ page }) => {
  62  |     await openPasswordSetupScreen(page);
  63  | 
> 64  |     await expect(page.getByLabel('Password')).toBeVisible();
      |                                               ^ Error: expect(locator).toBeVisible() failed
  65  |     await expect(page.getByLabel('Confirm Password')).toBeVisible();
  66  |     await expect(page.getByRole('button', { name: 'Create Database' })).toBeVisible();
  67  |   });
  68  | 
  69  |   test('Create Database button is disabled with empty password', async ({ page }) => {
  70  |     await openPasswordSetupScreen(page);
  71  | 
  72  |     await expect(
  73  |       page.getByRole('button', { name: 'Create Database' })
  74  |     ).toBeDisabled();
  75  |   });
  76  | 
  77  |   test('Create Database button is disabled when passwords do not match', async ({ page }) => {
  78  |     await openPasswordSetupScreen(page);
  79  | 
  80  |     await page.getByLabel('Password').fill('PasswordOne1!');
  81  |     await page.getByLabel('Confirm Password').fill('PasswordTwo2!');
  82  | 
  83  |     // Button should still be disabled because passwords differ.
  84  |     await expect(
  85  |       page.getByRole('button', { name: 'Create Database' })
  86  |     ).toBeDisabled();
  87  |   });
  88  | 
  89  |   test('Create Database button is disabled for a short password', async ({ page }) => {
  90  |     await openPasswordSetupScreen(page);
  91  | 
  92  |     await page.getByLabel('Password').fill('short');
  93  |     await page.getByLabel('Confirm Password').fill('short');
  94  | 
  95  |     await expect(
  96  |       page.getByRole('button', { name: 'Create Database' })
  97  |     ).toBeDisabled();
  98  |   });
  99  | 
  100 |   test('creates the database after entering a valid matching password', async ({ page }) => {
  101 |     await openPasswordSetupScreen(page);
  102 | 
  103 |     await page.getByLabel('Password').fill(TEST_PASSWORD);
  104 |     await page.getByLabel('Confirm Password').fill(TEST_PASSWORD);
  105 |     await page.getByRole('button', { name: 'Create Database' }).click();
  106 | 
  107 |     // After successful creation the main app shell should load.
  108 |     await expect(page.getByRole('button', { name: 'SQL Query' })).toBeVisible({
  109 |       timeout: 60_000,
  110 |     });
  111 |     await expect(page.getByTestId('database-status-text')).toHaveText(
  112 |       'Connected',
  113 |       { timeout: 60_000 }
  114 |     );
  115 |   });
  116 | });
  117 | 
  118 | // ---------------------------------------------------------------------------
  119 | // Encrypted archive loading
  120 | // ---------------------------------------------------------------------------
  121 | 
  122 | test.describe('Loading an encrypted archive', () => {
  123 |   /**
  124 |    * Creates a database, exports it, then re-imports it to verify the
  125 |    * password entry screen appears.
  126 |    *
  127 |    * NOTE: The full decryption round-trip requires a running dev server with
  128 |    * an accessible SharedWorker.  This test is marked as requiring the app
  129 |    * to be in a state where the Load from File button is available.
  130 |    */
  131 |   test('shows password entry screen when loading an encrypted file', async ({
  132 |     page,
  133 |   }) => {
  134 |     await seedBrowserCompatibility(page);
  135 |     await page.goto('/');
  136 | 
  137 |     // Step 1: Create a new database so we can export it.
  138 |     const createButton = page.getByRole('button', { name: 'Create New Database' });
  139 |     await expect(createButton).toBeVisible({ timeout: 30_000 });
  140 |     await createButton.click();
  141 | 
  142 |     await expect(page.getByText('Protect Your Database')).toBeVisible({
  143 |       timeout: 10_000,
  144 |     });
  145 |     await page.getByLabel('Password').fill(TEST_PASSWORD);
  146 |     await page.getByLabel('Confirm Password').fill(TEST_PASSWORD);
  147 |     await page.getByRole('button', { name: 'Create Database' }).click();
  148 | 
  149 |     await expect(page.getByRole('button', { name: 'SQL Query' })).toBeVisible({
  150 |       timeout: 60_000,
  151 |     });
  152 | 
  153 |     // Step 2: Export the database and capture the downloaded file.
  154 |     const [download] = await Promise.all([
  155 |       page.waitForEvent('download'),
  156 |       page.getByRole('button', { name: 'Settings' }).click().then(async () => {
  157 |         await page
  158 |           .getByRole('button', { name: /Export Database/i })
  159 |           .click();
  160 |       }),
  161 |     ]).catch(() => [null]);
  162 | 
  163 |     if (!download) {
  164 |       // If Settings / Export is unavailable in this build, skip gracefully.
```