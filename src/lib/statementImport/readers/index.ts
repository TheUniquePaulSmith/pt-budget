/**
 * Readers: bytes → StatementTable.
 *
 *   bytes ─► sniffBinaryKind ─► decodeStatementBytes ─► sniffTextKind ─┬─► readOfx        (OFX 1.x / 2.x, QFX)
 *            (XLSX, PDF…)       (BOM, UTF-8, UTF-16,    (OFX, QIF,     └─► readDelimited  (comma, semicolon, tab, pipe)
 *                                Windows-1252)           HTML…)
 *
 * The file is judged by its content, never by its extension or by the
 * language of the user interface. A file we cannot read comes back with no
 * tables and one issue that says why (`unsupportedFormat` carries
 * `params.kind`); everything the reader had to decide on a readable file
 * (encoding guessed, lines skipped, rows padded) is a note on the table.
 *
 * `readStatement`'s signature is part of the frozen contract.
 */

import type { ReadOptions, ReadResult, SourceFile } from '../types';

import { readDelimited } from './delimited';
import { decodeStatementBytes } from './encoding';
import { unreadable, unsupported } from './issues';
import { readOfx } from './ofx';
import { sniffBinaryKind, sniffTextKind } from './sniff';

export { fingerprintOfColumns, fingerprintOfOfx } from './fingerprint';
export type { UnsupportedKind } from './sniff';

export async function readStatement(file: SourceFile, options: ReadOptions = {}): Promise<ReadResult> {
  const { bytes } = file;
  if (bytes.length === 0) return unreadable('emptyFile');

  const binaryKind = sniffBinaryKind(bytes);
  if (binaryKind) return unsupported(binaryKind);

  const decoded = decodeStatementBytes(bytes, options.encoding);
  if (!/\S/.test(decoded.text)) return unreadable('emptyFile');

  const kind = sniffTextKind(decoded.text);
  if (kind === 'ofx') return readOfx(file, decoded);
  if (kind !== 'delimited') return unsupported(kind);
  return readDelimited(file, decoded, options);
}
