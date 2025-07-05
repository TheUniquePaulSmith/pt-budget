// Browser-compatible structured logger
export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  meta?: any;
  stack?: string;
}

// In-memory log storage for browser
const logBuffer: LogEntry[] = [];
const MAX_LOGS = 1000;

// Log listeners for real-time updates
type LogListener = (logs: LogEntry[]) => void;
const logListeners: LogListener[] = [];

const addToBuffer = (level: LogEntry['level'], message: string, meta?: any, stack?: string) => {
  const entry: LogEntry = {
    id: Date.now() + Math.random().toString(36),
    timestamp: new Date().toISOString(),
    level,
    message,
    meta,
    stack
  };
  
  logBuffer.push(entry);
  
  // Keep only the last MAX_LOGS entries
  if (logBuffer.length > MAX_LOGS) {
    logBuffer.splice(0, logBuffer.length - MAX_LOGS);
  }
  
  // Notify listeners
  logListeners.forEach(listener => listener([...logBuffer]));
};

// Format log message for console output
const formatConsoleMessage = (level: string, message: string, meta?: any): string => {
  const timestamp = new Date().toTimeString().slice(0, 8);
  let formatted = `${timestamp} [${level.toUpperCase()}]: ${message}`;
  
  if (meta && Object.keys(meta).length > 0) {
    formatted += `\n${JSON.stringify(meta, null, 2)}`;
  }
  
  return formatted;
};

// Create a logger with a specific prefix
const createLogger = (prefix: string) => ({
  info: (message: string, meta?: any) => {
    const fullMessage = `[${prefix}] ${message}`;
    const formatted = formatConsoleMessage('info', fullMessage, meta);
    
    // Use original console methods to preserve source mapping
    console.info(formatted);
    addToBuffer('info', fullMessage, meta);
  },
  
  error: (message: string, error?: Error | any, meta?: any) => {
    const fullMessage = `[${prefix}] ${message}`;
    const errorMeta = error instanceof Error ? {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...meta
    } : { error, ...meta };
    
    const formatted = formatConsoleMessage('error', fullMessage, errorMeta);
    
    // Use original console methods to preserve source mapping
    console.error(formatted);
    addToBuffer('error', fullMessage, errorMeta, error instanceof Error ? error.stack : undefined);
  },
  
  warn: (message: string, meta?: any) => {
    const fullMessage = `[${prefix}] ${message}`;
    const formatted = formatConsoleMessage('warn', fullMessage, meta);
    
    // Use original console methods to preserve source mapping
    console.warn(formatted);
    addToBuffer('warn', fullMessage, meta);
  },
  
  debug: (message: string, meta?: any) => {
    const fullMessage = `[${prefix}] ${message}`;
    const formatted = formatConsoleMessage('debug', fullMessage, meta);
    
    // Use original console methods to preserve source mapping
    console.debug(formatted);
    addToBuffer('debug', fullMessage, meta);
  }
});

// Enhanced logger with database-specific methods
export const dbLogger = createLogger('WaSQLiteDB');

// General app logger
export const appLogger = createLogger('App');

// Utility functions for log management
export const getLogBuffer = (): LogEntry[] => [...logBuffer];

export const clearLogBuffer = () => {
  logBuffer.length = 0;
  logListeners.forEach(listener => listener([]));
};

export const exportLogs = (): string => {
  return logBuffer.map(log => {
    let output = `[${log.timestamp}] ${log.level.toUpperCase()}: ${log.message}`;
    
    if (log.meta && Object.keys(log.meta).length > 0) {
      output += `\n${JSON.stringify(log.meta, null, 2)}`;
    }
    
    if (log.stack) {
      output += `\n${log.stack}`;
    }
    
    return output;
  }).join('\n');
};

export const subscribeToLogs = (listener: LogListener): (() => void) => {
  logListeners.push(listener);
  
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
  info: appLogger.info,
  error: appLogger.error,
  warn: appLogger.warn,
  debug: appLogger.debug,
  getBuffer: getLogBuffer,
  clearBuffer: clearLogBuffer,
  export: exportLogs,
  subscribe: subscribeToLogs
};

export default logger;
