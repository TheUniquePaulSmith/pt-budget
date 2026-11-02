'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  LinearProgress,
  Stack,
  Chip,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Storage,
  Refresh,
  Warning,
  CheckCircle,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';

interface StorageQuotaProps {
  variant?: 'card' | 'compact';
}

interface StorageEstimate {
  quota?: number;
  usage?: number;
  usageDetails?: {
    indexedDB?: number;
    webSQL?: number;
    caches?: number;
    serviceWorkerRegistrations?: number;
  };
}

type StorageError = 'unsupported' | 'failed';

const StorageQuota: React.FC<StorageQuotaProps> = ({ variant = 'card' }) => {
  const { t } = useTranslation('shell');
  const { number, percent } = useFormatters();
  const [storageEstimate, setStorageEstimate] = useState<StorageEstimate | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<StorageError | null>(null);

  const checkStorageQuota = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        setStorageEstimate(estimate);
      } else {
        setError('unsupported');
      }
    } catch (err) {
      setError('failed');
      console.error('Storage quota error:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkStorageQuota();
  }, [checkStorageQuota]);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return t('storageQuota.bytes', { value: number(0) });
    const k = 1024;
    const units = ['storageQuota.bytes', 'storageQuota.kilobytes', 'storageQuota.megabytes', 'storageQuota.gigabytes'] as const;
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
    const value = number(parseFloat((bytes / Math.pow(k, i)).toFixed(1)), { maximumFractionDigits: 1 });
    return t(units[i], { value });
  };

  const getUsagePercentage = (): number => {
    if (!storageEstimate?.quota || !storageEstimate?.usage) return 0;
    return (storageEstimate.usage / storageEstimate.quota) * 100;
  };

  const getUsageColor = (percentage: number): 'success' | 'warning' | 'error' => {
    if (percentage < 50) return 'success';
    if (percentage < 80) return 'warning';
    return 'error';
  };

  const getUsageIcon = (percentage: number) => {
    if (percentage < 80) return <CheckCircle />;
    return <Warning />;
  };

  if (error) {
    return variant === 'compact' ? (
      <Chip
        icon={<Storage />}
        label={t('storageQuota.unavailableChip')}
        variant="outlined"
        size="small"
        color="default"
      />
    ) : (
      <Card>
        <CardContent>
          <Typography variant="body2" color="error">
            {t('storageQuota.unavailable')}
          </Typography>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return variant === 'compact' ? (
      <Chip
        icon={<Storage />}
        label={t('storageQuota.loadingChip')}
        variant="outlined"
        size="small"
        color="default"
      />
    ) : (
      <Card>
        <CardContent>
          <Typography variant="body2">
            {t('storageQuota.loading')}
          </Typography>
        </CardContent>
      </Card>
    );
  }

  const usagePercentage = getUsagePercentage();
  const usageColor = getUsageColor(usagePercentage);
  const usageIcon = getUsageIcon(usagePercentage);

  if (variant === 'compact') {
    return (
      <Tooltip
        title={
          storageEstimate?.quota && storageEstimate?.usage ? (
            <Box>
              <Typography variant="body2">
                {t('storageQuota.used', { size: formatBytes(storageEstimate.usage) })}
              </Typography>
              <Typography variant="body2">
                {t('storageQuota.available', { size: formatBytes(storageEstimate.quota) })}
              </Typography>
            </Box>
          ) : (
            t('storageQuota.information')
          )
        }
      >
        <Chip
          icon={<Storage />}
          label={t('storageQuota.usageChip', { percent: percent(usagePercentage, { fromPercent: true, maximumFractionDigits: 0 }) })}
          variant="outlined"
          size="small"
          color={usageColor}
          onClick={() => void checkStorageQuota()}
        />
      </Tooltip>
    );
  }

  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Box display="flex" alignItems="center" gap={1}>
              <Storage color="primary" />
              <Typography variant="h6">{t('storageQuota.title')}</Typography>
            </Box>
            <Tooltip title={t('storageQuota.refresh')}>
              <IconButton size="small" onClick={() => void checkStorageQuota()} disabled={isLoading}>
                <Refresh />
              </IconButton>
            </Tooltip>
          </Box>

          {storageEstimate?.quota && storageEstimate?.usage ? (
            <>
              <Box>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                  <Typography variant="body2" color="text.secondary">
                    {t('storageQuota.percentUsed', {
                      percent: percent(usagePercentage, { fromPercent: true, minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                    })}
                  </Typography>
                  <Box display="flex" alignItems="center" gap={0.5}>
                    {usageIcon}
                    <Typography variant="body2" color={`${usageColor}.main`}>
                      {t('storageQuota.usageOfQuota', {
                        usage: formatBytes(storageEstimate.usage),
                        quota: formatBytes(storageEstimate.quota),
                      })}
                    </Typography>
                  </Box>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={usagePercentage}
                  color={usageColor}
                  sx={{ height: 8, borderRadius: 1 }}
                />
              </Box>

              {storageEstimate.usageDetails?.indexedDB && (
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    {t('storageQuota.indexedDb', { size: formatBytes(storageEstimate.usageDetails.indexedDB) })}
                  </Typography>
                </Box>
              )}

              {usagePercentage > 80 && (
                <Box>
                  <Typography variant="body2" color="warning.main">
                    {t('storageQuota.runningLow')}
                  </Typography>
                </Box>
              )}
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t('storageQuota.notAvailable')}
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
};

export default StorageQuota;
