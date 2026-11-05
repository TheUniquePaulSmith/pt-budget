/**
 * E2E tests for passkeys as a convenience unlock method (WebAuthn PRF),
 * driven by Chromium's DevTools virtual authenticator so no hardware or OS
 * prompt is involved:
 *
 *  1. Settings → Security registers a passkey (one row, renamable), the lock
 *     screen after a reload leads with "Unlock with passkey" (nothing runs by
 *     itself at load), and the passkey opens the database with the data intact.
 *  2. "Use password instead" falls back to the master form (and the master
 *     form links back to the passkey); after a password unlock the master
 *     form leads; after a passkey unlock, Settings → Lock re-unlocks with the
 *     passkey without a click (auto-trigger only after a lock, never at load).
 *  3. A failed user verification is reported as a cancelled request and the
 *     master form stays available. (Checked last: Chromium's virtual
 *     authenticator keeps failing every later assertion once one user
 *     verification has failed, even after `setUserVerified` is restored.)
 *  4. Removing the passkey leaves only the password form.
 *  5. The 32-byte PRF output never appears in the Developer Console stream
 *     (every log record, context included, is echoed to the browser console
 *     in this run).
 */

import { expect, test, type CDPSession, type Page } from '@playwright/test';

import {
  bootstrapDatabase,
  runQueryAndReadFirstCell,
  TEST_PASSWORD,
} from './helpers/bootstrap';

async function addVirtualAuthenticator(page: Page): Promise<{ cdp: CDPSession; authenticatorId: string }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable', { enableUI: false });
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}

async function openSecurityTab(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Security' }).click();
}

async function expectConnected(page: Page) {
  await expect(page.getByRole('button', { name: 'SQL Query' })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('database-status-text')).toHaveText('Connected', { timeout: 120_000 });
}

async function unlockWithPassword(page: Page) {
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expectConnected(page);
}

/**
 * Records every PRF output the page receives (hex and base64url) through an
 * exposed function that survives reloads, so the test can prove none of it
 * reached the log stream.
 */
async function recordPrfOutputs(page: Page): Promise<string[]> {
  const seen: string[] = [];
  await page.exposeFunction('__recordPrfOutput', (value: string) => {
    seen.push(value);
  });
  await page.addInitScript(() => {
    const encode = (buffer: ArrayBuffer) => {
      const bytes = new Uint8Array(buffer);
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      const b64 = btoa(String.fromCharCode(...bytes));
      return [hex, b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), b64];
    };
    const record = (credential: Credential | null) => {
      const prf = (credential as PublicKeyCredential | null)?.getClientExtensionResults?.()?.prf;
      const first = prf?.results?.first;
      if (first) {
        for (const text of encode(first as ArrayBuffer)) {
          (window as unknown as { __recordPrfOutput: (value: string) => void }).__recordPrfOutput(text);
        }
      }
      return credential;
    };
    const proto = CredentialsContainer.prototype;
    const originalCreate = proto.create;
    const originalGet = proto.get;
    proto.create = function patchedCreate(this: CredentialsContainer, ...args) {
      return originalCreate.apply(this, args).then(record);
    };
    proto.get = function patchedGet(this: CredentialsContainer, ...args) {
      return originalGet.apply(this, args).then(record);
    };
  });
  return seen;
}

