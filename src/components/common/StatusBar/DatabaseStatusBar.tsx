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
} from '@mui/icons-material';
import { databaseWorkerService, WorkerStatus } from '@/lib/databaseWorkerService';

interface DatabaseStatusBarProps {
  status: WorkerStatus;
}

const DatabaseStatusBar: React.FC<DatabaseStatusBarProps> = ({ status }) => {
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
    const timeSinceHeartbeat = status.lastHeartbeat ? currentTime - status.lastHeartbeat : 0;
    const heartbeatText = status.lastHeartbeat 
      ? `Heartbeat: ${Math.floor(timeSinceHeartbeat / 1000)}s ago`
      : 'No heartbeat received';
    
    return `Worker Status: ${status.isWorkerAlive ? 'Alive' : 'Dead'}
      Database Status: ${status.dbStatus}
      ${heartbeatText}
    `;
  };

  useEffect(() => {
    if (tooltipOpen) {
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
          <Typography variant="caption" color="text.secondary">
            v{status.version}
          </Typography>   
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
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
                <Typography variant="caption" color="text.secondary" style={{cursor: 'pointer'}}>
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
