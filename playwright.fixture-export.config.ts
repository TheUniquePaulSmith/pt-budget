import { defineConfig, devices } from '@playwright/test';

// Developer tooling, not part of the test suites: runs the scripts under
// tests/e2e-tools (currently the schema-baseline archive export used by
// tests/e2e/database-upgrade.spec.ts). Mirrors playwright.config.ts but points
// testDir at tests/e2e-tools so `npm run test:e2e` never picks these up.
//
//   npx playwright test --config playwright.fixture-export.config.ts
//
// Run it from a checkout of the schema version you want to capture (for the
// v1 baseline: the last commit before the schema v2 migration landed).
export default defineConfig({
  testDir: './tests/e2e-tools',
  timeout: 300_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
