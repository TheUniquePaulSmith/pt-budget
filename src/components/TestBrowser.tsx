/**
 * TestBrowser Component
 * 
 * Performs browser compatibility testing for WA-SQLite functionality
 * using a dedicated shared worker to test basic database operations.
 */

"use client";

import React, { useState, useEffect, useRef } from 'react';
import { 
  Box, 
  Typography, 
  CircularProgress, 
  Alert, 
  List, 
  ListItem, 
  ListItemIcon, 
  ListItemText,
  Paper,
  Chip
} from '@mui/material';
import { 
  CheckCircle, 
  Error, 
  Warning, 
  Storage,
  Memory,
  Code,
  BugReport
} from '@mui/icons-material';

interface TestResults {
  sharedWorkerSupport: boolean;
  wasmSupport: boolean;
  sqliteSupport: boolean;
  vfsSupport: boolean;
  overallCompatible: boolean;
}

interface TestBrowserProps {
  onTestComplete: (isCompatible: boolean, results: TestResults) => void;
}

export const TestBrowser: React.FC<TestBrowserProps> = ({ onTestComplete }) => {
  const [isTestingInProgress, setIsTestingInProgress] = useState(true);
  const [testResults, setTestResults] = useState<TestResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<SharedWorker | null>(null);
  const hasStartedTest = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return; // SSR guard
    if (hasStartedTest.current) return; // Prevent double execution

    hasStartedTest.current = true;

     const runCompatibilityTest = async () => {
    try {
      // First check if SharedWorker is supported
      if (typeof SharedWorker === 'undefined') {
        const results: TestResults = {
          sharedWorkerSupport: false,
          wasmSupport: false,
          sqliteSupport: false,
          vfsSupport: false,
          overallCompatible: false
        };
        setTestResults(results);
        setIsTestingInProgress(false);
        onTestComplete(false, results);
        return;
      }

      console.log('[TestBrowser] Starting compatibility test...');
      
      // Create the test worker
      const worker = new SharedWorker('/database-tester.js');
      workerRef.current = worker;
      
      worker.port.start();
      
      // Set up message handler
      worker.port.onmessage = (event) => {
        const { type, testResults: results, isSuccessful, error: workerError } = event.data;
        
        if (type === 'test_results') {
          console.log('[TestBrowser] Received test results:', results);
          setTestResults(results);
          setIsTestingInProgress(false);
          onTestComplete(results.overallCompatible, results);
        } else if (type === 'error') {
          console.error('[TestBrowser] Worker error:', workerError);
          setError(workerError);
          setIsTestingInProgress(false);
          
          const failedResults: TestResults = {
            sharedWorkerSupport: true,
            wasmSupport: false,
            sqliteSupport: false,
            vfsSupport: false,
            overallCompatible: false
          };
          onTestComplete(false, failedResults);
        } else if (type === 'tester_connected') {
          console.log('[TestBrowser] Test worker connected, starting test...');
          // Start the compatibility test
          worker.port.postMessage({
            id: Date.now(),
            type: 'test_compatibility'
          });
        }
      };

      worker.onerror = (error: ErrorEvent) => {
        console.error('[TestBrowser] Worker error:', error);
        setError('Failed to communicate with test worker');
        setIsTestingInProgress(false);
        
        const failedResults: TestResults = {
          sharedWorkerSupport: true,
          wasmSupport: false,
          sqliteSupport: false,
          vfsSupport: false,
          overallCompatible: false
        };
        onTestComplete(false, failedResults);
      };

    } catch (err: unknown) {
      console.error('[TestBrowser] Failed to start compatibility test:', err);
      let errorMessage = 'Unknown error during compatibility test';
      if (err && typeof err === 'object' && 'message' in err) {
        errorMessage = String(err.message);
      }
      setError(errorMessage);
      setIsTestingInProgress(false);
      
      const failedResults: TestResults = {
        sharedWorkerSupport: false,
        wasmSupport: false,
        sqliteSupport: false,
        vfsSupport: false,
        overallCompatible: false
      };
      onTestComplete(false, failedResults);
    }
  };
    runCompatibilityTest();

    // return () => {
    //   if (workerRef.current) {
    //     workerRef.current.port.close();
    //   }
    // };
  }, [onTestComplete]);

 

  const getTestIcon = (passed: boolean, inProgress: boolean) => {
    if (inProgress) {
      return <CircularProgress size={20} />;
    }
    return passed ? (
      <CheckCircle color="success" />
    ) : (
      <Error color="error" />
    );
  };

  const getTestStatus = (passed: boolean, inProgress: boolean): string => {
    if (inProgress) return 'Testing...';
    return passed ? 'Passed' : 'Failed';
  };

  const testItems = [
    {
      key: 'sharedWorkerSupport',
      label: 'SharedWorker Support',
      description: 'Browser supports SharedWorker API',
      icon: <Code />
    },
    {
      key: 'wasmSupport', 
      label: 'WebAssembly Support',
      description: 'Browser supports WebAssembly',
      icon: <Memory />
    },
    {
      key: 'sqliteSupport',
      label: 'SQLite WASM Module',
      description: 'WA-SQLite module loads and initializes',
      icon: <Storage />
    },
    {
      key: 'vfsSupport',
      label: 'Virtual File System',
      description: 'IndexedDB VFS backend works correctly',
      icon: <BugReport />
    }
  ];

  return (
    <Box sx={{ width: '100%', maxWidth: 600 }}>
      <Paper sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
          {isTestingInProgress && <CircularProgress size={24} sx={{ mr: 2 }} />}
          <Typography variant="h6">
            Browser Compatibility Test
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        <List>
          {testItems.map((item) => {
            const testValue = testResults?.[item.key as keyof TestResults] ?? false;
            const inProgress = isTestingInProgress && !testResults;
            
            return (
              <ListItem key={item.key} sx={{ px: 0 }}>
                <ListItemIcon>
                  {item.icon}
                </ListItemIcon>
                <ListItemText
                  primary={item.label}
                  secondary={item.description}
                />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Chip
                    size="small"
                    label={getTestStatus(testValue, inProgress)}
                    color={inProgress ? 'default' : (testValue ? 'success' : 'error')}
                    variant={inProgress ? 'outlined' : 'filled'}
                  />
                  {getTestIcon(testValue, inProgress)}
                </Box>
              </ListItem>
            );
          })}
        </List>

        {testResults && (
          <Box sx={{ mt: 3, pt: 2, borderTop: 1, borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography variant="subtitle1" fontWeight="bold">
                Overall Result:
              </Typography>
              <Chip
                label={testResults.overallCompatible ? 'Compatible' : 'Incompatible'}
                color={testResults.overallCompatible ? 'success' : 'error'}
                icon={testResults.overallCompatible ? <CheckCircle /> : <Warning />}
              />
            </Box>
            
            {!testResults.overallCompatible && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                Your browser may not fully support all required features for the budget application. 
                Some functionality may be limited or unavailable.
              </Alert>
            )}
          </Box>
        )}
      </Paper>
    </Box>
  );
};
