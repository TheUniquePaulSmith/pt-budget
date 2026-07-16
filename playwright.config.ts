import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: {
    timeout: 20_000,
  },
  fullyParallel: false,
  maxFailures: 1,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 180_000,
    env: {
      // Dummy client IDs so the cloud-storage buttons render enabled for
      // auth-popup.spec.ts / cloud-sync.spec.ts, which intercept every
      // provider request via Playwright routes and never contact a real
      // IdP. Only takes effect when Playwright starts a fresh server —
      // reuseExistingServer means an already-running `npm run dev` keeps
      // whatever env it was originally started with.
      NEXT_PUBLIC_GOOGLE_CLIENT_ID: 'e2e-test-google-client-id',
      NEXT_PUBLIC_MICROSOFT_CLIENT_ID: 'e2e-test-microsoft-client-id',
      NEXT_PUBLIC_MICROSOFT_TENANT_ID: 'common',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
});