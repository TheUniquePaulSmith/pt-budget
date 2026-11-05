/**
 * E2E tests for the recovery-phrase master secret and the key-slot header:
 *
 *  1. A database can be created with a generated 12-word phrase instead of a
 *     password, and the phrase unlocks it after a reload.
 *  2. A phrase with a bad checksum never reaches the worker (Unlock stays
 *     disabled and the field explains why).
 *  3. Settings → Security switches the master from password to phrase (the
 *     old password stops working, the phrase unlocks with data intact) and
 *     back again.
 *  4. An export from a phrase-protected database restores in a fresh
 *     browser context from the phrase alone.
 */

import { expect, test, type Page } from '@playwright/test';

import {
  bootstrapDatabase,
  reloadAndUnlock,
  runQueryAndReadFirstCell,
  seedBrowserCompatibility,
  TEST_PASSWORD,
} from './helpers/bootstrap';

async function openSecurityTab(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Security' }).click();
}

async function readGeneratedWords(page: Page): Promise<string[]> {
  const words: string[] = [];
  for (let i = 1; i <= 12; i += 1) {
    words.push((await page.getByTestId(`recovery-word-${i}`).innerText()).trim());
  }
  return words;
}

async function confirmGeneratedWords(page: Page, words: string[]) {
  await page.getByTestId('recovery-saved-checkbox').check();
  await page.getByTestId('recovery-continue').click();
  for (let i = 1; i <= 12; i += 1) {
    const input = page.getByTestId(`recovery-confirm-input-${i}`);
    if (await input.isVisible().catch(() => false)) {
      await input.fill(words[i - 1]);
    }
  }
  await page.getByTestId('recovery-confirm-submit').click();
}

