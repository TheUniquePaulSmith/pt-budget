import { expect, test } from '@playwright/test';

// The first-run browser compatibility test (src/components/setup/TestBrowser.tsx)
// is a developer surface: outside ?debug the visitor only sees the quiet
// loading screen (animated logo plus one status line) until the welcome
// screen appears. Nothing is seeded here so the real test runs.

declare global {
  interface Window {
    __compatPanelSeen?: boolean;
  }
}

test('a first visit shows the quiet loading screen, never the compatibility panel', async ({ page }) => {
  // Records whether the per-check panel is ever attached, even for one frame.
  await page.addInitScript(() => {
    window.__compatPanelSeen = false;
    const check = () => {
      if (document.querySelector('[data-testid="browser-compatibility-panel"]')) {
        window.__compatPanelSeen = true;
      }
    };
    new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true });
  });

  await page.goto('/');

  const loadingScreen = page.getByTestId('app-loading-screen');
  await expect(loadingScreen).toBeVisible();
  await expect(loadingScreen.getByTestId('app-logo')).toBeVisible();
  await expect(loadingScreen).toHaveAttribute('role', 'status');
  await expect(page.getByRole('progressbar')).toHaveCount(0);

  await expect(page.getByRole('heading', { name: 'Welcome to Budget Tracker' })).toBeVisible({ timeout: 120_000 });
  await expect(loadingScreen).toHaveCount(0);
  await expect(page.getByTestId('browser-compatibility-panel')).toHaveCount(0);
  expect(await page.evaluate(() => window.__compatPanelSeen)).toBe(false);
});

test('?debug shows the compatibility panel with every check passing', async ({ page }) => {
  await page.goto('/?debug');

  const panel = page.getByTestId('browser-compatibility-panel');
  await expect(panel).toBeVisible({ timeout: 120_000 });
  await expect(panel.getByText('Browser Compatibility Test')).toBeVisible();
  await expect(panel.getByText('Compatible', { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(panel.getByText('Passed')).toHaveCount(5);

  await expect(page.getByRole('heading', { name: 'Welcome to Budget Tracker' })).toBeVisible({ timeout: 120_000 });
});
