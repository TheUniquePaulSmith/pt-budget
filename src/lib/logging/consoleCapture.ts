/**
 * Console capture: raw `console.*` calls (third-party code, leftovers) become
 * `source: 'console'` records in the active sink, so the Developer Console
 * still shows them. The echo sink prints through `withConsoleCaptureSuspended`
 * (see consoleGuard.ts) so its own output is never captured back.
 */

import {
  forgetOriginalConsole,
  isConsoleCaptureActive,
  isConsoleCaptureSuspended,
  rememberOriginalConsole,
  type ConsoleMethod,
} from './consoleGuard';
import { createRecord, getLogSink } from './logger';
import type { LogLevel } from './types';

export { getOriginalConsole, isConsoleCaptureActive, withConsoleCaptureSuspended } from './consoleGuard';

const METHOD_LEVELS: Record<ConsoleMethod, LogLevel> = {
  log: 'info',
  info: 'info',
  warn: 'warn',
  error: 'error',
  debug: 'debug',
};

const MAX_ARG_LENGTH = 2000;

export function formatConsoleArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack ?? `${arg.name}: ${arg.message}`;
  if (arg === undefined) return 'undefined';
  if (typeof arg === 'function') return `ƒ ${arg.name || 'anonymous'}()`;
  if (typeof arg === 'object' && arg !== null) {
    try {
      const json = JSON.stringify(arg);
      return json.length > MAX_ARG_LENGTH ? `${json.slice(0, MAX_ARG_LENGTH)}…` : json;
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}

/** Builds the record for one console call: first string argument is the message, the rest are context. */
export function consoleCallToRecord(method: ConsoleMethod, args: unknown[]) {
  const [first, ...rest] = args;
  const message = args.length === 0 ? '' : formatConsoleArg(first);
  const error = args.find((arg) => arg instanceof Error);
  const context: Record<string, unknown> = { source: 'console', component: 'console', consoleMethod: method };
  const extra = rest.filter((arg) => arg !== error);
  if (extra.length > 0) context.args = extra.map(formatConsoleArg);
  if (error) context.error = error;
  return createRecord(METHOD_LEVELS[method], message, context);
}

export function startConsoleCapture(): void {
  if (isConsoleCaptureActive() || typeof console === 'undefined') return;
  const saved: Pick<Console, ConsoleMethod> = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  rememberOriginalConsole(saved);
  (Object.keys(saved) as ConsoleMethod[]).forEach((method) => {
    console[method] = (...args: unknown[]) => {
      saved[method].apply(console, args);
      if (isConsoleCaptureSuspended()) return;
      try {
        getLogSink().write(consoleCallToRecord(method, args));
      } catch {
        // Capturing must never break the caller.
      }
    };
  });
}

export function stopConsoleCapture(): void {
  const saved = forgetOriginalConsole();
  if (!saved) return;
  (Object.keys(saved) as ConsoleMethod[]).forEach((method) => {
    console[method] = saved[method];
  });
}
