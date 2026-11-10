#!/usr/bin/env node
// Tools for updating the ptbudget.com landing site (a separate repo,
// ptbudget-site) from this app repo. Used by the `landing-site` skill.
//
//   node .claude/skills/landing-site/scripts/landing-site.mjs <command> [options]
//
//   where                 print the site repo's path and state
//   shots                 compare the screenshots on disk with the ones the site uses
//   capture [--only=a,b]  retake screenshots from this checkout of the app
//   qa [--only=id,id]     build the site, serve it, screenshot it, run basic checks
//
// Options for every command:
//   --site=<path>         the site repo (default: PTBUDGET_SITE_DIR, else the
//                         folder named ptbudget-site next to the primary checkout)

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SPEC = 'tests/e2e/landing-screenshots.spec.ts';
const LOCAL_CONFIG = 'playwright.local.config.ts';

const [command, ...rest] = process.argv.slice(2);
const options = Object.fromEntries(
  rest
    .filter((arg) => arg.startsWith('--'))
    .map((arg) => {
      const [key, ...value] = arg.slice(2).split('=');
      return [key, value.length ? value.join('=') : 'true'];
    })
);

function fail(message) {
  console.error(`landing-site: ${message}`);
  process.exit(1);
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** The site repo: --site, PTBUDGET_SITE_DIR, or ptbudget-site beside the primary checkout. */
function findSite() {
  const explicit = options.site ?? process.env.PTBUDGET_SITE_DIR;
  // A worktree's common dir is the primary checkout's .git, wherever the worktree lives.
  const primary = path.dirname(path.resolve(ROOT, git(ROOT, 'rev-parse', '--git-common-dir')));
  const site = path.resolve(explicit ?? path.join(path.dirname(primary), 'ptbudget-site'));
  if (!fs.existsSync(path.join(site, 'src', 'data', 'features.ts'))) {
    fail(
      `no landing site at ${site} (expected src/data/features.ts). Clone ptbudget-site there, or pass --site=<path> / set PTBUDGET_SITE_DIR.`
    );
  }
  return site;
}

const shotsDir = (site) => path.join(site, 'src', 'assets', 'screenshots');

function shotInventory(site) {
  const onDisk = fs
    .readdirSync(shotsDir(site))
    .filter((name) => name.endsWith('.png'))
    .map((name) => name.slice(0, -4))
    .sort();
  // Every `file: 'name'` in the data files, plus screenshot('name') calls in pages.
  const used = new Set();
  const sources = [path.join(site, 'src', 'data'), path.join(site, 'src', 'pages')];
  for (const dir of sources) {
    for (const entry of fs.readdirSync(dir)) {
      const text = fs.readFileSync(path.join(dir, entry), 'utf8');
      for (const match of text.matchAll(/(?:\bfile:\s*|screenshot\()'([a-z0-9-]+)'/g)) used.add(match[1]);
    }
  }
  return {
    onDisk,
    used: [...used].sort(),
    missing: [...used].filter((name) => !onDisk.includes(name)).sort(),
    unused: onDisk.filter((name) => !used.has(name)),
  };
}

// --- where -------------------------------------------------------------------

function where() {
  const site = findSite();
  const status = git(site, 'status', '--short');
  console.log(`site repo   ${site}`);
  console.log(`branch      ${git(site, 'rev-parse', '--abbrev-ref', 'HEAD')} @ ${git(site, 'rev-parse', '--short', 'HEAD')}`);
  console.log(`working tree ${status ? `has changes:\n${status}` : 'clean'}`);
  console.log(`deps        ${fs.existsSync(path.join(site, 'node_modules')) ? 'installed' : 'MISSING: run npm install in the site repo'}`);
  console.log(`screenshots ${shotsDir(site)}`);
}

// --- shots -------------------------------------------------------------------

function shots() {
  const inventory = shotInventory(findSite());
  console.log(`${inventory.onDisk.length} screenshots on disk, ${inventory.used.length} used by the site.`);
  console.log(`\nUsed:\n  ${inventory.used.join(', ')}`);
  console.log(`\nOn disk but not used (free to add to a feature):\n  ${inventory.unused.join(', ') || '(none)'}`);
  if (inventory.missing.length) {
    console.log(`\nMISSING (referenced by the site, no file; the site build fails until captured):\n  ${inventory.missing.join(', ')}`);
    process.exitCode = 1;
  }
}

// --- capture -----------------------------------------------------------------

/** Which sample data the app would show right now (the generated fixtures are date-relative). */
function sampleDataStamp() {
  const file = path.join(ROOT, 'public', 'sample-data', 'expectations.json');
  if (!fs.existsSync(file)) fail('public/sample-data/expectations.json is missing. Run `node scripts/prepare-worktree.mjs` first.');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { referenceDate: manifest.window?.referenceDate ?? null, transactions: manifest.transactions?.total ?? null };
}

const sameData = (a, b) => Boolean(a && b && a.referenceDate === b.referenceDate && a.transactions === b.transactions);

function capture() {
  const site = findSite();
  if (!fs.existsSync(path.join(ROOT, LOCAL_CONFIG))) {
    fail(`${LOCAL_CONFIG} is missing. Run \`node scripts/prepare-worktree.mjs\` first (the worktree-ready skill).`);
  }
  const only = options.only && options.only !== 'true' ? options.only : '';

  // capture.json (in the site repo) records which sample data the last full
  // capture used. A partial retake on different data shows different totals
  // from the screenshots around it.
  const stampFile = path.join(shotsDir(site), 'capture.json');
  const stamp = fs.existsSync(stampFile) ? JSON.parse(fs.readFileSync(stampFile, 'utf8')) : null;
  const data = sampleDataStamp();
  if (only && !sameData(stamp?.sampleData, data)) {
    console.log(
      `WARNING: the sample data changed since the last full capture (was ${JSON.stringify(stamp?.sampleData ?? null)}, now ${JSON.stringify(data)}).\n` +
        '  Amounts in the retaken screenshots will not match the others. Prefer a full capture (omit --only).\n'
    );
  }

  const logFile = path.join(os.tmpdir(), `landing-capture-${Date.now()}.log`);
  console.log(`Capturing ${only ? `only: ${only}` : 'every screenshot'} into ${shotsDir(site)}`);
  console.log(`This runs the whole flow (about four minutes). Full log: ${logFile}`);

  const result = spawnSync(
    process.execPath,
    [path.join('node_modules', '@playwright', 'test', 'cli.js'), 'test', '--config', LOCAL_CONFIG, SPEC],
    {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, LANDING_SHOTS_DIR: shotsDir(site), LANDING_SHOTS_ONLY: only },
    }
  );
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  fs.writeFileSync(logFile, output);

  // Every Playwright run rewrites this tracked file; never leave it changed.
  try {
    git(ROOT, 'checkout', '--', 'test-results/.last-run.json');
  } catch {
    // Not present in this checkout: nothing to restore.
  }

  const lines = output.split(/\r?\n/).filter((line) => line.includes('[landing]'));
  const failures = lines.filter((line) => line.includes('[landing] FAIL'));
  const written = lines.filter((line) => line.includes('[landing] shot ')).length;
  console.log(`\n${written} screenshot(s) written.`);
  if (failures.length) console.log(`\nFailed steps:\n${failures.map((line) => `  ${line.trim()}`).join('\n')}`);
  if (result.status !== 0) {
    console.log(`\nPlaywright exited ${result.status}. Last lines of the log:`);
    console.log(output.split(/\r?\n/).filter(Boolean).slice(-25).join('\n'));
    process.exit(result.status ?? 1);
  }
  const appCommit = `${git(ROOT, 'rev-parse', '--short', 'HEAD')}${git(ROOT, 'status', '--porcelain') ? '+changes' : ''}`;
  const capturedAt = new Date().toISOString().slice(0, 10);
  const next = only
    ? {
        ...(stamp ?? { capturedAt: null, appCommit: null, sampleData: null }),
        retakes: [...(stamp?.retakes ?? []), { capturedAt, appCommit, shots: only.split(',').map((name) => name.trim()) }].slice(-10),
      }
    : { capturedAt, appCommit, sampleData: data, retakes: [] };
  fs.writeFileSync(stampFile, `${JSON.stringify(next, null, 2)}\n`);

  const changed = git(site, 'status', '--short', '--', 'src/assets/screenshots');
  console.log(`\nChanged in the site repo:\n${changed || '  (no PNG differs from what is committed)'}`);
  console.log('\nNext: look at each changed PNG, then run the `qa` command.');
}

// --- qa ----------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
};

