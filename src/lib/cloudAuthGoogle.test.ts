// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildGoogleAuthorizeUrl,
  clearGoogleToken,
  getValidGoogleToken,
  isGoogleDriveConfigured,
  storeGoogleToken,
  type GoogleTokenInfo,
} from './cloudAuthGoogle';

describe('isGoogleDriveConfigured', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is false when no client id is configured', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', '');
    expect(isGoogleDriveConfigured()).toBe(false);
  });

  it('is true when a client id is configured', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', 'test-client-id');
    expect(isGoogleDriveConfigured()).toBe(true);
  });
});

describe('buildGoogleAuthorizeUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('throws when Google Drive is not configured', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', '');
    expect(() => buildGoogleAuthorizeUrl('state-123')).toThrow('not configured');
  });

  it('builds an implicit-grant authorize URL with the expected parameters', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', 'test-client-id');

    const url = new URL(buildGoogleAuthorizeUrl('state-123'));

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('response_type')).toBe('token');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    expect(url.searchParams.get('state')).toBe('state-123');
    expect(url.searchParams.get('redirect_uri')).toBe(`${window.location.origin}/auth/complete/`);
  });
});

describe('token storage', () => {
  beforeEach(() => {
    clearGoogleToken();
  });

  it('returns null when no token has been stored', () => {
    expect(getValidGoogleToken()).toBeNull();
  });

  it('returns a stored token that has not expired', () => {
    const token: GoogleTokenInfo = {
      accessToken: 'abc',
      expiresAtMs: Date.now() + 10 * 60 * 1000,
      scope: 'https://www.googleapis.com/auth/drive.file',
    };
    storeGoogleToken(token);

    expect(getValidGoogleToken()).toEqual(token);
  });

  it('treats a token within the expiry skew window as invalid', () => {
    storeGoogleToken({
      accessToken: 'abc',
      // Expires in 30s — inside the 60s skew window, so should be treated
      // as already expired.
      expiresAtMs: Date.now() + 30 * 1000,
      scope: 'https://www.googleapis.com/auth/drive.file',
    });

    expect(getValidGoogleToken()).toBeNull();
  });

  it('treats an already-expired token as invalid', () => {
    storeGoogleToken({
      accessToken: 'abc',
      expiresAtMs: Date.now() - 1000,
      scope: 'https://www.googleapis.com/auth/drive.file',
    });

    expect(getValidGoogleToken()).toBeNull();
  });

  it('clearGoogleToken removes a stored token', () => {
    storeGoogleToken({
      accessToken: 'abc',
      expiresAtMs: Date.now() + 10 * 60 * 1000,
      scope: 'https://www.googleapis.com/auth/drive.file',
    });
    clearGoogleToken();

    expect(getValidGoogleToken()).toBeNull();
  });
});
