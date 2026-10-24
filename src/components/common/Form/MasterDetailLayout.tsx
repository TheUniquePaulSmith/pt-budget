'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Box, IconButton, Paper, Toolbar, Typography, useMediaQuery, useTheme } from '@mui/material';
import { ArrowBack } from '@mui/icons-material';

export interface MasterDetailLayoutProps {
  /** The list / grid. */
  master: ReactNode;
  /** The record form; `null` shows `emptyDetail`. */
  detail: ReactNode;
  /** Shown in the detail pane while nothing is selected. */
  emptyDetail?: ReactNode;
  /** Optional third column on desktop (e.g. a People panel); stacks under the master on phones. */
  aside?: ReactNode;
  /** Phones: `true` shows the detail full-screen instead of the master. */
  detailOpen: boolean;
  /** Phones: the back button in the detail header. */
  onCloseDetail?: () => void;
  /** Phones: the title above the full-screen detail. */
  detailTitle?: ReactNode;
  /** Initial width of the master column in px (desktop). */
  initialMasterWidth?: number;
  minMasterWidth?: number;
  minDetailWidth?: number;
  asideWidth?: number;
  /** localStorage key remembering the dragged master width. */
  storageKey?: string;
  /** Height of the whole layout on desktop; the panes scroll inside it. */
  height?: string | number;
  'data-testid'?: string;
}

function readStoredWidth(storageKey: string | undefined, fallback: number): number {
  if (!storageKey || typeof window === 'undefined') return fallback;
  try {
    const stored = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(stored) && stored > 0 ? stored : fallback;
  } catch {
    return fallback;
  }
}

/**
 * A resizable master / detail split for desktop ("Access form" feel) that
 * collapses to a list → full-screen form flow on phones. The divider is
 * draggable with a pointer and adjustable with the arrow keys.
 */
export function MasterDetailLayout({
  master,
  detail,
  emptyDetail,
  aside,
  detailOpen,
  onCloseDetail,
  detailTitle,
  initialMasterWidth = 520,
  minMasterWidth = 280,
  minDetailWidth = 320,
  asideWidth = 260,
  storageKey,
  height = '100%',
  'data-testid': testId,
}: MasterDetailLayoutProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [masterWidth, setMasterWidth] = useState(() => readStoredWidth(storageKey, initialMasterWidth));
  const [dragging, setDragging] = useState(false);
  // Whether the container is wide enough for the aside as a third column;
  // otherwise it stacks under the master.
  const [asideFits, setAsideFits] = useState(true);

  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(storageKey, String(Math.round(masterWidth)));
    } catch {
      // Width persistence is a convenience only.
    }
  }, [masterWidth, storageKey]);

  const clampWidth = useCallback(
    (next: number) => {
      const containerWidth = containerRef.current?.clientWidth ?? 0;
      // A container that has not been laid out yet (or jsdom) reports 0: only
      // apply the lower bound then.
      const available =
        containerWidth > 0 ? containerWidth - (aside && asideFits ? asideWidth + 8 : 0) - minDetailWidth - 12 : Infinity;
      return Math.min(Math.max(next, minMasterWidth), Math.max(minMasterWidth, available));
    },
    [aside, asideFits, asideWidth, minDetailWidth, minMasterWidth]
  );

  // Keep the split valid for the space actually available (initial layout,
  // window resizes, the rail expanding or collapsing).
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return undefined;

    const measure = () => {
      const width = container.clientWidth;
      if (width <= 0) return;
      const fits = !aside || width >= minMasterWidth + minDetailWidth + asideWidth + 16;
      setAsideFits(fits);
      const available = width - (fits && aside ? asideWidth + 8 : 0) - minDetailWidth - 12;
      setMasterWidth((current) => Math.min(Math.max(current, minMasterWidth), Math.max(minMasterWidth, available)));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [aside, asideWidth, minDetailWidth, minMasterWidth]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = masterWidth;
    setDragging(true);

    const handleMove = (moveEvent: PointerEvent) => {
      setMasterWidth(clampWidth(startWidth + (moveEvent.clientX - startX)));
    };
    const handleUp = () => {
      setDragging(false);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setMasterWidth((width) => clampWidth(width - 24));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setMasterWidth((width) => clampWidth(width + 24));
    }
  };

  if (isMobile) {
    if (detailOpen) {
      return (
        <Box data-testid={testId} data-layout="mobile-detail" sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <Toolbar variant="dense" disableGutters sx={{ gap: 1, minHeight: 44, px: 0.5 }}>
            <IconButton onClick={onCloseDetail} aria-label="Back to list" edge="start">
              <ArrowBack />
            </IconButton>
            <Typography variant="subtitle1" component="h2" noWrap sx={{ fontWeight: 600, minWidth: 0 }}>
              {detailTitle}
            </Typography>
          </Toolbar>
          <Box sx={{ minWidth: 0 }}>{detail}</Box>
        </Box>
      );
    }
    return (
      <Box data-testid={testId} data-layout="mobile-master" sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <Box sx={{ minWidth: 0 }}>{master}</Box>
        {aside && <Box sx={{ minWidth: 0 }}>{aside}</Box>}
      </Box>
    );
  }

  return (
    <Box
      ref={containerRef}
      data-testid={testId}
      data-layout="desktop"
      sx={{
        display: 'flex',
        alignItems: 'stretch',
        height,
        minHeight: 360,
        width: '100%',
        minWidth: 0,
        userSelect: dragging ? 'none' : undefined,
        cursor: dragging ? 'col-resize' : undefined,
      }}
    >
      <Box sx={{ width: masterWidth, flexShrink: 0, minWidth: minMasterWidth, display: 'flex', flexDirection: 'column', minHeight: 0, gap: 1 }}>
        <Paper
          variant="outlined"
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          {master}
        </Paper>
        {aside && !asideFits && (
          <Paper variant="outlined" data-testid="master-detail-aside-stacked" sx={{ maxHeight: '40%', overflow: 'auto', flexShrink: 0 }}>
            {aside}
          </Paper>
        )}
      </Box>
      <Box
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize list"
        aria-valuenow={Math.round(masterWidth)}
        aria-valuemin={minMasterWidth}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        data-testid="master-detail-divider"
        sx={{
          width: 8,
          mx: 0.25,
          flexShrink: 0,
          cursor: 'col-resize',
          borderRadius: 1,
          '&:hover, &:focus-visible': { bgcolor: 'action.hover', outline: 'none' },
          position: 'relative',
          '&::after': {
            content: '""',
            position: 'absolute',
            top: '50%',
            left: 3,
            width: 2,
            height: 32,
            marginTop: '-16px',
            borderRadius: 1,
            bgcolor: 'divider',
          },
        }}
      />
      <Paper
        variant="outlined"
        sx={{
          flex: 1,
          minWidth: minDetailWidth,
          minHeight: 0,
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {detail ?? (
          <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', p: 3 }}>
            {emptyDetail ?? (
              <Typography variant="body2" color="text.secondary">
                Select a record to see its details.
              </Typography>
            )}
          </Box>
        )}
      </Paper>
      {aside && asideFits && (
        <Paper
          variant="outlined"
          data-testid="master-detail-aside"
          sx={{ width: asideWidth, flexShrink: 0, ml: 1, minHeight: 0, overflow: 'auto' }}
        >
          {aside}
        </Paper>
      )}
    </Box>
  );
}

export default MasterDetailLayout;
