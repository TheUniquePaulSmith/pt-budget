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
 * or `trace` when the URL carries `?debug` (trace and debug are then stored
 * too). Records go to the persistent IndexedDB sink (`ptbudgetapp-logs`, a
 * 20k-entry ring shared with the SharedWorker) once `LoggingProvider` has
 * installed it, and are always echoed to the console at warn/error — or at
 * every level with `?debug_output_console=true`.
 *
 * Every record also carries the ambient context: the current registry page
 * and the UI element the user last interacted with (see ambientContext.ts),
 * and the worker transport copies the same fields into each request's
 * `meta` so app and worker rows join on `correlationId`.
 */
export type { LogContext, LogErrorInfo, LogLevel, LogRecord, LogSink, LogSource, Logger } from './types';
export { LOG_LEVELS, LOG_LEVEL_ORDER } from './types';
export { MemorySink } from './memorySink';
export { ConsoleEchoSink, defaultEchoLevel, type ConsoleEchoSinkOptions } from './consoleEchoSink';
export { IdbLogSink, toStorable, type IdbLogSinkOptions } from './idbLogSink';
export {
  CompositeSink,
  LOG_SESSION_ID,
  LOG_TAB_ID,
  createLogger,
  createRecord,
  defaultLogLevel,
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
  tabIdFromCorrelationId,
} from './logger';
export {
  INTERACTION_STAMP_WINDOW_MS,
  NAV_TEST_ID_PREFIX,
  pageIdFromNavTestId,
  getAmbientLogContext,
  getAmbientPage,
  getLastInteraction,
  noteInteraction,
  resetAmbientLogContext,
  setAmbientOperation,
  setAmbientPage,
  subscribeAmbientPage,
  type AmbientInteraction,
} from './ambientContext';
export {
  LOGS_CHANNEL,
  LOGS_DB_NAME,
  LOGS_STORE,
  deleteLogsDatabase,
  type LogChannelMessage,
  type StoredLogRecord,
} from './logDatabase';
export {
  clearLogs,
  closeLogStore,
  countLogs,
  matchesLogFilters,
  readAllLogs,
  readCorrelation,
  readLogPage,
  searchText,
  subscribeToLogUpdates,
  type LogFilters,
  type LogPage,
  type LogPageRequest,
} from './logStore';
export {
  SOURCE_TAGS,
  compareChronologically,
  downloadLogExports,
  downloadTextFile,
  exportDateStamp,
  exportFileNames,
  formatNdjson,
  formatTimeline,
  formatTimelineLine,
  sourceTag,
} from './logExport';
export {
  DEFAULT_LOG_RETENTION,
  LOG_RETENTION_AGE_OPTIONS,
  LOG_RETENTION_ENTRY_OPTIONS,
  LOG_RETENTION_STORAGE_KEY,
  getLogRetention,
  normalizeLogRetention,
  setLogRetention,
  subscribeLogRetention,
  type LogRetention,
} from './logRetention';
export {
  consoleCallToRecord,
  isConsoleCaptureActive,
  startConsoleCapture,
  stopConsoleCapture,
  withConsoleCaptureSuspended,
} from './consoleCapture';
export {
  getPersistentLogSink,
  installPersistentLogging,
  uninstallPersistentLogging,
} from './installPersistentLogging';
