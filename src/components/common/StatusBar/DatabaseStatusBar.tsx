import React, { useState, useRef, useEffect } from 'react';
import {
  Box,
  Typography,
  Chip,
  Tooltip,
  Paper,
} from '@mui/material';
import {
  Circle,
  Warning,
  CloudDone,
  CloudQueue,
  CloudSync,
  CloudOff,
} from '@mui/icons-material';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { databaseWorkerService, WorkerStatus } from '@/lib/databaseWorkerService';
import { useFormatters } from '@/contexts/useFormatters';
import type { AutoSyncSnapshot } from '@/lib/cloudAutoSyncScheduler';

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || 'dev';

interface DatabaseStatusBarProps {
  status: WorkerStatus;
  syncStatus?: AutoSyncSnapshot;
  onSyncNow?: () => void;
  onReconnectCloudSource?: () => void;
  onResolveCloudConflict?: () => void;
}

interface SyncChipConfig {
  label: string;
  icon: React.ReactElement;
  color: string;
  onClick?: () => void;
}

function getSyncChipConfig(
  syncStatus: AutoSyncSnapshot,
  handlers: { onSyncNow?: () => void; onReconnect?: () => void; onResolveConflict?: () => void },
  t: TFunction<'shell'>
): SyncChipConfig | null {
  switch (syncStatus.state) {
    case 'idle':
      return { label: t('statusBar.synced'), icon: <CloudDone fontSize="small" />, color: '#4caf50' };
    case 'pending':
      return { label: t('statusBar.pendingChanges'), icon: <CloudQueue fontSize="small" />, color: '#ff9800' };
    case 'syncing':
      return { label: t('statusBar.syncing'), icon: <CloudSync fontSize="small" />, color: '#2196f3' };
    case 'paused-auth':
      return {
        label: t('statusBar.reconnect'),
        icon: <CloudOff fontSize="small" />,
        color: '#f44336',
        onClick: handlers.onReconnect,
      };
    case 'paused-conflict':
      return {
        label: t('statusBar.resolveConflict'),
        icon: <Warning fontSize="small" />,
        color: '#f44336',
        onClick: handlers.onResolveConflict,
      };
    case 'offline':
      return { label: t('statusBar.offline'), icon: <CloudOff fontSize="small" />, color: '#9e9e9e' };
    case 'error':
      return {
        label: t('statusBar.syncError'),
        icon: <Warning fontSize="small" />,
        color: '#f44336',
        onClick: handlers.onSyncNow,
      };
    case 'disabled':
    default:
      return null;
  }
}

function getSyncTooltipText(
  syncStatus: AutoSyncSnapshot,
  t: TFunction<'shell'>,
  dateTime: (value: string | number | Date) => string
): string {
  const lines: string[] = [];
  if (syncStatus.lastSyncAt) {
    lines.push(t('statusBar.lastSynced', { time: dateTime(syncStatus.lastSyncAt) }));
  }
  if (syncStatus.pendingSince) {
    lines.push(t('statusBar.unsyncedSince', { time: dateTime(syncStatus.pendingSince) }));
  }
  if (syncStatus.lastError) {
    lines.push(t('statusBar.lastError', { error: syncStatus.lastError }));
  }
  return lines.join('\n') || t('statusBar.cloudSyncStatus');
}

