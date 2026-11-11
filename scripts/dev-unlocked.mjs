#!/usr/bin/env node
// Starts the dev server with automatic database unlock, for local agents and
// humans who reload the app constantly while editing (see src/lib/devUnlock.ts).
//
//   pnpm run dev:unlocked            next dev --turbopack, auto-unlock on
//   pnpm run dev:unlocked -p 3005    extra arguments go to next dev (a leading
//                                    `--`, as npm wants it, is dropped)
//
// The secret is generated once per repository clone and stored in the shared
// .git directory (every worktree reads the same file, nothing is ever
// committed), so each worktree's dev server opens the same localhost
// database. Delete the file to rotate the secret; a database created under
// the old one then needs its password or Reset App (`?debug`).
// NEXT_PUBLIC_DEV_UNLOCK_SECRET already present in the environment wins.
//
// Only `next dev` honours the secret: `next build` forces
// NODE_ENV=production, which compiles the feature out of every static export.

import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scriptArgs } from './lib/script-args.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET_FILE_NAME = 'budget-dev-unlock-secret';
const FALLBACK_SECRET_FILE = path.join(ROOT, '.dev-unlock-secret');
const ENV_NAME = 'NEXT_PUBLIC_DEV_UNLOCK_SECRET';

function gitCommonDir() {
  try {
    return execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

/** Where the secret lives: the clone's shared .git directory, or a gitignored file in the checkout. */
export function secretFilePath() {
  const commonDir = gitCommonDir();
  return commonDir ? path.join(commonDir, SECRET_FILE_NAME) : FALLBACK_SECRET_FILE;
}

/** Reads the stored secret, generating and saving a new one when none exists yet. */
export function loadOrCreateSecret(file = secretFilePath()) {
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 16) return { secret: existing, created: false };
  } catch {
    // No secret yet.
  }
  const secret = crypto.randomBytes(24).toString('base64url');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${secret}\n`, { mode: 0o600 });
  return { secret, created: true };
}

function main() {
  let source;
  let secret = process.env[ENV_NAME];
  if (secret && secret.length >= 16) {
    source = `${ENV_NAME} from the environment`;
  } else {
    const file = secretFilePath();
    const loaded = loadOrCreateSecret(file);
    secret = loaded.secret;
    source = `${loaded.created ? 'new secret written to' : 'secret from'} ${file}`;
  }

  console.log(`dev:unlocked — automatic database unlock is ON (${source}).`);
  console.log('Only this dev server unlocks automatically; builds and plain `npm run dev` never do.');

  // node itself, not an npm/npx shim: on Windows those are .cmd files that
  // need a shell, and the node path usually contains a space.
  const nextBin = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  const child = spawn(process.execPath, [nextBin, 'dev', '--turbopack', ...scriptArgs()], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, [ENV_NAME]: secret },
  });
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
