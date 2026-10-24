/**
 * Structured logging contracts shared by the app (this module), the
 * SharedWorker (`public/database-logger.js`, plain JS mirroring these shapes)
 * and the Developer Console.
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export const LOG_LEVELS: readonly LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error'];

export const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

/** Where a record originated. `console` marks records captured from raw console.* calls. */
export type LogSource = 'app' | 'worker' | 'console';

/**
 * Traceability fields. Everything is optional at the call site; the logger
 * fills `source`, `tabId` and `sessionId`, and merges parent context from
 * `child()` / `withOperation()`.
 */
export interface LogContext {
  source?: LogSource;
  /** Stable per browser tab (per page load). */
  tabId?: string;
  /** Stable per app session; the logging feature may persist it across reloads. */
  sessionId?: string;
  /** Registry page id the user was on. */
  page?: string;
  /** React component or service class that emitted the record. */
  component?: string;
  /** UI element the user interacted with (data-testid, aria-label or text). */
  element?: string;
  /** Method / user action name, e.g. 'saveBudgetPlan'. */
  operation?: string;
  /** Joins app records to the worker records they caused (also the worker message id). */
  correlationId?: string;
  /** Background process name, e.g. 'notification-scan', 'cloud-sync', 'migration'. */
  process?: string;
  /** Any thrown value; normalised into LogRecord.error by the logger. */
  error?: unknown;
  /** Free-form structured data. */
  [key: string]: unknown;
}

export interface LogErrorInfo {
  name: string;
  message: string;
  stack?: string;
}

export interface LogRecord {
  id: string;
  /** Epoch milliseconds. */
  ts: number;
  level: LogLevel;
  message: string;
  /** Always has source, tabId and sessionId; `error` is removed from here and normalised. */
  context: LogContext;
  error?: LogErrorInfo;
}

export interface LogSink {
  write(record: LogRecord): void;
  flush?(): Promise<void>;
}

export interface Logger {
  trace(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** A logger whose records carry this context merged over the parent's. */
  child(context: LogContext): Logger;
  /** `child({ operation })` with a fresh correlationId, for one user action or request. */
  withOperation(operation: string): Logger;
  /** The merged context this logger stamps onto every record. */
  readonly context: Readonly<LogContext>;
}