test.describe('Passkey unlock (WebAuthn PRF via virtual authenticator)', () => {
  test('registers, unlocks, falls back, auto-triggers after Lock, and removes a passkey', async ({ page }) => {
    const prfOutputs = await recordPrfOutputs(page);
    const consoleLines: string[] = [];
    const pendingArgs: Promise<void>[] = [];
    page.on('console', (message) => {
      consoleLines.push(message.text());
      for (const arg of message.args()) {
        pendingArgs.push(
          arg
            .jsonValue()
            .then((value) => {
              consoleLines.push(JSON.stringify(value));
            })
            .catch(() => undefined)
        );
      }
    });

    const { cdp, authenticatorId } = await addVirtualAuthenticator(page);
    await bootstrapDatabase(page, {
      sampleDataTransactionLimit: 50,
      extraQueryParams: 'debug&debug_output_console=true',
    });
    const initialCount = await runQueryAndReadFirstCell(page, 'SELECT COUNT(*) FROM transactions');
    expect(Number(initialCount)).toBeGreaterThan(0);

    // --- register --------------------------------------------------------
    await openSecurityTab(page);
    await expect(page.getByTestId('passkeys-section')).toBeVisible();
    await expect(page.getByTestId('passkey-slot')).toHaveCount(0);
    await page.getByTestId('add-passkey').click();
    await expect(page.getByTestId('passkey-slot')).toHaveCount(1, { timeout: 30_000 });
    await expect(page.getByTestId('passkey-label')).toHaveText(/^Passkey added /);
    await expect(page.getByText('Passkey added. You can now use it to unlock this database on this device.')).toBeVisible();
    expect(prfOutputs.length).toBeGreaterThan(0);

    // --- rename inline ----------------------------------------------------
    await page.getByTestId('rename-passkey').click();
    await page.getByTestId('rename-passkey-input').fill('Work laptop');
    await page.getByTestId('rename-passkey-save').click();
    await expect(page.getByTestId('passkey-label')).toHaveText('Work laptop');
    await expect(page.getByTestId('rename-passkey-input')).toHaveCount(0);
    await page.getByRole('button', { name: 'Close settings' }).click();

    // --- first load after a reload: passkey view leads, nothing auto-runs ---
    await page.reload();
    const passkeyButton = page.getByTestId('unlock-method-passkey');
    await expect(passkeyButton).toBeVisible({ timeout: 60_000 });
    await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
    // Still locked a moment later: no prompt was started by itself at load.
    await page.waitForTimeout(1_000);
    await expect(passkeyButton).toBeEnabled();
    await expect(page.getByTestId('database-status-text')).toHaveCount(0);

    await passkeyButton.click();
    await expectConnected(page);
    expect(await runQueryAndReadFirstCell(page, 'SELECT COUNT(*) FROM transactions')).toBe(initialCount);

    // The slot records its use.
    await openSecurityTab(page);
    await expect(page.getByTestId('passkey-slot')).toContainText(/Last used/);
    await page.getByRole('button', { name: 'Close settings' }).click();

    // --- fallback to the master form and back -------------------------------
    await page.reload();
    await expect(passkeyButton).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('unlock-method-master').click();
    const passwordInput = page.getByLabel('Password', { exact: true });
    await expect(passwordInput).toBeVisible();
    await expect(passkeyButton).toHaveCount(0);
    await page.getByTestId('unlock-method-passkey-switch').click();
    await expect(passkeyButton).toBeVisible();
    await page.getByTestId('unlock-method-master').click();
    await unlockWithPassword(page);

    // After a password unlock the master form leads next time.
    await page.reload();
    await expect(passwordInput).toBeVisible({ timeout: 60_000 });
    await expect(passkeyButton).toHaveCount(0);
    await expect(page.getByTestId('unlock-method-passkey-switch')).toBeVisible();
    await page.getByTestId('unlock-method-passkey-switch').click();
    await passkeyButton.click();
    await expectConnected(page);

    // --- Settings → Lock: the remembered passkey re-unlocks without a click ---
    await openSecurityTab(page);
    await page.getByRole('button', { name: 'Lock Database' }).click();
    await expectConnected(page);

    // --- a failed user verification: cancelled, fallback stays ------------------
    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
    await openSecurityTab(page);
    await page.getByRole('button', { name: 'Lock Database' }).click();
    // The remembered passkey starts by itself, fails, and leaves the button.
    await expect(page.getByText('The passkey request was cancelled.')).toBeVisible({ timeout: 30_000 });
    await expect(passkeyButton).toBeEnabled();
    await passkeyButton.click();
    await expect(page.getByText('The passkey request was cancelled.')).toBeVisible();
    await page.getByTestId('unlock-method-master').click();
    await unlockWithPassword(page);

    // --- remove ---------------------------------------------------------
    await openSecurityTab(page);
    await page.getByTestId('remove-passkey').click();
    await expect(page.getByText('Remove this passkey?')).toBeVisible();
    await page.getByTestId('confirm-remove-passkey').click();
    await expect(page.getByTestId('passkey-slot')).toHaveCount(0);
    await expect(page.getByTestId('add-passkey')).toBeVisible();
    await page.getByRole('button', { name: 'Close settings' }).click();

    await page.reload();
    await expect(passwordInput).toBeVisible({ timeout: 60_000 });
    await expect(passkeyButton).toHaveCount(0);
    await expect(page.getByTestId('unlock-method-passkey-switch')).toHaveCount(0);
    await unlockWithPassword(page);
    expect(await runQueryAndReadFirstCell(page, 'SELECT COUNT(*) FROM transactions')).toBe(initialCount);

    // --- no PRF bytes in the log stream -----------------------------------------
    await Promise.all(pendingArgs);
    expect(prfOutputs.length).toBeGreaterThanOrEqual(3);
    const logText = consoleLines.join('\n');
    expect(logText).toContain('Passkey registered');
    for (const secret of prfOutputs) {
      expect(logText).not.toContain(secret);
    }
  });
});
