import type { LogRecord, LogSink } from './types';

type MemorySinkListener = (record: LogRecord) => void;

/**
 * Ring buffer of the most recent records. The foundation's default sink and
 * the sink unit tests use; the logging feature replaces it with an IndexedDB
 * sink for persistence.
 */
export class MemorySink implements LogSink {
  private readonly records: LogRecord[] = [];
  private readonly listeners = new Set<MemorySinkListener>();

  constructor(private readonly capacity = 1000) {}

  write(record: LogRecord): void {
    this.records.push(record);
    if (this.records.length > this.capacity) {
      this.records.splice(0, this.records.length - this.capacity);
    }
    for (const listener of this.listeners) listener(record);
  }

  getRecords(): LogRecord[] {
    return [...this.records];
  }

  clear(): void {
    this.records.length = 0;
  }

  subscribe(listener: MemorySinkListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
