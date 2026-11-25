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

function workerTerminatedMessage() {
  return {
    type: 'worker_terminated',
    isSuccessful: true,
    dbStatus: 'disconnected',
    version: '1.0.0',
    sqlResponse: { message: 'Database worker terminated' },
  };
}

function respondWith(port: MockPort, id: string, sqlResponse: unknown) {
  port.dispatch('message', { id, type: 'ok', isSuccessful: true, dbStatus: 'connected', version: '1.0.0', sqlResponse });
}

/** Has the worker answer one request, as every running page has. */
async function useConnection(service: DatabaseWorkerService, port: MockPort) {
  const pinged = service.ping();
  const ping = port.postMessage.mock.calls
    .map((call) => call[0] as { id: string; type: string })
    .find((message) => message.type === 'ping');
  respondWith(port, ping!.id, {});
  await pinged;
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
    // A function, not an arrow: the service calls it with `new`.
    value: vi.fn(function (url: string, options?: unknown) {
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

describe('DatabaseWorkerService.terminate', () => {
  function respondTo(port: MockPort, message: { id: string }, isSuccessful = true) {
    port.dispatch('message', {
      id: message.id,
      type: 'terminate_worker_response',
      isSuccessful,
      dbStatus: 'disconnected',
      version: '1.0.0',
      sqlResponse: isSuccessful ? { message: 'Database worker terminated' } : { error: 'boom' },
    });
  }

  it('asks the worker to terminate, passing includeLogs, then drops this tab\'s connection', async () => {
    const { service, port } = createService();

    const pending = service.terminate({ includeLogs: true });

    expect(port.postMessage).toHaveBeenCalledTimes(1);
    const message = port.postMessage.mock.calls[0][0] as { id: string; type: string; payload: { includeLogs: boolean } };
    expect(message.type).toBe('terminate_worker');
    expect(message.payload.includeLogs).toBe(true);
    expect(port.close).not.toHaveBeenCalled();

    respondTo(port, message);
    await pending;

    expect(port.close).toHaveBeenCalledTimes(1);
  });

  it('defaults includeLogs to false', async () => {
    const { service, port } = createService();

    const pending = service.terminate();
    const message = port.postMessage.mock.calls[0][0] as { id: string; payload: { includeLogs: boolean } };
    expect(message.payload.includeLogs).toBe(false);

    respondTo(port, message);
    await pending;
  });

  it('is best-effort: a failed termination still resolves and drops the connection', async () => {
    const { service, port } = createService();

    const pending = service.terminate();
    respondTo(port, port.postMessage.mock.calls[0][0] as { id: string }, false);

    await expect(pending).resolves.toBeUndefined();
    expect(port.close).toHaveBeenCalledTimes(1);
  });

  it('marks the worker dead at once when any tab terminates it', async () => {
    const { service, port } = createService();
    await useConnection(service, port);
    const statuses: boolean[] = [];
    service.onStatusChange((status) => statuses.push(status.isWorkerAlive));
    port.dispatch('message', {
      type: 'heartbeat',
      isSuccessful: true,
      dbStatus: 'connected',
      version: '1.0.0',
      sqlResponse: { timestamp: Date.now() },
    });

    port.dispatch('message', workerTerminatedMessage());

    expect(service.getStatus()).toMatchObject({ isWorkerAlive: false, isConnected: false, dbStatus: 'disconnected' });
    expect(statuses.at(-1)).toBe(false);
  });

  it('never reconnects the tab that asked for the termination', async () => {
    const { service, port } = createService();
    const pending = service.terminate();
    respondTo(port, port.postMessage.mock.calls[0][0] as { id: string });
    port.dispatch('close', undefined);
    await pending;

    expect(globalThis.SharedWorker).toHaveBeenCalledTimes(1);
  });
});

/**
 * A page that connects while another tab's Reset App is shutting the shared
 * worker down is attached to that worker, which exits moments later. The
 * reloaded tab used to send `initialize` into the dead port and fail after
 * 30 s ("Heartbeat timeout - worker appears dead", then the initialize timeout).
 */
describe('DatabaseWorkerService reconnect after another tab terminates the worker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function requestsOn(port: MockPort) {
    return port.postMessage.mock.calls
      .map((call) => call[0] as { id: string; type: string })
      .filter((message) => message.type !== 'set_debug');
  }

  it('connects to a new worker once the shutting-down one exits and sends the waiting request there', async () => {
    const { service, port: dyingPort } = createService();
    const initialized = service.initialize();
    const [initialize] = requestsOn(dyingPort);

    dyingPort.dispatch('message', workerTerminatedMessage());
    expect(globalThis.SharedWorker).toHaveBeenCalledTimes(1);

    dyingPort.dispatch('close', undefined);

    expect(globalThis.SharedWorker).toHaveBeenCalledTimes(2);
    const freshPort = mockWorkerInstance.port;
    expect(freshPort).not.toBe(dyingPort);
    expect(dyingPort.close).toHaveBeenCalled();
    expect(requestsOn(freshPort)).toEqual([initialize]);

    freshPort.dispatch('message', {
      id: initialize.id,
      type: 'initialize_response',
      isSuccessful: true,
      dbStatus: 'initialized',
      version: '1.0.0',
      sqlResponse: {},
    });
    await expect(initialized).resolves.toMatchObject({ type: 'initialize_response' });
    service.destroy();
  });

  it('holds requests made while the worker shuts down and connects again after a wait when no close event comes', async () => {
    vi.useFakeTimers();
    const { service, port: dyingPort } = createService();
    dyingPort.dispatch('message', workerTerminatedMessage());

    const queried = service.query('SELECT 1');
    expect(requestsOn(dyingPort)).toEqual([]);

    vi.advanceTimersByTime(249);
    expect(globalThis.SharedWorker).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(globalThis.SharedWorker).toHaveBeenCalledTimes(2);

    const freshPort = mockWorkerInstance.port;
    const [query] = requestsOn(freshPort);
    expect(query.type).toBe('query');
    respondWith(freshPort, query.id, { results: [{ one: 1 }] });
    await expect(queried).resolves.toEqual([{ one: 1 }]);
    service.destroy();
  });

  it('sends a request the shutting-down worker refused to the new worker', async () => {
    const { service, port: dyingPort } = createService();
    const initialized = service.initialize();
    const [initialize] = requestsOn(dyingPort);

    dyingPort.dispatch('message', {
      id: initialize.id,
      type: 'error',
      isSuccessful: false,
      dbStatus: 'disconnected',
      version: '1.0.0',
      sqlResponse: { error: 'Database worker has been terminated — reload the app', code: 'WORKER_TERMINATED' },
    });
    dyingPort.dispatch('close', undefined);

    const freshPort = mockWorkerInstance.port;
    expect(requestsOn(freshPort)).toEqual([initialize]);
    respondWith(freshPort, initialize.id, {});
    await expect(initialized).resolves.toMatchObject({ isSuccessful: true });
    service.destroy();
  });

  it('keeps trying with longer waits, then fails the waiting requests', async () => {
    vi.useFakeTimers();
    const { service } = createService();
    const initialized = service.initialize();
    const outcome = initialized.then(
      () => 'resolved',
      (error: Error) => error.message
    );

    // Every connection reaches a worker that is still shutting down.
    for (const waitMs of [250, 500, 1000, 2000, 4000]) {
      mockWorkerInstance.port.dispatch('message', workerTerminatedMessage());
      vi.advanceTimersByTime(waitMs);
    }
    mockWorkerInstance.port.dispatch('message', workerTerminatedMessage());
    vi.advanceTimersByTime(8000);

    await expect(outcome).resolves.toBe('Could not connect to the database worker — reload the app');
    expect(globalThis.SharedWorker).toHaveBeenCalledTimes(6);
    service.destroy();
  });

  it('replaces a worker that went silent before this page used it', async () => {
    vi.useFakeTimers();
    const { service } = createService();
    vi.advanceTimersByTime(15_000);

    expect(globalThis.SharedWorker).toHaveBeenCalledTimes(2);
    service.destroy();
  });

  it('leaves a worker this page has used alone and fails its open requests as soon as it exits', async () => {
    const { service, port } = createService();
    await useConnection(service, port);
    const queried = service.query('SELECT 1');

    port.dispatch('message', workerTerminatedMessage());
    port.dispatch('close', undefined);

    await expect(queried).rejects.toThrow('Database worker stopped — reload the app');
    expect(globalThis.SharedWorker).toHaveBeenCalledTimes(1);
    expect(service.getStatus().isWorkerAlive).toBe(false);
  });

  it('treats a new worker that has answered like any worker the page has used', async () => {
    const { service, port: dyingPort } = createService();
    const initialized = service.initialize();
    dyingPort.dispatch('message', workerTerminatedMessage());
    dyingPort.dispatch('close', undefined);
    const freshPort = mockWorkerInstance.port;
    respondWith(freshPort, requestsOn(freshPort)[0].id, {});
    await initialized;

    // The page now has state in this worker: a later exit is not papered over.
    freshPort.dispatch('close', undefined);
    expect(globalThis.SharedWorker).toHaveBeenCalledTimes(2);
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
