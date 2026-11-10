#!/usr/bin/env node
/**
 * Builds the coming-soon placeholder into dist/.
 *
 * Same contract as the real app (`npm run build` writes a static site to
 * dist/), so the Cloudflare worker behind app.ptbudget.com keeps its build
 * settings when the app replaces this branch.
 *
 * The footer version follows the rule the app uses:
 *   1. APP_VERSION build variable, when set
 *   2. on `main`: the release tag (vX.Y.Z) pointing at the commit being built
 *   3. otherwise: "build <short commit hash>"
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = path.join(root, 'site');
const outDir = path.join(root, 'dist');

const RELEASE_BRANCH = 'main';
const RELEASE_TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function git(args) {
  try {
    return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

/** Highest release tag first: numeric by major.minor.patch, a pre-release below its release. */
function compareReleaseTags(a, b) {
  const parse = (tag) => {
    const [core, preRelease] = tag.slice(1).split(/-(.*)/s);
    return { parts: core.split('.').map(Number), preRelease };
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i += 1) {
    if (left.parts[i] !== right.parts[i]) return right.parts[i] - left.parts[i];
  }
  if (!left.preRelease !== !right.preRelease) return left.preRelease ? 1 : -1;
  return (right.preRelease ?? '').localeCompare(left.preRelease ?? '');
}

/**
 * Release tags pointing at `commit`. CI checkouts are usually shallow and
 * carry no tags, so on CI the remote is asked as well (`ls-remote` needs no
 * history, only the network).
 */
function releaseTagsAt(commit) {
  const local = git(['tag', '--points-at', 'HEAD']).split('\n');
  let remote = [];
  if (local.every((tag) => !RELEASE_TAG.test(tag)) && process.env.CI) {
    remote = git(['ls-remote', '--tags', 'origin'])
      .split('\n')
      .map((line) => line.split('\t'))
      .filter(([sha]) => sha === commit)
      // An annotated tag lists twice; the "^{}" line is the commit it points at.
      .map(([, ref]) => (ref ?? '').replace(/^refs\/tags\//, '').replace(/\^\{\}$/, ''));
    console.log(`  remote tag lookup: ${remote.length ? remote.join(', ') : 'no tag at this commit (or no reachable remote)'}`);
  }
  return [...new Set([...local, ...remote])].filter((tag) => RELEASE_TAG.test(tag)).sort(compareReleaseTags);
}

function resolveVersion() {
  const override = process.env.APP_VERSION?.trim();
  if (override) return { label: override, source: 'APP_VERSION build variable' };

  const commit = git(['rev-parse', 'HEAD']) || process.env.WORKERS_CI_COMMIT_SHA || '';
  const branch = process.env.WORKERS_CI_BRANCH || git(['rev-parse', '--abbrev-ref', 'HEAD']);
  console.log(`  branch: ${branch || '(unknown)'}  commit: ${commit || '(unknown)'}`);

  if (branch === RELEASE_BRANCH && commit) {
    const [tag] = releaseTagsAt(commit);
    if (tag) return { label: tag, source: `release tag on ${RELEASE_BRANCH}` };
  }
  if (commit) return { label: `build ${commit.slice(0, 7)}`, source: 'commit hash' };
  return { label: 'dev build', source: 'fallback (no git)' };
}

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

console.log('Building the placeholder');
const version = resolveVersion();
console.log(`  version: ${version.label}  (from ${version.source})`);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(siteDir, outDir, { recursive: true });

const indexPath = path.join(outDir, 'index.html');
const source = readFileSync(indexPath, 'utf8');
const stamped = source.replace(/<!--version-->[\s\S]*?<!--\/version-->/, escapeHtml(version.label));
if (stamped === source) throw new Error('site/index.html has no <!--version--> marker to stamp');
writeFileSync(indexPath, stamped);
// Every other path gets the same page with a 404 status (hosts that serve 404.html for unknown URLs).
writeFileSync(path.join(outDir, '404.html'), stamped);

console.log(`  wrote ${path.relative(root, outDir)}/`);
