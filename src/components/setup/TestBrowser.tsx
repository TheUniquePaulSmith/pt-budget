/**
 * TestBrowser Component
 *
 * Performs browser compatibility testing for WA-SQLite functionality
 * using a dedicated shared worker to test basic database operations.
 */

"use client";

import React, { useState, useEffect, useRef } from "react";
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
  Chip,
  Collapse,
  IconButton,
} from "@mui/material";
import {
  CheckCircle,
  Error,
  Warning,
  Storage,
  Memory,
  Code,
  BugReport,
  SkipNext,
  ExpandMore,
} from "@mui/icons-material";

export interface TestResults {
  sharedWorkerSupport: boolean | null;
  wasmSupport: boolean | null;
  sqliteSupport: boolean | null;
  vfsSupport: boolean | null;
  databaseOperationsSupport: boolean | null;
  overallCompatible: boolean | null;
  errorDetails?: string | null;
}

interface TestBrowserProps {
  onTestComplete: (
    isCompatible: boolean,
    results: TestResults
  ) => void | Promise<void>;
}

const STORAGE_KEY = "budgetApp_browserTestPassed";

function hasSuccessfulTestResults(
  results: Partial<TestResults> | null | undefined
): results is Required<TestResults> {
  return (
    results?.sharedWorkerSupport === true &&
    results.wasmSupport === true &&
    results.sqliteSupport === true &&
    results.vfsSupport === true &&
    results.databaseOperationsSupport === true &&
    results.overallCompatible === true
  );
}

