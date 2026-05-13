'use client';

import React, { useState } from 'react';
import {
  Box,
  Typography,
  AppBar,
  Toolbar,
  IconButton,
  Button,
  Stack,
  Paper,
  Alert,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
} from '@mui/material';
import {
  ArrowBack,
  BugReport,
  Clear,
  Download,
  ExpandMore,
  TableChart,
} from '@mui/icons-material';
import DeveloperConsole from './DeveloperConsole';
import { consoleLogger } from '@/lib/consoleLogger';
import { SampleDataService } from '@/lib/sampleDataService';

interface DeveloperConsolePageProps {
  onClose: () => void;
}

const DeveloperConsolePage: React.FC<DeveloperConsolePageProps> = ({ onClose }) => {
  const [exportingTable, setExportingTable] = useState<string | null>(null);
  
  // Check for dev mode flag
  const isDevMode = typeof window !== 'undefined' && 
    new URLSearchParams(window.location.search).get('dev') === 'true';

  const handleClearLogs = () => {
    consoleLogger.clearLogs();
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

  const handleExportTableForSampleData = async (tableName: string) => {
    setExportingTable(tableName);
    try {
      const jsonData = await SampleDataService.exportTableToJSON(tableName);
      
      // Download as JSON file
      const blob = new Blob([jsonData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${tableName}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      console.log(`[Developer Console] Exported ${tableName} to JSON for sample data`);
    } catch (error) {
      console.error(`[Developer Console] Failed to export ${tableName}:`, error);
    } finally {
      setExportingTable(null);
    }
  };

  const testConsoleLogging = () => {
    console.log('DeveloperConsole: Test log message from console page');
    console.info('DeveloperConsole: Test info message');
    console.warn('DeveloperConsole: Test warning message');
    console.error('DeveloperConsole: Test error message');
    console.debug('DeveloperConsole: Test debug message');
    
    // Test with objects
    console.log('DeveloperConsole: Test object:', { 
      component: 'DeveloperConsolePage', 
      timestamp: new Date(),
      userAgent: navigator.userAgent,
      url: window.location.href
    });
    
    // Test intentional error
    try {
      throw new Error('DeveloperConsole: Test intentional error for debugging');
    } catch (error) {
      console.error('DeveloperConsole: Caught error:', error);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Header */}
      <AppBar position="sticky" color="default" elevation={1}>
        <Toolbar>
          <IconButton 
            edge="start" 
            onClick={onClose}
            sx={{ mr: 2 }}
          >
            <ArrowBack />
          </IconButton>
          <BugReport sx={{ mr: 1 }} />
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Developer Console
          </Typography>
          
          {/* Quick Actions */}
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              startIcon={<Clear />}
              onClick={handleClearLogs}
            >
              Clear
            </Button>
            <Button
              size="small"
              startIcon={<Download />}
              onClick={handleExportLogs}
            >
              Export
            </Button>
          </Stack>
        </Toolbar>
      </AppBar>

      {/* Content */}
      <Box sx={{ maxWidth: 1400, mx: 'auto', p: { xs: 1, sm: 3 } }}>
        {/* Info Section */}
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h5" gutterBottom>
            Real-time Console Monitoring
          </Typography>
          <Typography variant="body1" color="text.secondary" paragraph>
            This developer console captures all browser console output, JavaScript errors, 
            and debugging information in real-time. Use this tool to monitor application 
            behavior and troubleshoot issues.
          </Typography>
          
          <Alert severity="info" sx={{ mb: 2 }}>
            Console logging is automatically enabled when the application starts. The logger 
            intercepts all console methods while preserving their original functionality. 
            Logs are stored locally and can be exported for analysis.
          </Alert>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Button
              variant="outlined"
              startIcon={<BugReport />}
              onClick={testConsoleLogging}
            >
              Generate Test Logs
            </Button>
            <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>
              Click to generate sample console output for testing
            </Typography>
          </Stack>
        </Paper>

        {/* Developer Tools - Only visible with ?dev=true */}
        {isDevMode && (
          <Paper sx={{ p: 3, mb: 3 }}>
            <Accordion>
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TableChart />
                  <Typography variant="h6">Sample Data Export</Typography>
                  <Chip label="Developer Tool" size="small" color="primary" />
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={2}>
                  <Alert severity="info">
                    Export database tables to JSON format for creating sample data files. 
                    Save exported files to <code>/public/sample-data/</code> directory.
                    To load sample data, navigate to <code>?loadSampleData</code> when creating a new database.
                  </Alert>
                  
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Export tables in dependency order:
                  </Typography>
                  
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {['users', 'accounts', 'account_cards', 'categories', 'companies', 
                      'projects', 'trips', 'transactions'].map(table => (
                      <Button
                        key={table}
                        variant="outlined"
                        size="small"
                        startIcon={<Download />}
                        onClick={() => handleExportTableForSampleData(table)}
                        disabled={exportingTable === table}
                        sx={{ mb: 1 }}
                      >
                        {exportingTable === table ? 'Exporting...' : `Export ${table}`}
                      </Button>
                    ))}
                  </Stack>
                </Stack>
              </AccordionDetails>
            </Accordion>
          </Paper>
        )}

        {/* Developer Console */}
        <Paper sx={{ minHeight: 600 }}>
          <DeveloperConsole isOpen={true} />
        </Paper>
      </Box>
    </Box>
  );
};

export default DeveloperConsolePage;
