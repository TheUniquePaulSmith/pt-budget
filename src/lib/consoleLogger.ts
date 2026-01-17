import { 
  getLogBuffer, 
  subscribeToLogs, 
  clearLogBuffer, 
  exportLogs, 
  startConsoleCapture,
  stopConsoleCapture,
  isCurrentlyCapturing,
  type LogEntry 
} from './logger';

// Re-export the LogEntry type for backward compatibility
export type { LogEntry };

// Console logger that provides access to structured logs
// with console method interception
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

  // Check if console is currently being captured
  isCurrentlyCapturing(): boolean {
    return isCurrentlyCapturing();
  }

  // Start capturing console output
  startCapturing() {
    startConsoleCapture();
  }

  // Stop capturing console output and restore original console methods
  stopCapturing() {
    stopConsoleCapture();
  }
}

export const consoleLogger = new ConsoleLogger();
