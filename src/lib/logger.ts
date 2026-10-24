/**
 * Compatibility shim. The console-capture logger that used to live here was
 * replaced by the structured logger in `src/lib/logging/`; raw `console.*`
 * calls are still captured (as `source: 'console'` records) by
 * `startConsoleCapture`, which `LoggingProvider` starts on mount.
 *
 * Prefer `import { logger } from '@/lib/logging'`.
 */
export {
  logger,
  createLogger,
  startConsoleCapture,
  stopConsoleCapture,
  isConsoleCaptureActive,
} from './logging';
export type { LogRecord, LogLevel, LogContext, Logger } from './logging';
