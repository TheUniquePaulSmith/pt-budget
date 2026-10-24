/**
 * Shared state between console capture and the console echo sink, kept in a
 * leaf module (no imports) so neither of them has to import the other:
 * the untouched console methods and a re-entrancy guard that stops the echo
 * sink's own output from being captured back as a record.
 */

export type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug';

let originalMethods: Pick<Console, ConsoleMethod> | null = null;
let suspended = 0;

export function rememberOriginalConsole(methods: Pick<Console, ConsoleMethod>): void {
  originalMethods = methods;
}

export function forgetOriginalConsole(): Pick<Console, ConsoleMethod> | null {
  const saved = originalMethods;
  originalMethods = null;
  return saved;
}

export function isConsoleCaptureActive(): boolean {
  return originalMethods !== null;
}

/** The untouched console methods (falls back to the live console when capture is off). */
export function getOriginalConsole(): Pick<Console, ConsoleMethod> {
  return originalMethods ?? console;
}

export function isConsoleCaptureSuspended(): boolean {
  return suspended > 0;
}

/** Runs `fn` with capture suspended so console output inside it is printed but not recorded. */
export function withConsoleCaptureSuspended<T>(fn: () => T): T {
  suspended += 1;
  try {
    return fn();
  } finally {
    suspended -= 1;
  }
}
