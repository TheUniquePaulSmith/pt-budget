// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  postAuthResult,
  waitForAuthResult,
  type AuthChannelMessage,
} from './cloudAuthBroadcast';

describe('waitForAuthResult / postAuthResult', () => {
  it('resolves when a matching auth-complete message arrives', async () => {
    const state = 'state-abc';
    const promise = waitForAuthResult(state);

    const message: AuthChannelMessage = {
      kind: 'auth-complete',
      provider: 'gdrive',
      state,
      ok: true,
      google: { accessToken: 'tok', expiresInSec: 3600, scope: 'drive.file' },
    };
    postAuthResult(message);

    await expect(promise).resolves.toEqual(message);
  });

  it('ignores messages with a mismatched state and eventually times out', async () => {
    const promise = waitForAuthResult('state-expected', { timeoutMs: 100 });

    postAuthResult({
      kind: 'auth-complete',
      provider: 'gdrive',
      state: 'state-other',
      ok: true,
      google: { accessToken: 'tok', expiresInSec: 3600, scope: 'drive.file' },
    });

    await expect(promise).rejects.toThrow('Timed out');
  });

  it('ignores auth-progress heartbeats and resolves once the real completion arrives', async () => {
    const state = 'state-progress';
    const promise = waitForAuthResult(state, { timeoutMs: 500 });

    postAuthResult({ kind: 'auth-progress', provider: 'onedrive', state });

    const expectedMessage: AuthChannelMessage = {
      kind: 'auth-complete',
      provider: 'onedrive',
      state,
      ok: true,
    };
    postAuthResult(expectedMessage);

    await expect(promise).resolves.toEqual(expectedMessage);
  });

  it('rejects after the timeout elapses with no matching message', async () => {
    const promise = waitForAuthResult('state-timeout', { timeoutMs: 50 });
    await expect(promise).rejects.toThrow('Timed out');
  });

  it('rejects when the signal aborts before any matching message arrives', async () => {
    const controller = new AbortController();
    const promise = waitForAuthResult('state-abort', {
      timeoutMs: 5000,
      signal: controller.signal,
    });

    controller.abort();

    await expect(promise).rejects.toThrow('cancelled');
  });

  it('resolves only the request with the matching state when two are in flight', async () => {
    const promiseA = waitForAuthResult('state-a', { timeoutMs: 500 });
    const promiseB = waitForAuthResult('state-b', { timeoutMs: 500 });

    const messageB: AuthChannelMessage = {
      kind: 'auth-complete',
      provider: 'gdrive',
      state: 'state-b',
      ok: true,
    };
    postAuthResult(messageB);

    await expect(promiseB).resolves.toEqual(messageB);

    const messageA: AuthChannelMessage = {
      kind: 'auth-complete',
      provider: 'onedrive',
      state: 'state-a',
      ok: true,
    };
    postAuthResult(messageA);

    await expect(promiseA).resolves.toEqual(messageA);
  });
});
