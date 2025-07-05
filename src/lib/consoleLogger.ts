import { getLogBuffer, subscribeToLogs, clearLogBuffer, exportLogs, type LogEntry } from './logger';

// Re-export the LogEntry type for backward compatibility
export type { LogEntry };

// Simple console logger that provides access to structured logs
// without monkey patching console methods
class ConsoleLogger {
  private listeners: ((logs: LogEntry[]) => void)[] = [];

  // Get all logs from the buffer
  getLogs(): LogEntry[] {
    return getLogBuffer();
  }

  // Subscribe to log updates
  subscribe(listener: (logs: LogEntry[]) => void) {
    this.listeners.push(listener);
    
    // Subscribe to the main logger
    const unsubscribe = subscribeToLogs((logs) => {
      this.listeners.forEach(l => l(logs));
    });
    
    return () => {
      // Remove from local listeners
      this.listeners = this.listeners.filter(l => l !== listener);
      // Unsubscribe from main logger
      unsubscribe();
    };
  }

  // Clear all logs
  clearLogs() {
    clearLogBuffer();
  }

  // Export logs as text
  exportLogs(): string {
    return exportLogs();
  }

  // For backward compatibility - always return false since we don't monkey patch
  isCurrentlyCapturing(): boolean {
    return false;
  }

  // No-op methods for backward compatibility
  startCapturing() {
    // Do nothing - we don't monkey patch console anymore
  }

  stopCapturing() {
    // Do nothing - we don't monkey patch console anymore
  }
}

export const consoleLogger = new ConsoleLogger();
