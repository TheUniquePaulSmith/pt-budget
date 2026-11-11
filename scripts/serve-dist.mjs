#!/usr/bin/env node
// Serves the static export (dist/) the way the production host does, so the
// offline service worker can be tried locally: `pnpm run build`, then
//
//   pnpm run serve:dist                    http://localhost:4173
//   pnpm run serve:dist --port=4180
//   pnpm run serve:dist --test-controls    adds /__serve-dist/offline|online
//
// The default port is deliberately not 3000: a service worker installed here
// controls its whole origin, and must never answer for `next dev`.
// --test-controls lets playwright.offline.config.ts make the host unreachable
// (every request 503) without stopping the server.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.split('=')[1];
const PORT = Number(arg('port') ?? process.env.PORT ?? 4173);
const DIST = path.resolve(ROOT, arg('dist') ?? 'dist');
const TEST_CONTROLS = process.argv.includes('--test-controls');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

let hostDown = false;

function fileFor(pathname) {
  const relative = decodeURIComponent(pathname).replace(/^\/+/, '');
  const full = path.resolve(DIST, relative);
  if (full !== DIST && !full.startsWith(DIST + path.sep)) return null;
  if (pathname.endsWith('/')) return path.join(full, 'index.html');
  return full;
}

function send(res, status, file) {
  const headers = {
    'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    // The header next.config.ts asks static hosts to send (multi-threaded wasm).
    'Document-Isolation-Policy': 'isolate-and-require-corp',
    'Cache-Control': file.includes(`${path.sep}_next${path.sep}static${path.sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  };
  res.writeHead(status, headers);
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (TEST_CONTROLS && url.pathname.startsWith('/__serve-dist/')) {
    hostDown = url.pathname === '/__serve-dist/offline';
    res.writeHead(204).end();
    return;
  }
  if (hostDown) {
    res.writeHead(503, { 'Content-Type': 'text/plain' }).end('host down (serve-dist test control)');
    return;
  }

  const file = fileFor(url.pathname);
  if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
    send(res, 200, file);
    return;
  }
  // `/ai` → `/ai/` like the production host's trailing-slash handling.
  if (file && !url.pathname.endsWith('/') && fs.existsSync(path.join(file, 'index.html'))) {
    res.writeHead(308, { Location: `${url.pathname}/${url.search}` }).end();
    return;
  }
  send(res, 404, path.join(DIST, '404.html'));
});

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error(`serve-dist: ${DIST} has no index.html. Run \`npm run build\` first.`);
  process.exit(1);
}
if (!fs.existsSync(path.join(DIST, 'sw.js'))) {
  console.warn('serve-dist: dist/sw.js is missing (built with plain `next build`?); the app will not work offline.');
}

server.listen(PORT, () => {
  console.log(`serve-dist: ${DIST} at http://localhost:${PORT}${TEST_CONTROLS ? ' (test controls on)' : ''}`);
});
