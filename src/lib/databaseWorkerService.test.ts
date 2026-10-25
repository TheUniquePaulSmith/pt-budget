// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DatabaseWorkerService, buildMessageMeta, type DatabaseChangeEvent } from './databaseWorkerService';
import {
  LOG_TAB_ID,
  MemorySink,
  noteInteraction,
  resetAmbientLogContext,
  resetLogSink,
  setAmbientPage,
  setLogLevel,
  setLogSink,
} from './logging';

class MockPort {
  listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  postMessage = vi.fn();
  start = vi.fn();
  close = vi.fn();

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, data: unknown) {
    this.listeners.get(type)?.forEach((listener) => {
      listener({ data } as MessageEvent);
    });
  }
}

class MockSharedWorker {
  port = new MockPort();
  constructor(
    public url: string,
    public options?: unknown
  ) {}
}

let mockWorkerInstance: MockSharedWorker;

function createService() {
  const service = new DatabaseWorkerService();
  return { service, port: mockWorkerInstance.port };
}

function databaseChangedMessage(sqlResponse: DatabaseChangeEvent) {
  return {
    type: 'database_changed',
    isSuccessful: true,
    dbStatus: 'connected',
    version: '1.0.0',
    sqlResponse,
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'SharedWorker', {
    configurable: true,
    writable: true,
    value: vi.fn((url: string, options?: unknown) => {
      mockWorkerInstance = new MockSharedWorker(url, options);
      return mockWorkerInstance;
    }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DatabaseWorkerService.onDatabaseChanged', () => {
  it('dispatches database_changed messages to subscribers', () => {
    const { service, port } = createService();
    const callback = vi.fn();
    service.onDatabaseChanged(callback);

    const event: DatabaseChangeEvent = {
      changedAt: '2026-07-14T00:00:00.000Z',
      writeCount: 3,
    };
    port.dispatch('message', databaseChangedMessage(event));

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(event);
  });

  it('stops calling a subscriber after it unsubscribes', () => {
    const { service, port } = createService();
    const callback = vi.fn();
    const unsubscribe = service.onDatabaseChanged(callback);
    unsubscribe();

    port.dispatch(
      'message',
      databaseChangedMessage({ changedAt: '2026-07-14T00:00:00.000Z', writeCount: 1 })
    );

    expect(callback).not.toHaveBeenCalled();
  });

  it('does not notify change subscribers for unrelated messages', () => {
    const { service, port } = createService();
    const callback = vi.fn();
    service.onDatabaseChanged(callback);

    port.dispatch('message', {
      type: 'heartbeat',
      isSuccessful: true,
      dbStatus: 'connected',
      version: '1.0.0',
      sqlResponse: { timestamp: Date.now() },
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it('does not immediately invoke a newly-registered subscriber', () => {
    const { service } = createService();
    const callback = vi.fn();
    service.onDatabaseChanged(callback);

    expect(callback).not.toHaveBeenCalled();
  });

  it('clears change subscribers on destroy', () => {
    const { service, port } = createService();
    const callback = vi.fn();
    service.onDatabaseChanged(callback);
    service.destroy();

    port.dispatch(
      'message',
      databaseChangedMessage({ changedAt: '2026-07-14T00:00:00.000Z', writeCount: 1 })
    );

    expect(callback).not.toHaveBeenCalled();
  });
});

describe('DatabaseWorkerService correlation', () => {
  let sink: MemorySink;

  beforeEach(() => {
    resetAmbientLogContext();
    sink = new MemorySink(100);
    setLogSink(sink);
    setLogLevel('trace');
  });

  afterEach(() => {
    resetAmbientLogContext();
    resetLogSink();
    setLogLevel('info');
  });

  it('sends <tabId>:<n> message ids with meta from the ambient context and logs the request under the same id', async () => {
    setAmbientPage('budget');
    noteInteraction('save-budget-button');
    const { service, port } = createService();

    const pending = service.query('SELECT 1', [7]);

    expect(port.postMessage).toHaveBeenCalledTimes(1);
    const message = port.postMessage.mock.calls[0][0] as {
      id: string;
      type: string;
      payload: { sql: string; parameters: unknown[]; meta: Record<string, unknown> };
    };
    expect(message.id).toMatch(new RegExp(`^${LOG_TAB_ID}:\\d+$`));
    expect(message.type).toBe('query');
    expect(message.payload.sql).toBe('SELECT 1');
    expect(message.payload.parameters).toEqual([7]);
    expect(message.payload.meta).toEqual({ correlationId: message.id, page: 'budget', operation: 'query' });

    const request = sink.getRecords().find((record) => record.message === 'Worker request');
    expect(request?.context).toMatchObject({
      component: 'DatabaseWorkerService',
      correlationId: message.id,
      operation: 'query',
      page: 'budget',
      element: 'save-budget-button',
      sql: 'SELECT 1',
      parameterCount: 1,
    });

    port.dispatch('message', {
      id: message.id,
      type: 'query_success',
      isSuccessful: true,
      dbStatus: 'connected',
      version: '1.0.0',
      sqlResponse: { results: [{ one: 1 }] },
    });
    await expect(pending).resolves.toEqual([{ one: 1 }]);

    const response = sink.getRecords().find((record) => record.message === 'Worker response');
    expect(response?.context).toMatchObject({ correlationId: message.id, operation: 'query', responseType: 'query_success' });
  });

  it('gives every request a distinct correlation id and a meta block even with a null payload', async () => {
    const { service, port } = createService();
    void service.ping().catch(() => undefined);
    void service.exec('PRAGMA foo').catch(() => undefined);

    const [ping, exec] = port.postMessage.mock.calls.map((call) => call[0] as { id: string; type: string; payload: { meta: { correlationId: string; operation: string } } });
    expect(ping.id).not.toBe(exec.id);
    expect(ping.payload).toEqual({ meta: { correlationId: ping.id, operation: 'ping' } });
    expect(exec.payload.meta).toEqual({ correlationId: exec.id, operation: 'exec' });
    service.destroy();
  });

  it('logs a warning carrying the correlation id when the worker reports a failure', async () => {
    const { service, port } = createService();
    const pending = service.query('SELECT * FROM missing');
    const message = port.postMessage.mock.calls[0][0] as { id: string };

    port.dispatch('message', {
      id: message.id,
      type: 'query_error',
      isSuccessful: false,
      dbStatus: 'connected',
      version: '1.0.0',
      sqlResponse: { error: 'no such table: missing', sql: 'SELECT * FROM missing' },
    });

    await expect(pending).rejects.toThrow('no such table: missing');
    const failure = sink.getRecords().find((record) => record.message === 'Worker request failed');
    expect(failure?.level).toBe('warn');
    expect(failure?.context).toMatchObject({ correlationId: message.id, operation: 'query', sql: 'SELECT * FROM missing' });
    expect(failure?.error?.message).toBe('no such table: missing');
  });

  it('asks the worker for per-port debug logging only under ?debug', () => {
    const { port } = createService();
    expect(port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'set_debug' }));

    window.history.pushState({}, '', '/?debug=true');
    try {
      const { port: debugPort } = createService();
      expect(debugPort.postMessage).toHaveBeenCalledWith({ id: 'debug_config', type: 'set_debug', payload: { debug: true } });
    } finally {
      window.history.pushState({}, '', '/');
    }
  });

  it('buildMessageMeta copies only the ambient page / component and falls back to the message type', () => {
    expect(buildMessageMeta('t:1', 'query', {})).toEqual({ correlationId: 't:1', operation: 'query' });
    expect(buildMessageMeta('t:2', 'exec', { page: 'trips', component: 'TripForm', operation: 'saveTrip', element: 'x' })).toEqual({
      correlationId: 't:2',
      page: 'trips',
      component: 'TripForm',
      operation: 'saveTrip',
    });
  });
});
