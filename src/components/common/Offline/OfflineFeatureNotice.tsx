'use client';

/**
 * Shown in place of (or above) a feature that needs the internet while the
 * browser reports no connection: what is unavailable, and that it comes back
 * by itself once the connection does. Renders nothing while online.
 */

import { CloudOff } from '@mui/icons-material';
import { Alert, type SxProps, type Theme } from '@mui/material';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { useOnlineStatus } from './useOnlineStatus';

export type OfflineFeature = 'cloudSync' | 'cloudOpen' | 'cloudAi';

export default function OfflineFeatureNotice({ feature, sx }: { feature: OfflineFeature; sx?: SxProps<Theme> }) {
  const { t } = useTranslation('shell');
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <Alert severity="info" icon={<CloudOff fontSize="inherit" />} sx={sx} data-testid={`offline-feature-${feature}`}>
      {t(`network.feature.${feature}`)}
    </Alert>
  );
}
