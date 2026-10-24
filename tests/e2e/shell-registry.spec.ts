import { expect, test } from '@playwright/test';

import { bootstrapDatabase, navigateToPage, type AppPageId } from './helpers/bootstrap';

// Every page in the shell's registry (src/components/common/Layout/pageRegistry.tsx)
// must be reachable through a control carrying data-testid="nav-<id>", and the
// slot components the feature agents plug into must be mounted.
const NAVIGATION_PAGES: AppPageId[] = [
  'dashboard',
  'projects',
  'trips',
  'budget',
  'accounts',
  'transactions',
  'subscriptions',
  'notifications',
  'sql-query',
];

test('@smoke every registry page is reachable and the shell slots render', async ({ page }) => {
  await bootstrapDatabase(page);

  for (const id of NAVIGATION_PAGES) {
    await navigateToPage(page, id);
    await expect(page.getByTestId(`nav-${id}`).first()).toHaveAttribute('aria-current', 'page');
  }

  // The notifications page is registered by the foundation as a stub.
  await navigateToPage(page, 'notifications');
  await expect(page.getByTestId('notifications-page')).toBeVisible();
  await expect(page.getByTestId('notifications-empty')).toHaveText('No notifications yet.');

  // Slots: bell and AI launcher in the header.
  await expect(page.getByTestId('notification-bell-button')).toBeVisible();
  await expect(page.getByTestId('ai-launcher-button')).toBeVisible();
  await page.getByTestId('ai-launcher-button').click();
  await expect(page.getByRole('heading', { name: 'Local AI' })).toBeVisible();
  await page.keyboard.press('Escape');

  // The bell navigates to the notifications page.
  await navigateToPage(page, 'dashboard');
  await page.getByTestId('notification-bell-button').click();
  await expect(page.getByTestId('notifications-page')).toBeVisible();

  // Settings is a full-screen page; closing it returns to the page that was open.
  await navigateToPage(page, 'sql-query');
  await navigateToPage(page, 'settings');
  await expect(page.getByRole('tab', { name: 'Storage' })).toBeVisible();
  await expect(page.getByTestId('nav-dashboard')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.getByTestId('nav-sql-query').first()).toHaveAttribute('aria-current', 'page');
});
