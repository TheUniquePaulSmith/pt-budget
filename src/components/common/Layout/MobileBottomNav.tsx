'use client';

/**
 * Phone navigation: a bottom bar with the first four `mobileNav` registry
 * pages and a "More" action that opens a bottom sheet listing every other
 * page plus Manage Data, the AI panel, the Developer Console and Settings.
 * Every page control carries `data-testid={page.testId}`.
 */

import React from 'react';
import {
  BottomNavigation,
  BottomNavigationAction,
  Box,
  Divider,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  SwipeableDrawer,
  Typography,
} from '@mui/material';
import {
  Add as AddTransactionIcon,
  MoreHoriz as MoreIcon,
  Storage as ManageDataIcon,
  Upload as ImportCsvIcon,
} from '@mui/icons-material';

import AiLauncherSlot from './slots/AiLauncherSlot';
import NotificationBellSlot from './slots/NotificationBellSlot';
import { useTranslation } from 'react-i18next';

import { getPageLabel, type PageDefinition, type PageId } from './pageRegistry';
import { BOTTOM_NAV_HEIGHT } from './sidebarPreference';

export const MOBILE_BOTTOM_NAV_SLOTS = 4;

export interface MobileBottomNavProps {
  /** Pages in the bar (at most `MOBILE_BOTTOM_NAV_SLOTS`). */
  barPages: PageDefinition[];
  /** Pages listed in the More sheet. */
  morePages: PageDefinition[];
  currentPage: PageId;
  moreOpen: boolean;
  onMoreOpenChange: (open: boolean) => void;
  onNavigate: (page: PageId) => void;
  onOpenManageData: () => void;
  onAddTransaction: () => void;
  onImportCsv: () => void;
  settingsPage: PageDefinition;
  developerConsolePage: PageDefinition;
}

export default function MobileBottomNav({
  barPages,
  morePages,
  currentPage,
  moreOpen,
  onMoreOpenChange,
  onNavigate,
  onOpenManageData,
  onAddTransaction,
  onImportCsv,
  settingsPage,
  developerConsolePage,
}: MobileBottomNavProps) {
  const { t } = useTranslation('shell');
  const barHasCurrent = barPages.some((page) => page.id === currentPage);
  const closeSheet = () => onMoreOpenChange(false);

  return (
    <>
      <Paper
        elevation={3}
        square
        data-testid="mobile-bottom-nav"
        sx={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: (theme) => theme.zIndex.appBar,
          borderTop: 1,
          borderColor: 'divider',
        }}
      >
        <BottomNavigation
          component="nav"
          aria-label={t('nav.pages')}
          showLabels
          value={barHasCurrent ? currentPage : moreOpen ? 'more' : false}
          sx={{ height: BOTTOM_NAV_HEIGHT, '& .MuiBottomNavigationAction-root': { minWidth: 0, px: 0.5 } }}
        >
          {barPages.map((page) => {
            const Icon = page.icon;
            return (
              <BottomNavigationAction
                key={page.id}
                value={page.id}
                label={getPageLabel(page, t)}
                icon={<Icon />}
                aria-label={getPageLabel(page, t)}
                aria-current={currentPage === page.id ? 'page' : undefined}
                data-testid={page.testId}
                onClick={() => onNavigate(page.id)}
              />
            );
          })}
          <BottomNavigationAction
            value="more"
            label={t('nav.more')}
            icon={<MoreIcon />}
            aria-label={t('nav.more')}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            data-testid="nav-more"
            onClick={() => onMoreOpenChange(true)}
          />
        </BottomNavigation>
      </Paper>

      <SwipeableDrawer
        anchor="bottom"
        open={moreOpen}
        onOpen={() => onMoreOpenChange(true)}
        onClose={closeSheet}
        disableSwipeToOpen
        slotProps={{ paper: { sx: { borderTopLeftRadius: 12, borderTopRightRadius: 12, maxHeight: '80vh' } } }}
      >
        <Box sx={{ pt: 1, pb: 2 }} data-testid="mobile-more-sheet">
          <Box sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: 'divider', mx: 'auto', mb: 1 }} />
          <Typography variant="overline" color="text.secondary" sx={{ px: 2 }}>
            {t('nav.more')}
          </Typography>
          <List dense>
            <ListItem disablePadding>
              <ListItemButton
                onClick={() => {
                  closeSheet();
                  onAddTransaction();
                }}
                data-testid="mobile-add-transaction"
              >
                <ListItemIcon>
                  <AddTransactionIcon />
                </ListItemIcon>
                <ListItemText primary={t('nav.addTransaction')} />
              </ListItemButton>
            </ListItem>
            <ListItem disablePadding>
              <ListItemButton
                onClick={() => {
                  closeSheet();
                  onImportCsv();
                }}
                data-testid="mobile-import-csv"
              >
                <ListItemIcon>
                  <ImportCsvIcon />
                </ListItemIcon>
                <ListItemText primary={t('nav.importCsv')} />
              </ListItemButton>
            </ListItem>
          </List>
          <Divider />
          <List dense>
            {morePages.map((page) => {
              const Icon = page.icon;
              return (
                <ListItem key={page.id} disablePadding>
                  <ListItemButton
                    selected={currentPage === page.id}
                    aria-current={currentPage === page.id ? 'page' : undefined}
                    data-testid={page.testId}
                    onClick={() => onNavigate(page.id)}
                  >
                    <ListItemIcon>
                      <Icon />
                    </ListItemIcon>
                    <ListItemText primary={getPageLabel(page, t)} />
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
          <Divider />
          <List dense>
            <NotificationBellSlot variant="menuItem" onNavigate={() => onNavigate('notifications')} />
            <AiLauncherSlot variant="menuItem" onActivate={closeSheet} />
            <ListItem disablePadding>
              <ListItemButton
                onClick={() => {
                  closeSheet();
                  onOpenManageData();
                }}
                data-testid="mobile-manage-data"
              >
                <ListItemIcon>
                  <ManageDataIcon />
                </ListItemIcon>
                <ListItemText primary={t('nav.manageData')} />
              </ListItemButton>
            </ListItem>
            <ListItem disablePadding>
              <ListItemButton onClick={() => onNavigate(developerConsolePage.id)} data-testid={developerConsolePage.testId}>
                <ListItemIcon>
                  <developerConsolePage.icon />
                </ListItemIcon>
                <ListItemText primary={getPageLabel(developerConsolePage, t)} />
              </ListItemButton>
            </ListItem>
            <ListItem disablePadding>
              <ListItemButton onClick={() => onNavigate(settingsPage.id)} data-testid={settingsPage.testId}>
                <ListItemIcon>
                  <settingsPage.icon />
                </ListItemIcon>
                <ListItemText primary={getPageLabel(settingsPage, t)} />
              </ListItemButton>
            </ListItem>
          </List>
        </Box>
      </SwipeableDrawer>
    </>
  );
}
