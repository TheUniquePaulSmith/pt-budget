// BroadcastChannel-based handoff between the main app window and the small
// popup window that hosts the OAuth round trip. COOP: same-origin (required
// for wllama's multithreaded wasm) severs window.opener/window-reference
// access between the popup and its opener once the popup navigates
// cross-origin, so the two windows cannot script each other directly.
// BroadcastChannel is scoped by origin + channel name rather than by a
// window reference, so it keeps working regardless.

import type { CloudProvider } from './databaseSourceStorage';
import type { CloudAuthErrorCode } from './cloudSyncErrors';

export const AUTH_CHANNEL_NAME = 'budget-tracker.auth.v1';

interface GoogleTokenPayload {
  accessToken: string;
  expiresInSec: number;
  scope: string;
}

export type AuthChannelMessage =
  | {
      kind: 'auth-complete';
      provider: CloudProvider;
      state: string;
      ok: true;
      google?: GoogleTokenPayload;
    }
  | {
      kind: 'auth-complete';
      provider: CloudProvider;
      state: string;
      ok: false;
      errorCode: CloudAuthErrorCode;
      errorMessage: string;
    }
  | {
      kind: 'auth-progress';
      provider: CloudProvider;
      state: string;
    };

type AuthCompleteMessage = Extract<AuthChannelMessage, { kind: 'auth-complete' }>;

function createChannel(): BroadcastChannel {
  return new BroadcastChannel(AUTH_CHANNEL_NAME);
}

/** Sent by the popup's /auth/complete page once it has a result. */
export function postAuthResult(message: AuthChannelMessage): void {
  const channel = createChannel();
  try {
    channel.postMessage(message);
  } finally {
    channel.close();
  }
}

/**
 * Waits for an auth-complete message whose `state` matches `expectedState`.
 * Every other message — progress heartbeats, or a completion belonging to a
 * different in-flight request — is ignored; this state-equality check is
 * what prevents a stale or unrelated broadcast from resolving the wrong
 * caller. Resolves/rejects exactly once, then closes its channel.
 */
export function waitForAuthResult(
  expectedState: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<AuthCompleteMessage> {
  const { timeoutMs = 300_000, signal } = options;

  return new Promise((resolve, reject) => {
    const channel = createChannel();
    let settled = false;

    const cleanup = () => {
      channel.close();
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
    };

    const settle = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      fn();
    };

    const timeoutId = setTimeout(() => {
      settle(() => reject(new Error('Timed out waiting for authentication to complete')));
    }, timeoutMs);

    const onAbort = () => {
      settle(() => reject(new Error('Authentication was cancelled')));
    };
    signal?.addEventListener('abort', onAbort);

    channel.onmessage = (event: MessageEvent<AuthChannelMessage>) => {
      const message = event.data;
      if (!message || message.state !== expectedState || message.kind !== 'auth-complete') {
        return;
      }
      settle(() => resolve(message));
    };
  });
}
