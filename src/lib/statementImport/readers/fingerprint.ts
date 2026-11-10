import type { StatementColumn } from '../types';

function normalizeHeaderName(name: string): string {
  return name.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * What identifies a delimited file's shape for saved layouts: its header
 * names, normalised (case, spacing, width) and kept in order. Two exports of
 * the same kind from one bank share it whatever their rows are; a file with
 * no header row is known only by its column count.
 */
export function fingerprintOfColumns(columns: StatementColumn[]): string {
  if (columns.length > 0 && columns.every((column) => column.synthetic)) {
    return `delimited:noheader:${columns.length}`;
  }
  return `delimited:${columns.map((column) => normalizeHeaderName(column.name)).join('|')}`;
}
