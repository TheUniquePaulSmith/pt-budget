'use client';

/**
 * Shell slot: the control that opens the AI panel. Owned by the AI feature,
 * which swaps the icon and adds window-mode handling; the shell only decides
 * where the slot is rendered and which variant.
 */

import React from 'react';
import { IconButton, ListItem, ListItemButton, ListItemIcon, ListItemText } from '@mui/material';
import { SmartToy as AiIcon } from '@mui/icons-material';

import { useAiPanel } from '@/components/ai/AiPanelProvider';

export type AiLauncherVariant = 'header' | 'menuItem';

export interface AiLauncherSlotProps {
  variant: AiLauncherVariant;
  /** Called after the panel opens (e.g. to close a mobile menu). */
  onActivate?: () => void;
}

export const AI_LAUNCHER_LABEL = 'Local AI';

export default function AiLauncherSlot({ variant, onActivate }: AiLauncherSlotProps) {
  const { openPanel } = useAiPanel();

  const activate = () => {
    openPanel();
    onActivate?.();
  };

  if (variant === 'menuItem') {
    return (
      <ListItem disablePadding>
        <ListItemButton onClick={activate} data-testid="ai-launcher-menu-item">
          <ListItemIcon>
            <AiIcon />
          </ListItemIcon>
          <ListItemText primary={AI_LAUNCHER_LABEL} />
        </ListItemButton>
      </ListItem>
    );
  }

  return (
    <IconButton
      color="inherit"
      onClick={activate}
      sx={{ ml: 2 }}
      title={AI_LAUNCHER_LABEL}
      aria-label={AI_LAUNCHER_LABEL}
      data-testid="ai-launcher-button"
    >
      <AiIcon />
    </IconButton>
  );
}
