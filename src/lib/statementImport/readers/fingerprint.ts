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

/**
 * What identifies an OFX / QFX statement's shape: who issued it (`<ORG>`,
 * else `<FID>`) and the kind of account. The columns are fixed, so every
 * statement of that kind from that bank shares one saved layout (in practice:
 * the remembered account and sign).
 */
export function fingerprintOfOfx(institution: string | null, accountType: string | null): string {
  return `ofx:${normalizeHeaderName(institution ?? '') || 'unknown'}:${accountType ?? 'unknown'}`;
}
