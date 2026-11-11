#!/usr/bin/env node
// Prepares a checkout (usually a .claude/worktrees/* worktree) so that builds
// and tests can be trusted. Every step reports OK / FIXED / WARN / FAIL.
//
//   node scripts/prepare-worktree.mjs            check and fix what is safe to fix
//   node scripts/prepare-worktree.mjs --check    report only, change nothing
//   node scripts/prepare-worktree.mjs --help
//
// Steps:
//   1. checkout   — this is the real app (not the stale `main` prototype)
//   2. deps       — node_modules exists (`pnpm install --frozen-lockfile` when it does not),
//                   was installed by pnpm and matches pnpm-lock.yaml
//   3. branch     — ahead/behind origin/devel/latest (never rebases or merges)
//   4. fixtures   — the generated sample-data fixtures exist and reach the current month
//                   and validate against public/database-schema.js
//   5. port       — a free, per-worktree Playwright port and an untracked
//                   playwright.local.config.ts with reuseExistingServer: false,
//                   so e2e can never adopt a sibling worktree's dev server
//   6. hygiene    — tracked files the test tools rewrite (test-results/.last-run.json,
//                   committed sample-data fixtures)

import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Every date-dependent fixture: generated, gitignored, relative to "today".
// (users, account_cards, categories and companies are static and committed.)
const GENERATED_FIXTURES = [
  'transactions',
  'accounts',
  'projects',
  'trips',
  'budget_plans',
  'budget_plan_categories',
  'income_sources',
  'loans',
  'loan_match_rules',
  'classification_rules',
  'account_balance_snapshots',
  'expectations',
];
// Same flags as .github/workflows/ci.yml: twelve months of natural rows (one per
// household event, about 60 a month) so the expectations manifest applies.
// Rows are written newest-first, so the e2e import caps keep the recent months.
const GENERATOR_FLAGS = ['--months=12', '--seed=review'];
const STALE_AFTER_DAYS = 31;
const LOCAL_CONFIG = 'playwright.local.config.ts';
const PORT_RANGE = { start: 3100, size: 900 };
const INSTALL_COMMAND = 'pnpm install --frozen-lockfile';

const args = new Set(process.argv.slice(2));
if (args.has('--help') || args.has('-h')) {
  console.log(`Usage: node scripts/prepare-worktree.mjs [options]

  --check                 report only; install, generate and write nothing
  --offline               skip 'git fetch' (branch status uses the last fetched origin)
  --no-install            never run 'pnpm install --frozen-lockfile'
  --regenerate-fixtures   regenerate sample data even when the files look fine
  --port=<n>              use this Playwright port instead of the per-worktree default
  --json                  print the results as JSON as well`);
  process.exit(0);
}
const CHECK_ONLY = args.has('--check');
const OFFLINE = args.has('--offline');
const NO_INSTALL = args.has('--no-install');
const FORCE_REGENERATE = args.has('--regenerate-fixtures');
const PORT_OVERRIDE = (() => {
  const flag = [...args].find((a) => a.startsWith('--port='));
  return flag ? Number.parseInt(flag.slice('--port='.length), 10) : null;
})();

const results = [];
function report(step, status, message, hint) {
  results.push({ step, status, message, ...(hint ? { hint } : {}) });
  const mark = { OK: 'OK   ', FIXED: 'FIXED', WARN: 'WARN ', FAIL: 'FAIL ' }[status];
  console.log(`[${mark}] ${step.padEnd(9)} ${message}`);
  if (hint) console.log(`          ${' '.repeat(9)} -> ${hint}`);
}

