/**
 * A device that still holds an encryption header from before key slots
 * (format v1: page key derived straight from the password) cannot be opened
 * by this version. The app must say so and offer a reset that lands back on
 * the setup screen, rather than showing a password prompt that can never
 * succeed.
 */

import { expect, test } from '@playwright/test';

import { seedBrowserCompatibility } from './helpers/bootstrap';

test('a pre-key-slot (v1) header leads to the reset notice, and resetting returns to setup', async ({ page }) => {
  await seedBrowserCompatibility(page);

  // Plant a v1 header exactly where the worker reads it. The 404 page is on
  // the same origin but never boots the database worker, so the header is in
  // place before the app's first look at it. (An init script would re-plant
  // it after the reset's reload — resetApp wipes the storage a guard could
  // live in — and the notice would come straight back.)
  await page.goto('/this-page-does-not-exist/');
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('ptbudgetapp-keys', 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('header')) {
            db.createObjectStore('header', { keyPath: 'id' });
          }
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('header', 'readwrite');
          transaction.objectStore('header').put({
            id: 'default',
            format: 'budget-tracker-page-encryption-header-v1',
            createdAt: '2026-01-01T00:00:00.000Z',
            pageSalt: '00'.repeat(32),
            pbkdf2Iterations: 600000,
            blockSize: 8192,
            verifierIv: '00'.repeat(12),
            verifierCiphertext: '00'.repeat(48),
          });
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      })
  );

  await page.goto('/');

  await expect(page.getByText('This database needs to be set up again')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);

  await page.getByTestId('legacy-reset').click();
  await page.getByTestId('legacy-reset-confirm').click();

  await expect(page.getByRole('button', { name: 'Create New Database' })).toBeVisible({ timeout: 60_000 });
});
