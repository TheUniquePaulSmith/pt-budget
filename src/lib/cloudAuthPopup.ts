import type { CloudProvider } from './databaseSourceStorage';

const AUTH_POPUP_NAME = 'bt-auth';
const AUTH_POPUP_FEATURES = 'popup,width=480,height=640';

/**
 * Opens the popup that hosts the OAuth round trip for `provider`. Must be
 * called synchronously from within a user-gesture handler (no `await`
 * before it) — browsers only allow window.open() to bypass the popup
 * blocker when it's the direct result of a click.
 *
 * Returns null if the popup was blocked; callers should show a "popup
 * blocked, try again" affordance rather than retrying automatically.
 *
 * Note: once the popup navigates to a cross-origin identity provider, its
 * `window.opener` reference is severed by this app's COOP: same-origin
 * header, and — because the browsing-context group switches — the popup's
 * own `.closed` property becomes unreliable to poll from here afterward.
 * Cancellation is therefore handled by the caller via an overall timeout
 * and an explicit "Cancel" action, never by checking `popup.closed`.
 */
export function openAuthPopup(provider: CloudProvider, state: string): Window | null {
  const url = `/auth/start/?provider=${encodeURIComponent(provider)}&state=${encodeURIComponent(state)}`;
  return window.open(url, AUTH_POPUP_NAME, AUTH_POPUP_FEATURES);
}
