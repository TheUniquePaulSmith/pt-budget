// Microsoft auth via MSAL, but with loginPopup replaced by our own
// popup + BroadcastChannel handoff: MSAL's loginPopup polls the popup
// window's .location directly from the main window, which couples sign-in
// to whichever cross-origin-isolation headers the app ships (an earlier
// COOP: same-origin phase of this app severed that reference outright).
// Instead, the popup itself runs loginRedirect + handleRedirectPromise
// against MSAL's shared localStorage cache; once it reports success over
// BroadcastChannel — which needs no window references at all — the main
// window's acquireTokenSilent picks up the token that the popup just wrote
// to that shared cache. The live popup reference is used only to detect
// the user closing the window (see awaitPopupAuthResult).

import { PublicClientApplication, type AccountInfo } from '@azure/msal-browser';

import { CloudAuthCancelledError, CloudAuthRequiredError } from './cloudSyncErrors';
import { awaitPopupAuthResult, openAuthPopup } from './cloudAuthPopup';

// Files.ReadWrite (not .All): the app only ever needs to read/write its own
// backup file(s), not the user's whole OneDrive.
export const MICROSOFT_SCOPES = ['User.Read', 'Files.ReadWrite'];

const INTERACTION_STATUS_KEY = 'msal.interaction.status';

let msalInstancePromise: Promise<PublicClientApplication> | null = null;

function getMicrosoftClientId(): string | null {
  return process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID ?? null;
}

function getMicrosoftTenantId(): string {
  return process.env.NEXT_PUBLIC_MICROSOFT_TENANT_ID ?? 'common';
}

export function isOneDriveConfigured(): boolean {
  return Boolean(getMicrosoftClientId());
}

/**
 * A popup that's closed or navigated away mid-flow (before
 * handleRedirectPromise completes) can leave MSAL's sessionStorage-persisted
 * interaction-status flag set in that popup window, which then blocks any
 * later login attempt started in the same (reused) popup window with an
 * "interaction_in_progress" error. Called from the /auth/start page itself
 * — MSAL's temporary interaction state always lives in sessionStorage
 * regardless of the main cacheLocation setting, and sessionStorage is
 * per-window, so this must run in the popup, not the main app window.
 */
export function clearStaleMsalInteractionStatus(): void {
  if (typeof window === 'undefined') {
    return;
  }

  Object.keys(window.sessionStorage)
    .filter((key) => key.includes(INTERACTION_STATUS_KEY))
    .forEach((key) => window.sessionStorage.removeItem(key));
}

export async function getMsalInstance(): Promise<PublicClientApplication> {
  const clientId = getMicrosoftClientId();
  if (!clientId) {
    throw new Error('OneDrive is not configured. Set NEXT_PUBLIC_MICROSOFT_CLIENT_ID.');
  }

  if (!msalInstancePromise) {
    const instance = new PublicClientApplication({
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${getMicrosoftTenantId()}`,
        redirectUri:
          typeof window === 'undefined'
            ? undefined
            : `${window.location.origin}/auth/complete/`,
      },
      cache: {
        cacheLocation: 'localStorage',
      },
    });

    msalInstancePromise = instance.initialize().then(() => instance);
  }

  return msalInstancePromise;
}

function getActiveOrFirstAccount(instance: PublicClientApplication): AccountInfo | null {
  return instance.getActiveAccount() ?? instance.getAllAccounts()[0] ?? null;
}

/**
 * Resolves to a valid Microsoft Graph access token. Tries a silent
 * acquisition against MSAL's shared localStorage cache first; only runs the
 * popup flow when `interactive` is true and silent acquisition fails with
 * an interaction-required error. Never opens a popup when `interactive` is
 * false — callers doing background work should catch
 * CloudAuthRequiredError and surface a "reconnect" affordance instead.
 */
export async function ensureMicrosoftToken(interactive: boolean): Promise<string> {
  const instance = await getMsalInstance();
  const account = getActiveOrFirstAccount(instance);

  if (account) {
    instance.setActiveAccount(account);
    try {
      const result = await instance.acquireTokenSilent({
        account,
        scopes: MICROSOFT_SCOPES,
      });
      return result.accessToken;
    } catch {
      // Any silent-acquisition failure means interactive sign-in is
      // needed; below we either run it (interactive) or report that it's
      // needed (non-interactive) — the specific MSAL error isn't
      // actionable to callers either way.
    }
  }

  if (!interactive) {
    throw new CloudAuthRequiredError('Microsoft sign-in is required');
  }

  const state = crypto.randomUUID();
  const popup = openAuthPopup('onedrive', state);
  if (!popup) {
    throw new CloudAuthCancelledError(
      'The sign-in popup was blocked. Please allow popups for this site and try again.',
      'popup_blocked'
    );
  }

  const result = await awaitPopupAuthResult(popup, state);
  if (!result.ok) {
    throw new Error(result.errorMessage);
  }

  // The popup's loginRedirect wrote the token/account into MSAL's shared
  // localStorage cache; re-run the silent flow in this window to pick it up.
  const refreshedAccount = getActiveOrFirstAccount(instance);
  if (!refreshedAccount) {
    throw new Error('Microsoft sign-in completed but no account was found');
  }
  instance.setActiveAccount(refreshedAccount);

  const silentResult = await instance.acquireTokenSilent({
    account: refreshedAccount,
    scopes: MICROSOFT_SCOPES,
  });
  return silentResult.accessToken;
}
