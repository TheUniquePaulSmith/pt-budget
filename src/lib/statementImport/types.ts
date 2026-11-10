/**
 * Statement import: the contract between the four stages of the Import Wizard.
 *
 *   bytes ─► readers ─► StatementTable ─► interpret ─► LayoutProposal + AnalysisReport
 *                                                         │ rows the user accepted
 *   wizard UI ◄── useImportWizardSlice ◄── databaseService.imports (resolve accounts, stage, commit)
 *
 * Everything in `src/lib/statementImport/` is pure: no React, no database, no
 * `window`. The service-side shapes at the bottom of this file are what
 * `databaseService.imports` takes and returns.
 *
 * FROZEN during the Import Wizard feature program: a change here is a
 * foundation patch merged before any agent rebases, never an agent edit.
 */

import type { AccountType, ImportProfile } from '@/types/database';
import type { TypeDecision } from '@/types/classification';

import type { CsvDateOrder } from '../dateOnly';
import type { ImportIssueCode } from './issueCodes';

// ---------------------------------------------------------------------------
// Reading: bytes → StatementTable
// ---------------------------------------------------------------------------

/** `delimited` = CSV / TSV / semicolon / pipe text; `ofx` = OFX 1.x SGML, OFX 2.x XML and QFX. */
export type StatementFormat = 'delimited' | 'ofx';

/** A file as the user dropped it. Readers own decoding, so this is bytes, never a string. */
export interface SourceFile {
  name: string;
  size: number;
  bytes: Uint8Array;
}

/**
 * Something in the file that says which account it belongs to.
 *   number       an account or card number as printed ("XXXX-XXXX-1234", "400000000004821")
 *   label        text with no usable number ("Joint Checking")
 *   institution  the bank's name (OFX <ORG>, a preamble line, the file name)
 *   accountType  OFX <ACCTTYPE> mapped to an app account type ("checking")
 *   currency     ISO 4217 code (OFX <CURDEF>, a currency column)
 */
export type AccountHintKind = 'number' | 'label' | 'institution' | 'accountType' | 'currency';
export type AccountHintSource = 'column' | 'preamble' | 'ofx' | 'fileName';

export interface AccountHint {
  kind: AccountHintKind;
  /** As printed in the file; consumers normalise. */
  value: string;
  source: AccountHintSource;
}

export interface StatementColumn {
  /** Position in every `rows` entry. */
  index: number;
  /** Header text, trimmed; "Column 1" style when the file has no header row. */
  name: string;
  /** True when the reader made the name up because the file has no header row. */
  synthetic?: boolean;
}

export interface StatementMeta {
  fileName: string;
  /** WHATWG encoding label the bytes were decoded with ("utf-8", "utf-16le", "windows-1252"). */
  encoding: string;
  /** Delimited files: the cell separator that was used. */
  delimiter?: string;
  /** 1-based line of the header row in the file; null when the file has none. */
  headerLine?: number | null;
  /** Lines above the header that were skipped (bank name, account number, date range). */
  preamble: string[];
  /** Lines below the data that were skipped (totals, disclaimers). */
  trailer: string[];
  /** File-level hints; per-row account values stay in the account column. */
  accountHints: AccountHint[];
  /** OFX: the statement's own period and closing balance. */
  statementStart?: string | null;
  statementEnd?: string | null;
  ledgerBalance?: { amount: number; asOf: string | null } | null;
  /**
   * A layout the reader knows for certain (OFX has fixed fields, so no
   * guessing). Delimited files leave it out and `proposeLayout` decides.
   */
  presetLayout?: ImportLayout;
}

/**
 * One account statement as a table of raw cells. A delimited file is one
 * table; an OFX file is one table per account it carries.
 */
