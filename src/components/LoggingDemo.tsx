import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Typography, 
  Button, 
  Paper, 
  Stack,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails
} from '@mui/material';
import { ExpandMore } from '@mui/icons-material';
import { consoleLogger } from '../lib/consoleLogger';
import { appLogger, dbLogger } from '../lib/logger';
import type { LogEntry } from '../lib/logger';

export default function LoggingDemo() {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    // Subscribe to log updates
    const unsubscribe = consoleLogger.subscribe((updatedLogs) => {
      setLogs(updatedLogs);
    });

    // Load initial logs
    setLogs(consoleLogger.getLogs());

    return unsubscribe;
  }, []);

  const handleTestLogs = () => {
    appLogger.info('This is an info message from appLogger');
    appLogger.warn('This is a warning message', { component: 'LoggingDemo' });
    appLogger.error('This is an error message', new Error('Test error'));
    appLogger.debug('This is a debug message', { timestamp: new Date() });
    
    dbLogger.info('Database operation completed');
    dbLogger.error('Database connection failed', new Error('Connection timeout'));
  };

  const handleClearLogs = () => {
    consoleLogger.clearLogs();
  };

  const handleExportLogs = () => {
    const logText = consoleLogger.exportLogs();
    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'application-logs.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  const getLevelColor = (level: LogEntry['level']) => {
    switch (level) {
      case 'error': return 'error';
      case 'warn': return 'warning';
      case 'info': return 'info';
      case 'debug': return 'secondary';
      default: return 'default';
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Logging System Demo
      </Typography>
      
      <Typography variant="body1" paragraph>
        This demo shows the new browser-compatible logging system that preserves console source mapping
        while providing structured logging capabilities.
      </Typography>

      <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
        <Button variant="contained" onClick={handleTestLogs}>
          Generate Test Logs
        </Button>
        <Button variant="outlined" onClick={handleClearLogs}>
          Clear Logs
        </Button>
        <Button variant="outlined" onClick={handleExportLogs}>
          Export Logs
        </Button>
      </Stack>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6" gutterBottom>
          Log Statistics
        </Typography>
        <Stack direction="row" spacing={1}>
          <Chip label={`Total: ${logs.length}`} />
          <Chip label={`Info: ${logs.filter(l => l.level === 'info').length}`} color="info" />
          <Chip label={`Warnings: ${logs.filter(l => l.level === 'warn').length}`} color="warning" />
          <Chip label={`Errors: ${logs.filter(l => l.level === 'error').length}`} color="error" />
          <Chip label={`Debug: ${logs.filter(l => l.level === 'debug').length}`} color="secondary" />
        </Stack>
      </Paper>

      <Paper sx={{ p: 2, maxHeight: 600, overflow: 'auto' }}>
        <Typography variant="h6" gutterBottom>
          Recent Logs ({logs.length})
        </Typography>
        
        {logs.length === 0 ? (
          <Typography color="text.secondary">
            No logs yet. Click &quot;Generate Test Logs&quot; to see the logging system in action.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {logs.slice().reverse().map((log) => (
              <Accordion key={log.id} sx={{ bgcolor: 'background.default' }}>
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ width: '100%' }}>
                    <Chip 
                      label={log.level.toUpperCase()} 
                      color={getLevelColor(log.level)}
                      size="small"
                    />
                    <Typography variant="body2" color="text.secondary">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </Typography>
                    <Typography variant="body2" sx={{ flexGrow: 1 }}>
                      {log.message}
                    </Typography>
                  </Stack>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={1}>
                    <Typography variant="body2">
                      <strong>Message:</strong> {log.message}
                    </Typography>
                    <Typography variant="body2">
                      <strong>Timestamp:</strong> {log.timestamp}
                    </Typography>
                    {log.meta && (
                      <Box>
                        <Typography variant="body2" sx={{ mb: 1 }}>
                          <strong>Metadata:</strong>
                        </Typography>
                        <Paper sx={{ p: 1, bgcolor: 'grey.100' }}>
                          <pre style={{ margin: 0, fontSize: '0.8rem' }}>
                            {JSON.stringify(log.meta, null, 2)}
                          </pre>
                        </Paper>
                      </Box>
                    )}
                    {log.stack && (
                      <Box>
                        <Typography variant="body2" sx={{ mb: 1 }}>
                          <strong>Stack Trace:</strong>
                        </Typography>
                        <Paper sx={{ p: 1, bgcolor: 'grey.100' }}>
                          <pre style={{ margin: 0, fontSize: '0.8rem' }}>
                            {log.stack}
                          </pre>
                        </Paper>
                      </Box>
                    )}
                  </Stack>
                </AccordionDetails>
              </Accordion>
            ))}
          </Stack>
        )}
      </Paper>
    </Box>
  );
}
