// Browser-compatible structured logger with console interception
import StackTrace from 'stacktrace-js';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  message: string;
  args: any[]; // Store references to original arguments (warn about mutations)
  sourceFile?: string;
  sourceLine?: number;
  sourceColumn?: number;
  stack?: string;
}

// In-memory log storage for browser
const logBuffer: LogEntry[] = [];
const MAX_LOGS = 1000; // Maximum buffer size

// Log listeners for real-time updates
type LogListener = (logs: LogEntry[]) => void;
const logListeners: LogListener[] = [];

// Store original console methods
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
};

let isCapturing = false;

// Add entry to buffer with source location
const addToBuffer = async (
  level: LogEntry['level'],
  args: any[]
) => {
  // Format message from first argument
  const message = args.length > 0 ? String(args[0]) : '';
  
  // Generate unique ID
  const id = Date.now() + Math.random().toString(36).substring(2);
  
  // Capture stack trace for source location
  let sourceFile: string | undefined;
  let sourceLine: number | undefined;
  let sourceColumn: number | undefined;
  let fullStack: string | undefined;

  try {
    // getSync() only parses the raw `Error().stack` string — it never
    // resolves source maps over the network. StackTrace.get() does, via
    // stacktrace-gps, and for anonymous frames inside an async call chain
    // (no "at fn (url:line:col)", just "at async url:line:col") the parser
    // in error-stack-parser mis-splits the line and leaves the literal
    // "async " keyword glued to the front of the parsed fileName. get()
    // then fetches *that* string as a URL to look for a source map, which
    // the browser resolves relative to this origin (since "async https://…"
    // isn't a valid absolute URL) — producing a bogus 404 request on every
    // console call made from inside an async function. This logger only
    // needs an approximate caller location for the Developer Console
    // display, so getSync()'s fully local parsing avoids the network call
    // (and the request it 404s) while still being fast enough to run on
    // every intercepted console call.
    const stackframes = StackTrace.getSync();
    // Skip first frame (this function) and second frame (the console wrapper)
    // Third frame is the actual caller
    if (stackframes.length > 2) {
      const callerFrame = stackframes[2];
      sourceFile = callerFrame.fileName?.replace(/^async\s+/, '');
      sourceLine = callerFrame.lineNumber;
      sourceColumn = callerFrame.columnNumber;
    }
    
    // For errors, keep the full stack
    if (level === 'error' && args[0] instanceof Error) {
      fullStack = args[0].stack;
    }
  } catch (error) {
    // Stack trace parsing failed, continue without source info
    console.warn('Failed to parse stack trace:', error);
  }

  const entry: LogEntry = {
    id,
    timestamp: new Date().toISOString(),
    level,
    message,
    args, // Store references only - objects may mutate!
    sourceFile,
    sourceLine,
    sourceColumn,
    stack: fullStack,
  };

  logBuffer.push(entry);

  // Keep only the last MAX_LOGS entries
  if (logBuffer.length > MAX_LOGS) {
    logBuffer.splice(0, logBuffer.length - MAX_LOGS);
  }

  // Notify listeners
  logListeners.forEach(listener => listener([...logBuffer]));
};

// Console interceptor functions
export const startConsoleCapture = () => {
  if (isCapturing) return;
  
  isCapturing = true;

  // Override console.log
  console.log = function(...args: any[]) {
    originalConsole.log.apply(console, args);
    addToBuffer('log', args);
  };

  // Override console.info
  console.info = function(...args: any[]) {
    originalConsole.info.apply(console, args);
    addToBuffer('info', args);
  };

  // Override console.warn
  console.warn = function(...args: any[]) {
    originalConsole.warn.apply(console, args);
    addToBuffer('warn', args);
  };

  // Override console.error
  console.error = function(...args: any[]) {
    originalConsole.error.apply(console, args);
    addToBuffer('error', args);
  };

  // Override console.debug
  console.debug = function(...args: any[]) {
    originalConsole.debug.apply(console, args);
    addToBuffer('debug', args);
  };
};

export const stopConsoleCapture = () => {
  if (!isCapturing) return;
  
  isCapturing = false;

  // Restore original console methods
  console.log = originalConsole.log;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  console.debug = originalConsole.debug;
};

export const isCurrentlyCapturing = (): boolean => {
  return isCapturing;
};

// Utility functions for log management
export const getLogBuffer = (): LogEntry[] => [...logBuffer];

export const clearLogBuffer = () => {
  logBuffer.length = 0;
  logListeners.forEach(listener => listener([]));
};

export const exportLogs = (): string => {
  return logBuffer.map(log => {
    let output = `[${log.timestamp}] ${log.level.toUpperCase()}`;
    
    if (log.sourceFile) {
      output += ` ${log.sourceFile}:${log.sourceLine}:${log.sourceColumn}`;
    }
    
    output += `\n${log.message}`;
    
    if (log.args.length > 1) {
      // Include additional arguments
      output += `\nArguments: ${log.args.slice(1).map(arg => {
        try {
          return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg);
        } catch {
          return '[Circular or non-serializable object]';
        }
      }).join(', ')}`;
    }
    
    if (log.stack) {
      output += `\n${log.stack}`;
    }
    
    return output;
  }).join('\n\n');
};

export const subscribeToLogs = (listener: LogListener): (() => void) => {
  logListeners.push(listener);
  
  // Immediately call with current buffer
  listener([...logBuffer]);
  
  // Return unsubscribe function
  return () => {
    const index = logListeners.indexOf(listener);
    if (index > -1) {
      logListeners.splice(index, 1);
    }
  };
};

// For backward compatibility, export a default logger
const logger = {
  getBuffer: getLogBuffer,
  clearBuffer: clearLogBuffer,
  export: exportLogs,
  subscribe: subscribeToLogs,
  startCapture: startConsoleCapture,
  stopCapture: stopConsoleCapture,
  isCapturing: isCurrentlyCapturing,
};

export default logger;