test.describe('Recovery phrase as the master secret', () => {
  test('creates a database protected by a generated phrase and unlocks it after a reload', async ({ page }) => {
    const { recoveryWords } = await bootstrapDatabase(page, { loadSampleData: false, masterType: 'recovery' });
    expect(recoveryWords).toHaveLength(12);

    await openSecurityTab(page);
    await expect(page.getByTestId('master-type-description')).toHaveText(/recovery phrase/i);
    // A phrase-protected database has no password to change.
    await expect(page.getByLabel('Current Password')).toHaveCount(0);
    await page.getByRole('button', { name: 'Close settings' }).click();

    await page.reload();
    await expect(page.getByText('Enter Recovery Phrase')).toBeVisible({ timeout: 30_000 });
    // The password form is not offered for a phrase-protected database.
    await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);

    // A real word in the wrong place fails the checksum: the worker is never asked.
    const tampered = [...recoveryWords!];
    tampered[11] = tampered[11] === 'zoo' ? 'zone' : 'zoo';
    await page.getByTestId('recovery-phrase-input').fill(tampered.join(' '));
    await expect(page.getByText(/doesn't check out/)).toBeVisible();
    await expect(page.getByTestId('recovery-unlock')).toBeDisabled();

    // A word outside the wordlist is named.
    await page.getByTestId('recovery-phrase-input').fill([...recoveryWords!.slice(0, 11), 'xylophone'].join(' '));
    await expect(page.getByText(/Not in the wordlist: xylophone/)).toBeVisible();
    await expect(page.getByTestId('recovery-unlock')).toBeDisabled();

    await page.getByTestId('recovery-phrase-input').fill(recoveryWords!.join('  ').toUpperCase());
    await expect(page.getByTestId('recovery-unlock')).toBeEnabled();
    await page.getByTestId('recovery-unlock').click();

    await expect(page.getByRole('button', { name: 'SQL Query' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('database-status-text')).toHaveText('Connected', { timeout: 60_000 });
    expect(await runQueryAndReadFirstCell(page, 'SELECT COUNT(*) FROM users')).toBe('1');
  });

  test('switches the master from password to phrase and back without re-encrypting data', async ({ page }) => {
    await bootstrapDatabase(page, { loadSampleData: true, sampleDataTransactionLimit: 50, password: TEST_PASSWORD });
    const transactionCount = await runQueryAndReadFirstCell(page, 'SELECT COUNT(*) FROM transactions');

    await openSecurityTab(page);
    await page.getByTestId('switch-master-type').click();
    await page.getByTestId('switch-master-current-password').fill('definitely-wrong');
    await page.getByTestId('switch-master-next').click();
    const words = await readGeneratedWords(page);
    await confirmGeneratedWords(page, words);
    // The wrong current password is rejected and the dialog returns to step 1.
    await expect(page.getByText(/incorrect/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('switch-master-current-password')).toBeVisible();

    await page.getByTestId('switch-master-current-password').fill(TEST_PASSWORD);
    await page.getByTestId('switch-master-next').click();
    const words2 = await readGeneratedWords(page);
    await confirmGeneratedWords(page, words2);
    await expect(page.getByText(/now protected by the recovery phrase/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('master-type-description')).toHaveText(/recovery phrase/i);
    await page.getByRole('button', { name: 'Close settings' }).click();

    // The old password cannot be entered anymore: the lock screen asks for the phrase.
    await page.reload();
    await expect(page.getByText('Enter Recovery Phrase')).toBeVisible({ timeout: 30_000 });
    await reloadAndUnlock(page, words2);
    expect(await runQueryAndReadFirstCell(page, 'SELECT COUNT(*) FROM transactions')).toBe(transactionCount);

    // And back to a password.
    await openSecurityTab(page);
    await page.getByTestId('switch-master-type').click();
    await page.getByTestId('switch-master-current-phrase').fill(words2.join(' '));
    await page.getByTestId('switch-master-next').click();
    await page.getByTestId('switch-master-new-password').fill('BackToPassword1!');
    await page.getByTestId('switch-master-confirm-password').fill('BackToPassword1!');
    await page.getByTestId('switch-master-submit').click();
    await expect(page.getByText(/now protected by the new password/)).toBeVisible({ timeout: 30_000 });
    // The switch dialog (whose own field is also labelled Current Password) must be gone before the Change Password form is checked.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByLabel('Current Password')).toBeVisible();
    await page.getByRole('button', { name: 'Close settings' }).click();

    await reloadAndUnlock(page, 'BackToPassword1!');
    expect(await runQueryAndReadFirstCell(page, 'SELECT COUNT(*) FROM transactions')).toBe(transactionCount);
  });

  test('an export of a phrase-protected database restores elsewhere from the phrase alone', async ({ page, browser }) => {
    const { recoveryWords } = await bootstrapDatabase(page, { loadSampleData: false, masterType: 'recovery' });

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      (async () => {
        await page.getByRole('button', { name: 'Settings' }).click();
        await page.getByRole('tab', { name: 'Data & Backup' }).click({ timeout: 10_000 });
        await page.getByRole('button', { name: /Export Database/i }).click({ timeout: 10_000 });
      })(),
    ]);
    const exportedPath = await download.path();
    expect(exportedPath).toBeTruthy();

    const freshContext = await browser.newContext();
    try {
      const freshPage = await freshContext.newPage();
      await seedBrowserCompatibility(freshPage);
      await freshPage.goto('/');

      const loadButton = freshPage.getByRole('button', { name: 'Load from File' });
      await expect(loadButton).toBeVisible({ timeout: 30_000 });
      const [fileChooser] = await Promise.all([
        freshPage.waitForEvent('filechooser', { timeout: 10_000 }),
        loadButton.click(),
      ]);
      await fileChooser.setFiles(exportedPath!);

      // The archive header says which secret it needs: the phrase form, not the password form.
      await expect(freshPage.getByText('Enter Recovery Phrase')).toBeVisible({ timeout: 30_000 });
      await freshPage.getByTestId('recovery-phrase-input').fill(recoveryWords!.join(' '));
      await freshPage.getByTestId('recovery-unlock').click();

      await expect(freshPage.getByRole('button', { name: 'SQL Query' })).toBeVisible({ timeout: 120_000 });
      await expect(freshPage.getByTestId('database-status-text')).toHaveText('Connected', { timeout: 120_000 });
      expect(await runQueryAndReadFirstCell(freshPage, 'SELECT COUNT(*) FROM users')).toBe('1');

      // The restored copy shares the backup's master slot: the same phrase unlocks it after a reload.
      await reloadAndUnlock(freshPage, recoveryWords!);
    } finally {
      await freshContext.close();
    }
  });
});
