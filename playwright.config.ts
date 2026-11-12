import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // Needs the production build and the service worker: playwright.offline.config.ts.
  testIgnore: /(^|[\\/])offline\.spec\.ts$/,
  timeout: 120_000,
  // Specs use these defaults rather than their own per-call timeouts: outside
  // the setup helpers (APP_READY_TIMEOUT_MS) no single step was measured above
  // ~7 s, so a broken step fails in 20 s instead of one or two minutes.
  expect: {
    timeout: 20_000,
  },
  fullyParallel: false,
  maxFailures: 1,
  retries: process.env.CI ? 2 : 0,
  // Every test gets a fresh browser context, so its own SharedWorker and
  // IndexedDB database: spec files run side by side without sharing state.
  // Measured on 4 workers: the smoke set in about 1 minute instead of 2, the
  // full suite in about 4 instead of 10.5. CI runners have 2–4 cores.
  // `--workers=N` overrides (a big machine can take 6 or more).
  workers: process.env.CI ? 2 : 4,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    // Clicks, fills, waitFor, waitForEvent/URL: the same 20 s as assertions
    // instead of Playwright's default of no limit (the whole test timeout).
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
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