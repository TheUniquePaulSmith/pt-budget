import { expect, test } from '@playwright/test';

import { bootstrapDatabase, seedBrowserCompatibility } from './helpers/bootstrap';

// The animated winged-money logo (src/components/common/AppLogo.tsx) replaces
// the placeholder icons on the welcome screen and in the app shell.

// iPhone 12/13/14-class viewport.
const MOBILE_VIEWPORT = { width: 390, height: 844 };

test('welcome screen shows the animated logo', async ({ page }) => {
  await seedBrowserCompatibility(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Welcome to Budget Tracker' })).toBeVisible();
  const logo = page.getByTestId('app-logo');
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute('data-animated', 'true');
  // Three wing frames flip on a flap cycle; the bob is a separate transform.
  await expect(logo.locator('animate')).toHaveCount(3);
});

test('the sidebar rail and the phone app bar both carry the logo', async ({ page }) => {
  await bootstrapDatabase(page, { loadSampleData: false });

  const rail = page.getByTestId('sidebar-rail');
  await expect(rail.getByTestId('app-logo')).toBeVisible();
  await expect(rail.getByTestId('app-logo')).toHaveAttribute('data-animated', 'true');

  // The collapsed rail has no room for it; the toggle stays reachable.
  await page.getByTestId('sidebar-toggle').click();
  await expect(rail).toHaveAttribute('data-expanded', 'false');
  await expect(rail.getByTestId('app-logo')).toHaveCount(0);

  // No rail on phones: the logo moves into the app bar, beside the page title.
  await page.setViewportSize(MOBILE_VIEWPORT);
  await expect(rail).toHaveCount(0);
  const appBarLogo = page.getByTestId('app-logo');
  await expect(appBarLogo).toBeVisible();
  await expect(page.getByTestId('app-bar-title')).toHaveText('Dashboard');
});
