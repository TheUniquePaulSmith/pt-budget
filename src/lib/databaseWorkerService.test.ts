// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DatabaseWorkerService, type DatabaseChangeEvent } from './databaseWorkerService';

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

describe('DatabaseWorkerService.onDatabaseChanged', () => {
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