export interface StatementTable {
  format: StatementFormat;
  /**
   * What identifies this file *shape* for saved layouts: the normalised header
   * signature of a delimited file, or institution + account type for OFX.
   * Two exports of the same kind from the same bank share it.
   */
  fingerprint: string;
  columns: StatementColumn[];
  /** Raw cell text, one array per data row, exactly `columns.length` long. */
  rows: string[][];
  /** 1-based line in the file each row came from (same length as `rows`). */
  sourceLines: number[];
  meta: StatementMeta;
  /** What the reader had to decide or noticed (file-scope issues, e.g. `preambleSkipped`). */
  notes: ImportIssue[];
}

export interface ReadResult {
  /** Empty when the file could not be read; `issues` then says why. */
  tables: StatementTable[];
  /** Problems that stopped the read (`unsupportedFormat`, `emptyFile`, …). */
  issues: ImportIssue[];
}

/**
 * Reader choices that replace what the reader would detect: from a saved
 * layout, or set by the user under Advanced. Delimited files only.
 */
export interface ReadOptions {
  encoding?: string;
  delimiter?: string;
  /** 1-based header line; null = the file has no header row. */
  headerLine?: number | null;
}

// ---------------------------------------------------------------------------
// Interpreting: StatementTable → ImportLayout
// ---------------------------------------------------------------------------

export type DateOrder = CsvDateOrder;
export type DecimalSeparator = '.' | ',';
/**
 * `asIs`: negative cells are money out. `inverted`: the bank prints charges
 * as positive numbers (common on card exports), so every amount is negated.
 * Ignored when the layout uses separate debit / credit columns.
 */
export type AmountSign = 'asIs' | 'inverted';

/** Which column plays which part. Values are `StatementColumn.index`. */
export interface ColumnRoles {
  /** The transaction date. Required. */
  date: number | null;
  /** A second "posted" date, when the file has both; informational. */
  postedDate?: number | null;
  /** One or more text columns, joined with a space in this order. Required. */
  description: number[];
  /** A single signed amount. One of `amount`, or `debit` / `credit`, is required. */
  amount?: number | null;
  /** Money-out column of a debit / credit pair. */
  debit?: number | null;
  /** Money-in column of a debit / credit pair. */
  credit?: number | null;
  /** A "DR" / "CR" or "Debit" / "Credit" indicator for an unsigned `amount`. */
  direction?: number | null;
  /** The bank's own transaction id; a second duplicate key (`transactions.external_id`). */
  reference?: number | null;
  /** Per-row account number or label, in a file that carries several accounts. */
  account?: number | null;
  /** Running balance; used to check sign and row order, never imported. */
  balance?: number | null;
  /** "Posted" / "Pending". */
  status?: number | null;
  currency?: number | null;
}

export interface ImportLayout {
  roles: ColumnRoles;
  dateOrder: DateOrder;
  decimal: DecimalSeparator;
  amountSign: AmountSign;
  /** Lower-cased cell values of the `direction` column that mean money out / money in. */
  directionValues?: { out: string[]; in: string[] };
}

/** What an inference was based on, strongest first. */
export type AssumptionBasis = 'profile' | 'file' | 'history' | 'language' | 'default' | 'ai';

export type AssumptionSubject =
  | 'account'
  | 'columns'
  | 'dateOrder'
  | 'decimal'
  | 'amountSign'
  | 'headerRow'
  | 'encoding'
  | 'delimiter';

/**
 * Something the wizard decided on the user's behalf and shows for
 * confirmation ("Dates read as day / month / year because row 14 is 23/04/2026").
 * The text is `importIssues:assumptions.<code>` with `params` interpolated.
 */
export interface Assumption {
  subject: AssumptionSubject;
  code: string;
  basis: AssumptionBasis;
  /** 0..1. Below 0.6 the wizard asks instead of assuming. */
  confidence: number;
  params?: Record<string, string | number>;
}

export interface LayoutContext {
  /** A saved layout for this fingerprint; wins over anything inferred. */
  profile?: ImportProfileConfig | null;
  /** The chosen account's type, when known: informs the sign inference. */
  accountType?: AccountType | null;
  /** Last-resort defaults from the UI language. Never used when the file has evidence. */
  fallbackDateOrder?: DateOrder;
  fallbackDecimal?: DecimalSeparator;
}

