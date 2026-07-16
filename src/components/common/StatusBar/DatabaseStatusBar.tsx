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
  Storage,
  Computer,
  Warning,
  CloudDone,
  CloudQueue,
  CloudSync,
  CloudOff,
} from '@mui/icons-material';
import { databaseWorkerService, WorkerStatus } from '@/lib/databaseWorkerService';
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
  handlers: { onSyncNow?: () => void; onReconnect?: () => void; onResolveConflict?: () => void }
): SyncChipConfig | null {
  switch (syncStatus.state) {
    case 'idle':
      return { label: 'Synced', icon: <CloudDone fontSize="small" />, color: '#4caf50' };
    case 'pending':
      return { label: 'Pending changes', icon: <CloudQueue fontSize="small" />, color: '#ff9800' };
    case 'syncing':
      return { label: 'Syncing…', icon: <CloudSync fontSize="small" />, color: '#2196f3' };
    case 'paused-auth':
      return {
        label: 'Reconnect',
        icon: <CloudOff fontSize="small" />,
        color: '#f44336',
        onClick: handlers.onReconnect,
      };
    case 'paused-conflict':
      return {
        label: 'Resolve conflict',
        icon: <Warning fontSize="small" />,
        color: '#f44336',
        onClick: handlers.onResolveConflict,
      };
    case 'offline':
      return { label: 'Offline', icon: <CloudOff fontSize="small" />, color: '#9e9e9e' };
    case 'error':
      return {
        label: 'Sync error',
        icon: <Warning fontSize="small" />,
        color: '#f44336',
        onClick: handlers.onSyncNow,
      };
    case 'disabled':
    default:
      return null;
  }
}

function getSyncTooltipText(syncStatus: AutoSyncSnapshot): string {
  const lines: string[] = [];
  if (syncStatus.lastSyncAt) {
    lines.push(`Last synced: ${new Date(syncStatus.lastSyncAt).toLocaleString()}`);
  }
  if (syncStatus.pendingSince) {
    lines.push(`Unsynced changes since: ${new Date(syncStatus.pendingSince).toLocaleString()}`);
  }
  if (syncStatus.lastError) {
    lines.push(`Last error: ${syncStatus.lastError}`);
  }
  return lines.join('\n') || 'Cloud sync status';
}

const DatabaseStatusBar: React.FC<DatabaseStatusBarProps> = ({
  status,
  syncStatus,
  onSyncNow,
  onReconnectCloudSource,
  onResolveCloudConflict,
}) => {
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

  const getStatusText = () => {
    if (!status.isWorkerAlive) return 'Worker Disconnected';
    if (status.dbStatus === 'connected') return 'Database Connected';
    if (status.dbStatus === 'initialized') return 'Database Initialized';
    if (status.dbStatus === 'error') return 'Database Error';
    return 'Database Disconnected';
  };

  const getStatusIcon = () => {
    if (!status.isWorkerAlive) return <Warning fontSize="small" />;
    if (status.dbStatus === 'connected') return <Storage fontSize="small" />;
    if (status.dbStatus === 'initialized') return <Computer fontSize="small" />;
    if (status.dbStatus === 'error') return <Warning fontSize="small" />;
    return <Circle fontSize="small" />;
  };

  const getTooltipText = () => {
    const timeSinceHeartbeat = status.lastHeartbeat
      ? Math.max(0, currentTime - status.lastHeartbeat)
      : 0;
    const heartbeatText = status.lastHeartbeat
      ? `Heartbeat: ${Math.floor(timeSinceHeartbeat / 1000)}s ago`
      : 'No heartbeat received';

    return `App Version: ${APP_VERSION}
      Worker Status: ${status.isWorkerAlive ? 'Alive' : 'Dead'}
      Database Status: ${status.dbStatus}
      ${heartbeatText}
    `;
  };

  const syncChipConfig = syncStatus
    ? getSyncChipConfig(syncStatus, {
        onSyncNow,
        onReconnect: onReconnectCloudSource,
        onResolveConflict: onResolveCloudConflict,
      })
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
        backgroundColor: '#f5f5f5',
        borderRadius: 0,
        borderTop: '1px solid #e0e0e0',
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
        {/* <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Tooltip title={getTooltipText()} arrow>
            <Chip
              icon={getStatusIcon()}
              label={getStatusText()}
              size="small"
              sx={{
                backgroundColor: getStatusColor(),
                color: 'white',
                '& .MuiChip-icon': {
                  color: 'white',
                },
                fontSize: '0.75rem',
                height: 24,
              }}
            />
          </Tooltip>
        </Box> */}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {syncChipConfig && (
            <Tooltip
              title={syncStatus ? getSyncTooltipText(syncStatus) : ''}
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
                  {status.isConnected ? 'Connected' : 'Disconnected'}
                </Typography>
              </Tooltip>
            </Box>

        </Box>
      </Box>
    </Paper>
  );
};

export default DatabaseStatusBar;
