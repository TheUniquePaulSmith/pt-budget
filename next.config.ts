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
  // Headers for SharedArrayBuffer support in Next-served environments.
  // Static export hosts must be configured to send equivalent headers.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
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