export const TestBrowser: React.FC<TestBrowserProps> = ({ onTestComplete }) => {
  const [isTestingInProgress, setIsTestingInProgress] = useState(true);
  const [testResults, setTestResults] = useState<TestResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const workerRef = useRef<SharedWorker | null>(null);
  const hasStartedTest = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return; // SSR guard
    if (hasStartedTest.current) return; // Prevent double execution

    hasStartedTest.current = true;

    // Check if test has been run successfully before
    const previousTestResults = localStorage.getItem(STORAGE_KEY);

    if (previousTestResults) {
      try {
        const savedResults = JSON.parse(previousTestResults) as Partial<TestResults>;

        if (hasSuccessfulTestResults(savedResults)) {
          console.log("[TestBrowser] Using cached test results from previous session");
          setTestResults(savedResults);
          setIsTestingInProgress(false);
          // Delay callback slightly to ensure parent component is ready
          setTimeout(() => {
            onTestComplete(true, savedResults);
          }, 100);
          return;
        }

        console.warn("[TestBrowser] Discarding stale cached test results");
        localStorage.removeItem(STORAGE_KEY);
      } catch (err) {
        console.warn("[TestBrowser] Failed to parse cached test results, running test again", err);
        localStorage.removeItem(STORAGE_KEY);
      }
    }

    const runCompatibilityTest = async () => {
      try {
        console.log("[TestBrowser] Starting compatibility test...");
        const results: TestResults = {
          sharedWorkerSupport: null,
          wasmSupport: null,
          sqliteSupport: null,
          vfsSupport: null,
          databaseOperationsSupport: null,
          overallCompatible: null,
        };
        // First check if WASM is supported
        if (
          !(
            typeof WebAssembly === "object" &&
            typeof WebAssembly.instantiate === "function"
          )
        ) {
          results.wasmSupport = false;
          setTestResults(results);
          setIsTestingInProgress(false);
          onTestComplete(false, results);
          return;
        } else {
          results.wasmSupport = true;
          setTestResults(results);
        }

        // Second check if SharedWorker is supported
        if (typeof SharedWorker === "undefined") {
          results.sharedWorkerSupport = false;
          setTestResults(results);
          setIsTestingInProgress(false);
          onTestComplete(false, results);
          return;
        } else {
          results.sharedWorkerSupport = true;
        }

        // Third create the test worker
        const worker = new SharedWorker("/database-tester.js");
        workerRef.current = worker;

        worker.port.start();

        // Set up message handler
        worker.port.onmessage = (event) => {
          const {
            type,
            testResults: results,
            isSuccessful,
            error: workerError,
          } = event.data;

          if (type === "test_results") {
            console.log("[TestBrowser] Received test results:", results);
            setTestResults(results);
            setIsTestingInProgress(false);
            
            // Save successful test results to localStorage
            if (hasSuccessfulTestResults(results)) {
              try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(results));
                console.log("[TestBrowser] Saved test results to localStorage for future sessions");
              } catch (err) {
                console.warn("[TestBrowser] Failed to save test results to localStorage", err);
              }
            }
            
            // Add a 2-second delay to let users see the test results
            setTimeout(() => {
              onTestComplete(results.overallCompatible ?? false, results);
            }, 5000);
          } else if (type === "error") {
            console.error("[TestBrowser] Worker error:", workerError);
            setError(workerError);
            setIsTestingInProgress(false);

            const failedResults: TestResults = {
              sharedWorkerSupport: true,
              wasmSupport: false,
              sqliteSupport: false,
              vfsSupport: false,
              databaseOperationsSupport: false,
              overallCompatible: false,
            };
            onTestComplete(false, failedResults);
          } else if (type === "tester_connected") {
            console.log(
              "[TestBrowser] Test worker connected, starting test..."
            );
            // Start the compatibility test
            worker.port.postMessage({
              id: Date.now(),
              type: "test_compatibility",
            });
          }
        };

        worker.onerror = (error: ErrorEvent) => {
          console.error("[TestBrowser] Worker error:", error);
          setError("Failed to communicate with test worker");
          setIsTestingInProgress(false);

          const failedResults: TestResults = {
            sharedWorkerSupport: true,
            wasmSupport: false,
            sqliteSupport: false,
            vfsSupport: false,
            databaseOperationsSupport: false,
            overallCompatible: false,
          };
          onTestComplete(false, failedResults);
        };
      } catch (err: unknown) {
        console.error("[TestBrowser] Failed to start compatibility test:", err);
        let errorMessage = "Unknown error during compatibility test";
        if (err && typeof err === "object" && "message" in err) {
          errorMessage = String(err.message);
        }
        setError(errorMessage);
        setIsTestingInProgress(false);

        const failedResults: TestResults = {
          sharedWorkerSupport: false,
          wasmSupport: false,
          sqliteSupport: false,
          vfsSupport: false,
          databaseOperationsSupport: false,
          overallCompatible: false,
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

  const getTestIcon = (passed: boolean, inProgress: boolean, hasResults: boolean) => {
    if (inProgress) {
      return <CircularProgress size={20} />;
    }
    if (!hasResults) {
      return <SkipNext color="disabled" />;
    }
    return passed ? <CheckCircle color="success" /> : <Error color="error" />;
  };

  const getTestStatus = (
    passed: boolean,
    inProgress: boolean,
    hasResults: boolean
  ): string => {
    if (inProgress) return "Testing...";
    if (!hasResults) return "Not tested";
    return passed ? "Passed" : "Failed";
  };

  const testItems = [
    {
      key: "wasmSupport",
      label: "WebAssembly Support",
      description: "Browser supports WebAssembly",
      icon: <Memory />,
    },
    {
      key: "sharedWorkerSupport",
      label: "SharedWorker Support",
      description: "Browser supports SharedWorker API",
      icon: <Code />,
    },
    {
      key: "sqliteSupport",
      label: "SQLite WASM Module",
      description: "WA-SQLite module loads and initializes",
      icon: <Storage />,
    },
    {
      key: "vfsSupport",
      label: "Virtual File System",
      description: "IndexedDB VFS backend works correctly",
      icon: <Storage />,
    },
    {
      key: "databaseOperationsSupport",
      label: "Database Operations",
      description: "Opens a test database and runs a query",
      icon: <BugReport />,
    },
  ];

  const errorDetailsText = testResults?.errorDetails ?? error;

  return (
    <Box sx={{ width: "100%", maxWidth: 600 }}>
      <Paper sx={{ p: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 3 }}>
          {isTestingInProgress && <CircularProgress size={24} sx={{ mr: 2 }} />}
          <Typography variant="h6">Browser Compatibility Test</Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        <List>
          {testItems.map((item) => {
            const testValue = testResults?.[item.key as keyof TestResults];
            const inProgress = isTestingInProgress && testValue === null;
            const hasResults = testResults !== null && testValue !== null && testValue !== undefined;

            return (
              <ListItem key={item.key} sx={{ px: 0 }}>
                <ListItemIcon>{item.icon}</ListItemIcon>
                <ListItemText
                  primary={item.label}
                  secondary={item.description}
                />
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Chip
                    size="small"
                    label={getTestStatus(testValue === true, inProgress, hasResults)}
                    color={
                      inProgress
                        ? "default"
                        : hasResults
                        ? testValue
                          ? "success"
                          : "error"
                        : "default"
                    }
                    variant={inProgress || !hasResults ? "outlined" : "filled"}
                  />
                  {getTestIcon(testValue === true, inProgress, hasResults)}
                </Box>
              </ListItem>
            );
          })}
        </List>

        {testResults && !isTestingInProgress && (
          <Box sx={{ mt: 3, pt: 2, borderTop: 1, borderColor: "divider" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
              <Typography variant="subtitle1" fontWeight="bold">
                Overall Result:
              </Typography>
              <Chip
                label={
                  testResults.overallCompatible ? "Compatible" : "Incompatible"
                }
                color={testResults.overallCompatible ? "success" : "error"}
                icon={
                  testResults.overallCompatible ? <CheckCircle /> : <Warning />
                }
              />
            </Box>

            {!testResults.overallCompatible && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                Your browser may not fully support all required features for the
                budget application. Some functionality may be limited or
                unavailable.
              </Alert>
            )}
          </Box>
        )}

        {errorDetailsText && !isTestingInProgress && (
          <Box sx={{ mt: 2 }}>
            <Box
              onClick={() => setDetailsExpanded((prev) => !prev)}
              sx={{
                display: "flex",
                alignItems: "center",
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
                Error details
              </Typography>
              <IconButton
                size="small"
                aria-label={detailsExpanded ? "Hide error details" : "Show error details"}
                sx={{
                  transform: detailsExpanded ? "rotate(180deg)" : "none",
                  transition: "transform 0.2s",
                }}
              >
                <ExpandMore fontSize="small" />
              </IconButton>
            </Box>
            <Collapse in={detailsExpanded}>
              <Paper
                variant="outlined"
                sx={{ p: 2, mt: 1, maxHeight: 240, overflow: "auto" }}
              >
                <Typography
                  component="pre"
                  variant="caption"
                  sx={{
                    m: 0,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontFamily: "monospace",
                  }}
                >
                  {errorDetailsText}
                </Typography>
              </Paper>
            </Collapse>
          </Box>
        )}
      </Paper>
    </Box>
  );
};
