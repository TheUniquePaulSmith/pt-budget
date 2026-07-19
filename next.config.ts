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

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: getAppVersion(),
  },
  output: 'export',
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
  // webpack: (config, { isServer }) => {
  //   // Basic fallbacks for Node.js modules in the browser
  //   if (!isServer) {
  //     config.resolve.fallback = {
  //       ...config.resolve.fallback,
  //       fs: false,
  //       path: false,
  //       crypto: false,
  //       stream: false,
  //       util: false,
  //       buffer: false,
  //       os: false,
  //     };
  //   }
    
  //   return config;
  // },
};

export default nextConfig;
