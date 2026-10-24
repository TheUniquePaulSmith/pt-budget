/**
 * Structured logging for the app.
 *
 *   import { logger } from '@/lib/logging';
 *   const log = logger.child({ component: 'CSVImport' });
 *   log.info('Analyzed file', { rows: 120 });
 *   const opLog = log.withOperation('importRows');   // fresh correlationId
 *   opLog.error('Import failed', { error });
 *
 * Levels: trace < debug < info < warn < error. The default level is `info`,
 * or `debug` when the URL carries `?debug`. The default sink keeps the last
 * 1000 records in memory and echoes to the console; the logging feature swaps
 * in a persistent IndexedDB sink via `setLogSink`.
 */
export type { LogContext, LogErrorInfo, LogLevel, LogRecord, LogSink, LogSource, Logger } from './types';
export { LOG_LEVELS, LOG_LEVEL_ORDER } from './types';
export { MemorySink } from './memorySink';
export { ConsoleEchoSink, type ConsoleEchoSinkOptions } from './consoleEchoSink';
export {
  LOG_SESSION_ID,
  LOG_TAB_ID,
  createLogger,
  defaultMemorySink,
  getLogLevel,
  getLogSink,
  isLevelEnabled,
  logger,
  nextCorrelationId,
  normalizeError,
  resetLogSink,
  setLogLevel,
  setLogSink,
} from './logger';
