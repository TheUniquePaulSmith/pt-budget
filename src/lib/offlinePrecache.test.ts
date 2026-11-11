import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildPrecacheManifest,
  CACHE_PREFIX,
  manifestVersion,
  renderServiceWorker,
  shouldPrecache,
  urlForFile,
} from '../../scripts/lib/offline-precache.mjs';

const ORIGIN = 'https://app.example.test';
const TEMPLATE = fs.readFileSync(path.resolve(__dirname, '../../scripts/service-worker/sw.template.js'), 'utf8');

describe('offline precache rules', () => {
  it('keeps everything the app loads and drops what it never does', () => {
    for (const kept of [
      'index.html',
      'ai/index.txt',
      '404.html',
      '_next/static/chunks/1684-65b77ba905d30a37.js',
      '_next/static/media/font.woff2',
      'database-worker.js',
      'database-tester.js',
      'wa-sqlite/wa-sqlite-async.mjs',
      'wa-sqlite/wa-sqlite-async.wasm',
      'wa-sqlite/src/examples/IDBBatchAtomicVFS.js',
      'wllama/wllama.wasm',
      'sample-data/transactions.json',
    ]) {
      expect(shouldPrecache(kept), kept).toBe(true);
    }
    for (const dropped of [
      'sw.js',
      '_next/static/chunks/main.js.map',
      'test-wa-sqlite.html',
      'sql-wasm/sql-wasm.wasm',
      'wa-sqlite/wa-sqlite.wasm',
      'wa-sqlite/wa-sqlite-jspi.mjs',
      'wa-sqlite/src/libvfs.c',
      'wa-sqlite/src/exported_functions.json',
      'wa-sqlite/src/types/index.d.ts',
      'sample-data/README.md',
      '.DS_Store',
    ]) {
      expect(shouldPrecache(dropped), dropped).toBe(false);
    }
  });

  it('saves pages under the address the user types', () => {
    expect(urlForFile('index.html')).toBe('/');
    expect(urlForFile('ai/index.html')).toBe('/ai/');
    expect(urlForFile('auth/complete/index.html')).toBe('/auth/complete/');
    expect(urlForFile('404.html')).toBe('/404.html');
    expect(urlForFile('ai/index.txt')).toBe('/ai/index.txt');
    expect(urlForFile('wllama/wllama.wasm')).toBe('/wllama/wllama.wasm');
  });
});

describe('buildPrecacheManifest', () => {
  let dist: string;

  beforeEach(() => {
    dist = fs.mkdtempSync(path.join(os.tmpdir(), 'precache-'));
    const write = (relative: string, content: string) => {
      fs.mkdirSync(path.dirname(path.join(dist, relative)), { recursive: true });
      fs.writeFileSync(path.join(dist, relative), content);
    };
    write('index.html', '<html>home</html>');
    write('ai/index.html', '<html>ai</html>');
    write('404.html', '<html>missing</html>');
    write('_next/static/chunks/a.js', 'console.log(1)');
    write('_next/static/chunks/a.js.map', '{}');
    write('sw.js', 'old worker');
  });

  afterEach(() => {
    fs.rmSync(dist, { recursive: true, force: true });
  });

  it('lists every kept file sorted, with content revisions and a version that follows them', () => {
    const entries = buildPrecacheManifest(dist);
    expect(entries.map((entry: { url: string }) => entry.url)).toEqual([
      '/',
      '/404.html',
      '/_next/static/chunks/a.js',
      '/ai/',
    ]);
    expect(entries[0].revision).toMatch(/^[0-9a-f]{16}$/);
    const before = manifestVersion(entries);

    fs.writeFileSync(path.join(dist, 'ai/index.html'), '<html>ai v2</html>');
    const after = buildPrecacheManifest(dist);
    expect(after[0].revision).toBe(entries[0].revision);
    expect(after[3].revision).not.toBe(entries[3].revision);
    expect(manifestVersion(after)).not.toBe(before);
  });

  it('refuses a template without the manifest marker', () => {
    expect(() => renderServiceWorker('const CONFIG = {};', [])).toThrow(/marker/);
  });
});

// ---------------------------------------------------------------------------
// The generated worker, run in a sandbox with an in-memory Cache Storage.

class FakeCache {
  readonly store = new Map<string, Response>();

  private key(request: RequestInfo | URL): string {
    const raw = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
    const url = new URL(raw, ORIGIN);
    return url.pathname;
  }

  async match(request: RequestInfo | URL) {
    const response = this.store.get(this.key(request));
    return response ? response.clone() : undefined;
  }

  async put(request: RequestInfo | URL, response: Response) {
    this.store.set(this.key(request), response);
  }
}

class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>();

  async open(name: string) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache());
    return this.caches.get(name)!;
  }

  async keys() {
    return [...this.caches.keys()];
  }

  async delete(name: string) {
    return this.caches.delete(name);
  }
}

type Listener = (event: unknown) => void;

interface Harness {
  listeners: Map<string, Listener>;
  caches: FakeCacheStorage;
  fetched: string[];
  skipWaitingCalls: number;
  claimCalls: number;
  online: boolean;
  version: string;
}

/** Files the fake host serves; `/404.html` answers with status 404 like some hosts do. */
const HOST: Record<string, { body: string; status?: number }> = {
  '/': { body: 'home page' },
  '/ai/': { body: 'ai page' },
  '/404.html': { body: 'not found page', status: 404 },
  '/_next/static/chunks/a.js': { body: 'chunk a' },
  '/wllama/wllama.wasm': { body: 'big wasm' },
};