/** Serves the built site (dist/) the way a static host does. */
function serveDist(dist) {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://site').pathname);
    let file = path.join(dist, pathname);
    if (!file.startsWith(dist)) file = dist;
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    const found = fs.existsSync(file);
    if (!found) file = path.join(dist, '404.html');
    response.writeHead(found ? 200 : 404, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function qa() {
  const site = findSite();
  const inventory = shotInventory(site);
  if (inventory.missing.length) fail(`screenshots referenced but not captured: ${inventory.missing.join(', ')}`);

  for (const script of ['check', 'build']) {
    console.log(`\n> npm run ${script} (site)`);
    // One command string: npm is a .cmd shim on Windows, so it needs the shell.
    const run = spawnSync(`npm run ${script}`, { cwd: site, shell: true, stdio: 'inherit' });
    if (run.status !== 0) fail(`npm run ${script} failed in ${site}`);
  }

  const { chromium } = await import('@playwright/test');
  const outDir = path.resolve(options.out && options.out !== 'true' ? options.out : path.join(os.tmpdir(), `ptbudget-site-qa-${Date.now()}`));
  fs.mkdirSync(outDir, { recursive: true });
  const only = options.only && options.only !== 'true' ? options.only.split(',').map((id) => id.trim()) : null;

  const server = await serveDist(path.join(site, 'dist'));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const problems = [];
  const files = [];

  const open = async (viewport, url, scale = 1) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: scale });
    const page = await context.newPage();
    page.on('console', (message) => {
      // The 404 check below requests a missing page on purpose.
      if (message.type() === 'error' && !message.text().includes('404')) problems.push(`${url}: console error: ${message.text()}`);
    });
    page.on('pageerror', (error) => problems.push(`${url}: page error: ${error.message}`));
    await page.goto(base + url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    return page;
  };

  const snap = async (page, name, selector, { block = 'center', offset = 0 } = {}) => {
    const found = await page.evaluate(
      ([target, mode, extra]) => {
        document.documentElement.style.scrollBehavior = 'auto';
        if (target === null) {
          window.scrollTo(0, 0);
          return true;
        }
        const element = document.querySelector(target);
        if (!element) return false;
        element.scrollIntoView({ block: mode });
        window.scrollBy(0, extra);
        return true;
      },
      [selector, block, offset]
    );
    if (!found) {
      problems.push(`no element matches ${selector}`);
      return;
    }
    await page.waitForTimeout(700);
    const file = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: file });
    files.push(file);
  };

  const audit = async (page, label) => {
    // Scroll the whole page so lazy images load, then look for anything broken.
    const result = await page.evaluate(async () => {
      document.documentElement.style.scrollBehavior = 'auto';
      for (let y = 0; y < document.documentElement.scrollHeight; y += 600) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
      const visible = [...document.querySelectorAll('img')].filter((img) => img.offsetParent !== null);
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        broken: visible.filter((img) => img.complete && img.naturalWidth === 0).map((img) => img.alt || img.currentSrc),
        deadAnchors: [...document.querySelectorAll('a[href^="#"]')]
          .map((link) => link.getAttribute('href'))
          .filter((href) => href.length > 1 && !document.getElementById(href.slice(1))),
      };
    });
    if (result.overflow > 0) problems.push(`${label}: page scrolls sideways by ${result.overflow}px`);
    for (const alt of result.broken) problems.push(`${label}: image failed to load: ${alt}`);
    for (const href of result.deadAnchors) problems.push(`${label}: link to ${href} has no target`);
  };

  // Desktop home: the hero, every feature (or just --only), then the closing sections.
  const desktop = await open({ width: 1440, height: 900 }, '/');
  const featureIds = await desktop.evaluate(() =>
    [...document.querySelectorAll('#features article[id]')].map((article) => article.id)
  );
  const wanted = only ? featureIds.filter((id) => only.includes(id)) : featureIds;
  if (only) for (const id of only.filter((id) => !featureIds.includes(id))) problems.push(`--only: no feature with id "${id}"`);
  if (!only) await snap(desktop, 'desktop-hero', null);
  for (const id of wanted) await snap(desktop, `desktop-${id}`, `#${id}`);
  if (!only) {
    await snap(desktop, 'desktop-privacy', '#privacy', { block: 'start', offset: -60 });
    await snap(desktop, 'desktop-faq', '#faq', { block: 'start', offset: -60 });
    await audit(desktop, 'home (desktop)');
  }

  // Phone home.
  const phone = await open({ width: 390, height: 844 }, '/', 2);
  if (!only) await snap(phone, 'phone-hero', null);
  for (const id of wanted.slice(0, only ? wanted.length : 2)) {
    await snap(phone, `phone-${id}`, `#${id}`, { block: 'start', offset: -130 });
    await snap(phone, `phone-${id}-shot`, `#${id} .window, #${id} .compare, #${id} .mobile__row`, { block: 'center' });
  }
  if (!only) await audit(phone, 'home (phone)');

  // Pricing, desktop and phone, and the 404 page.
  if (!only) {
    const pricing = await open({ width: 1440, height: 900 }, '/pricing/');
    await snap(pricing, 'desktop-pricing-plans', '.plans__grid', { block: 'start', offset: -150 });
    await snap(pricing, 'desktop-pricing-compare', '.cmp', { block: 'start', offset: -90 });
    await audit(pricing, 'pricing (desktop)');
    const pricingPhone = await open({ width: 390, height: 844 }, '/pricing/', 2);
    await snap(pricingPhone, 'phone-pricing-plans', '.plans__grid', { block: 'start', offset: -200 });
    await snap(pricingPhone, 'phone-pricing-compare', '.cmp', { block: 'start', offset: -80 });
    await audit(pricingPhone, 'pricing (phone)');
    const lost = await open({ width: 1440, height: 900 }, '/no-such-page/');
    await snap(lost, 'desktop-404', null);
  }

  await browser.close();
  server.close();

  console.log(`\n${files.length} screenshots in ${outDir}:`);
  for (const file of files) console.log(`  ${file}`);
  if (problems.length) {
    console.log(`\nPROBLEMS (${problems.length}):\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    process.exit(1);
  }
  console.log('\nNo console errors, broken images, dead anchors or sideways scrolling. Now look at the screenshots.');
}

// --- main --------------------------------------------------------------------

const commands = { where, shots, capture, qa };
if (!command || !commands[command]) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 14).map((line) => line.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(command ? 1 : 0);
}
await commands[command]();
