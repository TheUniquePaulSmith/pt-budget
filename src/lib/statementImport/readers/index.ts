/**
 * Readers: bytes → StatementTable.
 *
 * BASELINE (Import Wizard foundation). This reproduces what the old CSV dialog
 * did (UTF-8, header on the first line, PapaParse's delimiter guess) so the
 * pipeline runs end to end. The readers agent replaces the body with encoding
 * detection, preamble / trailer handling, headerless files and OFX / QFX; the
 * signature of `readStatement` is part of the frozen contract.
 */

import Papa from 'papaparse';

import type { ImportIssue, ReadOptions, ReadResult, SourceFile, StatementColumn, StatementTable } from '../types';

import { fingerprintOfColumns } from './fingerprint';

export { fingerprintOfColumns } from './fingerprint';

const fileIssue = (code: 'emptyFile' | 'noDataRows'): ImportIssue => ({ code, severity: 'blocker', scope: 'file' });

export async function readStatement(file: SourceFile, options: ReadOptions = {}): Promise<ReadResult> {
  const encoding = options.encoding ?? 'utf-8';
  const text = new TextDecoder(encoding).decode(file.bytes);
  if (!text.trim()) {
    return { tables: [], issues: [fileIssue('emptyFile')] };
  }

  const parsed = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: true,
    ...(options.delimiter ? { delimiter: options.delimiter } : {}),
  });
  const lines = parsed.data;
  if (lines.length === 0) {
    return { tables: [], issues: [fileIssue('emptyFile')] };
  }

  const columns: StatementColumn[] = lines[0].map((name, index) => ({ index, name: String(name ?? '').trim() }));
  const dataLines = lines.slice(1);
  if (dataLines.length === 0) {
    return { tables: [], issues: [fileIssue('noDataRows')] };
  }

  const table: StatementTable = {
    format: 'delimited',
    fingerprint: fingerprintOfColumns(columns),
    columns,
    // Every row is exactly as wide as the header: short rows are padded, extra cells dropped.
    rows: dataLines.map((cells) => columns.map((column) => String(cells[column.index] ?? ''))),
    // Approximate while blank lines and quoted line breaks are not tracked.
    sourceLines: dataLines.map((_, index) => index + 2),
    meta: {
      fileName: file.name,
      encoding,
      delimiter: parsed.meta.delimiter,
      headerLine: 1,
      preamble: [],
      trailer: [],
      accountHints: [],
    },
    notes: [],
  };
  return { tables: [table], issues: [] };
}
