/**
 * Switches the logger from the foundation's in-memory sink to the persistent
 * IndexedDB sink (plus the console echo), replaying whatever was logged
 * before the switch so startup records are not lost. Also starts console
 * capture so raw `console.*` calls land in the same store. Client-only and
 * idempotent; `LoggingProvider` calls it on mount.
 */

import { startConsoleCapture, stopConsoleCapture } from './consoleCapture';
import { ConsoleEchoSink } from './consoleEchoSink';
import { IdbLogSink } from './idbLogSink';
import { hasIndexedDb } from './logDatabase';
import { CompositeSink, defaultMemorySink, logger, resetLogSink, setLogSink } from './logger';
import { closeLogStore } from './logStore';

let installed: IdbLogSink | null = null;

export function getPersistentLogSink(): IdbLogSink | null {
  return installed;
}

export function installPersistentLogging(): IdbLogSink | null {
  if (installed) return installed;
  if (typeof window === 'undefined' || !hasIndexedDb()) return null;

  const sink = new IdbLogSink();
  for (const record of defaultMemorySink.getRecords()) sink.write(record);
  defaultMemorySink.clear();
  setLogSink(new CompositeSink([sink, new ConsoleEchoSink()]));
  installed = sink;
  startConsoleCapture();

  const flush = () => void sink.flush();
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  logger.debug('Persistent logging installed', { component: 'Logging' });
  return sink;
}

/**
 * Closes every connection this tab holds on the log database so it can be
 * deleted (Reset App with "Also clear diagnostic logs"). Logging falls back
 * to the in-memory sink for the rest of the page's life.
 */
export async function uninstallPersistentLogging(): Promise<void> {
  stopConsoleCapture();
  const sink = installed;
  installed = null;
  resetLogSink();
  await closeLogStore();
  if (sink) await sink.close();
}
