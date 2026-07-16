'use client';

import React, { type ReactNode } from 'react';

import { Cloud, Computer, Storage } from '@mui/icons-material';
import { Alert, Box, ButtonBase, Paper, Stack, Tooltip, Typography } from '@mui/material';

import { createCloudProviderClient } from '@/lib/cloudProviderClients';
import type { CloudProvider } from '@/lib/databaseSourceStorage';

interface StorageChoiceProps {
  onChoiceSelected: (choice: 'local' | CloudProvider) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

interface StorageOption {
  id: 'local' | CloudProvider;
  label: string;
  description: string;
  icon: ReactNode;
}

const OPTIONS: StorageOption[] = [
  {
    id: 'local',
    label: 'Keep Local',
    description: 'Stored only on this device.',
    icon: <Computer sx={{ fontSize: 40 }} />,
  },
  {
    id: 'gdrive',
    label: 'Google Drive',
    description: 'Automatically synced to your Google Drive.',
    icon: <Cloud sx={{ fontSize: 40 }} />,
  },
  {
    id: 'onedrive',
    label: 'OneDrive',
    description: 'Automatically synced to your OneDrive.',
    icon: <Storage sx={{ fontSize: 40 }} />,
  },
];

export function StorageChoice({ onChoiceSelected, isLoading, error }: StorageChoiceProps) {
  const googleConfigured = createCloudProviderClient('gdrive').isConfigured();
  const oneDriveConfigured = createCloudProviderClient('onedrive').isConfigured();

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
          Where should this database live?
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          You can change this later in Settings.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 3, textAlign: 'left' }}>
            {error}
          </Alert>
        )}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          {OPTIONS.map((option) => {
            const configured = isOptionConfigured(option.id);

            return (
              <Tooltip
                key={option.id}
                title={configured ? '' : `${option.label} is not configured for this deployment.`}
              >
                <Box component="span" sx={{ display: 'flex', flex: 1 }}>
                  <ButtonBase
                    onClick={() => void onChoiceSelected(option.id)}
                    disabled={isLoading || !configured}
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
                      {option.label}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {option.description}
                    </Typography>
                  </ButtonBase>
                </Box>
              </Tooltip>
            );
          })}
        </Stack>
      </Paper>
    </Box>
  );
}
