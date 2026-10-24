import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { consoleCallToRecord, isConsoleCaptureActive, startConsoleCapture, stopConsoleCapture } from './consoleCapture';
import { ConsoleEchoSink } from './consoleEchoSink';
import { CompositeSink, logger, resetLogSink, setLogLevel, setLogSink } from './logger';
import { MemorySink } from './memorySink';

describe('console capture', () => {
  let sink: MemorySink;
  const original = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };

  beforeEach(() => {
    sink = new MemorySink(50);
    setLogSink(sink);
    setLogLevel('trace');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    stopConsoleCapture();
    resetLogSink();
    setLogLevel('info');
    Object.assign(console, original);
  });

  it('records raw console calls as source=console records and restores the console on stop', () => {
    const spiedWarn = console.warn;
    startConsoleCapture();
    expect(isConsoleCaptureActive()).toBe(true);
    expect(console.warn).not.toBe(spiedWarn);

    const error = new Error('bad');
    console.log('plain %s', 'text', { a: 1 });
    console.error('Failed:', error);
    console.debug(42);

    const records = sink.getRecords();
    expect(records.map((record) => [record.level, record.message])).toEqual([
      ['info', 'plain %s'],
      ['error', 'Failed:'],
      ['debug', '42'],
    ]);
    expect(records[0].context).toMatchObject({ source: 'console', component: 'console', consoleMethod: 'log', args: ['text', '{"a":1}'] });
    expect(records[1].error).toMatchObject({ name: 'Error', message: 'bad' });
    expect(records[1].context).not.toHaveProperty('error');
    expect(spiedWarn).toHaveBeenCalledTimes(0); // nothing printed through warn
    expect(console.log).toBeDefined();

    stopConsoleCapture();
    expect(isConsoleCaptureActive()).toBe(false);
    expect(console.warn).toBe(spiedWarn);
  });

  it('does not capture what the echo sink prints (no feedback loop)', () => {
    const echo = new ConsoleEchoSink({ minLevel: 'trace' });
    setLogSink(new CompositeSink([sink, echo]));
    const printedWarn = console.warn; // the (spied) original the echo sink prints through
    startConsoleCapture();

    logger.warn('once', { component: 'Test' });

    const records = sink.getRecords();
    expect(records).toHaveLength(1);
    expect(records[0].context.source).toBe('app');
    expect(printedWarn).toHaveBeenCalledTimes(1);
  });

  it('never echoes captured console records back to the console', () => {
    const target = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const echo = new ConsoleEchoSink({ console: target, minLevel: 'trace' });
    echo.write(consoleCallToRecord('warn', ['from console']));
    expect(target.warn).not.toHaveBeenCalled();
  });
});