function git(...gitArgs) {
  return execFileSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function tryGit(...gitArgs) {
  try {
    return git(...gitArgs);
  } catch {
    return null;
  }
}
// `pnpm` is a .cmd shim on Windows and needs a shell; node itself must not go
// through one (its path usually contains a space: C:\Program Files\nodejs).
function run(command, commandArgs, label, { shell = false } = {}) {
  console.log(`          ${' '.repeat(9)} running: ${command} ${commandArgs.join(' ')}`);
  const result = shell
    ? spawnSync([command, ...commandArgs].join(' '), { cwd: ROOT, stdio: 'inherit', shell: true })
    : spawnSync(command, commandArgs, { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${label} exited with ${result.status}`);
}

// ---------------------------------------------------------------------------
// 1. checkout
// ---------------------------------------------------------------------------
function checkCheckout() {
  const required = ['src/lib/databaseService.ts', 'public/database-schema.js', 'tests/e2e/helpers/bootstrap.ts'];
  const missing = required.filter((file) => !fs.existsSync(path.join(ROOT, file)));
  if (missing.length > 0) {
    report(
      'checkout',
      'FAIL',
      `missing ${missing.join(', ')} — this looks like the stale 'main' prototype, not devel/latest`,
      'cut the worktree from devel/latest (origin/main has unrelated history)'
    );
    return false;
  }
  const primary = path.resolve(tryGit('rev-parse', '--path-format=absolute', '--git-common-dir') ?? '', '..');
  const isPrimary = path.resolve(ROOT).toLowerCase() === primary.toLowerCase();
  report(
    'checkout',
    isPrimary ? 'WARN' : 'OK',
    isPrimary
      ? `${ROOT} is the primary checkout (it often holds uncommitted WIP from other sessions)`
      : `worktree ${path.basename(ROOT)} on ${tryGit('branch', '--show-current') || '(detached)'}`,
    isPrimary ? 'prefer a .claude/worktrees/* checkout for new work' : undefined
  );
  return true;
}

// ---------------------------------------------------------------------------
// 2. deps
// ---------------------------------------------------------------------------
function checkDeps() {
  const nextPackage = path.join(ROOT, 'node_modules', 'next', 'package.json');
  if (fs.existsSync(nextPackage)) {
    // pnpm keeps a copy of the lockfile it installed from; an npm-era tree has none.
    // A leftover npm tree hoists transitive packages, so an import of a package that
    // is not in package.json still resolves here and only fails on a clean pnpm
    // install (CI, the Cloudflare build).
    const installedLock = path.join(ROOT, 'node_modules', '.pnpm', 'lock.yaml');
    if (!fs.existsSync(installedLock)) {
      report(
        'deps',
        'WARN',
        'node_modules was not installed by pnpm (a leftover npm tree?)',
        `delete node_modules, then run \`${INSTALL_COMMAND}\``
      );
    } else if (readLockfile(installedLock) !== readLockfile(path.join(ROOT, 'pnpm-lock.yaml'))) {
      report('deps', 'WARN', 'pnpm-lock.yaml differs from the installed node_modules', `run \`${INSTALL_COMMAND}\``);
    } else {
      report('deps', 'OK', 'node_modules is installed and matches pnpm-lock.yaml');
    }
    return true;
  }
  const why = 'no node_modules: `pnpm run dev` would panic with "Next.js package not found"';
  if (CHECK_ONLY || NO_INSTALL) {
    report('deps', 'FAIL', why, `run \`${INSTALL_COMMAND}\``);
    return false;
  }
  try {
    run('pnpm', ['install', '--frozen-lockfile'], INSTALL_COMMAND, { shell: true });
    report('deps', 'FIXED', `installed node_modules with \`${INSTALL_COMMAND}\``);
    return true;
  } catch (error) {
    report('deps', 'FAIL', `${INSTALL_COMMAND} failed: ${error.message}`);
    return false;
  }
}

// Git may check pnpm-lock.yaml out with CRLF line endings; pnpm's own copy is LF.
// With package.json's packageManager set, pnpm-lock.yaml starts with a separate
// YAML document (`---` … `---`) pinning pnpm itself; the copy in node_modules
// holds only the dependency document after it, so compare that part.
function readLockfile(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return text;
  const end = text.indexOf('\n---\n', 3);
  return end === -1 ? text : text.slice(end + '\n---\n'.length);
}

