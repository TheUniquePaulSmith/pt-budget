import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";

import { parseRemoteTags, pickReleaseTag, RELEASE_BRANCH, resolveAppVersion } from "./src/lib/appVersion";

function git(args: string[]): string {
  try {
    return execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

// The footer version: the release tag on a build of `main` (app.ptbudget.com),
// the short commit hash everywhere else (dev.ptbudget.com, previews, local).
// The rules live in src/lib/appVersion.ts; this only gathers what git and the
// build environment say.
function getAppVersion(): string {
  const commitSha = git(['rev-parse', 'HEAD']) || process.env.WORKERS_CI_COMMIT_SHA || '';
  // Cloudflare builds a detached commit, so the branch comes from its build variable.
  const branch = process.env.WORKERS_CI_BRANCH || git(['rev-parse', '--abbrev-ref', 'HEAD']);

  let tagsAtCommit: string[] = [];
  if (branch === RELEASE_BRANCH && commitSha) {
    tagsAtCommit = git(['tag', '--points-at', 'HEAD']).split('\n').filter(Boolean);
    // CI checkouts are shallow and carry no tags: ask the remote, which needs
    // no history. The tag has to exist by the time the build starts.
    if (!pickReleaseTag(tagsAtCommit) && process.env.CI) {
      tagsAtCommit = parseRemoteTags(git(['ls-remote', '--tags', 'origin']), commitSha);
    }
  }

  return resolveAppVersion({
    override: process.env.APP_VERSION,
    branch,
    commitSha,
    shortSha: git(['rev-parse', '--short', 'HEAD']),
    tagsAtCommit,
  });
}

// Next evaluates this file in several processes during one build; the
// variable hands the first answer to the rest, so git (and on a release
// build, the network) is asked once.
const appVersion = (process.env.APP_VERSION_RESOLVED ??= getAppVersion());

// `next build` always forces NODE_ENV=production internally, so there's no
// way to get a literal dev-mode build out of it. This flag instead keeps
// the same optimized static-export pipeline but restores real file names,
// line numbers, and unmangled identifiers in DevTools, for hosts (like the
// Cloudflare Pages build for dev.ptbudget.org) that want debuggable output
// without shipping a persistent `next dev` process. Set NEXT_DEBUG_BUILD=true
// in that environment's build variables; leave it unset for production.
const isDebugBuild = process.env.NEXT_DEBUG_BUILD === 'true';

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
  output: 'export',
  productionBrowserSourceMaps: isDebugBuild,
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  distDir: 'dist',
  images: {
    unoptimized: true,
  },
  // This folder is the workspace root. Without these, Next 15.5 picks the
  // outermost lockfile it finds above the project (a stray one in a parent
  // folder, or the main checkout's when running in .claude/worktrees/*).
  outputFileTracingRoot: __dirname,
  turbopack: {
    root: __dirname,
    resolveAlias: {
      fs: {browser: './empty.js'},
      path: {browser: './empty.js'},
      crypto: {browser: './empty.js'},
      stream: {browser: './empty.js'},
      util: {browser: './empty.js'},
      buffer: {browser: './empty.js'},
      os: {browser: './empty.js'},
    }
  },
  // Document-Isolation-Policy makes pages crossOriginIsolated — unlocking
  // SharedArrayBuffer and with it wllama's multithreaded wasm — on
  // Chromium 137+ without the COOP: same-origin / COEP: require-corp pair
  // this app previously sent. COOP severed the cloud-auth popup's
  // window.opener/.closed references the moment it navigated to
  // Google/Microsoft; DIP isolates the document via out-of-process frames
  // instead, so auth popups stay fully scriptable (see cloudAuthPopup.ts).
  // Browsers without DIP (Firefox/Safari today) get no isolation and run
  // wllama single-threaded, but sign-in popups work everywhere.
  // Static export hosts must be configured to send this same header.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Document-Isolation-Policy',
            value: 'isolate-and-require-corp',
          },
        ],
      },
    ];
  },
  webpack: (config) => {
    if (isDebugBuild) {
      config.optimization.minimize = false;
    }
    return config;
  },
};

export default nextConfig;
