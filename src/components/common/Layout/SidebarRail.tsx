'use client';

/**
 * Desktop navigation: a permanent mini-variant rail (64 ↔ 240 px). Every
 * page control carries `data-testid={page.testId}` and an accessible name
 * equal to `page.label` whether or not the labels are visible, so the e2e
 * selectors (`getByRole('button', { name: 'SQL Query' })`) resolve in both
 * states.
 */

import React, { Fragment } from 'react';
import {
  Box,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  AccountBalanceWallet as AppIcon,
  ChevronLeft as CollapseIcon,
  ChevronRight as ExpandIcon,
  Storage as ManageDataIcon,
} from '@mui/icons-material';
import type { SvgIconProps } from '@mui/material';

import type { PageDefinition, PageId } from './pageRegistry';
import { APP_BAR_HEIGHT, RAIL_WIDTH_COLLAPSED, RAIL_WIDTH_EXPANDED } from './sidebarPreference';

export interface SidebarRailProps {
  pages: PageDefinition[];
  currentPage: PageId;
  expanded: boolean;
  onToggleExpanded: () => void;
  onNavigate: (page: PageId) => void;
  onOpenManageData: () => void;
  /** Developer console entry (hidden from the page list, reached from the rail footer). */
  developerConsolePage: PageDefinition;
}

interface RailItemProps {
  label: string;
  icon: React.ComponentType<SvgIconProps>;
  expanded: boolean;
  selected?: boolean;
  onClick: () => void;
  testId?: string;
}

function RailItem({ label, icon: Icon, expanded, selected = false, onClick, testId }: RailItemProps) {
  const button = (
    <ListItemButton
      onClick={onClick}
      selected={selected}
      aria-current={selected ? 'page' : undefined}
      aria-label={label}
      data-testid={testId}
      sx={{
        minHeight: 40,
        px: 1.5,
        justifyContent: expanded ? 'flex-start' : 'center',
        borderRadius: 1,
        mx: 0.75,
        my: 0.25,
        '&.Mui-selected': { bgcolor: 'action.selected' },
      }}
    >
      <ListItemIcon sx={{ minWidth: 0, mr: expanded ? 1.5 : 0, justifyContent: 'center', color: selected ? 'primary.main' : undefined }}>
        <Icon fontSize="small" />
      </ListItemIcon>
      {expanded && <ListItemText primary={label} slotProps={{ primary: { variant: 'body2', noWrap: true, fontWeight: selected ? 600 : 500 } }} />}
    </ListItemButton>
  );

  return (
    <ListItem disablePadding sx={{ display: 'block' }}>
      {expanded ? button : <Tooltip title={label} placement="right">{button}</Tooltip>}
    </ListItem>
  );
}

const SECTION_ORDER: PageDefinition['section'][] = ['main', 'tools', 'system'];

export default function SidebarRail({
  pages,
  currentPage,
  expanded,
  onToggleExpanded,
  onNavigate,
  onOpenManageData,
  developerConsolePage,
}: SidebarRailProps) {
  const width = expanded ? RAIL_WIDTH_EXPANDED : RAIL_WIDTH_COLLAPSED;
  const sections = SECTION_ORDER.map((section) => pages.filter((page) => page.section === section)).filter(
    (group) => group.length > 0
  );
  const toggleLabel = expanded ? 'Collapse sidebar' : 'Expand sidebar';

  return (
    <Drawer
      variant="permanent"
      data-testid="sidebar-rail"
      data-expanded={String(expanded)}
      sx={{
        width,
        flexShrink: 0,
        whiteSpace: 'nowrap',
        '& .MuiDrawer-paper': {
          width,
          overflowX: 'hidden',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          transition: (theme) =>
            theme.transitions.create('width', {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.shorter,
            }),
        },
        transition: (theme) =>
          theme.transitions.create('width', {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.shorter,
          }),
      }}
    >
      {/* The toggle lives in the rail header (top-left) rather than the footer so
          nothing docked to the bottom-left corner of the viewport can cover it. */}
      <Box
        sx={{
          height: APP_BAR_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          justifyContent: expanded ? 'flex-start' : 'center',
          pl: expanded ? 2 : 0,
          pr: expanded ? 1 : 0,
          gap: 1,
          borderBottom: 1,
          borderColor: 'divider',
          flexShrink: 0,
        }}
      >
        {expanded && (
          <>
            <AppIcon color="primary" fontSize="small" />
            <Typography variant="subtitle2" component="div" noWrap sx={{ fontWeight: 700, flex: 1, minWidth: 0 }}>
              Budget Tracker
            </Typography>
          </>
        )}
        <Tooltip title={toggleLabel} placement="right">
          <IconButton size="small" onClick={onToggleExpanded} aria-label={toggleLabel} data-testid="sidebar-toggle">
            {expanded ? <CollapseIcon fontSize="small" /> : <ExpandIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>

      <Box component="nav" aria-label="Pages" sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', py: 0.5 }}>
        {sections.map((group, index) => (
          <Fragment key={group[0].section}>
            {index > 0 && <Divider sx={{ my: 0.5 }} />}
            <List dense disablePadding>
              {group.map((page) => (
                <RailItem
                  key={page.id}
                  label={page.label}
                  icon={page.icon}
                  expanded={expanded}
                  selected={currentPage === page.id}
                  onClick={() => onNavigate(page.id)}
                  testId={page.testId}
                />
              ))}
            </List>
          </Fragment>
        ))}
      </Box>

      <Divider />
      <List dense disablePadding sx={{ py: 0.5 }}>
        <RailItem label="Manage Data" icon={ManageDataIcon} expanded={expanded} onClick={onOpenManageData} testId="rail-manage-data" />
        <RailItem
          label={developerConsolePage.label}
          icon={developerConsolePage.icon}
          expanded={expanded}
          onClick={() => onNavigate(developerConsolePage.id)}
          testId={developerConsolePage.testId}
        />
      </List>
    </Drawer>
  );
}
