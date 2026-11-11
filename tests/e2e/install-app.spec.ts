import { expect, test, type Page } from '@playwright/test';

import { bootstrapDatabase, navigateToPage } from './helpers/bootstrap';

/**
 * Install controls (src/lib/appInstall.ts). Playwright cannot install an app,
 * so the browser's `beforeinstallprompt` event is fired by hand with a fake
 * `prompt()`; whether a real one also fires in headless Chromium does not
 * matter, the last event wins. The Safari guide is covered by
 * InstallGuideDialog.test.tsx and appInstall.test.ts.
 */

async function fireInstallPrompt(page: Page, outcome: 'accepted' | 'dismissed') {
  await page.evaluate((choice) => {
    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: string; platform: string }>;
    };
    event.prompt = async () => {
      const win = window as unknown as { __installPrompts?: number };
      win.__installPrompts = (win.__installPrompts ?? 0) + 1;
    };
    event.userChoice = Promise.resolve({ outcome: choice, platform: 'web' });
    window.dispatchEvent(event);
  }, outcome);
}

const promptCount = (page: Page) =>
  page.evaluate(() => (window as unknown as { __installPrompts?: number }).__installPrompts ?? 0);

async function openPreferences(page: Page) {
  await navigateToPage(page, 'settings');
  await page.getByTestId('settings-tab-preferences').click();
  await expect(page.getByTestId('settings-install')).toBeVisible();
}

test('the rail offers Install while the browser allows it, and hides it once installed', async ({ page }) => {
  await bootstrapDatabase(page, { loadSampleData: false });

  await fireInstallPrompt(page, 'accepted');
  const railItem = page.getByTestId('rail-install-app');
  await expect(railItem).toBeVisible();
  await expect(railItem).toHaveAccessibleName('Install app');

  await railItem.click();
  await expect.poll(() => promptCount(page)).toBe(1);
  await expect(railItem).toHaveCount(0);

  await openPreferences(page);
  await expect(page.getByTestId('settings-install-installed')).toHaveText('The app is installed on this device.');
  await expect(page.getByTestId('settings-install-button')).toHaveCount(0);
});

test('Settings explains when installing is not offered, and installs when it is', async ({ page }) => {
  await bootstrapDatabase(page, { loadSampleData: false });

  // A dismissed prompt cannot be shown again until the browser fires a new event.
  await fireInstallPrompt(page, 'dismissed');
  await page.getByTestId('rail-install-app').click();
  await expect.poll(() => promptCount(page)).toBe(1);
  await expect(page.getByTestId('rail-install-app')).toHaveCount(0);

  await openPreferences(page);
  await expect(page.getByTestId('settings-install-unavailable')).toBeVisible();

  await fireInstallPrompt(page, 'accepted');
  const button = page.getByTestId('settings-install-button');
  await expect(button).toHaveText('Install app');
  await button.click();
  await expect.poll(() => promptCount(page)).toBe(2);
  await expect(page.getByTestId('settings-install-installed')).toBeVisible();
});
