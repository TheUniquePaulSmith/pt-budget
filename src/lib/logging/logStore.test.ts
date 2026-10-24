import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { IdbLogSink } from './idbLogSink';
import { closeLogStore, matchesLogFilters, readCorrelation, readLogPage } from './logStore';
import type { StoredLogRecord } from './logDatabase';
import type { LogRecord } from './types';

function record(n: number, overrides: Partial<LogRecord> & { context?: LogRecord['context'] } = {}): LogRecord {
  return {
    id: `t-${n}`,
    ts: 1_000 + n,
    level: 'info',
    message: `m${n}`,
    ...overrides,
    context: { source: 'app', tabId: 't', sessionId: 's', ...(overrides.context ?? {}) },
  };
}

async function seed(records: LogRecord[]): Promise<void> {
  const sink = new IdbLogSink({ flushDelayMs: 10_000, retention: () => ({ maxEntries: 100_000, maxAgeDays: 0 }) });
  for (const entry of records) sink.write(entry);
  await sink.flush();
  await sink.close();
}

describe('logStore', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  afterEach(async () => {
    await closeLogStore();
  });

  it('pages newest-first and continues from the oldest seq', async () => {
    await seed(Array.from({ length: 7 }, (_, index) => record(index + 1)));

    const first = await readLogPage({ limit: 3 });
    expect(first.records.map((entry) => entry.message)).toEqual(['m7', 'm6', 'm5']);
    expect(first.hasMore).toBe(true);

    const second = await readLogPage({ limit: 3, beforeSeq: first.records[2].seq });
    expect(second.records.map((entry) => entry.message)).toEqual(['m4', 'm3', 'm2']);
    expect(second.hasMore).toBe(true);

    const third = await readLogPage({ limit: 3, beforeSeq: second.records[2].seq });
    expect(third.records.map((entry) => entry.message)).toEqual(['m1']);
    expect(third.hasMore).toBe(false);
  });

  it('filters by level, source, page, correlation id and text', async () => {
    await seed([
      record(1, { level: 'debug', context: { page: 'dashboard', correlationId: 'tab:1' } }),
      record(2, { level: 'error', message: 'Query failed', context: { source: 'worker', page: 'dashboard', correlationId: 'tab:1' } }),
      record(3, { level: 'info', context: { page: 'budget', component: 'BudgetPage' } }),
      record(4, { level: 'warn', context: { source: 'console', consoleMethod: 'warn' } }),
    ]);

    const errors = await readLogPage({ filters: { levels: ['error'] } });
    expect(errors.records.map((entry) => entry.message)).toEqual(['Query failed']);

    const worker = await readLogPage({ filters: { sources: ['worker'] } });
    expect(worker.records.map((entry) => entry.id)).toEqual(['t-2']);

    const budget = await readLogPage({ filters: { page: 'budget' } });
    expect(budget.records.map((entry) => entry.id)).toEqual(['t-3']);

    const byComponent = await readLogPage({ filters: { text: 'budgetpage' } });
    expect(byComponent.records.map((entry) => entry.id)).toEqual(['t-3']);

    const byContextJson = await readLogPage({ filters: { text: '"consoleMethod":"warn"' } });
    expect(byContextJson.records.map((entry) => entry.id)).toEqual(['t-4']);

    const correlated = await readLogPage({ filters: { correlationId: 'tab:1' } });
    expect(correlated.records.map((entry) => entry.id)).toEqual(['t-2', 't-1']);

    const timeline = await readCorrelation('tab:1');
    expect(timeline.map((entry) => `${entry.context.source}:${entry.id}`)).toEqual(['app:t-1', 'worker:t-2']);
  });

  it('matchesLogFilters treats empty filter lists as "all"', () => {
    const entry: StoredLogRecord = { ...record(1), seq: 1 };
    expect(matchesLogFilters(entry, { levels: [], sources: [] })).toBe(true);
    expect(matchesLogFilters(entry, { levels: ['warn'] })).toBe(false);
    expect(matchesLogFilters(entry, { text: '  ' })).toBe(true);
    expect(matchesLogFilters(entry, { text: 'M1' })).toBe(true);
  });
});
