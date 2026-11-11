'use client';

/**
 * The Import page: a full-screen page (like Settings) with its own header and
 * two views, the guided import and "History & formats".
 *
 * This file is the seam between the two: it owns the header, the view switch
 * and the leave guard, and nothing else. The wizard lives in ./wizard, the
 * history and saved-formats screens in ./manage; each view only fills its own
 * folder and reaches the other through the props below.
 */

import React, { useCallback, useRef, useState } from 'react';
import { AppBar, Box, IconButton, Tab, Tabs, Toolbar, Typography } from '@mui/material';
import { ArrowBack } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import ImportManage from './manage/ImportManage';
import ImportWizard from './wizard/ImportWizard';

export type ImportView = 'wizard' | 'manage';

/**
 * Asked before the page closes or switches view. The wizard registers one
 * while a file is loaded: it shows its own "Discard this import?" dialog and
 * resolves true to leave, false to stay.
 */
export type ImportLeaveGuard = () => Promise<boolean>;

export interface ImportWizardProps {
  /** Leaves the Import page (the guard has already been answered when the wizard calls this itself). */
  onClose: () => void;
  /** Opens the Transactions page, after a finished import. */
  onViewTransactions: () => void;
  /** Switches to "History & formats" (for example to undo the import just made). */
  onOpenHistory: () => void;
  /** Registers the guard, or clears it with null when there is nothing to lose. */
  setLeaveGuard: (guard: ImportLeaveGuard | null) => void;
}

export interface ImportManageProps {
  /** Switches back to the guided import. */
  onStartImport: () => void;
}

interface ImportPageProps {
  onClose: () => void;
  onViewTransactions: () => void;
}

export default function ImportPage({ onClose, onViewTransactions }: ImportPageProps) {
  const { t } = useTranslation('importWizard');
  const [view, setView] = useState<ImportView>('wizard');
  const leaveGuardRef = useRef<ImportLeaveGuard | null>(null);

  const setLeaveGuard = useCallback((guard: ImportLeaveGuard | null) => {
    leaveGuardRef.current = guard;
  }, []);

  const mayLeave = useCallback(async () => {
    const guard = leaveGuardRef.current;
    return guard ? guard() : true;
  }, []);

  const handleClose = useCallback(async () => {
    if (await mayLeave()) onClose();
  }, [mayLeave, onClose]);

  const handleViewChange = useCallback(
    async (next: ImportView) => {
      if (next === view) return;
      // Only the wizard holds unsaved work.
      if (view === 'wizard' && !(await mayLeave())) return;
      leaveGuardRef.current = null;
      setView(next);
    },
    [mayLeave, view]
  );

  return (
    <Box data-testid="import-page" sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="sticky" color="default" elevation={1}>
        {/* On a phone the two tabs take a row of their own, so the title keeps its width. */}
        <Toolbar sx={{ columnGap: 1, rowGap: 0, flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
          <IconButton edge="start" onClick={() => void handleClose()} aria-label={t('page.close')} data-testid="import-close">
            <ArrowBack />
          </IconButton>
          <Typography variant="h6" component="h1" noWrap sx={{ flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
            {t('page.title')}
          </Typography>
          <Tabs
            value={view}
            onChange={(_, next) => void handleViewChange(next as ImportView)}
            aria-label={t('page.views')}
            sx={{
              flexShrink: 0,
              minHeight: 0,
              width: { xs: '100%', sm: 'auto' },
              '& .MuiTab-root': { flexGrow: { xs: 1, sm: 0 }, maxWidth: { xs: 'none', sm: 360 } },
            }}
          >
            <Tab value="wizard" label={t('page.viewWizard')} data-testid="import-view-wizard" />
            <Tab value="manage" label={t('page.viewManage')} data-testid="import-view-manage" />
          </Tabs>
        </Toolbar>
      </AppBar>

      <Box component="main" sx={{ maxWidth: 1200, mx: 'auto', p: { xs: 1, sm: 3 } }}>
        {view === 'wizard' ? (
          <ImportWizard
            onClose={onClose}
            onViewTransactions={onViewTransactions}
            onOpenHistory={() => void handleViewChange('manage')}
            setLeaveGuard={setLeaveGuard}
          />
        ) : (
          <ImportManage onStartImport={() => void handleViewChange('wizard')} />
        )}
      </Box>
    </Box>
  );
}
