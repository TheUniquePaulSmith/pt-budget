import type { MetadataRoute } from 'next';

/**
 * Web app manifest (/manifest.webmanifest): makes the app installable as a
 * standalone window on desktop and a home-screen app on phones. Together with
 * the offline service worker (scripts/build-service-worker.mjs) the installed
 * app opens without a network. Icons come from `npm run favicon:generate`.
 * The name stays English like the page <title>: a manifest cannot follow the
 * device language preference.
 */

export const dynamic = 'force-static';

/** The app bar colour (theme primary) and the light theme's page background. */
const THEME_COLOR = '#1976d2';
const BACKGROUND_COLOR = '#f5f5f5';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Budget Tracker',
    short_name: 'Budget',
    description: 'Track your income, expenses, and budgets with powerful visualizations and insights.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    theme_color: THEME_COLOR,
    background_color: BACKGROUND_COLOR,
    categories: ['finance', 'productivity'],
    // One window is enough: the database worker is shared, and a second launch
    // brings the open window forward instead.
    launch_handler: { client_mode: ['focus-existing', 'auto'] },
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
}
