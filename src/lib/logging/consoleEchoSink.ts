import { getDebugFlags } from '../debugMode';
import { getOriginalConsole, withConsoleCaptureSuspended } from './consoleGuard';
import { LOG_LEVEL_ORDER, type LogLevel, type LogRecord, type LogSink } from './types';

export interface ConsoleEchoSinkOptions {
  /**
   * Lowest level echoed to the console. Defaults to `warn`, or `trace`
   * (everything) when the URL carries `?debug_output_console=true`.
   */
  minLevel?: LogLevel;
  /** Console-like target, injectable for tests. */
  console?: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
}

/** The echo level the current URL asks for: everything under `?debug_output_console`, warnings otherwise. */
export function defaultEchoLevel(): LogLevel {
  return getDebugFlags().debugOutputConsole ? 'trace' : 'warn';
}

/**
 * Prints records to the browser console in a compact, greppable form:
 *   [Component] message {context}
 * Always echoes warn / error; echoes everything with `?debug_output_console`.
 * Records captured from the console itself (`source: 'console'`) are never
 * echoed back — they were printed by the original call.
 */
export class ConsoleEchoSink implements LogSink {
  private readonly minLevel: number;
  private readonly target: Pick<Console, 'debug' | 'info' | 'warn' | 'error'> | null;

  constructor(options: ConsoleEchoSinkOptions = {}) {
    this.minLevel = LOG_LEVEL_ORDER[options.minLevel ?? defaultEchoLevel()];
    this.target = options.console ?? null;
  }

  write(record: LogRecord): void {
    if (LOG_LEVEL_ORDER[record.level] < this.minLevel) return;
    if (record.context.source === 'console') return;

    const prefix = record.context.component ? `[${record.context.component}] ` : '';
    const { source: _source, tabId: _tabId, sessionId: _sessionId, component: _component, ...rest } = record.context;
    const args: unknown[] = [`${prefix}${record.message}`];
    if (Object.keys(rest).length > 0) args.push(rest);
    if (record.error) args.push(record.error.stack ?? `${record.error.name}: ${record.error.message}`);

    const target = this.target ?? getOriginalConsole();
    withConsoleCaptureSuspended(() => {
      switch (record.level) {
        case 'trace':
        case 'debug':
          target.debug(...args);
          break;
        case 'info':
          target.info(...args);
          break;
        case 'warn':
          target.warn(...args);
          break;
        case 'error':
          target.error(...args);
          break;
      }
    });
  }
}
