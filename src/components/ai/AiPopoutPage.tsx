'use client';

/**
 * Body of the `/ai/` route: the AI panel as a whole-window page for the
 * pop-out mode. It lives under `(main)` so it gets `DatabaseProvider` and
 * shares the SharedWorker database with the main window. The transcript is
 * mirrored from the main window over BroadcastChannel; a local wllama model
 * must be loaded again in this window, cloud providers work immediately.
 */

import React, { useEffect } from 'react';
import { Box } from '@mui/material';

import { useAppShellSlice } from '@/contexts/useDatabaseSlices';
import AiPanelContent from './AiPanelContent';
import { AiPanelProvider } from './AiPanelProvider';
import { AiProviderContextProvider } from './AiProviderContext';
import { AiToolsContextProvider } from './AiToolsContext';

export default function AiPopoutPage() {
  const { isDatabaseLoaded } = useAppShellSlice();

  useEffect(() => {
    document.title = 'AI assistant – Budget Tracker';
  }, []);

  if (!isDatabaseLoaded) {
    // DatabaseProvider renders the unlock / setup gate in this state.
    return null;
  }

  return (
    <AiPanelProvider standalone>
      <AiProviderContextProvider>
        <AiToolsContextProvider>
          <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }} data-testid="ai-popout-page">
            <AiPanelContent onClose={() => window.close()} />
          </Box>
        </AiToolsContextProvider>
      </AiProviderContextProvider>
    </AiPanelProvider>
  );
}