export interface LayoutProposal {
  layout: ImportLayout;
  /** The lowest confidence among the required roles and formats (0..1). */
  confidence: number;
  assumptions: Assumption[];
  /** Required parts that could not be determined; the user must set them. */
  missing: Array<'date' | 'description' | 'amount'>;
}

// ---------------------------------------------------------------------------
// Analysing: StatementTable + ImportLayout → AnalysisReport
// ---------------------------------------------------------------------------

/**
 * `blocker`: the affected rows cannot be imported until fixed or skipped (or,
 * for file / column scope, nothing can). `warning`: importable, worth a look.
 * `info`: something the wizard did or noticed that needs no decision.
 */
export type IssueSeverity = 'blocker' | 'warning' | 'info';
export type IssueScope = 'file' | 'column' | 'row' | 'account' | 'coverage';

/**
 * One finding. The text is `importIssues:issues.<code>` with `params`
 * interpolated; `rows` are indexes into `StatementTable.rows`.
 */
export interface ImportIssue {
  code: ImportIssueCode;
  severity: IssueSeverity;
  scope: IssueScope;
  rows?: number[];
  /** `StatementColumn.index` for column-scope issues and for the cell a row issue points at. */
  column?: number;
  params?: Record<string, string | number>;
}

/** A user correction to one row. Lives in wizard state; the file is never rewritten. */
export interface RowOverride {
  skip?: boolean;
  /** `yyyy-MM-dd`. */
  date?: string;
  /** Signed: negative = money out. */
  amount?: number;
  description?: string;
}

/** Keyed by row index (`StatementTable.rows`). */
export type RowOverrides = Record<number, RowOverride>;

/** What is already stored for the target account, for the coverage findings. */
export interface AccountCoverage {
  accountId: number;
  firstDate: string | null;
  lastDate: string | null;
  /** `max_date` of the account's most recent import batch. */
  lastImportThrough: string | null;
  transactionCount: number;
}

export interface AnalysisContext {
  /** `yyyy-MM-dd`; injected so "future date" is testable. */
  today: string;
  accountType?: AccountType | null;
  accountCurrency?: string | null;
  coverage?: AccountCoverage | null;
  overrides?: RowOverrides;
}

/** A row as it would be imported. */
export interface NormalizedRow {
  /** Index into `StatementTable.rows`. */
  index: number;
  sourceLine: number;
  /** `yyyy-MM-dd`, or null when unreadable. */
  date: string | null;
  /** Signed: negative = money out. Null when unreadable. */
  amount: number | null;
  description: string;
  reference: string | null;
  /** Raw text of the account column, when the layout has one. */
  accountValue: string | null;
  balance: number | null;
  /** Skipped by the user (override) or by the analysis (a summary row). */
  skipped: boolean;
  /** A blocker applies and the row is not skipped. */
  blocked: boolean;
  issueCodes: ImportIssueCode[];
}

export interface AnalysisStats {
  totalRows: number;
  /** Rows that would be imported as they stand. */
  readyRows: number;
  blockedRows: number;
  skippedRows: number;
  firstDate: string | null;
  lastDate: string | null;
  /** Sums over the ready rows, both as positive numbers. */
  moneyIn: number;
  moneyOut: number;
}

export interface AnalysisReport {
  rows: NormalizedRow[];
  /** Layout-, row-, coverage-scope findings; the reader's notes are on the table. */
  issues: ImportIssue[];
  stats: AnalysisStats;
}

// ---------------------------------------------------------------------------
// AI help for layouts the built-in detection cannot work out
// ---------------------------------------------------------------------------

/**
 * Exactly what would leave the device: the header names and a few sample rows
 * with every run of more than four digits masked down to its last four. The
 * wizard shows this in the confirmation before a remote provider is called.
 */
export interface AiLayoutSample {
  headers: string[];
  rows: string[][];
}

/**
 * Sends one prompt to the AI provider the user configured and resolves with
 * its text reply. The wizard supplies it, so this folder never knows which
 * provider (local model or remote API) is behind it.
 */
