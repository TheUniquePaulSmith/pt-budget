/**
 * The catalog of things the import analysis can find. Each code has a default
 * severity and scope here and a text in `src/locales/<lang>/importIssues.json`
 * (`issues.<code>.title` / `.detail`); `issueCodes.test.ts` keeps the two in
 * step.
 *
 * Ownership during the Import Wizard program: the interpretation agent (B)
 * owns this file; the readers agent (A) may add codes inside the
 * `#region reader codes` block only.
 */

import type { IssueScope, IssueSeverity } from './types';

interface IssueCodeDefinition {
  severity: IssueSeverity;
  scope: IssueScope;
}

export const IMPORT_ISSUE_CODES = {
  // #region reader codes
  /** Not a statement file we read (XLSX, PDF, QIF, HTML, an image…). */
  unsupportedFormat: { severity: 'blocker', scope: 'file' },
  emptyFile: { severity: 'blocker', scope: 'file' },
  /** A header (or OFX envelope) but no transactions. */
  noDataRows: { severity: 'blocker', scope: 'file' },
  /** Not valid UTF-8 and no byte-order mark: decoded as Windows-1252. */
  encodingGuessed: { severity: 'info', scope: 'file' },
  /** Lines above the header row were skipped. */
  preambleSkipped: { severity: 'info', scope: 'file' },
  /** Lines below the data (totals, disclaimers) were skipped. */
  trailerSkipped: { severity: 'info', scope: 'file' },
  /** No header row: columns are named "Column 1", "Column 2"… */
  headerMissing: { severity: 'warning', scope: 'file' },
  duplicateHeaderNames: { severity: 'info', scope: 'file' },
  /** Some rows have more or fewer cells than the header. */
  raggedRows: { severity: 'warning', scope: 'row' },
  /** The last line ends mid-row: the download was probably cut short. */
  truncatedFile: { severity: 'warning', scope: 'file' },
  /** The file carries more than one account. */
  multipleAccountsInFile: { severity: 'info', scope: 'file' },
  // #endregion reader codes

  // Columns and formats
  /** Every date is valid both day-first and month-first; the order was assumed. */
  dateOrderAmbiguous: { severity: 'warning', scope: 'column' },
  /** Some dates only work day-first and others only month-first. */
  dateOrderMixed: { severity: 'blocker', scope: 'column' },
  decimalAmbiguous: { severity: 'warning', scope: 'column' },
  /** Whether charges are positive or negative was inferred, not certain. */
  signAssumed: { severity: 'warning', scope: 'column' },
  noDateColumn: { severity: 'blocker', scope: 'column' },
  noAmountColumn: { severity: 'blocker', scope: 'column' },
  noDescriptionColumn: { severity: 'blocker', scope: 'column' },
  /** A row has a value in both the debit and the credit column. */
  debitCreditBothFilled: { severity: 'warning', scope: 'row' },
  descriptionMostlyBlank: { severity: 'warning', scope: 'column' },
  /** The reference column repeats values, so it is not used as a duplicate key. */
  referenceNotUnique: { severity: 'info', scope: 'column' },
  /** The file's currency differs from the account's. */
  currencyMismatch: { severity: 'warning', scope: 'column' },
  /** A column the import does not use (category, principal / interest split…). */
  columnNotImported: { severity: 'info', scope: 'column' },

  // Rows
  unreadableDate: { severity: 'blocker', scope: 'row' },
  unreadableAmount: { severity: 'blocker', scope: 'row' },
  /** "4.00E+14", "1.23E+05": a spreadsheet rewrote the number. */
  excelMangledNumber: { severity: 'blocker', scope: 'row' },
  blankDescription: { severity: 'warning', scope: 'row' },
  zeroAmount: { severity: 'warning', scope: 'row' },
  futureDate: { severity: 'warning', scope: 'row' },
  /** A date years away from the rest of the file: likely a typo. */
  dateFarFromOthers: { severity: 'warning', scope: 'row' },
  /** Much larger than the other amounts in the file. */
  amountOutlier: { severity: 'info', scope: 'row' },
  /** Marked pending by the bank: it may change or disappear. */
  pendingTransaction: { severity: 'warning', scope: 'row' },
  /** Looks like a total / balance line, not a transaction; skipped. */
  summaryRow: { severity: 'info', scope: 'row' },
  /** The running balance does not follow from the amount. */
  balanceMismatch: { severity: 'warning', scope: 'row' },
  /** Identical to another row in this file. */
  duplicateInFile: { severity: 'warning', scope: 'row' },
  /** Already stored from an earlier import; will not be imported again. */
  alreadyImported: { severity: 'info', scope: 'row' },

  // Accounts
  /** The full account number in the file matches one account. */
  accountRecognised: { severity: 'info', scope: 'account' },
  accountAssumedByLastFour: { severity: 'warning', scope: 'account' },
  accountAssumedByProfile: { severity: 'warning', scope: 'account' },
  accountAssumedByName: { severity: 'warning', scope: 'account' },
  /** Several accounts match the number in the file. */
  accountAmbiguous: { severity: 'blocker', scope: 'account' },
  /** The account number was rewritten by a spreadsheet ("4.00E+14"). */
  accountValueMalformed: { severity: 'warning', scope: 'account' },
  /** The file says credit card, the chosen account is checking (or similar). */
  accountTypeMismatch: { severity: 'warning', scope: 'account' },
  accountUnknown: { severity: 'blocker', scope: 'account' },

  // Coverage against what is already stored
  /** Days between the last import and the start of this file are not covered. */
  gapSinceLastImport: { severity: 'warning', scope: 'coverage' },
  overlapsExisting: { severity: 'info', scope: 'coverage' },
} as const satisfies Record<string, IssueCodeDefinition>;

export type ImportIssueCode = keyof typeof IMPORT_ISSUE_CODES;

export const ALL_IMPORT_ISSUE_CODES = Object.keys(IMPORT_ISSUE_CODES) as ImportIssueCode[];

export function defaultSeverityOf(code: ImportIssueCode): IssueSeverity {
  return IMPORT_ISSUE_CODES[code].severity;
}

export function scopeOf(code: ImportIssueCode): IssueScope {
  return IMPORT_ISSUE_CODES[code].scope;
}
