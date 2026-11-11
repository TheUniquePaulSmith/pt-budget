'use client';

import React, { type ReactNode } from 'react';

import { Cloud, Computer, Storage } from '@mui/icons-material';
import { Alert, Box, ButtonBase, Paper, Stack, Tooltip, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

import OfflineFeatureNotice from '@/components/common/Offline/OfflineFeatureNotice';
import { useOnlineStatus } from '@/components/common/Offline/useOnlineStatus';
import { createCloudProviderClient } from '@/lib/cloudProviderClients';
import type { CloudProvider } from '@/lib/databaseSourceStorage';

interface StorageChoiceProps {
  onChoiceSelected: (choice: 'local' | CloudProvider) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

interface StorageOption {
  id: 'local' | CloudProvider;
  icon: ReactNode;
}

/** The storage targets in display order; labels and descriptions resolve through `t` at render time. */
const OPTIONS: StorageOption[] = [
  { id: 'local', icon: <Computer sx={{ fontSize: 40 }} /> },
  { id: 'gdrive', icon: <Cloud sx={{ fontSize: 40 }} /> },
  { id: 'onedrive', icon: <Storage sx={{ fontSize: 40 }} /> },
];

export function StorageChoice({ onChoiceSelected, isLoading, error }: StorageChoiceProps) {
  const { t } = useTranslation('setup');
  const googleConfigured = createCloudProviderClient('gdrive').isConfigured();
  const oneDriveConfigured = createCloudProviderClient('onedrive').isConfigured();

  const online = useOnlineStatus();
  const isOptionConfigured = (id: StorageOption['id']): boolean => {
    if (id === 'local') return true;
    return id === 'gdrive' ? googleConfigured : oneDriveConfigured;
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 2,
      }}
    >
      <Paper sx={{ p: 4, maxWidth: 640, width: '100%', textAlign: 'center' }}>
        <Typography variant="h5" gutterBottom fontWeight="bold">
          {t('storageChoice.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t('storageChoice.description')}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 3, textAlign: 'left' }}>
            {error}
          </Alert>
        )}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          {OPTIONS.map((option) => {
            const configured = isOptionConfigured(option.id);
            const label = t(`storageChoice.${option.id}Label`);

            return (
              <Tooltip
                key={option.id}
                title={configured ? '' : t('storageChoice.notConfigured', { provider: label })}
              >
                <Box component="span" sx={{ display: 'flex', flex: 1 }}>
                  <ButtonBase
                    onClick={() => void onChoiceSelected(option.id)}
                    disabled={isLoading || !configured || (option.id !== 'local' && !online)}
                    data-testid={`storage-choice-${option.id}`}
                    sx={{
                      flex: 1,
                      p: 3,
                      borderRadius: 2,
                      border: '1px solid',
                      borderColor: 'divider',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 1,
                      textAlign: 'center',
                      color: 'primary.main',
                      '&:hover': {
                        borderColor: 'primary.main',
                        backgroundColor: 'action.hover',
                      },
                      '&.Mui-disabled': {
                        opacity: 0.6,
                      },
                    }}
                  >
                    {option.icon}
                    <Typography variant="subtitle1" fontWeight="bold" color="text.primary">
                      {label}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t(`storageChoice.${option.id}Description`)}
                    </Typography>
                  </ButtonBase>
                </Box>
              </Tooltip>
            );
          })}
        </Stack>
        <OfflineFeatureNotice feature="cloudOpen" sx={{ mt: 3, textAlign: 'left' }} />
      </Paper>
    </Box>
  );
}
