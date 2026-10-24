import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConsoleEchoSink } from './consoleEchoSink';
import {
  LOG_SESSION_ID,
  LOG_TAB_ID,
  createLogger,
  getLogLevel,
  isLevelEnabled,
  logger,
  nextCorrelationId,
  normalizeError,
  resetLogSink,
  setLogLevel,
  setLogSink,
} from './logger';
import { MemorySink } from './memorySink';
import type { LogRecord } from './types';

describe('logger', () => {
  let sink: MemorySink;

  beforeEach(() => {
    sink = new MemorySink(5);
    setLogSink(sink);
    setLogLevel('trace');
  });

  afterEach(() => {
    resetLogSink();
    setLogLevel('info');
  });

  it('stamps source, tab and session ids on every record', () => {
    logger.info('hello');

    const [record] = sink.getRecords();
    expect(record).toMatchObject({
      level: 'info',
      message: 'hello',
      context: { source: 'app', tabId: LOG_TAB_ID, sessionId: LOG_SESSION_ID },
    });
    expect(record.id).toMatch(new RegExp(`^${LOG_TAB_ID}-\\d+$`));
    expect(typeof record.ts).toBe('number');
  });

  it('merges child context and lets call-site context override it', () => {
    const log = logger.child({ component: 'CSVImport', page: 'dashboard' });

    log.warn('Skipped rows', { rows: 3, page: 'import' });

    expect(sink.getRecords()[0].context).toMatchObject({
      component: 'CSVImport',
      page: 'import',
      rows: 3,
    });
    expect(log.context).toEqual({ source: 'app', component: 'CSVImport', page: 'dashboard' });
  });

  it('withOperation adds the operation and a fresh tab-scoped correlation id', () => {
    const base = logger.child({ component: 'DatabaseService' });
    const op1 = base.withOperation('saveBudgetPlan');
    const op2 = base.withOperation('saveBudgetPlan');

    op1.info('start');
    op2.info('start');

    const [first, second] = sink.getRecords();
    expect(first.context.operation).toBe('saveBudgetPlan');
    expect(first.context.correlationId).toMatch(new RegExp(`^${LOG_TAB_ID}\\.\\d+$`));
    expect(second.context.correlationId).not.toBe(first.context.correlationId);
    expect(nextCorrelationId()).toMatch(new RegExp(`^${LOG_TAB_ID}\\.\\d+$`));
  });

  it('normalises errors out of the context into record.error', () => {
    const error = new TypeError('boom');
    logger.error('Failed', { error, operation: 'x' });
    logger.error('Failed again', { error: { message: 'plain', code: 7 } });
    logger.error('Failed thrice', { error: 'string failure' });
    logger.error('No error', {});

    const [a, b, c, d] = sink.getRecords();
    expect(a.error).toEqual({ name: 'TypeError', message: 'boom', stack: error.stack });
    expect(a.context).not.toHaveProperty('error');
    expect(b.error).toEqual({ name: 'Error', message: 'plain', stack: undefined });
    expect(c.error).toEqual({ name: 'Error', message: 'string failure' });
    expect(d.error).toBeUndefined();
    expect(normalizeError(undefined)).toBeUndefined();
    expect(normalizeError({ nested: true })).toEqual({ name: 'Error', message: '{"nested":true}' });
  });

  it('filters records below the active level', () => {
    setLogLevel('warn');
    expect(getLogLevel()).toBe('warn');
    expect(isLevelEnabled('info')).toBe(false);
    expect(isLevelEnabled('error')).toBe(true);

    logger.debug('dropped');
    logger.info('dropped');
    logger.warn('kept');
    logger.error('kept');

    expect(sink.getRecords().map((r) => r.level)).toEqual(['warn', 'error']);
  });

  it('keeps only the newest records in the memory ring and notifies subscribers', () => {
    const seen: string[] = [];
    const unsubscribe = sink.subscribe((record) => seen.push(record.message));

    for (let i = 1; i <= 7; i += 1) logger.info(`m${i}`);
    unsubscribe();
    logger.info('m8');

    expect(sink.getRecords().map((r) => r.message)).toEqual(['m4', 'm5', 'm6', 'm7', 'm8']);
    expect(seen).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']);
    sink.clear();
    expect(sink.getRecords()).toEqual([]);
  });

  it('swaps sinks and never throws when a sink fails', () => {
    const broken = { write: vi.fn(() => { throw new Error('sink down'); }) };
    const previous = setLogSink(broken);
    expect(previous).toBe(sink);

    expect(() => logger.error('still safe')).not.toThrow();
    expect(broken.write).toHaveBeenCalledTimes(1);
  });

  it('createLogger starts from app source plus the given context', () => {
    const log = createLogger({ process: 'notification-scan' });
    log.trace('tick');
    expect(sink.getRecords()[0].context).toMatchObject({ source: 'app', process: 'notification-scan' });
  });
});

describe('ConsoleEchoSink', () => {
  function record(overrides: Partial<LogRecord> = {}): LogRecord {
    return {
      id: 'r1',
      ts: 1,
      level: 'info',
      message: 'Loaded',
      context: { source: 'app', tabId: 't', sessionId: 's', component: 'Dashboard', rows: 2 },
      ...overrides,
    };
  }

  it('prints a component-prefixed line with the remaining context and error', () => {
    const target = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const echo = new ConsoleEchoSink({ console: target });

    echo.write(record());
    echo.write(record({ level: 'debug', context: { source: 'app' } }));
    echo.write(record({ level: 'warn' }));
    echo.write(record({ level: 'error', error: { name: 'Error', message: 'nope' } }));

    expect(target.info).toHaveBeenCalledWith('[Dashboard] Loaded', { rows: 2 });
    expect(target.debug).toHaveBeenCalledWith('Loaded');
    expect(target.warn).toHaveBeenCalledWith('[Dashboard] Loaded', { rows: 2 });
    expect(target.error).toHaveBeenCalledWith('[Dashboard] Loaded', { rows: 2 }, 'Error: nope');
  });

  it('honours its own minimum level', () => {
    const target = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const echo = new ConsoleEchoSink({ console: target, minLevel: 'warn' });

    echo.write(record({ level: 'info' }));
    echo.write(record({ level: 'error' }));

    expect(target.info).not.toHaveBeenCalled();
    expect(target.error).toHaveBeenCalledTimes(1);
  });
});
