import { getDebugFlags } from '../debugMode';
import { getAmbientLogContext } from './ambientContext';
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
// session id is kept in sessionStorage so a reload of the same tab stays
// correlated with the records written before it.
// ---------------------------------------------------------------------------

const SESSION_ID_STORAGE_KEY = 'ptbudget.logs.sessionId';

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

function resolveSessionId(): string {
  if (typeof window === 'undefined') return randomId(10);
  try {
    const existing = window.sessionStorage.getItem(SESSION_ID_STORAGE_KEY);
    if (existing) return existing;
    const created = randomId(10);
    window.sessionStorage.setItem(SESSION_ID_STORAGE_KEY, created);
    return created;
  } catch {
    return randomId(10);
  }
}

export const LOG_TAB_ID = randomId(6);
export const LOG_SESSION_ID = resolveSessionId();

let recordCounter = 0;
let correlationCounter = 0;

/**
 * Next correlation id: `<tabId>:<n>`. The worker transport uses it as the
 * message id of every request, and the worker stamps it on the records it
 * writes while handling that request, so app and worker rows join on it.
 */
export function nextCorrelationId(): string {
  correlationCounter += 1;
  return `${LOG_TAB_ID}:${correlationCounter}`;
}

/** The tab a correlation id was minted in (`<tabId>:<n>` → `<tabId>`). */
export function tabIdFromCorrelationId(correlationId: string): string | undefined {
  const separator = correlationId.indexOf(':');
  return separator > 0 ? correlationId.slice(0, separator) : undefined;
}

// ---------------------------------------------------------------------------
// Sink and level
// ---------------------------------------------------------------------------

export const defaultMemorySink = new MemorySink(1000);

export class CompositeSink implements LogSink {
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

/** `trace` under `?debug` (trace and debug are stored), `info` otherwise. */
export function defaultLogLevel(): LogLevel {
  return getDebugFlags().debug ? 'trace' : 'info';
}

let activeSink: LogSink = createDefaultSink();
let activeLevel: LogLevel = defaultLogLevel();

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

/**
 * Builds a record: identity, then the ambient context (current page, last UI
 * interaction), then the explicit context. Exported for the console capture
 * sink, which records raw console calls through the same shape.
 */
export function createRecord(level: LogLevel, message: string, context: LogContext): LogRecord {
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
      ...getAmbientLogContext(),
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
      activeSink.write(createRecord(level, message, { ...this.context, ...context }));
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
