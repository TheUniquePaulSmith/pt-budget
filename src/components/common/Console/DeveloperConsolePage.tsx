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
  Alert,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
} from '@mui/material';
import {
  ArrowBack,
  BugReport,
  Download,
  ExpandMore,
  TableChart,
} from '@mui/icons-material';
import DeveloperConsole from './DeveloperConsole';
import { SampleDataService } from '@/lib/sampleDataService';

interface DeveloperConsolePageProps {
  onClose: () => void;
}

const DeveloperConsolePage: React.FC<DeveloperConsolePageProps> = ({ onClose }) => {
  const [exportingTable, setExportingTable] = useState<string | null>(null);

  // Check for dev mode flag
  const isDevMode = typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('dev') === 'true';

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

  return (
    <Box
      sx={{
        height: '100vh',
        // dvh tracks the visible viewport as mobile browser chrome shows/hides
        '@supports (height: 100dvh)': { height: '100dvh' },
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        bgcolor: 'background.default',
      }}
    >
      {/* Header */}
      <AppBar position="static" color="default" elevation={1}>
        <Toolbar variant="dense">
          <IconButton
            edge="start"
            onClick={onClose}
            sx={{ mr: 1 }}
            aria-label="Back to application"
          >
            <ArrowBack />
          </IconButton>
          <BugReport color="primary" sx={{ mr: 1 }} />
          <Typography variant="h6" component="div" noWrap>
            Developer Console
          </Typography>
        </Toolbar>
      </AppBar>

      {/* Developer Tools - Only visible with ?dev=true */}
      {isDevMode && (
        <Accordion
          disableGutters
          square
          elevation={0}
          sx={{ borderBottom: 1, borderColor: 'divider', '&:before': { display: 'none' } }}
        >
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <TableChart fontSize="small" />
              <Typography variant="body2">Sample Data Export</Typography>
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
      )}

      {/* Console fills the remaining viewport */}
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <DeveloperConsole />
      </Box>
    </Box>
  );
};

export default DeveloperConsolePage;
