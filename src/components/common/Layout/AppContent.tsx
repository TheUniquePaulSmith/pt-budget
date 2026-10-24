'use client';

/**
 * Application shell.
 *
 * Pages come from `pageRegistry.tsx`; nothing here names a page id except
 * the default. The shell rewrite (sidebar + bottom navigation) replaces the
 * header buttons and mobile drawer below but MUST keep these invariants,
 * which feature slots and the e2e suite rely on:
 *
 *   - `<AiPanelProvider>` wraps the shell (AI panel state lives there).
 *   - `<NotificationsRuntime />` is mounted exactly once, outside any page.
 *   - `<NotificationBellSlot />` and `<AiLauncherSlot />` are rendered in the
 *     header (and in the mobile menu as `menuItem` variants).
 *   - `<ManageData />` and `<DatabaseStatusBar />` are rendered.
 *   - Pages render through `getPage(id).render(...)` inside `<Suspense>`.
 *   - Every control that navigates to a page carries
 *     `data-testid={page.testId}` AND an accessible name equal to
 *     `page.label` at desktop width (a collapsed icon rail must use
 *     aria-label / Tooltip so `getByRole('button', { name: 'SQL Query' })`
 *     still resolves).
 *   - A `Settings`-named control stays in the header; full-screen pages
 *     (settings, developer console) render without the chrome and close
 *     via `goBack`.
 */

import React, { Suspense, useCallback, useRef, useState } from 'react';
import {
  Box,
  AppBar,
  Toolbar,
  IconButton,
  Typography,
  Button,
  useTheme,
  useMediaQuery,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
} from '@mui/material';
import {
  Settings as SettingsIcon,
  Menu as MenuIcon,
  Storage as ManageDataIcon,
  BugReport,
} from '@mui/icons-material';

import ManageData from '@/components/data-management/ManageData';
import DatabaseStatusBar from '@/components/common/StatusBar/DatabaseStatusBar';
import { AiPanelProvider } from '@/components/ai/AiPanelProvider';
import NotificationsRuntime from '@/components/notifications/NotificationsRuntime';
import { useAppShellSlice } from '@/contexts/useDatabaseSlices';
import AiLauncherSlot from './slots/AiLauncherSlot';
import NotificationBellSlot from './slots/NotificationBellSlot';
import PageFallback from './PageFallback';
import {
  DEFAULT_PAGE_ID,
  getNavigationPages,
  getPage,
  type PageId,
} from './pageRegistry';

/**
 * Main application component that handles all the routing and state management
 * This is separated from the page.tsx to prevent SSR issues
 */
export default function AppContent() {
  return (
    <AiPanelProvider>
      <AppShell />
    </AiPanelProvider>
  );
}

