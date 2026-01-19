'use client';

import React, { useState, useEffect } from 'react';
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

const StorageQuota: React.FC<StorageQuotaProps> = ({ variant = 'card' }) => {
  const [storageEstimate, setStorageEstimate] = useState<StorageEstimate | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const checkStorageQuota = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        setStorageEstimate(estimate);
      } else {
        setError('Storage API not supported');
      }
    } catch (err) {
      setError('Failed to get storage estimate');
      console.error('Storage quota error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkStorageQuota();
  }, []);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
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
        label="Storage: N/A"
        variant="outlined"
        size="small"
        color="default"
      />
    ) : (
      <Card>
        <CardContent>
          <Typography variant="body2" color="error">
            Storage quota unavailable
          </Typography>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return variant === 'compact' ? (
      <Chip
        icon={<Storage />}
        label="Loading..."
        variant="outlined"
        size="small"
        color="default"
      />
    ) : (
      <Card>
        <CardContent>
          <Typography variant="body2">
            Loading storage info...
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
                Used: {formatBytes(storageEstimate.usage)}
              </Typography>
              <Typography variant="body2">
                Available: {formatBytes(storageEstimate.quota)}
              </Typography>
            </Box>
          ) : (
            'Storage information'
          )
        }
      >
        <Chip
          icon={<Storage />}
          label={`Storage: ${usagePercentage.toFixed(0)}%`}
          variant="outlined"
          size="small"
          color={usageColor}
          onClick={checkStorageQuota}
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
              <Typography variant="h6">Storage Usage</Typography>
            </Box>
            <Tooltip title="Refresh storage info">
              <IconButton size="small" onClick={checkStorageQuota} disabled={isLoading}>
                <Refresh />
              </IconButton>
            </Tooltip>
          </Box>

          {storageEstimate?.quota && storageEstimate?.usage ? (
            <>
              <Box>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                  <Typography variant="body2" color="text.secondary">
                    {usagePercentage.toFixed(1)}% used
                  </Typography>
                  <Box display="flex" alignItems="center" gap={0.5}>
                    {usageIcon}
                    <Typography variant="body2" color={`${usageColor}.main`}>
                      {formatBytes(storageEstimate.usage)} / {formatBytes(storageEstimate.quota)}
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
                    IndexedDB: {formatBytes(storageEstimate.usageDetails.indexedDB)}
                  </Typography>
                </Box>
              )}

              {usagePercentage > 80 && (
                <Box>
                  <Typography variant="body2" color="warning.main">
                    ⚠️ Storage is running low. Consider exporting and backing up your data.
                  </Typography>
                </Box>
              )}
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Storage information not available
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
};

export default StorageQuota;
