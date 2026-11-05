'use client';

/**
 * Shown when the device holds an encryption header from a version before key
 * slots (a password-derived page key). This version cannot open it, so the
 * only way forward is to reset and either set up fresh or restore a backup
 * exported from a current version.
 */

import { useState } from 'react';

import { WarningAmber } from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Paper,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

interface LegacyDatabaseNoticeProps {
  onReset: () => Promise<void>;
}

export function LegacyDatabaseNotice({ onReset }: LegacyDatabaseNoticeProps) {
  const { t } = useTranslation(['setup', 'common']);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReset = async () => {
    setIsResetting(true);
    setError(null);
    try {
      await onReset();
    } catch (err) {
      setIsResetting(false);
      setError(err instanceof Error ? err.message : t('legacy.failed'));
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
      <Paper sx={{ p: 4, maxWidth: 480, width: '100%' }}>
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <WarningAmber sx={{ fontSize: 56, color: 'warning.main', mb: 1.5 }} />
          <Typography variant="h5" gutterBottom fontWeight="bold">
            {t('legacy.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('legacy.description')}
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Button
          variant="contained"
          color="error"
          fullWidth
          size="large"
          onClick={() => setConfirmOpen(true)}
          disabled={isResetting}
          data-testid="legacy-reset"
        >
          {t('legacy.reset')}
        </Button>

        <Dialog open={confirmOpen} onClose={() => !isResetting && setConfirmOpen(false)}>
          <DialogTitle>{t('legacy.confirmTitle')}</DialogTitle>
          <DialogContent>
            <DialogContentText>{t('legacy.confirmBody')}</DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmOpen(false)} disabled={isResetting}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              color="error"
              variant="contained"
              onClick={() => void handleReset()}
              disabled={isResetting}
              startIcon={isResetting ? <CircularProgress size={16} color="inherit" /> : undefined}
              data-testid="legacy-reset-confirm"
            >
              {isResetting ? t('legacy.resetting') : t('legacy.reset')}
            </Button>
          </DialogActions>
        </Dialog>
      </Paper>
    </Box>
  );
}
