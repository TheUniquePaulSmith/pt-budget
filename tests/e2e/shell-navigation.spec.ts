import { expect, test } from '@playwright/test';

import { bootstrapDatabase, navigateToPage, openMobileMoreSheet, reloadAndUnlock, toggleSidebar } from './helpers/bootstrap';

// iPhone 12/13/14-class viewport.
const MOBILE_VIEWPORT = { width: 390, height: 844 };

test('desktop rail collapses to icons that keep their names, and remembers the choice across reloads', async ({ page }) => {
  await bootstrapDatabase(page);

  const rail = page.getByTestId('sidebar-rail');
  await expect(rail).toHaveAttribute('data-expanded', 'true');
  await expect(page.getByTestId('app-bar-title')).toHaveText('Dashboard');

  // Expanded rail: labels are visible text.
  await expect(rail.getByTestId('nav-sql-query')).toHaveText('SQL Query');

  await toggleSidebar(page);
  await expect(rail).toHaveAttribute('data-expanded', 'false');
  // Collapsed rail: the label is gone from the text but still the accessible name.
  await expect(rail.getByTestId('nav-sql-query')).not.toHaveText('SQL Query');
  await expect(page.getByRole('button', { name: 'SQL Query' })).toBeVisible();
  await page.getByRole('button', { name: 'SQL Query' }).click();
  await expect(page.getByTestId('nav-sql-query')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('app-bar-title')).toHaveText('SQL Query');

  // Hovering a collapsed item shows its label as a tooltip.
  await rail.getByTestId('nav-budget').hover();
  await expect(page.getByRole('tooltip', { name: 'Budget' })).toBeVisible();

  // The header keeps Settings, the bell and the AI launcher; the rail keeps
  // Manage Data and the Developer Console.
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
  await expect(page.getByTestId('notification-bell-button')).toBeVisible();
  await expect(page.getByTestId('ai-launcher-button')).toBeVisible();
  await expect(rail.getByRole('button', { name: 'Developer Console' })).toBeVisible();
  await expect(rail.getByRole('button', { name: 'Manage Data' })).toBeVisible();

  // The preference is stored and survives a reload.
  expect(await page.evaluate(() => window.localStorage.getItem('budgetTracker_sidebarExpanded'))).toBe('false');
  await reloadAndUnlock(page);
  await expect(page.getByTestId('sidebar-rail')).toHaveAttribute('data-expanded', 'false');

  await toggleSidebar(page);
  await expect(page.getByTestId('sidebar-rail')).toHaveAttribute('data-expanded', 'true');
  expect(await page.evaluate(() => window.localStorage.getItem('budgetTracker_sidebarExpanded'))).toBe('true');
});

test('the status bar docks beside the rail on desktop and the content is not covered', async ({ page }) => {
  await bootstrapDatabase(page);

  const railBox = await page.getByTestId('sidebar-rail').boundingBox();
  const statusBox = await page.getByTestId('database-status').locator('xpath=ancestor::*[contains(@class, "MuiPaper-root")][1]').boundingBox();
  expect(railBox).not.toBeNull();
  expect(statusBox).not.toBeNull();
  expect(statusBox!.x).toBeGreaterThanOrEqual(railBox!.x + railBox!.width - 1);
});

test('phone viewport uses the bottom navigation and the More sheet', async ({ page }) => {
  // The bootstrap helper waits for the desktop nav, so create the database
  // at desktop size first, then shrink the viewport.
  await bootstrapDatabase(page);
  await page.setViewportSize(MOBILE_VIEWPORT);

  const bottomNav = page.getByTestId('mobile-bottom-nav');
  await expect(bottomNav).toBeVisible();
  await expect(page.getByTestId('sidebar-rail')).toHaveCount(0);

  // The bar carries the first four mobileNav pages plus More.
  for (const id of ['dashboard', 'budget', 'accounts', 'transactions'] as const) {
    await expect(bottomNav.getByTestId(`nav-${id}`)).toBeVisible();
  }
  await expect(bottomNav.getByTestId('nav-more')).toBeVisible();
  await expect(bottomNav.getByTestId('nav-sql-query')).toHaveCount(0);

  await bottomNav.getByTestId('nav-transactions').click();
  await expect(bottomNav.getByTestId('nav-transactions')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('app-bar-title')).toHaveText('Transactions');

  // Everything else lives in the More sheet, including Settings and the
  // developer console.
  await openMobileMoreSheet(page);
  const sheet = page.getByTestId('mobile-more-sheet');
  for (const id of ['projects', 'trips', 'subscriptions', 'notifications', 'sql-query', 'developer-console', 'settings'] as const) {
    await expect(sheet.getByTestId(`nav-${id}`)).toBeVisible();
  }
  await expect(sheet.getByTestId('ai-launcher-menu-item')).toBeVisible();
  await expect(sheet.getByTestId('mobile-manage-data')).toBeVisible();

  await sheet.getByTestId('nav-sql-query').click();
  await expect(sheet).not.toBeVisible();
  await expect(page.getByTestId('app-bar-title')).toHaveText('SQL Query');
  await expect(page.getByTestId('sql-query-input')).toBeVisible();

  // The helper falls back to the More sheet on its own.
  await navigateToPage(page, 'subscriptions');
  await expect(page.getByTestId('app-bar-title')).toHaveText('Subscriptions');

  // The status bar sits above the bottom navigation, and nothing overflows.
  const navBox = await bottomNav.boundingBox();
  const statusBox = await page.getByTestId('database-status').boundingBox();
  expect(navBox).not.toBeNull();
  expect(statusBox).not.toBeNull();
  expect(statusBox!.y + statusBox!.height).toBeLessThanOrEqual(navBox!.y + 1);

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

  // Settings is a full-screen page on phones too, and closing it returns.
  await navigateToPage(page, 'settings');
  await expect(page.getByRole('tab', { name: 'Storage' })).toBeVisible();
  await expect(bottomNav).toHaveCount(0);
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.getByTestId('app-bar-title')).toHaveText('Subscriptions');
});
