import { describe, expect, it } from 'vitest';

import { exportDateStamp, exportFileNames, formatNdjson, formatTimeline, formatTimelineLine } from './logExport';
import type { LogRecord } from './types';

const appRecord: LogRecord & { seq: number } = {
  seq: 2,
  id: 'ab12-7',
  ts: Date.UTC(2026, 9, 24, 10, 0, 0, 5),
  level: 'info',
  message: 'Worker request',
  context: {
    source: 'app',
    tabId: 'ab12',
    sessionId: 'sess',
    page: 'dashboard',
    component: 'DatabaseWorkerService',
    operation: 'query',
    correlationId: 'ab12:7',
    element: 'nav-dashboard',
    sql: 'SELECT 1',
  },
};

const workerRecord: LogRecord & { seq: number } = {
  seq: 3,
  id: 'wx1-3',
  ts: Date.UTC(2026, 9, 24, 10, 0, 0, 9),
  level: 'error',
  message: 'Query execution failed',
  context: { source: 'worker', correlationId: 'ab12:7', operation: 'query', process: undefined },
  error: { name: 'SQLiteError', message: 'no such table', stack: 'SQLiteError: no such table\n    at step' },
};

const backgroundRecord: LogRecord & { seq: number } = {
  seq: 1,
  id: 'wx1-1',
  ts: Date.UTC(2026, 9, 24, 9, 59, 59, 0),
  level: 'debug',
  message: 'Heartbeat started',
  context: { source: 'worker', process: 'heartbeat' },
};

describe('log export', () => {
  it('names both files after the local date', () => {
    const date = new Date(2026, 9, 24, 23, 30);
    expect(exportDateStamp(date)).toBe('2026-10-24');
    expect(exportFileNames(date)).toEqual({ ndjson: 'logs-2026-10-24.ndjson', txt: 'logs-2026-10-24.txt' });
  });

  it('writes one JSON record per line, oldest first, without the storage seq', () => {
    const lines = formatNdjson([workerRecord, appRecord, backgroundRecord]).split('\n');
    expect(lines).toHaveLength(3);
    const parsed = lines.map((line) => JSON.parse(line) as LogRecord & { seq?: number });
    expect(parsed.map((entry) => entry.id)).toEqual(['wx1-1', 'ab12-7', 'wx1-3']);
    expect(parsed.every((entry) => entry.seq === undefined)).toBe(true);
    expect(parsed[2].error?.message).toBe('no such table');
  });

  it('merges app and worker rows into a tagged timeline with aligned correlation ids', () => {
    const exportedAt = new Date(Date.UTC(2026, 9, 24, 12, 0, 0));
    const text = formatTimeline([workerRecord, appRecord, backgroundRecord], exportedAt);
    const lines = text.split('\n');

    expect(lines[0]).toBe('# ptbudget diagnostic logs — exported 2026-10-24T12:00:00.000Z');
    expect(lines[1]).toBe('# 3 record(s); sources: [WORKER] [APP]');
    expect(lines[3]).toBe('');

    const body = lines.slice(4);
    expect(body[0]).toBe('2026-10-24T09:59:59.000Z [WORKER]  DEBUG -      Heartbeat started (process=heartbeat)');
    expect(body[1]).toBe(
      '2026-10-24T10:00:00.005Z [APP]     INFO  ab12:7 Worker request (page=dashboard component=DatabaseWorkerService op=query element="nav-dashboard") {"sql":"SELECT 1"}'
    );
    expect(body[2]).toBe('2026-10-24T10:00:00.009Z [WORKER]  ERROR ab12:7 Query execution failed (op=query)');
    expect(body[3]).toBe('    SQLiteError: no such table');
    expect(body[4]).toBe('        at step');

    // Correlation ids sit in the same column on every row.
    const column = body[1].indexOf('ab12:7');
    expect(body[2].indexOf('ab12:7')).toBe(column);
    expect(body[0].indexOf('-', 30)).toBe(column);
  });

  it('formats a single line with a width-padded correlation column', () => {
    const line = formatTimelineLine(backgroundRecord, 10);
    expect(line).toContain('[WORKER]  DEBUG -          Heartbeat started');
  });
});
