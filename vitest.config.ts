import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  css: {
    // Tests never assert on styles, and postcss.config.mjs uses Next.js's
    // string-plugin shorthand that Vite's PostCSS loader cannot resolve.
    // An inline empty config stops Vite from picking that file up.
    postcss: {},
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    restoreMocks: true,
    clearMocks: true,
    server: {
      deps: {
        // @mui/x-data-grid's ESM entry has a side-effect `import './index.css'`.
        // Externalized deps are loaded by Node, which cannot handle .css — inline
        // it so Vite's transform pipeline resolves the stylesheet instead.
        inline: ['@mui/x-data-grid'],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/databaseService.ts'],
      thresholds: {
        statements: 80,
        branches: 60,
        functions: 95,
        lines: 80,
      },
    },
  },
});