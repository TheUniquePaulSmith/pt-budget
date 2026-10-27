import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

import { LOGS_STORE, openLogsDatabase, requestToPromise } from './logDatabase';
import { WorkerLogSink, createWorkerLogger } from '../../../public/database-logger.js';

async function storedCount(): Promise<number> {
  const db = await openLogsDatabase();
  try {
    return await requestToPromise(db.transaction(LOGS_STORE, 'readonly').objectStore(LOGS_STORE).count());
  } finally {
    db.close();
  }
}

function record(n: number) {
  return { id: `w-${n}`, ts: Date.now(), level: 'info', message: `m${n}`, context: { source: 'worker' } };
}

describe('WorkerLogSink.close', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('persists what is still queued, then ignores later writes', async () => {
    const sink = new WorkerLogSink({ flushDelayMs: 60_000, batchSize: 100 });
    sink.write(record(1));
    sink.write(record(2));

    await sink.close();
    sink.write(record(3));
    await sink.flush();

    expect(await storedCount()).toBe(2);
  });

  it('drops the queue instead when asked to discard, and never opens the log database', async () => {
    const sink = new WorkerLogSink({ flushDelayMs: 60_000, batchSize: 100 });
    sink.write(record(1));

    await sink.close({ discard: true });
    sink.write(record(2));
    await sink.flush();

    expect(await storedCount()).toBe(0);
  });

  it('releases its handle so the log database can be deleted without being blocked', async () => {
    const sink = new WorkerLogSink({ flushDelayMs: 60_000, batchSize: 100 });
    sink.write(record(1));
    await sink.flush();

    await sink.close();

    const outcome = await new Promise<string>((resolve) => {
      const request = indexedDB.deleteDatabase('ptbudgetapp-logs');
      request.onsuccess = () => resolve('deleted');
      request.onblocked = () => resolve('blocked');
      request.onerror = () => resolve('error');
    });
    expect(outcome).toBe('deleted');
  });

  it('is idempotent and reachable through the logger', async () => {
    const logger = createWorkerLogger({ sink: new WorkerLogSink({ flushDelayMs: 60_000, batchSize: 100 }) });
    logger.info('before');

    await logger.close();
    await expect(logger.close()).resolves.toBeUndefined();
    logger.info('after');
    await logger.flush();

    expect(await storedCount()).toBe(1);
  });
});
