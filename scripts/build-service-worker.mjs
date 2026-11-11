#!/usr/bin/env node
// Writes dist/sw.js after `next build` (part of `pnpm run build`): the offline
// service worker with the list of every file of this build, plus
// dist/offline.json (file count and size) for Settings to show. Rules for what is
// saved live in scripts/lib/offline-precache.mjs; the worker itself in
// scripts/service-worker/sw.template.js.
//
//   node scripts/build-service-worker.mjs [--dist=dist]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildPrecacheManifest,
  manifestVersion,
  OFFLINE_SUMMARY_FILE,
  offlineSummary,
  renderServiceWorker,
} from './lib/offline-precache.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distArg = process.argv.find((arg) => arg.startsWith('--dist='));
const distDir = path.resolve(ROOT, distArg ? distArg.slice('--dist='.length) : 'dist');

if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  console.error(`build-service-worker: ${distDir} has no index.html. Run \`next build\` first.`);
  process.exit(1);
}

const template = fs.readFileSync(path.join(ROOT, 'scripts', 'service-worker', 'sw.template.js'), 'utf8');
const entries = buildPrecacheManifest(distDir);
fs.writeFileSync(path.join(distDir, 'sw.js'), renderServiceWorker(template, entries));
// What turning on offline mode will download, for Settings → Preferences to show beforehand.
fs.writeFileSync(path.join(distDir, OFFLINE_SUMMARY_FILE), JSON.stringify(offlineSummary(entries)));

const megabytes = (entries.reduce((sum, entry) => sum + entry.size, 0) / 1024 / 1024).toFixed(1);
console.log(
  `build-service-worker: dist/sw.js precaches ${entries.length} files (${megabytes} MB), version ${manifestVersion(entries)}`,
);
