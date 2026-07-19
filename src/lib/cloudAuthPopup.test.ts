// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { awaitPopupAuthResult } from './cloudAuthPopup';
import { CloudAuthCancelledError } from './cloudSyncErrors';
import { waitForAuthResult, type AuthCompleteMessage } from './cloudAuthBroadcast';

vi.mock('./cloudAuthBroadcast', () => ({
  waitForAuthResult: vi.fn(),
}));

const mockedWaitForAuthResult = vi.mocked(waitForAuthResult);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface FakePopup {
  closed: boolean;
  close: () => void;
  focus: () => void;
}

function makePopup(): FakePopup {
  const popup: FakePopup = {
    closed: false,
    close: vi.fn(() => {
      popup.closed = true;
    }),
    focus: vi.fn(),
  };
  return popup;
}

function asWindow(popup: FakePopup): Window {
  return popup as unknown as Window;
}

const OK_RESULT: AuthCompleteMessage = {
  kind: 'auth-complete',
  provider: 'gdrive',
  state: 'state-1',
  ok: true,
};

describe('awaitPopupAuthResult', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('resolves with the broadcast result while the popup is open', async () => {
    const result = deferred<AuthCompleteMessage>();
    mockedWaitForAuthResult.mockReturnValue(result.promise);
    const popup = makePopup();

    const promise = awaitPopupAuthResult(asWindow(popup), 'state-1');
    result.resolve(OK_RESULT);

    await expect(promise).resolves.toEqual(OK_RESULT);
    expect(popup.close).not.toHaveBeenCalled();
  });

  it('rejects with popup_closed when the popup closes without a result', async () => {
    mockedWaitForAuthResult.mockReturnValue(deferred<AuthCompleteMessage>().promise);
    const popup = makePopup();

    const promise = awaitPopupAuthResult(asWindow(popup), 'state-1');
    const assertion = expect(promise).rejects.toMatchObject({
      name: 'CloudAuthCancelledError',
      code: 'popup_closed',
    });

    popup.closed = true;
    // One poll tick to observe the close, then the late-result grace window.
    await vi.advanceTimersByTimeAsync(500 + 1500);

    await assertion;
  });

  it('still resolves when the result broadcast lands during the post-close grace window', async () => {
    const result = deferred<AuthCompleteMessage>();
    mockedWaitForAuthResult.mockReturnValue(result.promise);
    const popup = makePopup();

    const promise = awaitPopupAuthResult(asWindow(popup), 'state-1');

    popup.closed = true;
    await vi.advanceTimersByTimeAsync(500); // poll observes the close, grace starts
    result.resolve(OK_RESULT);
    await expect(promise).resolves.toEqual(OK_RESULT);

    // The grace deadline passing afterwards must not turn into a late error.
    await vi.advanceTimersByTimeAsync(5000);
  });

  it('closes the orphaned popup and re-rejects when the broadcast wait fails', async () => {
    const result = deferred<AuthCompleteMessage>();
    mockedWaitForAuthResult.mockReturnValue(result.promise);
    const popup = makePopup();

    const promise = awaitPopupAuthResult(asWindow(popup), 'state-1');
    const assertion = expect(promise).rejects.toThrow('Timed out waiting');

    result.reject(new Error('Timed out waiting for authentication to complete'));

    await assertion;
    expect(popup.close).toHaveBeenCalledTimes(1);
  });

  it('does not report popup_closed after the flow already failed', async () => {
    const result = deferred<AuthCompleteMessage>();
    mockedWaitForAuthResult.mockReturnValue(result.promise);
    const popup = makePopup();

    const promise = awaitPopupAuthResult(asWindow(popup), 'state-1');
    const assertion = expect(promise).rejects.toThrow('cancelled by caller');

    // The failure path closes the popup; the (already-stopped) close
    // watchdog must not race in with a second, misleading rejection.
    result.reject(new Error('cancelled by caller'));
    await assertion;
    await vi.advanceTimersByTimeAsync(10_000);

    expect(popup.closed).toBe(true);
  });

  it('passes timeout and signal options through to the broadcast wait', () => {
    mockedWaitForAuthResult.mockReturnValue(deferred<AuthCompleteMessage>().promise);
    const popup = makePopup();
    const controller = new AbortController();

    void awaitPopupAuthResult(asWindow(popup), 'state-1', {
      timeoutMs: 1234,
      signal: controller.signal,
    }).catch(() => {
      // Settled later (or never) — this test only checks call wiring.
    });

    expect(mockedWaitForAuthResult).toHaveBeenCalledWith('state-1', {
      timeoutMs: 1234,
      signal: controller.signal,
    });
  });
});

describe('CloudAuthCancelledError popup_closed shape', () => {
  it('carries the popup_closed code for UI branching', () => {
    const error = new CloudAuthCancelledError('closed', 'popup_closed');
    expect(error.code).toBe('popup_closed');
    expect(error.name).toBe('CloudAuthCancelledError');
  });
});
