// Offline e2e (`pnpm run test:e2e:offline`): builds the static export and
// serves it with scripts/serve-dist.mjs, because `next dev` never registers
// the service worker. Runs only tests/e2e/offline.spec.ts, which the normal
// configs ignore.
//
//   OFFLINE_E2E_PORT=4180         another port (parallel worktrees)
//   OFFLINE_E2E_SKIP_BUILD=1      serve the existing dist/ (run `pnpm run build` first)
//
// The build writes dist/, which a `next dev` in the same worktree also uses:
// stop the dev server first.
import { defineConfig } from '@playwright/test';

import base from './playwright.config';

const PORT = Number(process.env.OFFLINE_E2E_PORT ?? 4174);
const serve = `node scripts/serve-dist.mjs --port=${PORT} --test-controls`;

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: /(^|[\\/])offline\.spec\.ts$/,
  use: { ...base.use, baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: process.env.OFFLINE_E2E_SKIP_BUILD ? serve : `pnpm run build && ${serve}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 600_000,
  },
});
