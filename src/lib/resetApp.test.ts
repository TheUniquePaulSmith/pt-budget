// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOGS_DB_NAME } from './logging';
import { resetApp, selectDatabasesToDelete } from './resetApp';

describe('resetApp', () => {
  it('keeps the diagnostic log database unless asked to clear it', () => {
    const existing = ['ptbudgetapp-v2-encrypted', LOGS_DB_NAME, 'something-else'];

    expect(selectDatabasesToDelete(existing, false)).toEqual([
      'ptbudgetapp-v2-encrypted',
      'ptbudgetapp-keys',
      'something-else',
    ]);
    expect(selectDatabasesToDelete(existing, true)).toEqual(
      expect.arrayContaining(['ptbudgetapp-v2-encrypted', 'ptbudgetapp-keys', 'something-else', LOGS_DB_NAME])
    );
  });

  it('always includes the known databases and the log database when asked, even if databases() is unavailable', () => {
    expect(selectDatabasesToDelete([], false)).toEqual(['ptbudgetapp-v2-encrypted', 'ptbudgetapp-keys']);
    expect(selectDatabasesToDelete([], true)).toEqual(['ptbudgetapp-v2-encrypted', 'ptbudgetapp-keys', LOGS_DB_NAME]);
  });
});

describe('resetApp worker termination', () => {
  let clearLocalStorage: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // jsdom has no IndexedDB, so the database sweep is a no-op; the final
    // navigation is stubbed because jsdom does not implement it.
    vi.stubGlobal('location', { origin: 'http://localhost', pathname: '/', hostname: 'localhost', href: '' });
    clearLocalStorage = vi.spyOn(Storage.prototype, 'clear');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('terminates the worker before wiping storage and tells it whether the logs are going too', async () => {
    const terminateWorker = vi.fn().mockResolvedValue(undefined);

    await resetApp(terminateWorker, { includeLogs: false });

    expect(terminateWorker).toHaveBeenCalledWith({ includeLogs: false });
    expect(terminateWorker.mock.invocationCallOrder[0]).toBeLessThan(clearLocalStorage.mock.invocationCallOrder[0]);

    terminateWorker.mockClear();
    await resetApp(terminateWorker, { includeLogs: true });
    expect(terminateWorker).toHaveBeenCalledWith({ includeLogs: true });
  });

  it('waits for the worker to finish terminating before it touches storage', async () => {
    let finishTerminating: () => void = () => undefined;
    const terminateWorker = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishTerminating = resolve;
        })
    );

    const reset = resetApp(terminateWorker);
    await Promise.resolve();
    expect(clearLocalStorage).not.toHaveBeenCalled();

    finishTerminating();
    await reset;
    expect(clearLocalStorage).toHaveBeenCalled();
  });

  it('still wipes storage when the worker cannot be terminated', async () => {
    const terminateWorker = vi.fn().mockRejectedValue(new Error('worker gone'));

    await expect(resetApp(terminateWorker)).resolves.toBeUndefined();

    expect(clearLocalStorage).toHaveBeenCalled();
  });

  it('works when there is no worker to terminate', async () => {
    await expect(resetApp()).resolves.toBeUndefined();

    expect(clearLocalStorage).toHaveBeenCalled();
  });
});
