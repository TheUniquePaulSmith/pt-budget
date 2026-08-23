import { expect, test, type Page } from '@playwright/test';

import { bootstrapDatabase } from './helpers/bootstrap';

// iPhone 12/13/14-class viewport.
const MOBILE_VIEWPORT = { width: 390, height: 844 };

// Imports the full sample-data fixture set so the current month has
// transactions and every chart tab renders real content.
const SAMPLE_DATA_TRANSACTION_LIMIT = 1000;

const CHART_TABS = [
  'Spending Breakdown',
  'Budget Health',
  'Trends',
  'Commitments',
  'Income Sources',
  'User Analysis',
];

async function expectNoHorizontalPageOverflow(page: Page, context: string) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    scrollWidth,
    `${context}: document scrollWidth ${scrollWidth} must fit client width ${clientWidth}`
  ).toBeLessThanOrEqual(clientWidth);
}

test('@smoke dashboard charts and tabs fit a phone viewport without horizontal overflow', async ({ page }, testInfo) => {
  // The bootstrap helper waits for the desktop nav ("SQL Query" button), which
  // the app shell moves into the drawer on mobile widths — so create the
  // database at desktop size first, then shrink the viewport.
  await bootstrapDatabase(page, {
    sampleDataTransactionLimit: SAMPLE_DATA_TRANSACTION_LIMIT,
  });

  // Sample data reaches into the current month, so the default "This Month"
  // range renders real pie slices rather than the empty state.
  await expect(page.locator('[class*="MuiPieArc"]').first()).toBeVisible({
    timeout: 120_000,
  });

  await page.setViewportSize(MOBILE_VIEWPORT);

  for (const tabName of CHART_TABS) {
    const tab = page.getByRole('tab', { name: tabName });
    // Scrollable tabs keep every tab reachable on narrow screens; click
    // fails here if the tab is clipped by a non-scrollable tab bar.
    await tab.click({ timeout: 20_000 });
    await expect(tab).toHaveAttribute('aria-selected', 'true');

    await expectNoHorizontalPageOverflow(page, `"${tabName}" tab`);
    // Let chart entry animations finish so the diagnostic screenshots show
    // the settled layout (the overflow assertions above don't depend on it).
    await page.waitForTimeout(600);
    await page.screenshot({
      path: testInfo.outputPath(
        `mobile-${tabName.toLowerCase().replace(/\s+/g, '-')}.png`
      ),
      fullPage: true,
    });
  }
});
