import type { CloudProvider } from './databaseSourceStorage';
import { CloudAuthCancelledError } from './cloudSyncErrors';
import { waitForAuthResult, type AuthCompleteMessage } from './cloudAuthBroadcast';

const AUTH_POPUP_NAME = 'bt-auth';
const AUTH_POPUP_FEATURES = 'popup,width=480,height=640';

// How often to check whether the user closed the popup, and how long to
// wait after a close for a result broadcast that may still be in flight
// (/auth/complete posts its result immediately before closing itself, so a
// close observed here usually races a legitimate result by a few ms).
const POPUP_CLOSED_POLL_MS = 500;
const LATE_RESULT_GRACE_MS = 1500;

/**
 * Opens the popup that hosts the OAuth round trip for `provider`. Must be
 * called synchronously from within a user-gesture handler (no `await`
 * before it) — browsers only allow window.open() to bypass the popup
 * blocker when it's the direct result of a click.
 *
 * Returns null if the popup was blocked; callers should show a "popup
 * blocked, try again" affordance rather than retrying automatically.
 *
 * This app itself does not send a COOP header (cross-origin isolation for
 * wllama comes from Document-Isolation-Policy instead — see
 * next.config.ts), but the identity provider's own pages do (accounts
 * .google.com and login.microsoftonline.com both send
 * Cross-Origin-Opener-Policy: same-origin). COOP severance is triggered by
 * either side, so once the popup navigates there the browsing-context-group
 * link still switches and `window.opener`/messaging go away — Chromium
 * logs "Cross-Origin-Opener-Policy policy would block the window.closed
 * call" at that point. `.closed` itself is exempted from COOP's scripting
 * restrictions in every current engine (it leaks nothing beyond a
 * boolean), so despite the warning it keeps reporting real values and the
 * poll in awaitPopupAuthResult below stays trustworthy throughout.
 */
export function openAuthPopup(provider: CloudProvider, state: string): Window | null {
  const url = `/auth/start/?provider=${encodeURIComponent(provider)}&state=${encodeURIComponent(state)}`;
  const popup = window.open(url, AUTH_POPUP_NAME, AUTH_POPUP_FEATURES);
  // A repeat sign-in click reuses the existing named window; window.open
  // re-navigates it but doesn't necessarily raise it.
  popup?.focus();
  return popup;
}

/**
 * Resolves with the popup's auth result, or rejects as soon as the outcome
 * is knowable without waiting out the full broadcast timeout:
 *
 * - result broadcast arrives (success or provider error) → resolves;
 * - the user closes the popup mid-flow → rejects with
 *   CloudAuthCancelledError('popup_closed') after a short grace period for
 *   a late broadcast;
 * - the broadcast wait itself rejects (timeout backstop, or the caller's
 *   AbortSignal) → closes the orphaned popup and re-rejects.
 *
 * The `.closed` poll only runs while a sign-in is in flight — there is no
 * platform event for a popup closing, so a short interval is the only way
 * to observe it, but it is exact: it reports what the window actually did
 * rather than guessing from a deadline.
 */
export function awaitPopupAuthResult(
  popup: Window,
  expectedState: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<AuthCompleteMessage> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let graceTimerId: number | undefined;

    const settle = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearInterval(pollTimerId);
      window.clearTimeout(graceTimerId);
      fn();
    };

    const pollTimerId = window.setInterval(() => {
      if (!popup.closed) {
        return;
      }
      window.clearInterval(pollTimerId);
      graceTimerId = window.setTimeout(() => {
        settle(() =>
          reject(
            new CloudAuthCancelledError(
              'The sign-in window was closed before finishing. Sign-in was cancelled.',
              'popup_closed'
            )
          )
        );
      }, LATE_RESULT_GRACE_MS);
    }, POPUP_CLOSED_POLL_MS);

    waitForAuthResult(expectedState, options).then(
      (result) => settle(() => resolve(result)),
      (error: unknown) =>
        settle(() => {
          try {
            popup.close();
          } catch {
            // Closing an already-closed or navigated-away window must never
            // mask the underlying timeout/cancellation error.
          }
          reject(error);
        })
    );
  });
}
