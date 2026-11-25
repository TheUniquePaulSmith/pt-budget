/**
 * A transaction the file lists more than once.
 *
 * A bank reference belongs to one transaction. Two rows that carry the same
 * reference and are the same in every other cell too are therefore one
 * transaction printed twice: an export that pages badly repeats whole
 * stretches of the file (one bank's card export sends each row up to six
 * times). That is not the "two coffees on one day" case, where the rows match
 * in date, amount and description but each has a reference of its own.
 *
 * Two rows with the same reference that differ anywhere say something else:
 * the column does not tell transactions apart, and nothing follows from it.
 */

import { isPlaceholderReference } from '../shared/references';

import { isExcelMangled } from './cells';

/** True when two rows of the file have the same text in every cell. */
export function sameCells(first: string[], second: string[]): boolean {
  const width = Math.max(first.length, second.length);
  for (let cell = 0; cell < width; cell += 1) {
    if ((first[cell] ?? '').trim() !== (second[cell] ?? '').trim()) return false;
  }
  return true;
}

/** The reference a row carries, or null for a blank, placeholder ("0", "N/A") or spreadsheet-damaged cell. */
export function referenceOf(cells: string[], column: number): string | null {
  const value = (cells[column] ?? '').trim();
  return isPlaceholderReference(value) || isExcelMangled(value) ? null : value;
}

/**
 * Indexes of the rows that repeat an earlier row: the same reference in
 * `column` and every cell the same. Null when two rows share a reference and
 * differ, because the column is then not a transaction id. Rows for which
 * `ignored` is true (left out by the user) are neither a first listing nor a
 * repeat.
 */
export function repeatedListings(
  rows: string[][],
  column: number,
  ignored: (index: number) => boolean = () => false
): Set<number> | null {
  const firstListing = new Map<string, string[]>();
  const repeats = new Set<number>();
  for (let index = 0; index < rows.length; index += 1) {
    if (ignored(index)) continue;
    const reference = referenceOf(rows[index], column);
    if (reference === null) continue;
    const first = firstListing.get(reference);
    if (!first) firstListing.set(reference, rows[index]);
    else if (sameCells(first, rows[index])) repeats.add(index);
    else return null;
  }
  return repeats;
}