function AppShell() {
  const {
    isDatabaseLoaded,
    workerStatus,
    syncStatus,
    syncNow,
    reconnectCloudSource,
    resolveCloudConflict,
  } = useAppShellSlice();
  const [currentPage, setCurrentPage] = useState<PageId>(DEFAULT_PAGE_ID);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [manageDataOpen, setManageDataOpen] = useState(false);
  // The page that was showing before a full-screen page (settings / developer
  // console) opened, so `goBack` returns there.
  const previousPageRef = useRef<PageId>(DEFAULT_PAGE_ID);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const navigationPages = getNavigationPages();
  const settingsPage = getPage('settings');
  const developerConsolePage = getPage('developer-console');

  const navigate = useCallback((page: PageId) => {
    setCurrentPage((current) => {
      if (getPage(page).fullScreen && !getPage(current).fullScreen) {
        previousPageRef.current = current;
      }
      return page;
    });
    setMobileMenuOpen(false);
  }, []);

  const goBack = useCallback(() => {
    setCurrentPage(previousPageRef.current);
  }, []);

  const handleMobileMenuToggle = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };

  // The provider owns initialization screens, so AppContent only renders once data is ready.
  if (!isDatabaseLoaded) {
    return null; // The context will show initialization UI
  }

  const page = getPage(currentPage);
  const pageContent = (
    <Suspense fallback={<PageFallback />}>{page.render({ navigate, goBack })}</Suspense>
  );

  if (page.fullScreen) {
    return (
      <>
        <NotificationsRuntime />
        {pageContent}
      </>
    );
  }

  const renderNavigationButtons = () => (
    <>
      {navigationPages.map((item) => {
        const Icon = item.icon;
        return (
          <Button
            key={item.id}
            color="inherit"
            startIcon={<Icon />}
            onClick={() => navigate(item.id)}
            data-testid={item.testId}
            aria-current={currentPage === item.id ? 'page' : undefined}
            sx={{
              mx: 1,
              bgcolor: currentPage === item.id ? 'action.selected' : 'transparent',
              '&:hover': {
                bgcolor: 'action.hover',
              },
            }}
          >
            {item.label}
          </Button>
        );
      })}
    </>
  );

  const renderMobileDrawer = () => (
    <Drawer
      anchor="left"
      open={mobileMenuOpen}
      onClose={() => setMobileMenuOpen(false)}
      sx={{
        '& .MuiDrawer-paper': {
          width: 250,
          boxSizing: 'border-box',
        },
      }}
    >
      <Box sx={{ overflow: 'auto' }}>
        <Box sx={{ p: 2 }}>
          <Typography variant="h6" component="div">
            Budget Tracker
          </Typography>
        </Box>
        <Divider />
        <List>
          {navigationPages.map((item) => {
            const Icon = item.icon;
            return (
              <ListItem key={item.id} disablePadding>
                <ListItemButton
                  selected={currentPage === item.id}
                  onClick={() => navigate(item.id)}
                  data-testid={item.testId}
                >
                  <ListItemIcon>
                    <Icon />
                  </ListItemIcon>
                  <ListItemText primary={item.label} />
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>
        <Divider />
        <List>
          {isDatabaseLoaded && (
            <ListItem disablePadding>
              <ListItemButton onClick={() => { setManageDataOpen(true); setMobileMenuOpen(false); }}>
                <ListItemIcon>
                  <ManageDataIcon />
                </ListItemIcon>
                <ListItemText primary="Manage Data" />
              </ListItemButton>
            </ListItem>
          )}
          <AiLauncherSlot variant="menuItem" onActivate={() => setMobileMenuOpen(false)} />
          <ListItem disablePadding>
            <ListItemButton
              onClick={() => navigate(developerConsolePage.id)}
              data-testid={developerConsolePage.testId}
            >
              <ListItemIcon>
                <BugReport />
              </ListItemIcon>
              <ListItemText primary={developerConsolePage.label} />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton onClick={() => navigate(settingsPage.id)} data-testid={settingsPage.testId}>
              <ListItemIcon>
                <SettingsIcon />
              </ListItemIcon>
              <ListItemText primary={settingsPage.label} />
            </ListItemButton>
          </ListItem>
        </List>
      </Box>
    </Drawer>
  );

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <NotificationsRuntime />

      {/* Responsive App Bar */}
      <AppBar position="sticky" color="default" elevation={1}>
        <Toolbar sx={{ minHeight: 64 }}>
          {isMobile && (
            <IconButton
              color="inherit"
              aria-label="open drawer"
              edge="start"
              onClick={handleMobileMenuToggle}
              sx={{ mr: 2 }}
            >
              <MenuIcon />
            </IconButton>
          )}

          <Typography
            variant="h6"
            component="div"
            sx={{
              flexGrow: isMobile ? 1 : 0,
              mr: { xs: 0, md: 3 },
              fontWeight: 600,
              minWidth: 'fit-content',
            }}
          >
            Budget Tracker
          </Typography>

          {!isMobile && (
            <Box sx={{ flexGrow: 1, display: 'flex', ml: 2, minWidth: 0 }}>
              {renderNavigationButtons()}
            </Box>
          )}

          <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 'fit-content' }}>
            <NotificationBellSlot variant="header" onNavigate={() => navigate('notifications')} />
            {!isMobile && isDatabaseLoaded && (
              <IconButton
                color="inherit"
                onClick={() => setManageDataOpen(true)}
                sx={{ ml: 2 }}
                title="Manage Data"
              >
                <ManageDataIcon />
              </IconButton>
            )}
            {!isMobile && <AiLauncherSlot variant="header" />}
            {!isMobile && (
              <IconButton
                color="inherit"
                onClick={() => navigate(developerConsolePage.id)}
                sx={{ ml: 2 }}
                title={developerConsolePage.label}
                data-testid={developerConsolePage.testId}
              >
                <BugReport />
              </IconButton>
            )}
            {!isMobile && (
              <IconButton
                color="inherit"
                onClick={() => navigate(settingsPage.id)}
                sx={{ ml: 2 }}
                title={settingsPage.label}
                data-testid={settingsPage.testId}
              >
                <SettingsIcon />
              </IconButton>
            )}
          </Box>
        </Toolbar>
      </AppBar>

      {/* Mobile Navigation Drawer */}
      {isMobile && renderMobileDrawer()}

      {/* Page Content */}
      {pageContent}

      {/* Manage Data Dialog */}
      <ManageData
        open={manageDataOpen}
        onClose={() => setManageDataOpen(false)}
      />

      {/* Database Status Bar */}
      <DatabaseStatusBar
        status={workerStatus || {
          isWorkerAlive: false,
          isConnected: false,
          dbStatus: 'disconnected',
          version: '1.0.0',
          lastHeartbeat: 0
        }}
        syncStatus={syncStatus}
        onSyncNow={() => void syncNow()}
        onReconnectCloudSource={() => void reconnectCloudSource()}
        onResolveCloudConflict={() => navigate('settings')}
      />
    </Box>
  );
}