export type AiComplete = (prompt: { system: string; user: string }, signal?: AbortSignal) => Promise<string>;

// ---------------------------------------------------------------------------
// Saved layouts
// ---------------------------------------------------------------------------

/** `import_profiles.config_json`. Bump `version` when the shape changes. */
export interface ImportProfileConfig {
  version: 1;
  layout: ImportLayout;
  /** Reader choices the user overrode in Advanced, reapplied on the next read. */
  reader?: ReadOptions;
}

/** An `import_profiles` row with its `config_json` parsed. */
export type SavedImportProfile = Omit<ImportProfile, 'config_json'> & { config: ImportProfileConfig };

export interface ImportProfileInput {
  name: string;
  format: StatementFormat;
  fingerprint: string;
  institution?: string | null;
  account_id?: number | null;
  config: ImportProfileConfig;
}

// ---------------------------------------------------------------------------
// Service side: accounts, staging, commit (databaseService.imports)
// ---------------------------------------------------------------------------

/**
 * How a file value was tied to an account. Only `fullNumber` is "recognised";
 * every other basis is shown to the user as an assumption to confirm.
 */
export type AccountMatchBasis = 'fullNumber' | 'lastFour' | 'label' | 'profile';
export type AccountResolutionStatus = 'recognised' | 'assumed' | 'ambiguous' | 'unknown';

export interface AccountResolution {
  /** The value from the file; '' for a file that names no account. */
  value: string;
  status: AccountResolutionStatus;
  basis: AccountMatchBasis | null;
  /** Set for `recognised` and `assumed`. */
  accountId: number | null;
  /** The card the rows attach to, when the match came from `account_cards`. */
  cardId: number | null;
  /** `ambiguous`: every account that matched. `unknown`: accounts whose name resembles the value. */
  candidateAccountIds: number[];
}

/** One row handed to staging: already normalised and tied to an account. */
export interface StagedRowInput {
  /** `NormalizedRow.index`, echoed back in `StageResult`. */
  rowIndex: number;
  accountId: number;
  cardId: number | null;
  date: string;
  amount: number;
  description: string;
  reference: string | null;
}

export interface StageResult {
  /** Staging-table id per input row, same order (`tmp:<id>` classification keys). */
  tempIds: number[];
  /** `rowIndex` of rows whose transaction is already stored; the commit skips them. */
  alreadyImported: number[];
  /** Rows identical to each other in this file (same account, date, amount, description). */
  duplicateGroups: Array<{ rowIndexes: number[] }>;
}

/** Compact record of the analysis kept on the import batch (`import_batches.issues_json`). */
export interface ImportIssuesSummary {
  /** Number of findings per issue code. */
  counts: Partial<Record<ImportIssueCode, number>>;
  /** Assumptions the user accepted, as `subject:code`. */
  assumptions: string[];
  fixedRows: number;
}

export interface CommitInput {
  fileName: string;
  format: StatementFormat;
  profileId: number | null;
  accountIds: number[];
  /** Data rows in the file. */
  totalRows: number;
  /** Rows the user or the analysis left out. */
  skippedRows: number;
  /** Rows that could not be read and were not fixed. */
  rejectedRows: number;
  issues: ImportIssuesSummary;
  /** Staging ids of in-file duplicates the user chose not to import. */
  excludedTempIds: number[];
  /** Classification decisions for staged rows (`tmp:` keys): rules, refunds, kept transfer pairs. */
  stagedDecisions: TypeDecision[];
  /** Decisions for rows already stored (`tx:` keys): the existing leg of a kept pair. */
  existingDecisions: TypeDecision[];
}

export interface CommitResult {
  batchId: number;
  inserted: number;
  /** Staged rows that were already stored and were not inserted again. */
  duplicates: number;
}

/** What undoing one import batch would remove; shown in the confirmation. */
export interface ImportBatchImpact {
  batchId: number;
  transactions: number;
  /** Of those, how many the user changed after the import. */
  editedSinceImport: number;
  loanPayments: number;
  transferPairs: number;
}
