/**
 * Test helpers: build the contract's inputs from text, so interpretation and
 * analysis tests do not depend on fixture files or on how the readers evolve.
 * Test-only; never import from application code.
 */

import { fingerprintOfColumns } from '../readers/fingerprint';
import type { SourceFile, StatementTable } from '../types';

/** A `SourceFile` from text, encoded as UTF-8. */
export function sourceFileFromText(text: string, name = 'statement.csv'): SourceFile {
  const bytes = new TextEncoder().encode(text);
  return { name, size: bytes.length, bytes };
}

/**
 * A `StatementTable` from already-split cells: the first array is the header,
 * the rest are data rows. Use this (not the reader) in interpretation tests.
 */
export function tableFromCells(cells: string[][], overrides: Partial<StatementTable> = {}): StatementTable {
  const [header, ...rows] = cells;
  const columns = header.map((name, index) => ({ index, name }));
  return {
    format: 'delimited',
    fingerprint: fingerprintOfColumns(columns),
    columns,
    rows: rows.map((row) => columns.map((column) => row[column.index] ?? '')),
    sourceLines: rows.map((_, index) => index + 2),
    meta: { fileName: 'statement.csv', encoding: 'utf-8', delimiter: ',', headerLine: 1, preamble: [], trailer: [], accountHints: [] },
    notes: [],
    ...overrides,
  };
}

/** A `StatementTable` from simple comma-separated text with no quoting. */
export function tableFromCsv(text: string, overrides: Partial<StatementTable> = {}): StatementTable {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return tableFromCells(
    lines.map((line) => line.split(',').map((cell) => cell.trim())),
    overrides
  );
}