const ENTRIES = Object.entries(HOST).map(([url, { body }]) => ({ url, revision: `rev-${body.length}`, size: body.length }));

function loadWorker(entries = ENTRIES, caches = new FakeCacheStorage()): Harness {
  const harness: Harness = {
    listeners: new Map(),
    caches,
    fetched: [],
    skipWaitingCalls: 0,
    claimCalls: 0,
    online: true,
    version: manifestVersion(entries),
  };
  const fetchImpl = async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, ORIGIN);
    harness.fetched.push(url.pathname);
    if (!harness.online) throw new TypeError('Failed to fetch');
    const file = HOST[url.pathname];
    return new Response(file?.body ?? 'host 404', {
      status: file ? (file.status ?? 200) : 404,
      headers: { 'Document-Isolation-Policy': 'isolate-and-require-corp' },
    });
  };
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type: string, listener: Listener) => harness.listeners.set(type, listener),
    skipWaiting: () => {
      harness.skipWaitingCalls += 1;
    },
    clients: {
      claim: async () => {
        harness.claimCalls += 1;
      },
    },
  };
  vm.runInNewContext(renderServiceWorker(TEMPLATE, entries), {
    self,
    caches,
    fetch: fetchImpl,
    Request,
    Response,
    Headers,
    URL,
    Map,
    Promise,
    Array,
    Error,
  });
  return harness;
}

async function lifecycle(harness: Harness, type: 'install' | 'activate') {
  let pending: Promise<unknown> = Promise.resolve();
  harness.listeners.get(type)!({ waitUntil: (promise: Promise<unknown>) => (pending = promise) });
  await pending;
}

async function request(harness: Harness, url: string, mode: RequestMode | 'navigate' = 'cors', method = 'GET') {
  let responded: Promise<Response> | null = null;
  const event = {
    request: { url: new URL(url, ORIGIN).href, mode, method },
    respondWith: (promise: Promise<Response>) => (responded = promise),
  };
  harness.listeners.get('fetch')!(event);
  return responded === null ? null : ((await responded) as Response);
}

describe('generated service worker', () => {
  it('saves every file at install, flattening the not-found page and keeping host headers', async () => {
    const harness = loadWorker();
    await lifecycle(harness, 'install');

    const cache = harness.caches.caches.get(CACHE_PREFIX + harness.version)!;
    expect([...cache.store.keys()].sort()).toEqual(Object.keys(HOST).sort());
    const notFound = (await cache.match('/404.html'))!;
    expect(await notFound.text()).toBe('not found page');
    expect(notFound.headers.get('Document-Isolation-Policy')).toBe('isolate-and-require-corp');
  });

  it('fails the install when a file cannot be downloaded', async () => {
    const harness = loadWorker([...ENTRIES, { url: '/gone.js', revision: 'x', size: 1 }]);
    await expect(lifecycle(harness, 'install')).rejects.toThrow(/gone\.js/);
  });

  it('answers pages and assets from the cache while the host is unreachable', async () => {
    const harness = loadWorker();
    await lifecycle(harness, 'install');
    await lifecycle(harness, 'activate');
    harness.online = false;
    harness.fetched = [];

    expect(await (await request(harness, '/?loadSampleData', 'navigate'))!.text()).toBe('home page');
    expect(await (await request(harness, '/ai', 'navigate'))!.text()).toBe('ai page');
    expect(await (await request(harness, '/ai/index.html', 'navigate'))!.text()).toBe('ai page');
    expect(await (await request(harness, '/_next/static/chunks/a.js?v=1'))!.text()).toBe('chunk a');
    expect(await (await request(harness, '/somewhere/else/', 'navigate'))!.text()).toBe('not found page');
    expect(harness.fetched).toEqual(['/somewhere/else/']);
  });

  it('leaves other origins, other methods and unknown assets to the network', async () => {
    const harness = loadWorker();
    await lifecycle(harness, 'install');

    expect(await request(harness, 'https://www.googleapis.com/drive/v3/files')).toBeNull();
    expect(await request(harness, '/', 'cors', 'POST')).toBeNull();
    expect(await request(harness, '/not-in-build.json')).toBeNull();
  });

  it('copies unchanged files from the previous version and deletes it on activate', async () => {
    const caches = new FakeCacheStorage();
    const first = loadWorker(ENTRIES, caches);
    await lifecycle(first, 'install');
    await lifecycle(first, 'activate');

    const changed = ENTRIES.map((entry) => (entry.url === '/' ? { ...entry, revision: 'rev-new' } : entry));
    const second = loadWorker(changed, caches);
    await lifecycle(second, 'install');
    expect(second.fetched).toEqual(['/']);
    expect([...caches.caches.keys()].sort()).toEqual(
      [CACHE_PREFIX + first.version, CACHE_PREFIX + second.version].sort(),
    );

    await lifecycle(second, 'activate');
    expect([...caches.caches.keys()]).toEqual([CACHE_PREFIX + second.version]);
    expect(second.claimCalls).toBe(1);
  });

  it('takes over only when the page asks', () => {
    const harness = loadWorker();
    harness.listeners.get('message')!({ data: { type: 'HELLO' } });
    expect(harness.skipWaitingCalls).toBe(0);
    harness.listeners.get('message')!({ data: { type: 'SKIP_WAITING' } });
    expect(harness.skipWaitingCalls).toBe(1);
  });
});
