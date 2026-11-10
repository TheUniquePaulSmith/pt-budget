import { IMPORT_ISSUE_CODES, type ImportIssueCode } from '../issueCodes';
import type { ImportIssue, ReadResult } from '../types';

import type { UnsupportedKind } from './sniff';

/**
 * A reader finding with the catalog's severity and scope. What each code
 * carries in `params`:
 *   unsupportedFormat       kind      (see `UnsupportedKind`)
 *   encodingGuessed         encoding  the label that was used
 *   preambleSkipped         count     lines above the header
 *   trailerSkipped          count     lines below the data
 *   headerMissing           columns   how many "Column n" names were made up
 *   duplicateHeaderNames    names     the repeated names, comma-separated; count
 *   raggedRows              count     (the row indexes are in `rows`)
 *   truncatedFile           line      file line of the row that was cut off
 *   multipleAccountsInFile  count     statements in the file
 */
export function readerIssue(code: ImportIssueCode, extra: Pick<ImportIssue, 'rows' | 'params'> = {}): ImportIssue {
  return { code, severity: IMPORT_ISSUE_CODES[code].severity, scope: IMPORT_ISSUE_CODES[code].scope, ...extra };
}

/** Nothing to read: no tables, and the one issue that says so. */
export function unreadable(code: 'emptyFile' | 'noDataRows'): ReadResult {
  return { tables: [], issues: [readerIssue(code)] };
}

/** Not a file we read: no tables, and what it is instead. */
export function unsupported(kind: UnsupportedKind): ReadResult {
  return { tables: [], issues: [readerIssue('unsupportedFormat', { params: { kind } })] };
}
