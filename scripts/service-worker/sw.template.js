/* Offline service worker for the static export.
 *
 * Template: scripts/build-service-worker.mjs fills in the manifest after
 * `next build` and writes dist/sw.js. Never served by `next dev`.
 *
 * - install: saves every file of the build (pages, chunks, languages, wasm,
 *   worker modules) in one versioned cache. A file whose content hash did not
 *   change is copied from the previous version's cache instead of downloaded.
 * - activate: deletes the other versions' caches.
 * - fetch: same-origin GETs are answered from the cache first, anything not in
 *   it goes to the network. A page load for an unknown address tries the
 *   network and falls back to the saved not-found page.
 * - A new version waits until the page asks it to take over
 *   ({ type: 'SKIP_WAITING' }) or every tab is closed, because the database
 *   SharedWorker of the old version keeps running while any tab is open.
 */

const CONFIG = /*__PRECACHE_MANIFEST__*/;

const CACHE_NAME = CONFIG.cachePrefix + CONFIG.version;
const REVISION_HEADER = 'X-Precache-Revision';
const DOWNLOAD_CONCURRENCY = 6;
const REVISIONS = new Map(CONFIG.entries);

function resolvePath(pathname) {
  if (REVISIONS.has(pathname)) return pathname;
  // `/ai` and `/ai/index.html` are the same page as `/ai/`.
  if (!pathname.endsWith('/') && REVISIONS.has(pathname + '/')) return pathname + '/';
  if (pathname.endsWith('/index.html')) {
    const directory = pathname.slice(0, -'index.html'.length);
    if (REVISIONS.has(directory)) return directory;
  }
  return null;
}

/**
 * A response the cache can hand to any request: redirects followed by the
 * install fetch are flattened (navigations reject redirected responses) and
 * the revision is stamped for the next version's copy step.
 */
async function storable(response, revision) {
  const headers = new Headers(response.headers);
  headers.set(REVISION_HEADER, revision);
  const body = await response.arrayBuffer();
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

async function previousCopies() {
  const names = (await caches.keys()).filter(
    (name) => name.startsWith(CONFIG.cachePrefix) && name !== CACHE_NAME,
  );
  return Promise.all(names.map((name) => caches.open(name)));
}

async function fromPreviousCache(previous, url, revision) {
  for (const cache of previous) {
    const response = await cache.match(url);
    if (response && response.headers.get(REVISION_HEADER) === revision) return response;
  }
  return null;
}

async function download(url, revision) {
  const absolute = new URL(url, self.location.origin).href;
  const response = await fetch(new Request(absolute, { cache: 'reload', credentials: 'same-origin' }));
  // The not-found page may come back with status 404; it is still the page.
  const acceptable = response.ok || (url === CONFIG.notFoundUrl && response.status === 404);
  if (!acceptable) throw new Error('Precache download failed: ' + url + ' (' + response.status + ')');
  return storable(response, revision);
}

async function precache() {
  const cache = await caches.open(CACHE_NAME);
  const previous = await previousCopies();
  const queue = CONFIG.entries.slice();
  const work = async () => {
    while (queue.length > 0) {
      const [url, revision] = queue.shift();
      const existing = await cache.match(url);
      if (existing && existing.headers.get(REVISION_HEADER) === revision) continue;
      const copy = await fromPreviousCache(previous, url, revision);
      await cache.put(url, copy || (await download(url, revision)));
    }
  };
  await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, work));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CONFIG.cachePrefix) && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (data.type === 'GET_VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: CONFIG.version, files: CONFIG.entries.length });
  }
});

async function cached(path) {
  const cache = await caches.open(CACHE_NAME);
  return cache.match(path);
}

async function handleNavigation(request, path) {
  if (path) {
    const response = await cached(path);
    if (response) return response;
  }
  try {
    return await fetch(request);
  } catch (error) {
    const notFound = CONFIG.notFoundUrl ? await cached(CONFIG.notFoundUrl) : null;
    if (notFound) return notFound;
    throw error;
  }
}

async function handleAsset(request, path) {
  const response = await cached(path);
  return response || fetch(request);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const path = resolvePath(url.pathname);
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request, path));
  } else if (path) {
    event.respondWith(handleAsset(request, path));
  }
  // Anything else same-origin and not in the build goes to the network untouched.
});
