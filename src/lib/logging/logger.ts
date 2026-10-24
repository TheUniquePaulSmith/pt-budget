import { getDebugFlags } from '../debugMode';
import { ConsoleEchoSink } from './consoleEchoSink';
import { MemorySink } from './memorySink';
import {
  LOG_LEVEL_ORDER,
  type LogContext,
  type LogErrorInfo,
  type LogLevel,
  type LogRecord,
  type LogSink,
  type Logger,
} from './types';

// ---------------------------------------------------------------------------
// Identity: one tabId per page load, one sessionId per app session. The
// logging feature may persist the session id (sessionStorage) so a reload
// stays correlated; the foundation keeps both in memory.
// ---------------------------------------------------------------------------

function randomId(length = 8): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  const cryptoObj = typeof globalThis.crypto !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(length);
    cryptoObj.getRandomValues(bytes);
    for (const byte of bytes) id += alphabet[byte % alphabet.length];
    return id;
  }
  for (let i = 0; i < length; i += 1) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  return id;
}

export const LOG_TAB_ID = randomId(6);
export const LOG_SESSION_ID = randomId(10);

let recordCounter = 0;
let correlationCounter = 0;

/** Next correlation id: `<tabId>.<n>`; the worker transport embeds this in message ids. */
export function nextCorrelationId(): string {
  correlationCounter += 1;
  return `${LOG_TAB_ID}.${correlationCounter}`;
}

// ---------------------------------------------------------------------------
// Sink and level
// ---------------------------------------------------------------------------

export const defaultMemorySink = new MemorySink(1000);

class CompositeSink implements LogSink {
  constructor(private readonly sinks: LogSink[]) {}
  write(record: LogRecord): void {
    for (const sink of this.sinks) {
      try {
        sink.write(record);
      } catch {
        // A failing sink must never break the caller.
      }
    }
  }
  async flush(): Promise<void> {
    await Promise.all(this.sinks.map((sink) => sink.flush?.()));
  }
}

function createDefaultSink(): LogSink {
  return new CompositeSink([defaultMemorySink, new ConsoleEchoSink()]);
}

let activeSink: LogSink = createDefaultSink();
let activeLevel: LogLevel = getDebugFlags().debug ? 'debug' : 'info';

/** Replace the sink (returns the previous one). The logging feature installs its IndexedDB sink here. */
export function setLogSink(sink: LogSink): LogSink {
  const previous = activeSink;
  activeSink = sink;
  return previous;
}

export function getLogSink(): LogSink {
  return activeSink;
}

/** Restore the foundation default (memory ring + console echo). */
export function resetLogSink(): void {
  activeSink = createDefaultSink();
}

export function setLogLevel(level: LogLevel): void {
  activeLevel = level;
}

export function getLogLevel(): LogLevel {
  return activeLevel;
}

export function isLevelEnabled(level: LogLevel): boolean {
  return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[activeLevel];
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export function normalizeError(value: unknown): LogErrorInfo | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof value === 'object') {
    const candidate = value as { name?: unknown; message?: unknown; stack?: unknown };
    if (typeof candidate.message === 'string') {
      return {
        name: typeof candidate.name === 'string' ? candidate.name : 'Error',
        message: candidate.message,
        stack: typeof candidate.stack === 'string' ? candidate.stack : undefined,
      };
    }
    try {
      return { name: 'Error', message: JSON.stringify(value) };
    } catch {
      return { name: 'Error', message: String(value) };
    }
  }
  return { name: 'Error', message: String(value) };
}

function buildRecord(level: LogLevel, message: string, context: LogContext): LogRecord {
  const { error, ...rest } = context;
  recordCounter += 1;
  const record: LogRecord = {
    id: `${LOG_TAB_ID}-${recordCounter}`,
    ts: Date.now(),
    level,
    message,
    context: {
      source: 'app',
      tabId: LOG_TAB_ID,
      sessionId: LOG_SESSION_ID,
      ...rest,
    },
  };
  const normalized = normalizeError(error);
  if (normalized) record.error = normalized;
  return record;
}

class LoggerImpl implements Logger {
  constructor(readonly context: Readonly<LogContext>) {}

  private emit(level: LogLevel, message: string, context?: LogContext): void {
    if (!isLevelEnabled(level)) return;
    try {
      activeSink.write(buildRecord(level, message, { ...this.context, ...context }));
    } catch {
      // Logging must never throw into application code.
    }
  }

  trace(message: string, context?: LogContext): void {
    this.emit('trace', message, context);
  }
  debug(message: string, context?: LogContext): void {
    this.emit('debug', message, context);
  }
  info(message: string, context?: LogContext): void {
    this.emit('info', message, context);
  }
  warn(message: string, context?: LogContext): void {
    this.emit('warn', message, context);
  }
  error(message: string, context?: LogContext): void {
    this.emit('error', message, context);
  }

  child(context: LogContext): Logger {
    return new LoggerImpl({ ...this.context, ...context });
  }

  withOperation(operation: string): Logger {
    return this.child({ operation, correlationId: nextCorrelationId() });
  }
}

export function createLogger(context: LogContext = {}): Logger {
  return new LoggerImpl({ source: 'app', ...context });
}

/** Root app logger. Prefer `logger.child({ component })` at module scope. */
export const logger: Logger = createLogger();
