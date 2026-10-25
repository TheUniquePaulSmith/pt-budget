'use client';

/**
 * Shell slot: the control that opens the AI panel. Owned by the AI feature;
 * the shell only decides where the slot is rendered and which variant.
 *
 * A click opens the panel in its current mode (or focuses the pop-out window
 * when one is open). Right-click, or the menu-item variant's secondary
 * action, offers the window modes: sidebar, maximized, new window.
 */

import React, { useState } from 'react';
import {
  IconButton,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
} from '@mui/material';
import {
  AutoAwesome as AiIcon,
  Fullscreen,
  OpenInNew,
  ViewSidebar,
} from '@mui/icons-material';

import { useAiPanel } from '@/components/ai/AiPanelProvider';

export type AiLauncherVariant = 'header' | 'menuItem';

export interface AiLauncherSlotProps {
  variant: AiLauncherVariant;
  /** Called after the panel opens (e.g. to close a mobile menu). */
  onActivate?: () => void;
}

export const AI_LAUNCHER_LABEL = 'Local AI';

export default function AiLauncherSlot({ variant, onActivate }: AiLauncherSlotProps) {
  const { openPanel, setMode, openPopout } = useAiPanel();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  // openPanel focuses a live pop-out window itself, or reopens in-app.
  const activate = () => {
    openPanel();
    onActivate?.();
  };

  const openMenu = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    setMenuAnchor(event.currentTarget);
  };

  const choose = (action: () => void) => {
    setMenuAnchor(null);
    action();
    onActivate?.();
  };

  const menu = (
    <Menu
      anchorEl={menuAnchor}
      open={Boolean(menuAnchor)}
      onClose={() => setMenuAnchor(null)}
      data-testid="ai-launcher-menu"
    >
      <MenuItem onClick={() => choose(() => setMode('sidebar'))} data-testid="ai-launcher-mode-sidebar">
        <ListItemIcon>
          <ViewSidebar fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="Open as sidebar" />
      </MenuItem>
      <MenuItem onClick={() => choose(() => setMode('maximized'))} data-testid="ai-launcher-mode-maximized">
        <ListItemIcon>
          <Fullscreen fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="Open maximized" />
      </MenuItem>
      <MenuItem onClick={() => choose(openPopout)} data-testid="ai-launcher-mode-popout">
        <ListItemIcon>
          <OpenInNew fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="Open in a new window" />
      </MenuItem>
    </Menu>
  );

  if (variant === 'menuItem') {
    return (
      <>
        <ListItem disablePadding>
          <ListItemButton onClick={activate} onContextMenu={openMenu} data-testid="ai-launcher-menu-item">
            <ListItemIcon>
              <AiIcon />
            </ListItemIcon>
            <ListItemText primary={AI_LAUNCHER_LABEL} />
          </ListItemButton>
        </ListItem>
        {menu}
      </>
    );
  }

  return (
    <>
      <IconButton
        color="inherit"
        onClick={activate}
        onContextMenu={openMenu}
        sx={{ ml: 2 }}
        title={`${AI_LAUNCHER_LABEL} (right-click for window options)`}
        aria-label={AI_LAUNCHER_LABEL}
        data-testid="ai-launcher-button"
      >
        <AiIcon />
      </IconButton>
      {menu}
    </>
  );
}
