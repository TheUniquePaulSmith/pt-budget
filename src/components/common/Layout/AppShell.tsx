'use client';

/**
 * The application shell: a permanent mini-variant navigation rail and a slim
 * app bar on desktop, a bottom navigation bar with a "More" sheet on phones.
 * See the invariants listed atop `AppContent.tsx`; this file is where they
 * are honoured.
 */

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { AppBar, Box, IconButton, Toolbar, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material';
import { Settings as SettingsIcon } from '@mui/icons-material';

import ManageData from '@/components/data-management/ManageData';
import DatabaseStatusBar from '@/components/common/StatusBar/DatabaseStatusBar';
import NotificationsRuntime from '@/components/notifications/NotificationsRuntime';
import { useAppShellSlice } from '@/contexts/useDatabaseSlices';
import AiLauncherSlot from './slots/AiLauncherSlot';
import NotificationBellSlot from './slots/NotificationBellSlot';
import MobileBottomNav, { MOBILE_BOTTOM_NAV_SLOTS } from './MobileBottomNav';
import PageFallback from './PageFallback';
import SidebarRail from './SidebarRail';
import {
  DEFAULT_PAGE_ID,
  getMobileNavigationPages,
  getNavigationPages,
  getPage,
  type PageId,
} from './pageRegistry';
import {
  APP_BAR_HEIGHT,
  BOTTOM_NAV_HEIGHT,
  RAIL_WIDTH_COLLAPSED,
  RAIL_WIDTH_EXPANDED,
  STATUS_BAR_HEIGHT,
  readStoredSidebarExpanded,
  writeStoredSidebarExpanded,
} from './sidebarPreference';

export default function AppShell() {
  const {
    isDatabaseLoaded,
    workerStatus,
    syncStatus,
    syncNow,
    reconnectCloudSource,
  } = useAppShellSlice();
  const [currentPage, setCurrentPage] = useState<PageId>(DEFAULT_PAGE_ID);
  const [moreOpen, setMoreOpen] = useState(false);
  const [manageDataOpen, setManageDataOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState<boolean>(readStoredSidebarExpanded);
  // The page that was showing before a full-screen page (settings / developer
  // console) opened, so `goBack` returns there.
  const previousPageRef = useRef<PageId>(DEFAULT_PAGE_ID);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const navigationPages = getNavigationPages();
  const mobileCandidates = getMobileNavigationPages();
  const barPages = mobileCandidates.slice(0, MOBILE_BOTTOM_NAV_SLOTS);
  const morePages = navigationPages.filter((page) => !barPages.includes(page));
  const settingsPage = getPage('settings');
  const developerConsolePage = getPage('developer-console');

  useEffect(() => {
    writeStoredSidebarExpanded(sidebarExpanded);
  }, [sidebarExpanded]);

  const navigate = useCallback((page: PageId) => {
    setCurrentPage((current) => {
      if (getPage(page).fullScreen && !getPage(current).fullScreen) {
        previousPageRef.current = current;
      }
      return page;
    });
    setMoreOpen(false);
  }, []);

  const goBack = useCallback(() => {
    setCurrentPage(previousPageRef.current);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarExpanded((expanded) => !expanded);
  }, []);

  // The provider owns initialization screens, so the shell only renders once data is ready.
  if (!isDatabaseLoaded) {
    return null;
  }

  const page = getPage(currentPage);
  const pageContent = (
    <Suspense fallback={<PageFallback />}>{page.render({ navigate, goBack })}</Suspense>
  );

  const railWidth = sidebarExpanded ? RAIL_WIDTH_EXPANDED : RAIL_WIDTH_COLLAPSED;
  const bottomInset = isMobile ? BOTTOM_NAV_HEIGHT + STATUS_BAR_HEIGHT : STATUS_BAR_HEIGHT;

  // The headless notifications runtime sits at one fixed position in the
  // tree, outside both page branches, so navigating to a full-screen page
  // (settings, developer console) never remounts it and re-runs its scans.
  return (
    <>
      <NotificationsRuntime />
      {page.fullScreen ? (
        pageContent
      ) : (
        <Box
          data-testid="app-shell"
          data-sidebar-expanded={isMobile ? undefined : String(sidebarExpanded)}
          sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default', maxWidth: '100vw', overflowX: 'clip' }}
        >
          {!isMobile && (
            <SidebarRail
              pages={navigationPages}
              currentPage={currentPage}
              expanded={sidebarExpanded}
              onToggleExpanded={toggleSidebar}
              onNavigate={navigate}
              onOpenManageData={() => setManageDataOpen(true)}
              developerConsolePage={developerConsolePage}
            />
          )}

          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <AppBar
              position="sticky"
              color="default"
              elevation={0}
              sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}
            >
              <Toolbar variant="dense" sx={{ minHeight: APP_BAR_HEIGHT, px: { xs: 1.5, md: 2 } }}>
                {/* Not a heading: pages own their own h1/h4 and the e2e suite asserts on those. */}
                <Typography
                  variant="subtitle1"
                  component="div"
                  noWrap
                  data-testid="app-bar-title"
                  sx={{ fontWeight: 600, flexGrow: 1, minWidth: 0 }}
                >
                  {page.label}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                  <NotificationBellSlot variant="header" onNavigate={() => navigate('notifications')} />
                  <AiLauncherSlot variant="header" />
                  {!isMobile && (
                    <Tooltip title={settingsPage.label}>
                      <IconButton
                        color="inherit"
                        onClick={() => navigate(settingsPage.id)}
                        sx={{ ml: 2 }}
                        aria-label={settingsPage.label}
                        data-testid={settingsPage.testId}
                      >
                        <SettingsIcon />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              </Toolbar>
            </AppBar>

            <Box component="main" sx={{ flex: 1, minWidth: 0, pb: `${bottomInset + 8}px` }}>
              {pageContent}
            </Box>
          </Box>

          {isMobile && (
            <MobileBottomNav
              barPages={barPages}
              morePages={morePages}
              currentPage={currentPage}
              moreOpen={moreOpen}
              onMoreOpenChange={setMoreOpen}
              onNavigate={navigate}
              onOpenManageData={() => setManageDataOpen(true)}
              settingsPage={settingsPage}
              developerConsolePage={developerConsolePage}
            />
          )}

          <ManageData open={manageDataOpen} onClose={() => setManageDataOpen(false)} />

          {/* The status bar is fixed to the viewport bottom; on desktop it starts
              after the rail, on phones it sits above the bottom navigation. */}
          <Box
            data-testid="status-bar-dock"
            sx={{
              '& > .MuiPaper-root': {
                left: isMobile ? 0 : railWidth,
                bottom: isMobile ? BOTTOM_NAV_HEIGHT : 0,
                transition: theme.transitions.create('left', {
                  easing: theme.transitions.easing.sharp,
                  duration: theme.transitions.duration.shorter,
                }),
              },
            }}
          >
            <DatabaseStatusBar
              status={
                workerStatus || {
                  isWorkerAlive: false,
                  isConnected: false,
                  dbStatus: 'disconnected',
                  version: '1.0.0',
                  lastHeartbeat: 0,
                }
              }
              syncStatus={syncStatus}
              onSyncNow={() => void syncNow()}
              onReconnectCloudSource={() => void reconnectCloudSource()}
              onResolveCloudConflict={() => navigate('settings')}
            />
          </Box>
        </Box>
      )}
    </>
  );
}
