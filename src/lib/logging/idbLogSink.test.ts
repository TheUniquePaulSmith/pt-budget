import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { IdbLogSink, toStorable } from './idbLogSink';
import { LOGS_STORE, openLogsDatabase, requestToPromise, type LogChannelMessage } from './logDatabase';
import { clearLogs, closeLogStore, countLogs, readAllLogs, readLogPage, subscribeToLogUpdates } from './logStore';
import type { LogRecord } from './types';

// Recent timestamps: the default retention prunes anything older than 7 days.
const BASE_TS = Date.now() - 60_000;

function record(n: number, overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    id: `t-${n}`,
    ts: BASE_TS + n,
    level: 'info',
    message: `m${n}`,
    context: { source: 'app', tabId: 't', sessionId: 's', n },
    ...overrides,
  };
}

async function storedCount(): Promise<number> {
  const db = await openLogsDatabase();
  try {
    return await requestToPromise(db.transaction(LOGS_STORE, 'readonly').objectStore(LOGS_STORE).count());
  } finally {
    db.close();
  }
}

describe('IdbLogSink', () => {
  let sink: IdbLogSink | null = null;

  beforeEach(() => {
    // A fresh IndexedDB per test.
    globalThis.indexedDB = new IDBFactory();
  });

  afterEach(async () => {
    await sink?.close();
    sink = null;
    await closeLogStore();
  });

  it('batches queued records into one write and announces them on the channel', async () => {
    const messages: LogChannelMessage[] = [];
    const unsubscribe = subscribeToLogUpdates((message) => messages.push(message));
    sink = new IdbLogSink({ flushDelayMs: 10_000, batchSize: 100 });

    sink.write(record(1));
    sink.write(record(2));
    sink.write(record(3));
    expect(await storedCount()).toBe(0); // still queued

    await sink.flush();
    expect(await storedCount()).toBe(3);

    const all = await readAllLogs();
    expect(all.map((entry) => entry.message)).toEqual(['m1', 'm2', 'm3']);
    expect(all.map((entry) => entry.seq)).toEqual([1, 2, 3]);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(messages).toContainEqual({ type: 'appended', count: 3, source: 'app', tabId: 't' });
    unsubscribe();
  });

  it('flushes automatically once the batch is full or the idle delay elapses', async () => {
    // Real timers on purpose: fake-indexeddb schedules its own work with timers.
    sink = new IdbLogSink({ flushDelayMs: 30, batchSize: 3 });
    sink.write(record(1));
    sink.write(record(2));
    sink.write(record(3)); // batch full → immediate flush
    await sink.flush();
    expect(await storedCount()).toBe(3);

    sink.write(record(4));
    expect(await storedCount()).toBe(3);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await sink.flush();
    expect(await storedCount()).toBe(4);
  });

  it('prunes the oldest entries beyond the ring cap', async () => {
    sink = new IdbLogSink({ flushDelayMs: 10_000, retention: () => ({ maxEntries: 5, maxAgeDays: 0 }) });
    for (let n = 1; n <= 12; n += 1) sink.write(record(n));
    await sink.flush();

    const all = await readAllLogs();
    expect(all.map((entry) => entry.message)).toEqual(['m8', 'm9', 'm10', 'm11', 'm12']);
    expect(await countLogs()).toBe(5);
  });

  it('prunes entries older than the retention age', async () => {
    const now = 10 * 24 * 60 * 60 * 1000; // day 10
    sink = new IdbLogSink({
      flushDelayMs: 10_000,
      retention: () => ({ maxEntries: 1000, maxAgeDays: 2 }),
      now: () => now,
    });
    sink.write(record(1, { ts: now - 5 * 24 * 60 * 60 * 1000 })); // 5 days old → pruned
    sink.write(record(2, { ts: now - 1 * 24 * 60 * 60 * 1000 })); // 1 day old → kept
    sink.write(record(3, { ts: now }));
    await sink.flush();

    expect((await readAllLogs()).map((entry) => entry.message)).toEqual(['m2', 'm3']);
  });

  it('stores structured-clone-safe copies of exotic context values', async () => {
    const circular: Record<string, unknown> = { name: 'loop' };
    circular.self = circular;
    const storable = toStorable(
      record(1, {
        context: {
          source: 'app',
          fn: () => 1,
          when: new Date(0),
          bytes: new Uint8Array(3),
          circular,
          big: BigInt(5),
        },
        error: { name: 'E', message: 'boom' },
      })
    );
    expect(storable.context).toEqual({
      source: 'app',
      fn: expect.stringContaining('=>'),
      when: '1970-01-01T00:00:00.000Z',
      bytes: '[Uint8Array 3 bytes]',
      circular: { name: 'loop', self: '[Circular]' },
      big: '5n',
    });
    expect(storable.error).toEqual({ name: 'E', message: 'boom' });

    sink = new IdbLogSink({ flushDelayMs: 10_000 });
    sink.write(storable);
    await sink.flush();
    expect(await countLogs()).toBe(1);
  });

  it('drops writes after close and lets the database be cleared', async () => {
    sink = new IdbLogSink({ flushDelayMs: 10_000 });
    sink.write(record(1));
    await sink.flush();
    await sink.close();
    sink.write(record(2));
    await sink.flush();
    expect(await countLogs()).toBe(1);

    const page = await readLogPage();
    expect(page.records).toHaveLength(1);
    await clearLogs();
    expect(await countLogs()).toBe(0);
    sink = null;
  });
});
