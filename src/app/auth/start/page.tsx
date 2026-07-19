'use client';

import { useEffect, useState } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';

import { buildGoogleAuthorizeUrl } from '@/lib/cloudAuthGoogle';
import { postAuthResult } from '@/lib/cloudAuthBroadcast';
import {
  clearStaleMsalInteractionStatus,
  getMsalInstance,
  MICROSOFT_SCOPES,
} from '@/lib/cloudAuthMicrosoft';
import type { CloudProvider } from '@/lib/databaseSourceStorage';

const MSAL_STATE_STORAGE_KEY = 'bt.auth.msal.state';
const AUTH_PROVIDER_STORAGE_KEY = 'bt.auth.provider';

function parseParams(): { provider: CloudProvider | null; state: string | null } {
  if (typeof window === 'undefined') {
    return { provider: null, state: null };
  }
  const params = new URLSearchParams(window.location.search);
  const provider = params.get('provider');
  const state = params.get('state');
  return {
    provider: provider === 'gdrive' || provider === 'onedrive' ? provider : null,
    state,
  };
}

// Hosted inside the small popup window opened by cloudAuthPopup.ts. Kicks
// off the redirect-based OAuth flow for whichever provider was requested —
// this page has no DatabaseProvider/WllamaProvider in scope (it lives
// outside the (main) route group) so it never boots the SharedWorker.
export default function AuthStartPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { provider, state } = parseParams();

    // The opener is blocked on awaitPopupAuthResult(state) until a matching
    // broadcast arrives, it observes this popup closing, or its timeout
    // backstop fires. Every error path below must still postAuthResult
    // before closing so the opener surfaces the specific error rather than
    // a generic "sign-in window was closed".
    const fail = (currentProvider: CloudProvider, text: string) => {
      if (state) {
        postAuthResult({
          kind: 'auth-complete',
          provider: currentProvider,
          state,
          ok: false,
          errorCode: 'config',
          errorMessage: text,
        });
      }
      setError(text);
      window.setTimeout(() => window.close(), 2000);
    };

    if (!provider || !state) {
      setError('Missing sign-in parameters. You can close this window.');
      window.setTimeout(() => window.close(), 2000);
      return;
    }

    // /auth/complete/ can't tell Google's and Microsoft's redirect responses
    // apart from URL contents alone once Google's response is an *error* —
    // its implicit-grant fragment then has no access_token to key off of.
    // Stamping the provider here (read back and cleared in auth/complete)
    // removes the ambiguity for that case.
    window.sessionStorage.setItem(AUTH_PROVIDER_STORAGE_KEY, provider);

    if (provider === 'gdrive') {
      try {
        window.location.replace(buildGoogleAuthorizeUrl(state));
      } catch (err) {
        fail(provider, err instanceof Error ? err.message : 'Failed to start Google sign-in');
      }
      return;
    }

    void (async () => {
      try {
        window.sessionStorage.setItem(MSAL_STATE_STORAGE_KEY, state);
        clearStaleMsalInteractionStatus();

        const instance = await getMsalInstance();
        await instance.loginRedirect({
          scopes: MICROSOFT_SCOPES,
          prompt: 'select_account',
        });
      } catch (err) {
        fail(provider, err instanceof Error ? err.message : 'Failed to start Microsoft sign-in');
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
      {error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : (
        <>
          <CircularProgress size={32} />
          <Typography variant="body2" color="text.secondary">
            Redirecting to sign in…
          </Typography>
        </>
      )}
    </Box>
  );
}