// ---------------------------------------------------------------------------
// 3. branch
// ---------------------------------------------------------------------------
function checkBranch() {
  if (!OFFLINE && !CHECK_ONLY) {
    if (tryGit('fetch', 'origin', 'devel/latest', '--quiet') === null) {
      report('branch', 'WARN', 'could not fetch origin/devel/latest; using the last fetched state');
    }
  }
  if (tryGit('rev-parse', '--verify', '--quiet', 'origin/devel/latest') === null) {
    report('branch', 'WARN', 'origin/devel/latest is not available locally', 'git fetch origin devel/latest');
    return;
  }
  const counts = tryGit('rev-list', '--left-right', '--count', 'HEAD...origin/devel/latest');
  const [ahead, behind] = (counts ?? '0 0').split(/\s+/).map(Number);
  const dirty = (tryGit('status', '--porcelain') ?? '').split('\n').filter(Boolean).length;
  const summary = `${ahead} ahead, ${behind} behind origin/devel/latest, ${dirty} changed file(s)`;
  if (behind === 0) {
    report('branch', 'OK', summary);
  } else if (ahead === 0 && dirty === 0) {
    report('branch', 'WARN', summary, 'safe to catch up: git merge --ff-only origin/devel/latest');
  } else {
    report(
      'branch',
      'WARN',
      summary,
      'behind with own work: sync with the base branch (Claude app: sync_with_base_branch; otherwise rebase onto origin/devel/latest)'
    );
  }
}

// ---------------------------------------------------------------------------
// 4. fixtures
// ---------------------------------------------------------------------------
const FIXTURE_DIR = path.join(ROOT, 'public', 'sample-data');

function newestTransactionDate() {
  const file = path.join(FIXTURE_DIR, 'transactions.json');
  if (!fs.existsSync(file)) return null;
  // The envelope's meta (first in the file) records the window, and the rows
  // follow newest-first, so the head of the file is enough.
  const fd = fs.openSync(file, 'r');
  const length = Math.min(fs.statSync(file).size, 64 * 1024);
  const buffer = Buffer.alloc(length);
  fs.readSync(fd, buffer, 0, length, 0);
  fs.closeSync(fd);
  const head = buffer.toString('utf8');
  const endDate = head.match(/"endDate":\s*"(\d{4}-\d{2}-\d{2})"/);
  if (endDate) return endDate[1];
  const dates = head.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  return dates.sort().at(-1) ?? null;
}