const DatabaseStatusBar: React.FC<DatabaseStatusBarProps> = ({
  status,
  syncStatus,
  onSyncNow,
  onReconnectCloudSource,
  onResolveCloudConflict,
}) => {
  const { t } = useTranslation('shell');
  const { dateTime } = useFormatters();
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const getStatusColor = () => {
    if (!status.isWorkerAlive) return '#9e9e9e'; // Gray for disconnected worker
    if (status.dbStatus === 'connected') return '#4caf50'; // Green for connected
    if (status.dbStatus === 'initialized') return '#ff9800'; // Orange for initialized but not connected
    if (status.dbStatus === 'error') return '#f44336'; // Red for error
    return '#9e9e9e'; // Gray for unknown
  };

  const getTooltipText = () => {
    const timeSinceHeartbeat = status.lastHeartbeat
      ? Math.max(0, currentTime - status.lastHeartbeat)
      : 0;
    const heartbeatText = status.lastHeartbeat
      ? t('statusBar.heartbeat', { seconds: Math.floor(timeSinceHeartbeat / 1000) })
      : t('statusBar.noHeartbeat');

    return t('statusBar.tooltip', {
      version: APP_VERSION,
      worker: status.isWorkerAlive ? t('statusBar.workerAlive') : t('statusBar.workerDead'),
      status: status.dbStatus,
      heartbeat: heartbeatText,
    });
  };

  const syncChipConfig = syncStatus
    ? getSyncChipConfig(
        syncStatus,
        {
          onSyncNow,
          onReconnect: onReconnectCloudSource,
          onResolveConflict: onResolveCloudConflict,
        },
        t
      )
    : null;

  // Keep currentTime in sync with the freshest heartbeat immediately, rather than
  // waiting for the next 1s interval tick — otherwise a heartbeat received just
  // after mount/open can be newer than the last-known currentTime, producing a
  // negative (and floor-rounded to -1) "seconds ago" reading.
  useEffect(() => {
    setCurrentTime(Date.now());
  }, [status.lastHeartbeat]);

  useEffect(() => {
    if (tooltipOpen) {
      setCurrentTime(Date.now());
      intervalRef.current = setInterval(() => {
        setCurrentTime(Date.now());
      }, 1000);
    } else if(intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [tooltipOpen]);


  return (
    <Paper
      elevation={1}
      sx={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        backgroundColor: 'background.default',
        borderRadius: 0,
        borderTop: '1px solid',
        borderColor: 'divider',
        py: 0.5,
        px: 2
      }}
    >
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: 32
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {/* Empty box to align status bar to right */}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {syncChipConfig && (
            <Tooltip
              title={syncStatus ? getSyncTooltipText(syncStatus, t, dateTime) : ''}
              arrow
              componentsProps={{
                tooltip: {
                  sx: { whiteSpace: 'pre-line', wordBreak: 'break-word' },
                },
              }}
            >
              <Chip
                data-testid="cloud-sync-chip"
                icon={syncChipConfig.icon}
                label={syncChipConfig.label}
                size="small"
                onClick={syncChipConfig.onClick}
                clickable={Boolean(syncChipConfig.onClick)}
                sx={{
                  backgroundColor: syncChipConfig.color,
                  color: 'white',
                  '& .MuiChip-icon': {
                    color: 'white',
                  },
                  fontSize: '0.75rem',
                  height: 24,
                }}
              />
            </Tooltip>
          )}
          <Typography variant="caption" color="text.secondary">
            v{APP_VERSION}
          </Typography>
            <Box
              sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
              data-testid="database-status"
            >
              <Circle
                sx={{
                  fontSize: 8,
                  color: getStatusColor(),
                  animation: status.dbStatus === 'connected' ? 'pulse 2s infinite' : 'none',
                  '@keyframes pulse': {
                    '0%': { opacity: 1 },
                    '50%': { opacity: 0.5 },
                    '100%': { opacity: 1 },
                  }
                }} />
              <Tooltip
              title={getTooltipText()}
              arrow
              onOpen={() => setTooltipOpen(true)}
              onClose={() => setTooltipOpen(false)}
              componentsProps={{
                tooltip: {
                  sx: {
                    whiteSpace: 'pre-line',
                    wordBreak: 'break-word',
                  },
                },
              }}
              >
                <Typography
                  variant="caption"
                  color="text.secondary"
                  style={{cursor: 'pointer'}}
                  data-testid="database-status-text"
                >
                  {status.isConnected ? t('statusBar.connected') : t('statusBar.disconnected')}
                </Typography>
              </Tooltip>
            </Box>

        </Box>
      </Box>
    </Paper>
  );
};

export default DatabaseStatusBar;
