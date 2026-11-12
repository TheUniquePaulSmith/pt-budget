#!/usr/bin/env node
// Runs the Playwright e2e suite in a visible (non-headless) Chromium window.
//
//   pnpm run test:e2e:headed                   the full suite (every spec, smoke tests included)
//   pnpm run test:e2e:smoke:headed             only the @smoke tests, what CI runs
//   pnpm run test:e2e:headed loans.spec.ts     extra arguments go to `playwright test`
//   pnpm run test:e2e:headed -g "test name"    a single test
//   pnpm run test:e2e:headed --workers=4       several windows at once (default: one worker)
//
// Config: uses the untracked playwright.local.config.ts that `pnpm run worktree:prepare`
// writes (own port, reuseExistingServer: false), so the run can never silently test
// whichever sibling worktree owns :3000. Without it the base config is used and a
// warning says why that is risky. An explicit --config in the arguments wins.
//
// Why a script and not a plain package.json entry: npm scripts run through cmd.exe on
// Windows, so a "pick the local config if it exists" one-liner is not portable.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scriptArgs } from './lib/script-args.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_CONFIG = 'playwright.local.config.ts';

/** Builds the argument list for `playwright test`. `--smoke` is ours, everything else is forwarded. */
function buildPlaywrightArgs(argv, { localConfigExists }) {
  const args = [];
  let smoke = false;
  for (const arg of argv) {
    if (arg === '--smoke') smoke = true;
    else args.push(arg);
  }
  const hasConfig = args.some((a) => a === '-c' || a === '--config' || a.startsWith('--config='));
  const hasWorkers = args.some((a) => a === '-j' || a === '--workers' || a.startsWith('--workers=') || /^-j\d+$/.test(a));
  const out = ['test'];
  if (!hasConfig && localConfigExists) out.push('--config', LOCAL_CONFIG);
  if (smoke) out.push('--grep', '@smoke');
  // One window to watch: the configs run several workers, i.e. several windows at once.
  if (!hasWorkers) out.push('--workers=1');
  out.push('--headed', ...args);
  return { args: out, usesLocalConfig: !hasConfig && localConfigExists, hasConfig };
}

function main() {
  const localConfigExists = fs.existsSync(path.join(ROOT, LOCAL_CONFIG));
  const { args, usesLocalConfig, hasConfig } = buildPlaywrightArgs(scriptArgs(), {
    localConfigExists,
  });

  if (!usesLocalConfig && !hasConfig) {
    console.warn(
      `test:e2e:headed — ${LOCAL_CONFIG} not found, using playwright.config.ts. It reuses whatever dev server ` +
        'owns :3000, which may be another branch, or a dev:unlocked server the specs cannot bootstrap against. ' +
        'Run `npm run worktree:prepare` to create a private config.',
    );
  }

  // node itself, not an npx shim: on Windows that is a .cmd file that needs a shell.
  const cli = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
  const child = spawn(process.execPath, [cli, ...args], { cwd: ROOT, stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
  });
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => child.kill(sig));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
