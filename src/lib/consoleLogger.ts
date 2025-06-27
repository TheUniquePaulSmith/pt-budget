export interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  message: string;
  args: any[];
  stack?: string;
}

class ConsoleLogger {
  private logs: LogEntry[] = [];
  private maxLogs = 1000;
  private originalConsole: Console;
  private listeners: ((logs: LogEntry[]) => void)[] = [];
  private isCapturing = false;

  constructor() {
    this.originalConsole = { ...console };
  }

  startCapturing() {
    if (this.isCapturing) return;
    
    this.isCapturing = true;
    
    // Override console methods
    ['log', 'info', 'warn', 'error', 'debug'].forEach(level => {
      const originalMethod = this.originalConsole[level as keyof Console] as Function;
      
      (console as any)[level] = (...args: any[]) => {
        // Call original method first
        originalMethod.apply(console, args);
        
        // Capture the log
        this.addLog(level as LogEntry['level'], args);
      };
    });

    // Capture unhandled errors
    window.addEventListener('error', this.handleError);
    window.addEventListener('unhandledrejection', this.handleRejection);
  }

  stopCapturing() {
    if (!this.isCapturing) return;
    
    this.isCapturing = false;
    
    // Restore original console methods
    Object.assign(console, this.originalConsole);
    
    // Remove error listeners
    window.removeEventListener('error', this.handleError);
    window.removeEventListener('unhandledrejection', this.handleRejection);
  }

  private handleError = (event: ErrorEvent) => {
    this.addLog('error', [event.message], event.error?.stack);
  };

  private handleRejection = (event: PromiseRejectionEvent) => {
    this.addLog('error', ['Unhandled Promise Rejection:', event.reason]);
  };

  private addLog(level: LogEntry['level'], args: any[], stack?: string) {
    const entry: LogEntry = {
      id: Date.now() + Math.random().toString(36),
      timestamp: new Date(),
      level,
      message: args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' '),
      args,
      stack
    };

    this.logs.push(entry);
    
    // Keep only the last maxLogs entries
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
    
    // Notify listeners
    this.listeners.forEach(listener => listener([...this.logs]));
  }

  subscribe(listener: (logs: LogEntry[]) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  clearLogs() {
    this.logs = [];
    this.listeners.forEach(listener => listener([]));
  }

  exportLogs(): string {
    return this.logs.map(log => 
      `[${log.timestamp.toISOString()}] ${log.level.toUpperCase()}: ${log.message}${log.stack ? '\n' + log.stack : ''}`
    ).join('\n');
  }

  isCurrentlyCapturing(): boolean {
    return this.isCapturing;
  }
}

export const consoleLogger = new ConsoleLogger();
