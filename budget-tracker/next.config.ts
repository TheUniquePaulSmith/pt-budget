import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // output: 'export',
  // trailingSlash: true,
  // skipTrailingSlashRedirect: true,
  // distDir: 'dist',
  images: {
    unoptimized: true,
  },
  webpack: (config, { isServer }) => {
    // Basic fallbacks for Node.js modules in the browser
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
        stream: false,
        util: false,
        buffer: false,
        os: false,
      };
    }
    
    return config;
  },
};

export default nextConfig;
