/**
 * Export formats for the Developer Console.
 *
 *   logs-<date>.ndjson  one JSON record per line (machine-readable)
 *   logs-<date>.txt     merged, human-readable timeline with [APP] / [WORKER]
 *                       tags and correlation ids aligned in a fixed column
 */

import type { LogRecord, LogSource } from './types';

export const SOURCE_TAGS: Record<LogSource, string> = {
  app: '[APP]',
  worker: '[WORKER]',
  console: '[CONSOLE]',
};

const TAG_WIDTH = Math.max(...Object.values(SOURCE_TAGS).map((tag) => tag.length));
const LEVEL_WIDTH = 5;
const CORRELATION_PLACEHOLDER = '-';

/** Keys of `context` that are rendered in their own columns and therefore left out of the trailing JSON. */
const COLUMN_KEYS = new Set(['source', 'tabId', 'sessionId', 'page', 'component', 'operation', 'correlationId', 'element', 'process']);

export function sourceTag(record: LogRecord): string {
  const source = (record.context.source ?? 'app') as LogSource;
  return SOURCE_TAGS[source] ?? SOURCE_TAGS.app;
}

export function formatIsoTimestamp(ts: number): string {
  return new Date(ts).toISOString();
}

export function exportDateStamp(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function exportFileNames(date: Date = new Date()): { ndjson: string; txt: string } {
  const stamp = exportDateStamp(date);
  return { ndjson: `logs-${stamp}.ndjson`, txt: `logs-${stamp}.txt` };
}

/** One JSON object per line, oldest first. `seq` (a local storage detail) is dropped. */
export function formatNdjson(records: readonly LogRecord[]): string {
  const sorted = [...records].sort(compareChronologically);
  return sorted
    .map((record) => {
      const { seq: _seq, ...rest } = record as LogRecord & { seq?: number };
      return JSON.stringify(rest);
    })
    .join('\n');
}

export function compareChronologically(a: LogRecord, b: LogRecord): number {
  if (a.ts !== b.ts) return a.ts - b.ts;
  const seqA = (a as { seq?: number }).seq;
  const seqB = (b as { seq?: number }).seq;
  if (seqA !== undefined && seqB !== undefined) return seqA - seqB;
  return 0;
}

function describeContext(record: LogRecord): string {
  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record.context)) {
    if (COLUMN_KEYS.has(key) || value === undefined) continue;
    extras[key] = value;
  }
  if (Object.keys(extras).length === 0) return '';
  try {
    return ` ${JSON.stringify(extras)}`;
  } catch {
    return ' {unserializable context}';
  }
}

function describeWhere(record: LogRecord): string {
  const parts: string[] = [];
  if (record.context.page) parts.push(`page=${record.context.page}`);
  if (record.context.component) parts.push(`component=${record.context.component}`);
  if (record.context.operation) parts.push(`op=${record.context.operation}`);
  if (record.context.process) parts.push(`process=${record.context.process}`);
  if (record.context.element) parts.push(`element=${JSON.stringify(record.context.element)}`);
  return parts.length > 0 ? ` (${parts.join(' ')})` : '';
}

/** One record as a timeline line (plus indented error lines). */
export function formatTimelineLine(record: LogRecord, correlationWidth: number): string {
  const tag = sourceTag(record).padEnd(TAG_WIDTH);
  const level = record.level.toUpperCase().padEnd(LEVEL_WIDTH);
  const correlation = (record.context.correlationId ?? CORRELATION_PLACEHOLDER).padEnd(correlationWidth);
  let line = `${formatIsoTimestamp(record.ts)} ${tag} ${level} ${correlation} ${record.message}${describeWhere(record)}${describeContext(record)}`;
  if (record.error) {
    const detail = record.error.stack ?? `${record.error.name}: ${record.error.message}`;
    line += `\n${detail
      .split('\n')
      .map((errorLine) => `    ${errorLine}`)
      .join('\n')}`;
  }
  return line;
}

/** Merged app + worker timeline, oldest first, with a header. */
export function formatTimeline(records: readonly LogRecord[], exportedAt: Date = new Date()): string {
  const sorted = [...records].sort(compareChronologically);
  const correlationWidth = Math.max(
    CORRELATION_PLACEHOLDER.length,
    ...sorted.map((record) => record.context.correlationId?.length ?? 0)
  );
  const sources = new Set(sorted.map((record) => sourceTag(record)));
  const header = [
    `# ptbudget diagnostic logs — exported ${exportedAt.toISOString()}`,
    `# ${sorted.length} record(s); sources: ${[...sources].join(' ') || 'none'}`,
    `# columns: timestamp source level correlationId message (page component op process element) {context}`,
    '',
  ];
  return [...header, ...sorted.map((record) => formatTimelineLine(record, correlationWidth))].join('\n');
}

/** Triggers a browser download of `content` under `fileName`. */
export function downloadTextFile(fileName: string, content: string, mimeType: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Defer revocation so the browser has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Downloads both export files for `records`. */
export function downloadLogExports(records: readonly LogRecord[], date: Date = new Date()): { ndjson: string; txt: string } {
  const names = exportFileNames(date);
  downloadTextFile(names.ndjson, formatNdjson(records), 'application/x-ndjson');
  downloadTextFile(names.txt, formatTimeline(records, date), 'text/plain');
  return names;
}
