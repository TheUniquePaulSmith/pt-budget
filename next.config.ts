import type { NextConfig } from "next";
import { execSync } from "node:child_process";

function getAppVersion(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
}

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
    NEXT_PUBLIC_APP_VERSION: getAppVersion(),
  },
  output: 'export',
  productionBrowserSourceMaps: isDebugBuild,
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  distDir: 'dist',
  images: {
    unoptimized: true,
  },
  turbopack: {
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
