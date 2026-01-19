import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Chip,
  Button,
  TextField,
  Stack,
  Divider,
  Tooltip,
  Collapse,
} from '@mui/material';
import {
  Clear,
  Download,
  ExpandMore,
  ExpandLess,
  ContentCopy,
  BugReport,
} from '@mui/icons-material';
import { consoleLogger, LogEntry } from '@/lib/consoleLogger';

interface DeveloperConsoleProps {
  isOpen: boolean;
}

const DeveloperConsole: React.FC<DeveloperConsoleProps> = ({ isOpen }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState<string[]>(['log', 'info', 'warn', 'error', 'debug']);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [isCapturing, setIsCapturing] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Subscribe to log updates
    const unsubscribe = consoleLogger.subscribe(setLogs);
    
    // Load existing logs
    setLogs(consoleLogger.getLogs());
    
    // Always set capturing to true since it's now always on
    setIsCapturing(true);

    return () => {
      unsubscribe();
    };
  }, [isOpen]);

  useEffect(() => {
    // Auto-scroll to bottom when new logs arrive
    if (logs.length > 0) {
      // Use setTimeout to ensure DOM is updated before scrolling
      setTimeout(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 10);
    }
  }, [logs]);

  const filteredLogs = logs.filter(log => {
    const matchesLevel = levelFilter.includes(log.level);
    const matchesFilter = filter === '' || 
      log.message.toLowerCase().includes(filter.toLowerCase());
    return matchesLevel && matchesFilter;
  });

  useEffect(() => {
    // Auto-scroll when filters change to show latest filtered logs
    if (filteredLogs.length > 0) {
      setTimeout(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 10);
    }
  }, [filteredLogs.length, filter, levelFilter]);

  const handleLevelToggle = (level: string) => {
    setLevelFilter(prev => 
      prev.includes(level) 
        ? prev.filter(l => l !== level)
        : [...prev, level]
    );
  };

  const handleToggleExpand = (logId: string) => {
    setExpandedLogs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(logId)) {
        newSet.delete(logId);
      } else {
        newSet.add(logId);
      }
      return newSet;
    });
  };

  const handleCopyLog = (log: LogEntry) => {
    let logText = `[${log.timestamp}] ${log.level.toUpperCase()}`;
    
    if (log.sourceFile) {
      logText += ` ${log.sourceFile}:${log.sourceLine}:${log.sourceColumn}`;
    }
    
    logText += `\n${log.message}`;
    
    if (log.args.length > 1) {
      logText += '\nArguments: ' + log.args.slice(1).map(arg => {
        try {
          return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg);
        } catch {
          return '[Circular or non-serializable object]';
        }
      }).join(', ');
    }
    
    if (log.stack) {
      logText += '\n' + log.stack;
    }
    
    navigator.clipboard.writeText(logText);
  };

  const handleExportLogs = () => {
    const logsText = consoleLogger.exportLogs();
    const blob = new Blob([logsText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `console-logs-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleToggleCapturing = () => {
    // Logging is now always on, so this function doesn't change the state
    // but we keep it for UI consistency in case there are edge cases
    // where we want to show the current state
    setIsCapturing(consoleLogger.isCurrentlyCapturing());
  };

  const getLevelColor = (level: string): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' => {
    switch (level) {
      case 'error': return 'error';
      case 'warn': return 'warning';
      case 'info': return 'info';
      case 'debug': return 'secondary';
      default: return 'default';
    }
  };

  const getLevelBackgroundColor = (level: string) => {
    switch (level) {
      case 'error': return 'rgba(244, 67, 54, 0.1)';
      case 'warn': return 'rgba(255, 152, 0, 0.1)';
      case 'info': return 'rgba(33, 150, 243, 0.1)';
      case 'debug': return 'rgba(156, 39, 176, 0.1)';
      default: return 'transparent';
    }
  };

  return (
    <Collapse in={isOpen}>
      <Paper sx={{ mt: 2, maxHeight: 600, display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Stack direction="row" spacing={2} alignItems="center" mb={2}>
            <BugReport color="primary" />
            <Typography variant="h6">Developer Console</Typography>
            <Button
              size="small"
              startIcon={<Clear />}
              onClick={() => consoleLogger.clearLogs()}
            >
              Clear
            </Button>
            <Button
              size="small"
              startIcon={<Download />}
              onClick={handleExportLogs}
              disabled={logs.length === 0}
            >
              Export
            </Button>
          </Stack>

          {/* Filters */}
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" gap={1}>
            <TextField
              size="small"
              placeholder="Filter messages..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              sx={{ minWidth: 200 }}
            />
            <Divider orientation="vertical" flexItem />
            {['log', 'info', 'warn', 'error', 'debug'].map(level => (
              <Chip
                key={level}
                label={level}
                size="small"
                variant={levelFilter.includes(level) ? 'filled' : 'outlined'}
                color={getLevelColor(level)}
                onClick={() => handleLevelToggle(level)}
              />
            ))}
          </Stack>
        </Box>

        {/* Status */}
        <Box sx={{ px: 2, py: 1, backgroundColor: 'grey.50', borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="body2" color="text.secondary">
            <span style={{ color: '#4caf50' }}>● Console logging active</span>
            {' • '}
            {filteredLogs.length} of {logs.length} logs shown
          </Typography>
        </Box>

        {/* Logs */}
        <Box sx={{ flex: 1, overflow: 'auto', p: 1, maxHeight: 400 }}>
          {filteredLogs.length === 0 ? (
            <Box sx={{ p: 2, textAlign: 'center' }}>
              <Typography color="text.secondary">
                {logs.length === 0 ? (
                  'No logs captured yet. Try interacting with the application or use the "Test Console" button.'
                ) : (
                  'No logs match the current filters.'
                )}
              </Typography>
            </Box>
          ) : (
            filteredLogs.map(log => {
              const isExpanded = expandedLogs.has(log.id);
              const hasExpandableContent = log.message.length > 100 || log.stack || log.args.length > 1;
              
              return (
                <Box
                  key={log.id}
                  sx={{
                    p: 1,
                    mb: 1,
                    backgroundColor: getLevelBackgroundColor(log.level),
                    borderRadius: 1,
                    border: log.level === 'error' ? '1px solid rgba(244, 67, 54, 0.3)' : 'none',
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="flex-start">
                    <Chip
                      label={log.level}
                      size="small"
                      color={getLevelColor(log.level)}
                      sx={{ minWidth: 60, fontSize: '0.7rem', height: 20 }}
                    />
                    <Typography
                      variant="body2"
                      sx={{ 
                        fontFamily: 'monospace', 
                        color: 'text.secondary', 
                        minWidth: 80,
                        fontSize: '0.75rem'
                      }}
                    >
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </Typography>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      {/* Source location */}
                      {log.sourceFile && (
                        <Typography
                          variant="caption"
                          sx={{
                            fontFamily: 'monospace',
                            fontSize: '0.7rem',
                            color: 'primary.main',
                            display: 'block',
                            mb: 0.5,
                          }}
                        >
                          {log.sourceFile}:{log.sourceLine}:{log.sourceColumn}
                        </Typography>
                      )}
                      
                      {/* Message */}
                      <Typography
                        variant="body2"
                        sx={{
                          fontFamily: 'monospace',
                          fontSize: '0.8rem',
                          wordBreak: 'break-word',
                          whiteSpace: isExpanded ? 'pre-wrap' : 'nowrap',
                          overflow: isExpanded ? 'visible' : 'hidden',
                          textOverflow: isExpanded ? 'unset' : 'ellipsis',
                        }}
                      >
                        {log.message}
                      </Typography>
                      
                      {/* Additional arguments */}
                      {isExpanded && log.args.length > 1 && (
                        <Box sx={{ mt: 1 }}>
                          {log.args.slice(1).map((arg, idx) => (
                            <Typography
                              key={idx}
                              variant="body2"
                              sx={{
                                fontFamily: 'monospace',
                                fontSize: '0.75rem',
                                mt: 0.5,
                                p: 1,
                                backgroundColor: 'rgba(0, 0, 0, 0.05)',
                                borderRadius: 1,
                                whiteSpace: 'pre-wrap',
                              }}
                            >
                              {typeof arg === 'object' ? (
                                <span style={{ color: '#795548' }}>
                                  {JSON.stringify(arg, null, 2)}
                                </span>
                              ) : (
                                String(arg)
                              )}
                            </Typography>
                          ))}
                          <Typography
                            variant="caption"
                            sx={{
                              fontSize: '0.65rem',
                              color: 'warning.main',
                              fontStyle: 'italic',
                              display: 'block',
                              mt: 0.5,
                            }}
                          >
                            ⚠️ Object arguments are stored by reference and may have been mutated
                          </Typography>
                        </Box>
                      )}
                      
                      {/* Stack trace */}
                      {log.stack && isExpanded && (
                        <Typography
                          variant="body2"
                          sx={{
                            fontFamily: 'monospace',
                            color: 'error.main',
                            mt: 1,
                            whiteSpace: 'pre-wrap',
                            fontSize: '0.7rem',
                            backgroundColor: 'rgba(244, 67, 54, 0.05)',
                            p: 1,
                            borderRadius: 1,
                          }}
                        >
                          {log.stack}
                        </Typography>
                      )}
                    </Box>
                    <Stack direction="row" spacing={0.5}>
                      <Tooltip title="Copy log">
                        <IconButton size="small" onClick={() => handleCopyLog(log)}>
                          <ContentCopy fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {hasExpandableContent && (
                        <IconButton
                          size="small"
                          onClick={() => handleToggleExpand(log.id)}
                        >
                          {isExpanded ? <ExpandLess /> : <ExpandMore />}
                        </IconButton>
                      )}
                    </Stack>
                  </Stack>
                </Box>
              );
            })
          )}
          <div ref={logsEndRef} />
        </Box>
      </Paper>
    </Collapse>
  );
};

export default DeveloperConsole;