/** Modified tracked files under public/sample-data (repo-relative paths). */
function trackedFixtureChanges() {
  // Not via git(): trimming would eat the leading status column of line one.
  let output = '';
  try {
    output = execFileSync('git', ['status', '--porcelain', '--', 'public/sample-data'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return [];
  }
  return output
    .split('\n')
    .filter((line) => /^(M.|.M) /.test(line))
    .map((line) => line.slice(3).trim());
}

function validateFixtures() {
  const result = spawnSync(process.execPath, ['scripts/validate-sample-data-schema.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
  });
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

function checkFixtures() {
  const missing = GENERATED_FIXTURES.filter((name) => !fs.existsSync(path.join(FIXTURE_DIR, `${name}.json`)));
  const newest = newestTransactionDate();
  // Stale once the newest row is older than the limit or outside the current
  // calendar month: dashboards default to "This Month" and the e2e suite
  // expects it to have rows.
  const ageDays = newest ? (Date.now() - Date.parse(`${newest}T00:00:00Z`)) / 86_400_000 : Infinity;
  const currentMonth = new Date().toISOString().slice(0, 7);
  const stale = ageDays > STALE_AFTER_DAYS || (newest !== null && newest.slice(0, 7) !== currentMonth);

  let problem = null;
  if (missing.length > 0) problem = `missing ${missing.map((n) => `${n}.json`).join(', ')}`;
  else if (stale) problem = `newest sample transaction is ${newest} (dashboards show an empty "This Month")`;
  else if (FORCE_REGENERATE) problem = 'regeneration requested';

  if (problem) {
    if (CHECK_ONLY) {
      report('fixtures', 'FAIL', problem, `node scripts/generate-sample-data.mjs ${GENERATOR_FLAGS.join(' ')}`);
      return;
    }
    const trackedBefore = new Set(trackedFixtureChanges());
    try {
      run(process.execPath, ['scripts/generate-sample-data.mjs', ...GENERATOR_FLAGS], 'sample-data generator');
    } catch (error) {
      report('fixtures', 'FAIL', `generator failed: ${error.message}`);
      return;
    }
    // The generator rewrites the committed fixtures too. Put back only the ones
    // that were clean before, so a deliberate schema change stays visible.
    // (On Windows with core.autocrlf this is often pure line-ending churn.)
    const churned = trackedFixtureChanges().filter((file) => !trackedBefore.has(file));
    if (churned.length > 0) tryGit('checkout', '--', ...churned);
    const validation = validateFixtures();
    if (!validation.ok) {
      report(
        'fixtures',
        'FAIL',
        'regenerated fixtures do not validate against the schema',
        'run `pnpm run sample-data:validate` and read the report; a schema change may need generator updates'
      );
      return;
    }
    report('fixtures', 'FIXED', `${problem} -> regenerated (${GENERATOR_FLAGS.join(' ')}) and validated`);
    return;
  }

  const validation = validateFixtures();
  if (!validation.ok) {
    report('fixtures', 'FAIL', 'fixtures do not validate against public/database-schema.js', 'node scripts/prepare-worktree.mjs --regenerate-fixtures');
    return;
  }
  report('fixtures', 'OK', `all ${GENERATED_FIXTURES.length} generated fixtures present, newest transaction ${newest}, schema-valid`);
}

// ---------------------------------------------------------------------------
// 5. port
// ---------------------------------------------------------------------------
function connects(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(400);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, () => server.close(() => resolve(true)));
  });
}

async function isFree(port) {
  if ((await connects('127.0.0.1', port)) || (await connects('::1', port))) return false;
  return canListen(port);
}

function readConfiguredPort() {
  const file = path.join(ROOT, LOCAL_CONFIG);
  if (!fs.existsSync(file)) return null;
  const match = fs.readFileSync(file, 'utf8').match(/const PORT = (\d+);/);
  return match ? Number(match[1]) : null;
}

function localConfigSource(port) {
  return `// Generated by scripts/prepare-worktree.mjs for this worktree only. Untracked:
// listed in .git/info/exclude. Regenerate with \`node scripts/prepare-worktree.mjs\`.
//
// Runs the e2e suite against a dev server that Playwright starts itself on a
// port no sibling worktree uses. reuseExistingServer is false so a collision
// fails loudly instead of silently testing another branch's code, and so the
// dummy cloud client ids from playwright.config.ts are always injected.
//
//   pnpm exec playwright test --config ${LOCAL_CONFIG} [spec] [--grep @smoke]
import { defineConfig } from '@playwright/test';

import base from './playwright.config';

const PORT = ${port};
const baseWebServer = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer;

export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: \`http://localhost:\${PORT}\` },
  webServer: {
    ...baseWebServer,
    // pnpm passes extra arguments straight through; a \`--\` would reach next dev
    // as a literal argument (it then reads -p as the project directory).
    command: \`pnpm run dev -p \${PORT}\`,
    url: \`http://localhost:\${PORT}\`,
    reuseExistingServer: false,
  },
});
`;
}

function ensureExcluded(entry) {
  const excludePath = tryGit('rev-parse', '--path-format=absolute', '--git-path', 'info/exclude');
  if (!excludePath) return false;
  const current = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, 'utf8') : '';
  if (current.split(/\r?\n/).includes(entry)) return true;
  if (CHECK_ONLY) return false;
  fs.mkdirSync(path.dirname(excludePath), { recursive: true });
  fs.appendFileSync(excludePath, `${current.endsWith('\n') || current === '' ? '' : '\n'}${entry}\n`);
  return true;
}

