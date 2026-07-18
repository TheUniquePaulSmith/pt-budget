'use client';

import { useEffect, useRef, useState } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';

import { postAuthResult } from '@/lib/cloudAuthBroadcast';
import { getMsalInstance } from '@/lib/cloudAuthMicrosoft';

const MSAL_STATE_STORAGE_KEY = 'bt.auth.msal.state';
const AUTH_PROVIDER_STORAGE_KEY = 'bt.auth.provider';

function parseGoogleHash(hash: string) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return {
    accessToken: params.get('access_token') ?? undefined,
    expiresInSec: params.get('expires_in') ? Number(params.get('expires_in')) : undefined,
    scope: params.get('scope') ?? undefined,
    state: params.get('state') ?? undefined,
    error: params.get('error') ?? undefined,
  };
}

// Hosted inside the popup window. Both the Google implicit-grant redirect
// and the Microsoft authorization-code redirect land here; this page
// figures out which one occurred, relays the result to the main app window
// over BroadcastChannel (see cloudAuthBroadcast.ts), and closes itself.
export default function AuthCompletePage() {
  const [status, setStatus] = useState<'working' | 'done' | 'error'>('working');
  const [message, setMessage] = useState('Finishing sign-in…');
  const hasRunRef = useRef(false);

  useEffect(() => {
    if (hasRunRef.current) {
      return;
    }
    hasRunRef.current = true;

    const finish = (text: string, ok: boolean) => {
      setMessage(text);
      setStatus(ok ? 'done' : 'error');
      window.setTimeout(() => window.close(), 600);
    };

    // Set by auth/start right before it redirected here — read (and clear)
    // it to tell Google from Microsoft. Sniffing the hash for
    // `access_token=` doesn't work: Google's implicit-grant fragment omits
    // it on a denied/error response too, so that check previously
    // misrouted a denied Google sign-in into the Microsoft branch below,
    // which found no MSAL state (this wasn't an MSAL flow) and closed the
    // popup without ever calling postAuthResult — leaving the opener
    // waiting on its full timeout instead of surfacing the error.
    const provider = window.sessionStorage.getItem(AUTH_PROVIDER_STORAGE_KEY);
    window.sessionStorage.removeItem(AUTH_PROVIDER_STORAGE_KEY);

    if (provider === 'gdrive') {
      const hash = window.location.hash;
      const parsed = parseGoogleHash(hash);
      // Clear the token out of the URL/history immediately so it never
      // lingers there.
      window.history.replaceState(null, '', window.location.pathname);

      if (!parsed.state) {
        finish('Sign-in response was missing state. You can close this window.', false);
        return;
      }

      if (parsed.error || !parsed.accessToken || !parsed.expiresInSec) {
        postAuthResult({
          kind: 'auth-complete',
          provider: 'gdrive',
          state: parsed.state,
          ok: false,
          errorCode: parsed.error === 'access_denied' ? 'access_denied' : 'provider_error',
          errorMessage: parsed.error ?? 'Google sign-in did not return an access token',
        });
        finish('Sign-in failed. You can close this window.', false);
        return;
      }

      postAuthResult({
        kind: 'auth-complete',
        provider: 'gdrive',
        state: parsed.state,
        ok: true,
        google: {
          accessToken: parsed.accessToken,
          expiresInSec: parsed.expiresInSec,
          scope: parsed.scope ?? '',
        },
      });
      finish('Signed in. You can close this window.', true);
      return;
    }

    // Otherwise, this is the Microsoft redirect-response leg.
    const msalState = window.sessionStorage.getItem(MSAL_STATE_STORAGE_KEY);

    void (async () => {
      try {
        const instance = await getMsalInstance();
        // Stay on this page after processing the redirect response instead
        // of letting MSAL navigate the popup back to /auth/start/.
        const result = await instance.handleRedirectPromise({
          navigateToLoginRequestUrl: false,
        });

        if (!msalState) {
          finish('Sign-in response was missing state. You can close this window.', false);
          return;
        }

        if (!result) {
          postAuthResult({
            kind: 'auth-complete',
            provider: 'onedrive',
            state: msalState,
            ok: false,
            errorCode: 'provider_error',
            errorMessage: 'Microsoft sign-in did not return a result',
          });
          finish('Sign-in failed. You can close this window.', false);
          return;
        }

        postAuthResult({
          kind: 'auth-complete',
          provider: 'onedrive',
          state: msalState,
          ok: true,
        });
        finish('Signed in. You can close this window.', true);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Microsoft sign-in failed';
        if (msalState) {
          postAuthResult({
            kind: 'auth-complete',
            provider: 'onedrive',
            state: msalState,
            ok: false,
            errorCode: 'provider_error',
            errorMessage,
          });
        }
        finish('Sign-in failed. You can close this window.', false);
      } finally {
        window.sessionStorage.removeItem(MSAL_STATE_STORAGE_KEY);
      }
    })();
  }, []);

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 2,
        p: 2,
        textAlign: 'center',
      }}
    >
      {status === 'working' && <CircularProgress size={32} />}
      <Typography variant="body2" color={status === 'error' ? 'error' : 'text.secondary'}>
        {message}
      </Typography>
    </Box>
  );
}
