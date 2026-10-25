'use client';

/**
 * Hosts the AI panel in the mode the provider selected: a persistent,
 * drag-resizable right drawer that shifts the app content (desktop sidebar,
 * when the content keeps at least the `lg` breakpoint of width), an overlay
 * drawer on narrower desktops, a full-screen drawer (mobile), or a
 * full-viewport dialog (maximized). In pop-out mode the panel lives in
 * another window and nothing renders here.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { Box, Dialog, Drawer, useMediaQuery, useTheme } from '@mui/material';

import { AI_SIDEBAR_MIN_WIDTH, useAiPanel } from './AiPanelProvider';
import AiPanelContent from './AiPanelContent';
import { AiProviderContextProvider } from './AiProviderContext';
import { AiToolsContextProvider } from './AiToolsContext';

interface AiSidePanelProps {
  open: boolean;
  onClose: () => void;
}

function ResizeHandle({ onResize, minContentWidth }: { onResize: (width: number) => void; minContentWidth: number }) {
  const draggingRef = useRef(false);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    draggingRef.current = true;
    (event.currentTarget as HTMLDivElement).setPointerCapture?.(event.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const stop = useCallback(() => {
    if (!draggingRef.current) {
      return;
    }
    draggingRef.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) {
        return;
      }
      const maxWidth = Math.max(AI_SIDEBAR_MIN_WIDTH, window.innerWidth - minContentWidth);
      onResize(Math.min(maxWidth, Math.max(AI_SIDEBAR_MIN_WIDTH, window.innerWidth - event.clientX)));
    },
    [minContentWidth, onResize]
  );

  useEffect(() => {
    window.addEventListener('pointerup', stop);
    return () => window.removeEventListener('pointerup', stop);
  }, [stop]);

  return (
    <Box
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize AI panel"
      data-testid="ai-panel-resize-handle"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stop}
      sx={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: 6,
        height: '100%',
        cursor: 'col-resize',
        zIndex: 1,
        '&:hover': { bgcolor: 'action.hover' },
      }}
    />
  );
}

export default function AiSidePanel({ open, onClose }: AiSidePanelProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { mode, sidebarWidth, setSidebarWidth } = useAiPanel();
  // Dock (shift the content) only while the content keeps `lg` width; the
  // current header needs about that much. Narrower desktops get an overlay.
  const minContentWidth = theme.breakpoints.values.lg;
  const canDock = useMediaQuery(`(min-width:${minContentWidth + sidebarWidth}px)`);

  const content = (
    <AiProviderContextProvider>
      <AiToolsContextProvider>
        <AiPanelContent onClose={onClose} />
      </AiToolsContextProvider>
    </AiProviderContextProvider>
  );

  if (mode === 'popout') {
    return null;
  }

  if (mode === 'maximized') {
    return (
      <Dialog fullScreen open={open} onClose={onClose} aria-label="AI assistant" data-testid="ai-panel-maximized">
        {open && content}
      </Dialog>
    );
  }

  if (isMobile || !canDock) {
    return (
      <Drawer
        anchor="right"
        open={open}
        onClose={onClose}
        ModalProps={{ keepMounted: false }}
        sx={{ '& .MuiDrawer-paper': { width: isMobile ? '100vw' : sidebarWidth, maxWidth: '100vw', boxSizing: 'border-box' } }}
        data-testid={isMobile ? 'ai-panel-sidebar' : 'ai-panel-overlay'}
      >
        {open && content}
      </Drawer>
    );
  }

  return (
    <Drawer
      variant="persistent"
      anchor="right"
      open={open}
      data-testid="ai-panel-sidebar"
      sx={{
        width: open ? sidebarWidth : 0,
        flexShrink: 0,
        transition: theme.transitions.create('width', { duration: theme.transitions.duration.shorter }),
        '& .MuiDrawer-paper': {
          width: sidebarWidth,
          boxSizing: 'border-box',
          overflow: 'visible',
        },
      }}
    >
      {open && (
        <Box sx={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <ResizeHandle onResize={setSidebarWidth} minContentWidth={minContentWidth} />
          {content}
        </Box>
      )}
    </Drawer>
  );
}