async function checkPort() {
  const hash = crypto.createHash('sha1').update(path.resolve(ROOT).toLowerCase()).digest();
  const preferred = PORT_OVERRIDE ?? PORT_RANGE.start + (hash.readUInt32BE(0) % PORT_RANGE.size);
  const configured = readConfiguredPort();

  const shared3000 = (await connects('127.0.0.1', 3000)) || (await connects('::1', 3000));
  const note = shared3000 ? '; :3000 is taken by some dev server, so never run e2e without --config' : '';
  const excluded = ensureExcluded(LOCAL_CONFIG);

  // An existing config keeps its port: something listening there is most likely
  // this worktree's own server from an earlier run, which we cannot tell apart
  // from a stranger's. Playwright (reuseExistingServer: false) fails loudly if so.
  if (configured && !PORT_OVERRIDE) {
    const busy = !(await isFree(configured));
    report(
      'port',
      busy || !excluded ? 'WARN' : 'OK',
      `${LOCAL_CONFIG} uses port ${configured}${busy ? ' (currently in use)' : ''}${note}`,
      busy
        ? `stop the server on ${configured} before running e2e, or rerun with --port=<n>`
        : excluded
          ? undefined
          : `add ${LOCAL_CONFIG} to .git/info/exclude`
    );
    return;
  }

  let port = preferred;
  for (let i = 0; i < PORT_RANGE.size && !(await isFree(port)); i += 1) {
    port = PORT_RANGE.start + ((port - PORT_RANGE.start + 1) % PORT_RANGE.size);
  }
  if (CHECK_ONLY) {
    report('port', 'FAIL', `no ${LOCAL_CONFIG} for this worktree (would use port ${port})${note}`, 'run without --check');
    return;
  }
  fs.writeFileSync(path.join(ROOT, LOCAL_CONFIG), localConfigSource(port));
  report('port', 'FIXED', `wrote ${LOCAL_CONFIG} on port ${port}${note}`);
}

// ---------------------------------------------------------------------------
// 6. hygiene
// ---------------------------------------------------------------------------
function checkHygiene() {
  const notes = [];
  if ((tryGit('status', '--porcelain', '--', 'test-results/.last-run.json') ?? '') !== '') {
    notes.push('test-results/.last-run.json is modified (git checkout -- test-results/.last-run.json)');
  }
  const fixtures = trackedFixtureChanges();
  if (fixtures.length > 0) {
    notes.push(`${fixtures.length} committed sample-data file(s) modified — keep only if the schema changed on purpose (git checkout -- public/sample-data/)`);
  }
  if ((tryGit('ls-files', '--', LOCAL_CONFIG) ?? '') !== '') {
    notes.push(`${LOCAL_CONFIG} is tracked by git — it must stay local`);
  }
  if (notes.length === 0) report('hygiene', 'OK', 'no tool churn in tracked files');
  else for (const note of notes) report('hygiene', 'WARN', note);
}

// ---------------------------------------------------------------------------
console.log(`prepare-worktree ${CHECK_ONLY ? '(check only) ' : ''}in ${ROOT}\n`);
if (checkCheckout()) {
  const depsOk = checkDeps();
  checkBranch();
  if (depsOk || CHECK_ONLY) checkFixtures();
  await checkPort();
  checkHygiene();
}

const failed = results.filter((r) => r.status === 'FAIL').length;
const warned = results.filter((r) => r.status === 'WARN').length;
console.log(`\n${failed ? 'NOT READY' : 'READY'}: ${failed} failed, ${warned} warning(s).`);
if (args.has('--json')) console.log(JSON.stringify({ ready: failed === 0, results }, null, 2));
process.exit(failed ? 1 : 0);
