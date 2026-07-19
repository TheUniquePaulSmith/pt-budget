// Hand-rolled Google OAuth implicit grant (response_type=token) hosted in
// our own popup (see cloudAuthPopup): the popup does the redirect round
// trip and hands the token back over BroadcastChannel. This deliberately
// does not use Google Identity Services: GIS's token-client popup relies on
// window.opener.postMessage(...) internally, coupling sign-in to whichever
// cross-origin-isolation headers the app ships (an earlier COOP:
// same-origin phase of this app broke it outright). The BroadcastChannel
// handoff has no window-reference dependency at all, so it survives any
// future isolation-header change; the live popup reference is used only to
// detect the user closing the window (see awaitPopupAuthResult).

import { CloudAuthCancelledError, CloudAuthRequiredError } from './cloudSyncErrors';
import { awaitPopupAuthResult, openAuthPopup } from './cloudAuthPopup';

// drive.file (not the full `drive` scope): the app only ever needs to see
// files it created/opened itself, which keeps the OAuth consent screen
// mild and avoids Google's verification review for sensitive scopes.
export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const TOKEN_STORAGE_KEY = 'bt.gdrive.token.v1';
const STATE_STORAGE_KEY = 'bt.auth.state';
const EXPIRY_SKEW_MS = 60_000;

export interface GoogleTokenInfo {
  accessToken: string;
  expiresAtMs: number;
  scope: string;
}

function getGoogleClientId(): string | null {
  return process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? null;
}

export function isGoogleDriveConfigured(): boolean {
  return Boolean(getGoogleClientId());
}

export function buildGoogleAuthorizeUrl(state: string): string {
  const clientId = getGoogleClientId();
  if (!clientId) {
    throw new Error('Google Drive is not configured. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID.');
  }

  const redirectUri = `${window.location.origin}/auth/complete/`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope: GOOGLE_SCOPE,
    state,
    include_granted_scopes: 'true',
    prompt: 'select_account',
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function readStoredToken(): GoogleTokenInfo | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as GoogleTokenInfo;
  } catch {
    return null;
  }
}

export function storeGoogleToken(token: GoogleTokenInfo): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(token));
}

export function clearGoogleToken(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
}

/** Returns the cached token if it's present and not (nearly) expired. */
export function getValidGoogleToken(): GoogleTokenInfo | null {
  const token = readStoredToken();
  if (!token) {
    return null;
  }
  if (token.expiresAtMs <= Date.now() + EXPIRY_SKEW_MS) {
    return null;
  }
  return token;
}

/**
 * Resolves to a valid Google Drive access token, running the popup OAuth
 * flow if necessary and `interactive` is true. Never opens a popup when
 * `interactive` is false — callers doing background work (e.g. auto-sync)
 * should catch CloudAuthRequiredError and surface a "reconnect" affordance
 * instead of prompting unprompted.
 */
export async function ensureGoogleToken(interactive: boolean): Promise<string> {
  const cached = getValidGoogleToken();
  if (cached) {
    return cached.accessToken;
  }

  if (!interactive) {
    throw new CloudAuthRequiredError('Google Drive sign-in is required');
  }

  const state = crypto.randomUUID();
  window.sessionStorage.setItem(STATE_STORAGE_KEY, state);

  const popup = openAuthPopup('gdrive', state);
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
  if (!result.google) {
    throw new Error('Google sign-in did not return an access token');
  }

  const token: GoogleTokenInfo = {
    accessToken: result.google.accessToken,
    expiresAtMs: Date.now() + result.google.expiresInSec * 1000,
    scope: result.google.scope,
  };
  storeGoogleToken(token);

  return token.accessToken;
}
