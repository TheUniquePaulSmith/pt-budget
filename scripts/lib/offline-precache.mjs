// Pure helpers behind scripts/build-service-worker.mjs: which files of the
// static export (dist/) the service worker saves at install, the URL each one
// is saved under, and the generated sw.js text. Unit-tested by
// src/lib/offlinePrecache.test.ts, which also runs the generated worker.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Cache names start with this; the worker deletes every other version on activate. */
export const CACHE_PREFIX = 'ptbudget-precache-';

/** The marker in the template that the manifest replaces. */
export const MANIFEST_PLACEHOLDER = '/*__PRECACHE_MANIFEST__*/';

/** The export's not-found page: the offline answer for an unknown address. */
export const NOT_FOUND_URL = '/404.html';

/**
 * Files in dist/ the app never loads at runtime. Everything else is saved,
 * because the pages, languages, wasm and worker modules are all fetched lazily
 * and any of them can be the first thing an offline user needs.
 */
const EXCLUDED = [
  /^sw\.js$/, // the worker itself is never precached
  /\.map$/, // source maps (NEXT_DEBUG_BUILD only)
  /^test-wa-sqlite\.html$/, // manual wa-sqlite test page
  /^sql-wasm\//, // sql.js, superseded by wa-sqlite and referenced by nothing
  /^wa-sqlite\/wa-sqlite(-jspi)?\.(mjs|wasm)$/, // only the async build is loaded
  /^wa-sqlite\/src\/types\//, // TypeScript declarations
  /^wa-sqlite\/src\/.*\.(c|h|json)$/, // C sources and build lists
  /\.md$/, // READMEs
  /(^|\/)\.[^/]+$/, // dotfiles
];

/** Whether a dist-relative path (forward slashes) belongs in the precache. */
export function shouldPrecache(relativePath) {
  return !EXCLUDED.some((pattern) => pattern.test(relativePath));
}

/**
 * The URL a file is saved under. HTML pages are saved under the address the
 * user types (`ai/index.html` → `/ai/`), because the worker answers
 * navigations from the cache and the host may redirect `index.html` addresses.
 */
export function urlForFile(relativePath) {
  if (relativePath === 'index.html') return '/';
  if (relativePath.endsWith('/index.html')) return `/${relativePath.slice(0, -'index.html'.length)}`;
  return `/${relativePath}`;
}

function listFiles(root, dir = root) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(root, full));
    else if (entry.isFile()) out.push(path.relative(root, full).split(path.sep).join('/'));
  }
  return out;
}

function shortHash(data) {
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

/**
 * Every precached file of `distDir` as `{ url, revision, size }`, sorted by URL.
 * The revision is a content hash: an unchanged file is copied from the previous
 * cache on update instead of being downloaded again.
 */
export function buildPrecacheManifest(distDir) {
  return listFiles(distDir)
    .filter(shouldPrecache)
    .map((relativePath) => {
      const data = fs.readFileSync(path.join(distDir, relativePath));
      return { url: urlForFile(relativePath), revision: shortHash(data), size: data.length };
    })
    .sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
}

/** One version string for the whole set: it changes whenever any file does. */
export function manifestVersion(entries) {
  return shortHash(entries.map((entry) => `${entry.url} ${entry.revision}`).join('\n'));
}

/** The sw.js text: the template with the manifest and version filled in. */
export function renderServiceWorker(template, entries) {
  if (!template.includes(MANIFEST_PLACEHOLDER)) {
    throw new Error(`Service worker template has no ${MANIFEST_PLACEHOLDER} marker`);
  }
  const notFound = entries.some((entry) => entry.url === NOT_FOUND_URL) ? NOT_FOUND_URL : null;
  const config = {
    version: manifestVersion(entries),
    cachePrefix: CACHE_PREFIX,
    notFoundUrl: notFound,
    entries: entries.map(({ url, revision }) => [url, revision]),
  };
  return template.replace(MANIFEST_PLACEHOLDER, JSON.stringify(config));
}
