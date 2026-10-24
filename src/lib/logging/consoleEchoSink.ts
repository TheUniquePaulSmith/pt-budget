import { LOG_LEVEL_ORDER, type LogLevel, type LogRecord, type LogSink } from './types';

export interface ConsoleEchoSinkOptions {
  /** Lowest level echoed to the console; records below it are not printed. */
  minLevel?: LogLevel;
  /** Console-like target, injectable for tests. */
  console?: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
}

/**
 * Prints records to the browser console in a compact, greppable form:
 *   [Component] message {context}
 * The foundation echoes everything so the console-capture Developer Console
 * keeps showing structured logs until the IndexedDB-backed console lands.
 */
export class ConsoleEchoSink implements LogSink {
  private readonly minLevel: number;
  private readonly target: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;

  constructor(options: ConsoleEchoSinkOptions = {}) {
    this.minLevel = LOG_LEVEL_ORDER[options.minLevel ?? 'trace'];
    this.target = options.console ?? console;
  }

  write(record: LogRecord): void {
    if (LOG_LEVEL_ORDER[record.level] < this.minLevel) return;

    const prefix = record.context.component ? `[${record.context.component}] ` : '';
    const { source: _source, tabId: _tabId, sessionId: _sessionId, component: _component, ...rest } = record.context;
    const args: unknown[] = [`${prefix}${record.message}`];
    if (Object.keys(rest).length > 0) args.push(rest);
    if (record.error) args.push(record.error.stack ?? `${record.error.name}: ${record.error.message}`);

    switch (record.level) {
      case 'trace':
      case 'debug':
        this.target.debug(...args);
        break;
      case 'info':
        this.target.info(...args);
        break;
      case 'warn':
        this.target.warn(...args);
        break;
      case 'error':
        this.target.error(...args);
        break;
    }
  }
}
