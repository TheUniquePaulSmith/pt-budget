/**
 * The guided import's state, as a pure reducer.
 *
 * A dropped file becomes one *statement* per table it carries (a delimited
 * file is one, an OFX file is one per account). Statements wait in a queue;
 * the current one walks Account → Check how we read it → Things to check →
 * Summary, is committed as its own import batch, and the next one starts.
 * After the last, the Done step shows one combined result.
 *
 * Nothing here touches React, the database or the clock: reading files,
 * resolving accounts, staging and committing are the controller's job
 * (./useImportWizard), which reports what happened as actions. The layout
 * proposal and the analysis are pure functions of the contract, so the
 * reducer runs them itself whenever a decision changes what they depend on.
 */

import {
  analyzeStatement,
  defaultSeverityOf,
  proposeLayout,
  scopeOf,
  type AccountCoverage,
  type AccountResolution,
  type AmountSign,
  type AnalysisContext,
  type AnalysisReport,
  type ColumnRoles,
  type CommitInput,
  type DateOrder,
  type DecimalSeparator,
  type ImportIssue,
  type ImportIssueCode,
  type ImportIssuesSummary,
  type ImportLayout,
  type ImportProfileInput,
  type LayoutProposal,
  type NormalizedRow,
  type ReadOptions,
  type RowOverride,
  type RowOverrides,
  type SavedImportProfile,
  type StageResult,
  type StagedRowInput,
  type StatementTable,
} from '@/lib/statementImport';
import type { ImportClassificationPreview, TransferPairPreview, TypeDecision } from '@/types/classification';
import type { AccountType } from '@/types/database';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type WizardStep = 'files' | 'account' | 'layout' | 'review' | 'summary' | 'done';

export const WIZARD_STEPS: readonly WizardStep[] = ['files', 'account', 'layout', 'review', 'summary', 'done'];

/** Below this confidence the wizard asks instead of assuming (see `Assumption.confidence`). */
export const ASK_BELOW_CONFIDENCE = 0.6;

/** The reading settings a user may be asked to confirm on "Check how we read it". */
export type ConfirmSubject = 'dateOrder' | 'decimal' | 'amountSign';

/** The part a column can play; `ColumnRoles` keys. */
export type RoleKey =
  | 'date'
  | 'postedDate'
  | 'description'
  | 'amount'
  | 'debit'
  | 'credit'
  | 'direction'
  | 'reference'
  | 'account'
  | 'balance'
  | 'status'
  | 'currency';

export const ROLE_KEYS: readonly RoleKey[] = [
  'date',
  'description',
  'amount',
  'debit',
  'credit',
  'direction',
  'postedDate',
  'reference',
  'account',
  'balance',
  'status',
  'currency',
];

/** What the reducer needs to know about one of the user's accounts. */
export interface AccountFacts {
  id: number;
  type: AccountType;
  currency: string | null;
}

export interface WizardFile {
  id: string;
  name: string;
  size: number;
  status: 'reading' | 'ready' | 'unreadable';
  /** Why the file could not be read (`ReadResult.issues`). */
  issues: ImportIssue[];
}

/** One value a file uses for an account ('' = the file names none) and what the user decided. */
export interface AccountChoice {
  value: string;
  /** Rows of the statement that carry this value. */
  rowCount: number;
  resolution: AccountResolution;
  accountId: number | null;
  cardId: number | null;
  /** Recognised by its full number, or accepted / picked by the user. */
  confirmed: boolean;
  /** The user left these rows out. */
  skipped: boolean;
}

export interface StagingState {
  status: 'idle' | 'working' | 'ready' | 'error';
  /** The `rowsVersion` the result was computed for. */
  version: number;
  result: StageResult | null;
  /** `rowIndex` of every staged row, in the order of `result.tempIds`. */
  rowIndexes: number[];
  classification: ImportClassificationPreview | null;
  error: string | null;
}

export interface StatementResult {
  outcome: 'imported' | 'nothingNew' | 'skipped' | 'failed';
  batchId: number | null;
  inserted: number;
  /** Rows that were already stored and were left out. */
  duplicates: number;
  /** Rows the user (or the analysis) left out. */
  skipped: number;
  transfers: number;
  refunds: number;
  ruleTyped: number;
  accountIds: number[];
  error: string | null;
}

export type LayoutSource = 'profile' | 'preset' | 'detected' | 'ai';

export interface StatementSession {
  id: string;
  fileId: string;
  fileName: string;
  /** Position among the tables of its file (an OFX file can carry several accounts). */
  tableIndex: number;
  tableCount: number;
  table: StatementTable;
  /**
   * The fingerprint a plain read of the file gives. A saved format is filed
   * under it, so the next import finds the format before any reader choice
   * (which may change the columns, and so the table's own fingerprint) is applied.
   */
  detectedFingerprint: string;
  /** Reader choices in effect: from the saved format, or set under Advanced. */
  readOptions: ReadOptions;
  /** True once the user changed a reader choice; the saved format then remembers it. */
  readerEdited: boolean;
  /** The saved format this file is read with, if its fingerprint matched one. */
  profile: SavedImportProfile | null;
  /** Every saved format with this fingerprint (one bank's layout is saved once per account), most recently used first. */
  profiles: SavedImportProfile[];
  /**
   * The matched format was saved for another account (or for a file with several). Its columns and
   * formats still hold; the direction of money may not, because a bank's card and checking exports
   * can share one header. The sign is then inferred afresh and confirmed, and there is no fast path.
   */
  profileForOtherAccount: boolean;
  proposal: LayoutProposal;
  layout: ImportLayout;
  layoutSource: LayoutSource;
  layoutEdited: boolean;
  confirmed: Record<ConfirmSubject, boolean>;
  /** Null until the file's account values have been looked up. */
  accounts: AccountChoice[] | null;
  /** The choices made before the accounts had to be looked up again, so the user's decisions survive it. */
  earlierChoices: AccountChoice[];
  coverage: AccountCoverage | null;
  overrides: RowOverrides;
  report: AnalysisReport;
  /** Bumped whenever the rows that would be staged may have changed. */
  rowsVersion: number;
  staging: StagingState;
  /** Rows of an in-file duplicate group the user chose to leave out. */
  excludedDuplicateRows: number[];
  /** Detected transfer pairs the user keeps. */
  selectedPairIds: string[];
  rememberFormat: boolean;
  formatName: string;
  /** D16: the saved format matched and nothing blocks, so the wizard opened on the Summary. */
  fastPath: boolean;
  status: 'pending' | 'done';
  result: StatementResult | null;
}

export interface WizardState {
  /** `yyyy-MM-dd`; injected so the analysis is testable. */
  today: string;
  /** D6: last-resort defaults from the UI language, used only when the file has no evidence. */
  fallbackDateOrder: DateOrder;
  fallbackDecimal: DecimalSeparator;
  step: WizardStep;
  files: WizardFile[];
  statements: StatementSession[];
  currentId: string | null;
  /** The current statement's accounts are being looked up; the step body waits. */
  activating: boolean;
  accountFacts: Record<number, AccountFacts>;
  /** importing: the current statement is being committed. finishing: the scans after the last one. */
  busy: 'importing' | 'finishing' | null;
  /** Why the last import attempt failed; shown on the Summary. */
  importError: string | null;
}

/** A table as the controller hands it over: read, and matched against the saved formats. */
export interface PreparedTable {
  id: string;
  table: StatementTable;
  /** Fingerprint of the table as first read, before a saved format's reader choices were applied. */
  detectedFingerprint: string;
  readOptions: ReadOptions;
  /** The saved formats with this fingerprint, most recently used first. */
  profiles: SavedImportProfile[];
}

export type WizardAction =
  | { type: 'fileAdded'; file: { id: string; name: string; size: number } }
  | { type: 'fileRead'; fileId: string; tables: PreparedTable[]; issues: ImportIssue[] }
  | { type: 'fileRemoved'; fileId: string }
  | { type: 'accountFactsLoaded'; accounts: AccountFacts[] }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'goToStep'; step: WizardStep }
  | { type: 'profileFound'; statementId: string; profiles: SavedImportProfile[]; table: StatementTable; readOptions: ReadOptions }
  | { type: 'accountsResolved'; statementId: string; resolutions: AccountResolution[] }
  | { type: 'accountChosen'; value: string; accountId: number; cardId: number | null }
  | { type: 'accountConfirmed'; value: string }
  | { type: 'accountSkipped'; value: string; skipped: boolean }
  | { type: 'coverageLoaded'; statementId: string; accountId: number; coverage: AccountCoverage | null }
  | { type: 'roleAssigned'; column: number; role: RoleKey | null }
  | { type: 'dateOrderSet'; order: DateOrder }
  | { type: 'decimalSet'; decimal: DecimalSeparator }
  | { type: 'amountSignSet'; sign: AmountSign }
  | { type: 'settingConfirmed'; subject: ConfirmSubject }
  | { type: 'aiProposalApplied'; proposal: LayoutProposal }
  | { type: 'statementReread'; statementId: string; table: StatementTable; readOptions: ReadOptions }
  | { type: 'rowFixed'; index: number; patch: Pick<RowOverride, 'date' | 'amount' | 'description'> }
  | { type: 'rowsSkipped'; indexes: number[]; skip: boolean }
  | { type: 'rowReset'; index: number }
  | { type: 'duplicateExcluded'; index: number; excluded: boolean }
  | { type: 'pairToggled'; pairId: string; selected: boolean }
  | { type: 'rememberSet'; remember: boolean }
  | { type: 'formatNameSet'; name: string }
  | { type: 'stagingStarted'; statementId: string; version: number }
  | {
      type: 'staged';
      statementId: string;
      version: number;
      result: StageResult;
      rowIndexes: number[];
      classification: ImportClassificationPreview | null;
    }
  | { type: 'stagingFailed'; statementId: string; version: number; error: string }
  | { type: 'importStarted' }
  | { type: 'importFailed'; error: string }
  | { type: 'statementFinished'; statementId: string; result: StatementResult }
  | { type: 'finished' }
  | { type: 'reset'; today: string };

export interface WizardDeps {
  propose: typeof proposeLayout;
  analyze: typeof analyzeStatement;
}

export interface WizardInit {
  today: string;
  fallbackDateOrder: DateOrder;
  fallbackDecimal: DecimalSeparator;
}

export function createInitialState({ today, fallbackDateOrder, fallbackDecimal }: WizardInit): WizardState {
  return {
    today,
    fallbackDateOrder,
    fallbackDecimal,
    step: 'files',
    files: [],
    statements: [],
    currentId: null,
    activating: false,
    accountFacts: {},
    busy: null,
    importError: null,
  };
}

const IDLE_STAGING: StagingState = {
  status: 'idle',
  version: -1,
  result: null,
  rowIndexes: [],
  classification: null,
  error: null,
};

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export function currentStatement(state: WizardState): StatementSession | null {
  return state.statements.find((statement) => statement.id === state.currentId) ?? null;
}

export function pendingStatements(state: WizardState): StatementSession[] {
  return state.statements.filter((statement) => statement.status === 'pending');
}

/** Position of the current statement in the queue, for "File 2 of 3". */
export function queuePosition(state: WizardState): { index: number; total: number } | null {
  const index = state.statements.findIndex((statement) => statement.id === state.currentId);
  return index < 0 ? null : { index, total: state.statements.length };
}

function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

/** The value a file-level hint gives for the account, when the file has no account column. */
function hintedAccountValue(table: StatementTable): { value: string; kind: 'number' | 'label' } | null {
  const hints = table.meta.accountHints;
  const number = hints.find((hint) => hint.kind === 'number' && hint.value.trim());
  if (number) return { value: number.value.trim(), kind: 'number' };
  const label = hints.find((hint) => hint.kind === 'label' && hint.value.trim());
  return label ? { value: label.value.trim(), kind: 'label' } : null;
}

function isRowActive(row: NormalizedRow): boolean {
  return !row.skipped;
}

/**
 * Every value the statement uses for an account, with how many rows carry it:
 * the distinct cells of the account column, or the one file-level hint, or ''
 * for a file that names no account.
 */
export function accountValuesOf(
  statement: Pick<StatementSession, 'table' | 'layout' | 'report'>
): Array<{ value: string; rowCount: number }> {
  const activeRows = statement.report.rows.filter(isRowActive);
  if (statement.layout.roles.account != null) {
    const counts = new Map<string, number>();
    for (const row of activeRows) {
      const value = (row.accountValue ?? '').trim();
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    if (counts.size > 0) return [...counts].map(([value, rowCount]) => ({ value, rowCount }));
  }
  return [{ value: hintedAccountValue(statement.table)?.value ?? '', rowCount: activeRows.length }];
}

/** How a confirmed value is remembered: as a number when it carries one, else as a label. */
export function identifierKindOf(statement: Pick<StatementSession, 'table' | 'layout'>, value: string): 'number' | 'label' {
  if (statement.layout.roles.account == null) {
    const hint = hintedAccountValue(statement.table);
    if (hint && hint.value === value) return hint.kind;
  }
  return digitsOf(value).length >= 4 ? 'number' : 'label';
}

/** The issue code that says how a value was tied to its account. */
export function accountIssueCode(resolution: AccountResolution): ImportIssueCode {
  if (resolution.status === 'recognised') return 'accountRecognised';
  if (resolution.status === 'ambiguous') return 'accountAmbiguous';
  if (resolution.status === 'unknown') return 'accountUnknown';
  if (resolution.basis === 'lastFour') return 'accountAssumedByLastFour';
  if (resolution.basis === 'profile') return 'accountAssumedByProfile';
  return 'accountAssumedByName';
}

/** True when the user changed what the lookup proposed (or there was nothing to propose). */
export function isUserChoice(choice: AccountChoice): boolean {
  return choice.accountId != null && choice.accountId !== choice.resolution.accountId;
}

function isChoiceSettled(choice: AccountChoice, fastPath: boolean): boolean {
  if (choice.skipped) return true;
  // D16: on the fast path the Summary names the account and Import confirms it.
  return choice.accountId != null && (choice.confirmed || fastPath);
}

/** Every account value has an account (confirmed where it was a guess) or is skipped, and something is left. */
export function accountsSettled(statement: StatementSession): boolean {
  const choices = statement.accounts;
  if (!choices || choices.length === 0) return false;
  return (
    choices.every((choice) => isChoiceSettled(choice, statement.fastPath)) && choices.some((choice) => !choice.skipped)
  );
}

/** The one account every imported row goes into, or null when there are several (or none yet). */
export function singleAccountId(statement: Pick<StatementSession, 'accounts'>): number | null {
  const ids = new Set(
    (statement.accounts ?? []).filter((choice) => !choice.skipped && choice.accountId != null).map((choice) => choice.accountId)
  );
  return ids.size === 1 ? ([...ids][0] as number) : null;
}

/** Identifiers to remember when the import goes through (D10): confirmed guesses and manual picks. */
export function identifiersToSave(
  statement: StatementSession
): Array<{ account_id: number; kind: 'number' | 'label'; value: string }> {
  return (statement.accounts ?? [])
    .filter(
      (choice) =>
        choice.value !== '' &&
        !choice.skipped &&
        choice.accountId != null &&
        !(choice.resolution.status === 'recognised' && choice.resolution.accountId === choice.accountId)
    )
    .map((choice) => ({
      account_id: choice.accountId as number,
      kind: identifierKindOf(statement, choice.value),
      value: choice.value,
    }));
}

export function usesSingleAmount(layout: ImportLayout): boolean {
  return layout.roles.amount != null && layout.roles.debit == null && layout.roles.credit == null;
}

/**
 * D9: the sign of a single amount column is confirmed with an example. A debit / credit pair or an
 * in / out marker column already says which way the money went, so there is nothing to ask.
 */
export function signNeedsConfirmation(layout: ImportLayout): boolean {
  return usesSingleAmount(layout) && layout.roles.direction == null;
}

/** Which reading settings still wait for the user's answer. */
export function settingsToConfirm(statement: StatementSession): ConfirmSubject[] {
  // OFX fields are fixed.
  if (statement.layoutSource === 'preset') return [];
  if (statement.layoutSource === 'profile') {
    // A saved format was confirmed when it was saved. Only the sign is asked again, when the
    // format was saved for another account.
    const askSign =
      statement.profileForOtherAccount && signNeedsConfirmation(statement.layout) && !statement.confirmed.amountSign;
    return askSign ? ['amountSign'] : [];
  }
  const lowConfidence = (subject: ConfirmSubject) =>
    statement.proposal.assumptions.some(
      (assumption) => assumption.subject === subject && assumption.confidence < ASK_BELOW_CONFIDENCE
    );
  const subjects: ConfirmSubject[] = [];
  if (statement.layout.roles.date != null && lowConfidence('dateOrder')) subjects.push('dateOrder');
  if (lowConfidence('decimal')) subjects.push('decimal');
  // D9: the sign of a single amount column is always confirmed with an example.
  if (signNeedsConfirmation(statement.layout)) subjects.push('amountSign');
  return subjects.filter((subject) => !statement.confirmed[subject]);
}

/** Required parts of the layout that no column plays yet. */
export function missingParts(layout: ImportLayout): Array<'date' | 'description' | 'amount'> {
  const missing: Array<'date' | 'description' | 'amount'> = [];
  if (layout.roles.date == null) missing.push('date');
  if (layout.roles.description.length === 0) missing.push('description');
  if (layout.roles.amount == null && layout.roles.debit == null && layout.roles.credit == null) missing.push('amount');
  return missing;
}

export function layoutSettled(statement: StatementSession): boolean {
  return missingParts(statement.layout).length === 0 && settingsToConfirm(statement).length === 0;
}

/** The part a column plays, if any. */
export function roleOfColumn(roles: ColumnRoles, column: number): RoleKey | null {
  if (roles.description.includes(column)) return 'description';
  for (const role of ROLE_KEYS) {
    if (role !== 'description' && roles[role] === column) return role;
  }
  return null;
}

/**
 * Gives `column` the part `role` (null = not imported). A part other than
 * the description belongs to one column, so its previous holder loses it; a
 * single amount and a debit / credit pair exclude each other.
 */
export function assignRole(roles: ColumnRoles, column: number, role: RoleKey | null): ColumnRoles {
  const next: ColumnRoles = { ...roles, description: roles.description.filter((index) => index !== column) };
  for (const key of ROLE_KEYS) {
    if (key !== 'description' && next[key] === column) next[key] = null;
  }
  if (role === null) return next;
  if (role === 'description') {
    next.description = [...next.description, column].sort((a, b) => a - b);
    return next;
  }
  next[role] = column;
  if (role === 'amount') {
    next.debit = null;
    next.credit = null;
  }
  if (role === 'debit' || role === 'credit') {
    next.amount = null;
    next.direction = null;
  }
  return next;
}

/** The findings the wizard derives from the account lookup, as catalog codes. */
export function accountIssues(statement: StatementSession): ImportIssue[] {
  return (statement.accounts ?? [])
    .filter((choice) => !choice.skipped)
    .map((choice) => {
      const code = accountIssueCode(choice.resolution);
      const unsettled = choice.accountId == null;
      return {
        code,
        // An unknown or ambiguous value stops being a blocker once the user picked its account.
        severity: defaultSeverityOf(code) === 'blocker' && !unsettled ? 'info' : defaultSeverityOf(code),
        scope: scopeOf(code),
        params: { value: choice.value, count: choice.rowCount },
      } satisfies ImportIssue;
    });
}

export function isStagingFresh(statement: StatementSession): boolean {
  return statement.staging.status === 'ready' && statement.staging.version === statement.rowsVersion;
}

/** Rows already stored, as a catalog finding (only known once the rows are staged). */
export function alreadyImportedIssue(statement: StatementSession): ImportIssue | null {
  const rows = isStagingFresh(statement) ? (statement.staging.result?.alreadyImported ?? []) : [];
  if (rows.length === 0) return null;
  return {
    code: 'alreadyImported',
    severity: defaultSeverityOf('alreadyImported'),
    scope: scopeOf('alreadyImported'),
    rows,
    params: { count: rows.length },
  };
}

/**
 * What a file leaves open about each reading setting. The analysis only sees the file, so it
 * repeats these on every run; the wizard knows when the question has been answered.
 */
const SETTING_WARNINGS: Partial<Record<ImportIssueCode, ConfirmSubject>> = {
  dateOrderAmbiguous: 'dateOrder',
  decimalAmbiguous: 'decimal',
  signAssumed: 'amountSign',
};

/** A warning about a setting the user confirmed, or that a saved format settled when it was saved. */
function isAnsweredSettingWarning(statement: StatementSession, issue: ImportIssue): boolean {
  const subject = SETTING_WARNINGS[issue.code];
  if (!subject) return false;
  if (statement.confirmed[subject]) return true;
  if (statement.layoutSource !== 'profile') return false;
  // The sign of a format saved for another account is not settled for this one.
  return !(subject === 'amountSign' && statement.profileForOtherAccount);
}

/** Everything worth telling the user about the statement: the reader's notes and the analysis. */
export function statementIssues(statement: StatementSession): ImportIssue[] {
  const already = alreadyImportedIssue(statement);
  const fromAnalysis = statement.report.issues.filter(
    (issue) => !(already && issue.code === 'alreadyImported') && !isAnsweredSettingWarning(statement, issue)
  );
  return [...statement.table.notes, ...fromAnalysis, ...(already ? [already] : [])];
}

/**
 * The rows of a finding that are still listed under it: every row but those the user left out
 * themselves. A row the analysis skipped by itself (a total line) stays, so it can be brought back.
 */
export function listedRowsOf(statement: StatementSession, issue: ImportIssue): number[] {
  const rows = statement.report.rows;
  return (issue.rows ?? []).filter((index) => rows[index] && statement.overrides[index]?.skip !== true);
}

/** Findings of one severity; row-scope findings whose rows the user all left out drop out. */
export function issuesBySeverity(statement: StatementSession, severity: ImportIssue['severity']): ImportIssue[] {
  return statementIssues(statement).filter((issue) => {
    if (issue.severity !== severity) return false;
    if (issue.scope !== 'row' || !issue.rows) return true;
    return listedRowsOf(statement, issue).length > 0;
  });
}

export type ImportBlocker =
  | { kind: 'issue'; issue: ImportIssue }
  | { kind: 'blockedRows'; count: number }
  | { kind: 'missing'; parts: Array<'date' | 'description' | 'amount'> }
  | { kind: 'accounts' }
  | { kind: 'confirm'; subjects: ConfirmSubject[] }
  | { kind: 'noRows' };

/** D7: everything that keeps Import disabled. */
export function importBlockers(statement: StatementSession): ImportBlocker[] {
  const blockers: ImportBlocker[] = [];
  const missing = missingParts(statement.layout);
  if (missing.length > 0) blockers.push({ kind: 'missing', parts: missing });
  // A blocker on the file or a column cannot be fixed row by row.
  for (const issue of statementIssues(statement)) {
    if (issue.severity !== 'blocker' || issue.scope === 'row') continue;
    // The layout's own "no … column" findings are the `missing` blocker above.
    if (missing.length > 0 && ['noDateColumn', 'noAmountColumn', 'noDescriptionColumn'].includes(issue.code)) continue;
    blockers.push({ kind: 'issue', issue });
  }
  if (statement.report.stats.blockedRows > 0) {
    blockers.push({ kind: 'blockedRows', count: statement.report.stats.blockedRows });
  }
  if (!accountsSettled(statement)) blockers.push({ kind: 'accounts' });
  const confirm = settingsToConfirm(statement);
  if (confirm.length > 0) blockers.push({ kind: 'confirm', subjects: confirm });
  if (blockers.length === 0 && rowsToStage(statement).length === 0) blockers.push({ kind: 'noRows' });
  return blockers;
}

/** True when nothing but row fixes could unblock the statement: the D16 fast path needs none at all. */
function hasAnyBlocker(statement: StatementSession): boolean {
  return (
    statement.report.stats.blockedRows > 0 ||
    statementIssues(statement).some((issue) => issue.severity === 'blocker') ||
    missingParts(statement.layout).length > 0
  );
}

function choiceForRow(statement: StatementSession, row: NormalizedRow): AccountChoice | null {
  const choices = statement.accounts;
  if (!choices || choices.length === 0) return null;
  if (statement.layout.roles.account == null) return choices[0];
  const value = (row.accountValue ?? '').trim();
  return choices.find((choice) => choice.value === value) ?? null;
}

/** The rows that would be imported as they stand, tied to their accounts. */
export function rowsToStage(statement: StatementSession): StagedRowInput[] {
  const staged: StagedRowInput[] = [];
  for (const row of statement.report.rows) {
    if (row.skipped || row.blocked || row.date === null || row.amount === null) continue;
    const choice = choiceForRow(statement, row);
    if (!choice || choice.skipped || choice.accountId == null) continue;
    staged.push({
      rowIndex: row.index,
      accountId: choice.accountId,
      cardId: choice.cardId,
      date: row.date,
      amount: row.amount,
      description: row.description,
      reference: row.reference,
    });
  }
  return staged;
}

export interface StatementSummary {
  totalRows: number;
  /** Rows that will be written. */
  toImport: number;
  /** Rows that are already stored and will be left out (known once staged). */
  alreadyImported: number;
  /** Rows left out by the user, the analysis or a skipped account. */
  skipped: number;
  /** Repeated rows the user left out. */
  excludedDuplicates: number;
  blockedRows: number;
  firstDate: string | null;
  lastDate: string | null;
  /** Sums over the rows that will be written, both positive. */
  moneyIn: number;
  moneyOut: number;
  accountIds: number[];
  transfers: number;
  refunds: number;
  ruleTyped: number;
}

export function summarize(statement: StatementSession): StatementSummary {
  const staged = rowsToStage(statement);
  const fresh = isStagingFresh(statement);
  const already = new Set(fresh ? (statement.staging.result?.alreadyImported ?? []) : []);
  const excluded = new Set(statement.excludedDuplicateRows);
  const importing = staged.filter((row) => !already.has(row.rowIndex) && !excluded.has(row.rowIndex));
  const excludedCount = staged.filter((row) => excluded.has(row.rowIndex) && !already.has(row.rowIndex)).length;
  const dates = importing.map((row) => row.date).sort();
  const classification = fresh ? statement.staging.classification : null;
  const { stats } = statement.report;
  return {
    totalRows: stats.totalRows,
    toImport: importing.length,
    alreadyImported: staged.filter((row) => already.has(row.rowIndex)).length,
    skipped: stats.totalRows - staged.length - stats.blockedRows + excludedCount,
    excludedDuplicates: excludedCount,
    blockedRows: stats.blockedRows,
    firstDate: dates[0] ?? stats.firstDate,
    lastDate: dates.at(-1) ?? stats.lastDate,
    moneyIn: roundMoney(importing.reduce((sum, row) => sum + Math.max(row.amount, 0), 0)),
    moneyOut: roundMoney(importing.reduce((sum, row) => sum + Math.max(-row.amount, 0), 0)),
    accountIds: [...new Set(staged.map((row) => row.accountId))],
    transfers: classification ? keptPairs(statement).length : 0,
    refunds: classification?.summary.refundsInferred ?? 0,
    ruleTyped: classification?.summary.ruleMatches ?? 0,
  };
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Staging ids of the repeated rows the user left out. */
export function excludedTempIds(statement: StatementSession): number[] {
  const { result, rowIndexes } = statement.staging;
  if (!result) return [];
  const excluded = new Set(statement.excludedDuplicateRows);
  return rowIndexes.flatMap((rowIndex, position) => (excluded.has(rowIndex) ? [result.tempIds[position]] : []));
}

/** Detected transfer pairs that will be imported as transfers: selected, with both legs still in the import. */
export function keptPairs(statement: StatementSession): TransferPairPreview[] {
  const classification = statement.staging.classification;
  if (!classification) return [];
  const excluded = new Set(excludedTempIds(statement));
  const selected = new Set(statement.selectedPairIds);
  const legExcluded = (tempId: number | null) => tempId != null && excluded.has(tempId);
  return classification.pairs.filter(
    (pair) => selected.has(pair.pairId) && !legExcluded(pair.out.tempId) && !legExcluded(pair.in.tempId)
  );
}

/** The compact record of the analysis kept on the import batch. */
export function issuesSummary(statement: StatementSession): ImportIssuesSummary {
  const counts: ImportIssuesSummary['counts'] = {};
  for (const issue of [...statementIssues(statement), ...accountIssues(statement)]) {
    counts[issue.code] = (counts[issue.code] ?? 0) + (issue.rows ? issue.rows.length : 1);
  }
  const assumptions = statement.proposal.assumptions.map((assumption) => `${assumption.subject}:${assumption.code}`);
  for (const choice of statement.accounts ?? []) {
    if (!choice.skipped && choice.resolution.status === 'assumed') {
      assumptions.push(`account:${accountIssueCode(choice.resolution)}`);
    }
  }
  const fixedRows = Object.values(statement.overrides).filter(
    (override) =>
      !override.skip && (override.date !== undefined || override.amount !== undefined || override.description !== undefined)
  ).length;
  return { counts, assumptions, fixedRows };
}

/**
 * What the commit needs, from a freshly staged statement. `pairDecisions` are
 * the classifier's decisions for `keptPairs` (both legs).
 */
export function buildCommitInput(
  statement: StatementSession,
  pairDecisions: TypeDecision[],
  profileId: number | null
): CommitInput {
  const summary = summarize(statement);
  const excluded = excludedTempIds(statement);
  const excludedKeys = new Set(excluded.map((tempId) => `tmp:${tempId}`));
  const rowDecisions = (statement.staging.classification?.rowDecisions ?? []).filter(
    (decision) => !excludedKeys.has(decision.key)
  );
  return {
    fileName: statement.fileName,
    format: statement.table.format,
    profileId,
    accountIds: summary.accountIds,
    totalRows: summary.totalRows,
    skippedRows: summary.skipped,
    rejectedRows: summary.blockedRows,
    issues: issuesSummary(statement),
    excludedTempIds: excluded,
    stagedDecisions: [...rowDecisions, ...pairDecisions.filter((decision) => decision.key.startsWith('tmp:'))],
    existingDecisions: pairDecisions.filter((decision) => decision.key.startsWith('tx:')),
  };
}

/** The saved format this statement would write ("Remember this format"). */
export function buildProfileInput(statement: StatementSession): ImportProfileInput {
  const institution = statement.table.meta.accountHints.find((hint) => hint.kind === 'institution')?.value ?? null;
  return {
    name: statement.formatName.trim() || defaultFormatName(statement.table, null),
    format: statement.table.format,
    fingerprint: statement.detectedFingerprint,
    institution,
    account_id: singleAccountId(statement),
    config: {
      version: 1,
      layout: statement.layout,
      ...(statement.readerEdited || statement.profile?.config.reader ? { reader: statement.readOptions } : {}),
    },
  };
}

function defaultFormatName(table: StatementTable, profile: SavedImportProfile | null): string {
  if (profile) return profile.name;
  const institution = table.meta.accountHints.find((hint) => hint.kind === 'institution')?.value.trim();
  if (institution) return institution;
  return table.meta.fileName.replace(/\.[^.]+$/, '') || table.meta.fileName;
}

/** Whether Next may be pressed on the current step. */
export function canGoNext(state: WizardState): boolean {
  if (state.busy || state.activating) return false;
  const statement = currentStatement(state);
  switch (state.step) {
    case 'files':
      return state.files.every((file) => file.status !== 'reading') && pendingStatements(state).length > 0;
    case 'account':
      return statement != null && accountsSettled(statement);
    case 'layout':
      return statement != null && layoutSettled(statement);
    case 'review':
      return statement != null && importBlockers(statement).filter((blocker) => blocker.kind !== 'noRows').length === 0;
    default:
      return false;
  }
}

/** True when leaving would lose work: a file is loaded (or being read) and has not been imported yet. */
export function hasUnsavedWork(state: WizardState): boolean {
  if (state.step === 'done') return false;
  return pendingStatements(state).length > 0 || state.files.some((file) => file.status === 'reading');
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function profileFits(profile: SavedImportProfile | null, table: StatementTable): SavedImportProfile | null {
  if (!profile) return null;
  const { roles } = profile.config.layout;
  const indexes = [
    roles.date,
    roles.postedDate,
    ...roles.description,
    roles.amount,
    roles.debit,
    roles.credit,
    roles.direction,
    roles.reference,
    roles.account,
    roles.balance,
    roles.status,
    roles.currency,
  ].filter((index): index is number => index != null);
  const fits = indexes.every((index) => Number.isInteger(index) && index >= 0 && index < table.columns.length);
  return fits && missingParts(profile.config.layout).length === 0 ? profile : null;
}

function accountContextOf(state: WizardState, statement: Pick<StatementSession, 'accounts'>) {
  const accountId = singleAccountId(statement);
  const facts = accountId == null ? null : (state.accountFacts[accountId] ?? null);
  return { accountId, accountType: facts?.type ?? null, accountCurrency: facts?.currency ?? null };
}

function analysisContextOf(state: WizardState, statement: StatementSession): AnalysisContext {
  const { accountId, accountType, accountCurrency } = accountContextOf(state, statement);
  return {
    today: state.today,
    accountType,
    accountCurrency,
    coverage: statement.coverage && statement.coverage.accountId === accountId ? statement.coverage : null,
    overrides: statement.overrides,
  };
}

const NOTHING_CONFIRMED: Record<ConfirmSubject, boolean> = { dateOrder: false, decimal: false, amountSign: false };

export function createWizardReducer(deps: WizardDeps) {
  /** Re-runs the analysis and marks the staged rows stale. */
  function reanalyze(state: WizardState, statement: StatementSession): StatementSession {
    return {
      ...statement,
      report: deps.analyze(statement.table, statement.layout, analysisContextOf(state, statement)),
      rowsVersion: statement.rowsVersion + 1,
    };
  }

  function propose(state: WizardState, statement: Pick<StatementSession, 'table' | 'profile' | 'accounts'>): LayoutProposal {
    return deps.propose(statement.table, {
      profile: statement.profile?.config ?? null,
      accountType: accountContextOf(state, statement).accountType,
      fallbackDateOrder: state.fallbackDateOrder,
      fallbackDecimal: state.fallbackDecimal,
    });
  }

  function createStatement(
    state: WizardState,
    file: WizardFile,
    prepared: PreparedTable,
    tableIndex: number,
    tableCount: number
  ): StatementSession {
    const profiles = prepared.profiles.filter((candidate) => profileFits(candidate, prepared.table));
    const profile = profiles[0] ?? null;
    const base = { table: prepared.table, profile, accounts: null };
    const proposal = propose(state, base);
    const statement: StatementSession = {
      id: prepared.id,
      fileId: file.id,
      fileName: file.name,
      tableIndex,
      tableCount,
      table: prepared.table,
      detectedFingerprint: prepared.detectedFingerprint,
      readOptions: prepared.readOptions,
      readerEdited: false,
      profile,
      profiles,
      profileForOtherAccount: false,
      proposal,
      layout: proposal.layout,
      layoutSource: profile ? 'profile' : prepared.table.meta.presetLayout ? 'preset' : 'detected',
      layoutEdited: false,
      confirmed: NOTHING_CONFIRMED,
      accounts: null,
      earlierChoices: [],
      coverage: null,
      overrides: {},
      report: { rows: [], issues: [], stats: emptyStats() },
      rowsVersion: 0,
      staging: IDLE_STAGING,
      excludedDuplicateRows: [],
      selectedPairIds: [],
      rememberFormat: true,
      formatName: defaultFormatName(prepared.table, profile),
      fastPath: false,
      status: 'pending',
      result: null,
    };
    return reanalyze(state, statement);
  }

  /**
   * After the account (and so, perhaps, the account type) changed: a layout
   * that was only detected is proposed again, because the type informs the
   * sign, and a saved format is matched to the account. A layout the user
   * edited and an OFX preset stay.
   */
  function afterAccountsChanged(state: WizardState, statement: StatementSession): StatementSession {
    let next = statement;
    if (statement.layoutSource === 'detected' && !statement.layoutEdited) {
      const proposal = propose(state, statement);
      const signChanged = proposal.layout.amountSign !== statement.layout.amountSign;
      next = {
        ...statement,
        proposal,
        layout: proposal.layout,
        confirmed: signChanged ? { ...statement.confirmed, amountSign: false } : statement.confirmed,
      };
    } else if (statement.layoutSource === 'profile' && !statement.layoutEdited) {
      next = withProfileForAccount(state, statement);
    }
    return reanalyze(state, next);
  }

  /**
   * Reads the statement with the format saved for the account it goes into, when there is one.
   * Otherwise the matched format was saved for another account: its columns and formats are kept,
   * but which way the money goes is inferred afresh for this account and has to be confirmed. A
   * bank's card export (charges as positive numbers) and its checking export can share one header.
   */
  function withProfileForAccount(state: WizardState, statement: StatementSession): StatementSession {
    if (!statement.profile) return statement;
    const { accountId, accountType } = accountContextOf(state, statement);
    const own = accountId == null ? undefined : statement.profiles.find((candidate) => candidate.account_id === accountId);
    const profile = own ?? statement.profile;
    const saved = propose(state, { ...statement, profile });
    const formatName = statement.formatName === statement.profile.name ? profile.name : statement.formatName;
    // A file with several accounts has no single account to compare with: the format is taken as it is.
    const forOtherAccount = accountId != null && profile.account_id !== accountId;
    if (!forOtherAccount) {
      return { ...statement, profile, profileForOtherAccount: false, formatName, proposal: saved, layout: saved.layout };
    }
    const detected = deps.propose(statement.table, {
      profile: null,
      accountType,
      fallbackDateOrder: state.fallbackDateOrder,
      fallbackDecimal: state.fallbackDecimal,
    });
    const layout: ImportLayout = { ...saved.layout, amountSign: detected.layout.amountSign };
    const alreadyAnswered = statement.profileForOtherAccount && statement.layout.amountSign === layout.amountSign;
    return {
      ...statement,
      profile,
      profileForOtherAccount: true,
      formatName,
      proposal: {
        ...saved,
        layout,
        assumptions: [...saved.assumptions, ...detected.assumptions.filter((assumption) => assumption.subject === 'amountSign')],
      },
      layout,
      confirmed: alreadyAnswered ? statement.confirmed : { ...statement.confirmed, amountSign: false },
      fastPath: false,
    };
  }

  function updateCurrent(state: WizardState, update: (statement: StatementSession) => StatementSession): WizardState {
    if (!state.currentId) return state;
    return {
      ...state,
      statements: state.statements.map((statement) => (statement.id === state.currentId ? update(statement) : statement)),
    };
  }

  function updateStatement(
    state: WizardState,
    statementId: string,
    update: (statement: StatementSession) => StatementSession
  ): WizardState {
    return {
      ...state,
      statements: state.statements.map((statement) => (statement.id === statementId ? update(statement) : statement)),
    };
  }

  /** A change to the layout made by the user (or by the AI on their request). */
  function editLayout(state: WizardState, edit: (statement: StatementSession) => Partial<StatementSession>): WizardState {
    return updateCurrent(state, (statement) => {
      const edited = { ...statement, ...edit(statement), layoutEdited: true };
      const accountColumnChanged = edited.layout.roles.account !== statement.layout.roles.account;
      const analysed = reanalyze(state, edited);
      // Another account column means other account values: they are looked up again.
      return accountColumnChanged ? { ...forgetAccounts(analysed), fastPath: false } : analysed;
    });
  }

  /** The accounts have to be looked up again; what the user decided so far is kept for the values that remain. */
  function forgetAccounts(statement: StatementSession): StatementSession {
    return { ...statement, accounts: null, earlierChoices: statement.accounts ?? statement.earlierChoices, coverage: null };
  }

  function choicesFrom(statement: StatementSession, resolutions: AccountResolution[]): AccountChoice[] {
    const byValue = new Map(resolutions.map((resolution) => [resolution.value, resolution]));
    const earlier = new Map((statement.accounts ?? statement.earlierChoices).map((choice) => [choice.value, choice]));
    return accountValuesOf(statement).map(({ value, rowCount }) => {
      const resolution: AccountResolution = byValue.get(value) ?? {
        value,
        status: 'unknown',
        basis: null,
        accountId: null,
        cardId: null,
        candidateAccountIds: [],
      };
      const before = earlier.get(value);
      // A decision the user already made about this value survives a second lookup.
      if (before && (before.skipped || (before.confirmed && before.resolution.status !== 'recognised'))) {
        return { ...before, rowCount, resolution };
      }
      const proposed = resolution.status === 'recognised' || resolution.status === 'assumed';
      return {
        value,
        rowCount,
        resolution,
        accountId: proposed ? resolution.accountId : null,
        cardId: proposed ? resolution.cardId : null,
        confirmed: resolution.status === 'recognised',
        skipped: false,
      };
    });
  }

  function advanceQueue(state: WizardState): WizardState {
    const next = state.statements.find((statement) => statement.status === 'pending');
    if (next) {
      return { ...state, currentId: next.id, activating: true, step: 'account', busy: null, importError: null };
    }
    const anythingWritten = state.statements.some((statement) => (statement.result?.inserted ?? 0) > 0);
    // Loan rules and the subscription scan run once, after the last file.
    return anythingWritten
      ? { ...state, currentId: null, activating: false, busy: 'finishing', importError: null }
      : { ...state, currentId: null, activating: false, busy: null, step: 'done', importError: null };
  }

  return function wizardReducer(state: WizardState, action: WizardAction): WizardState {
    switch (action.type) {
      case 'fileAdded':
        return { ...state, files: [...state.files, { ...action.file, status: 'reading', issues: [] }] };

      case 'fileRead': {
        const file = state.files.find((candidate) => candidate.id === action.fileId);
        if (!file) return state;
        if (action.tables.length === 0) {
          const issues: ImportIssue[] =
            action.issues.length > 0
              ? action.issues
              : [{ code: 'unsupportedFormat', severity: 'blocker', scope: 'file' }];
          return {
            ...state,
            files: state.files.map((candidate) =>
              candidate.id === file.id ? { ...candidate, status: 'unreadable', issues } : candidate
            ),
          };
        }
        const statements = action.tables.map((prepared, index) =>
          createStatement(state, file, prepared, index, action.tables.length)
        );
        return {
          ...state,
          files: state.files.map((candidate) =>
            candidate.id === file.id ? { ...candidate, status: 'ready', issues: action.issues } : candidate
          ),
          // The queue follows the order the files were added in, whichever was read first.
          statements: [...state.statements, ...statements].sort(
            (a, b) =>
              state.files.findIndex((candidate) => candidate.id === a.fileId) -
                state.files.findIndex((candidate) => candidate.id === b.fileId) || a.tableIndex - b.tableIndex
          ),
        };
      }

      case 'fileRemoved': {
        const imported = state.statements.some(
          (statement) => statement.fileId === action.fileId && statement.status === 'done'
        );
        if (imported) return state;
        const statements = state.statements.filter((statement) => statement.fileId !== action.fileId);
        const currentRemoved = state.currentId != null && !statements.some((statement) => statement.id === state.currentId);
        return {
          ...state,
          files: state.files.filter((file) => file.id !== action.fileId),
          statements,
          ...(currentRemoved ? { currentId: null, activating: false, step: 'files' as const } : {}),
        };
      }

      case 'accountFactsLoaded': {
        const accountFacts = Object.fromEntries(action.accounts.map((account) => [account.id, account]));
        const withFacts = { ...state, accountFacts };
        // The current statement's account may only now have a known type (an account created inline).
        return updateCurrent(withFacts, (statement) => {
          const accountId = singleAccountId(statement);
          if (accountId == null) return statement;
          const before = state.accountFacts[accountId];
          const after = accountFacts[accountId];
          if (before?.type === after?.type && before?.currency === after?.currency) return statement;
          return afterAccountsChanged(withFacts, statement);
        });
      }

      case 'next': {
        if (!canGoNext(state)) return state;
        const statement = currentStatement(state);
        switch (state.step) {
          case 'files': {
            if (statement && statement.status === 'pending' && statement.accounts) {
              return { ...state, step: statement.fastPath ? 'summary' : 'account' };
            }
            const first = statement && statement.status === 'pending' ? statement : pendingStatements(state)[0];
            return { ...state, currentId: first.id, activating: true, step: 'account' };
          }
          case 'account':
            return { ...state, step: 'layout' };
          case 'layout':
            return { ...state, step: 'review' };
          case 'review':
            return { ...state, step: 'summary' };
          default:
            return state;
        }
      }

      case 'back': {
        if (state.busy) return state;
        const previous: Partial<Record<WizardStep, WizardStep>> = {
          account: 'files',
          layout: 'account',
          review: 'layout',
          summary: 'review',
        };
        const step = previous[state.step];
        if (!step) return state;
        // Looking at the details ends the fast path: its guesses then need the usual confirmation.
        return { ...updateCurrent(state, (statement) => ({ ...statement, fastPath: false })), step, activating: false };
      }

      case 'goToStep': {
        if (state.busy || state.step === 'done') return state;
        const target = WIZARD_STEPS.indexOf(action.step);
        if (target < 0 || target >= WIZARD_STEPS.indexOf(state.step)) return state;
        if (action.step !== 'files' && !currentStatement(state)) return state;
        return {
          ...updateCurrent(state, (statement) => ({ ...statement, fastPath: false })),
          step: action.step,
          activating: false,
        };
      }

      case 'profileFound':
        // A format saved earlier in this run (by a file before this one in the queue) applies to this
        // file too, as long as the user has not started deciding things about it.
        return updateStatement(state, action.statementId, (statement) => {
          const profiles = action.profiles.filter((candidate) => profileFits(candidate, action.table));
          const profile = profiles[0];
          if (!profile || statement.profile || statement.layoutEdited || statement.readerEdited) return statement;
          const base = { ...statement, table: action.table, readOptions: action.readOptions, profile, profiles };
          const proposal = propose(state, base);
          return reanalyze(state, {
            ...base,
            proposal,
            layout: proposal.layout,
            layoutSource: 'profile',
            formatName: profile.name,
            confirmed: NOTHING_CONFIRMED,
            overrides: {},
            staging: IDLE_STAGING,
          });
        });

      case 'accountsResolved': {
        const target = state.statements.find((statement) => statement.id === action.statementId);
        if (!target) return state;
        const resolved = updateStatement(state, action.statementId, (statement) =>
          afterAccountsChanged(state, { ...statement, accounts: choicesFrom(statement, action.resolutions) })
        );
        if (action.statementId !== state.currentId) return resolved;
        const statement = currentStatement(resolved) as StatementSession;
        if (state.activating) {
          // D16: a known format with nothing to decide goes straight to the Summary. A format that
          // was saved for another account is not known for this one: its sign is confirmed first.
          const fastPath =
            statement.layoutSource === 'profile' &&
            !statement.profileForOtherAccount &&
            (statement.accounts ?? []).every((choice) => choice.accountId != null) &&
            !hasAnyBlocker(statement);
          return {
            ...updateCurrent(resolved, (current) => ({ ...current, fastPath })),
            activating: false,
            step: fastPath ? 'summary' : 'account',
          };
        }
        // Looked up again (the account column changed): come back if something needs deciding.
        const beyondAccount = WIZARD_STEPS.indexOf(state.step) > WIZARD_STEPS.indexOf('account');
        return beyondAccount && state.step !== 'done' && !accountsSettled(statement) ? { ...resolved, step: 'account' } : resolved;
      }

      case 'accountChosen':
        return updateCurrent(state, (statement) =>
          afterAccountsChanged(state, {
            ...statement,
            coverage: null,
            accounts: (statement.accounts ?? []).map((choice) =>
              choice.value === action.value
                ? { ...choice, accountId: action.accountId, cardId: action.cardId, confirmed: true, skipped: false }
                : choice
            ),
          })
        );

      case 'accountConfirmed':
        return updateCurrent(state, (statement) => ({
          ...statement,
          accounts: (statement.accounts ?? []).map((choice) =>
            choice.value === action.value && choice.accountId != null ? { ...choice, confirmed: true } : choice
          ),
        }));

      case 'accountSkipped':
        return updateCurrent(state, (statement) =>
          afterAccountsChanged(state, {
            ...statement,
            coverage: null,
            accounts: (statement.accounts ?? []).map((choice) =>
              choice.value === action.value ? { ...choice, skipped: action.skipped } : choice
            ),
          })
        );

      case 'coverageLoaded':
        return updateStatement(state, action.statementId, (statement) => {
          if (singleAccountId(statement) !== action.accountId) return statement;
          // Nothing stored and nothing known before: the analysis would not change.
          if (action.coverage === null && statement.coverage === null) return statement;
          return reanalyze(state, { ...statement, coverage: action.coverage });
        });

      case 'roleAssigned':
        return editLayout(state, (statement) => ({
          layout: { ...statement.layout, roles: assignRole(statement.layout.roles, action.column, action.role) },
        }));

      case 'dateOrderSet':
        return editLayout(state, (statement) => ({
          layout: { ...statement.layout, dateOrder: action.order },
          confirmed: { ...statement.confirmed, dateOrder: true },
        }));

      case 'decimalSet':
        return editLayout(state, (statement) => ({
          layout: { ...statement.layout, decimal: action.decimal },
          confirmed: { ...statement.confirmed, decimal: true },
        }));

      case 'amountSignSet':
        return editLayout(state, (statement) => ({
          layout: { ...statement.layout, amountSign: action.sign },
          confirmed: { ...statement.confirmed, amountSign: true },
        }));

      case 'settingConfirmed':
        return updateCurrent(state, (statement) => ({
          ...statement,
          confirmed: { ...statement.confirmed, [action.subject]: true },
        }));

      case 'aiProposalApplied':
        return updateCurrent(state, (statement) => {
          const accountColumnChanged = action.proposal.layout.roles.account !== statement.layout.roles.account;
          const applied = reanalyze(state, {
            ...statement,
            proposal: action.proposal,
            layout: action.proposal.layout,
            layoutSource: 'ai',
            layoutEdited: false,
            // A suggestion is never applied silently: everything is confirmed again.
            confirmed: NOTHING_CONFIRMED,
          });
          return accountColumnChanged ? forgetAccounts(applied) : applied;
        });

      case 'statementReread':
        return updateStatement(state, action.statementId, (statement) => {
          const profiles = statement.profiles.filter((candidate) => profileFits(candidate, action.table));
          const profile = profiles.find((candidate) => candidate.id === statement.profile?.id) ?? profiles[0] ?? null;
          const base = { ...forgetAccounts(statement), table: action.table, profile, profiles, profileForOtherAccount: false };
          const proposal = propose(state, base);
          return reanalyze(state, {
            ...base,
            readOptions: action.readOptions,
            readerEdited: true,
            proposal,
            layout: proposal.layout,
            layoutSource: profile ? 'profile' : action.table.meta.presetLayout ? 'preset' : 'detected',
            layoutEdited: false,
            confirmed: NOTHING_CONFIRMED,
            // Row indexes belong to the old table.
            overrides: {},
            excludedDuplicateRows: [],
            staging: IDLE_STAGING,
            fastPath: false,
          });
        });

      case 'rowFixed':
        return updateCurrent(state, (statement) => {
          const override: RowOverride = { ...statement.overrides[action.index], ...action.patch };
          return reanalyze(state, { ...statement, overrides: { ...statement.overrides, [action.index]: override } });
        });

      case 'rowsSkipped':
        return updateCurrent(state, (statement) => {
          const overrides = { ...statement.overrides };
          for (const index of action.indexes) {
            const { skip: wasSkipped, ...rest } = overrides[index] ?? {};
            if (action.skip) overrides[index] = { ...rest, skip: true };
            // A row the analysis left out by itself (a total line) only comes back with an explicit "do not skip".
            else if (wasSkipped !== true && statement.report.rows[index]?.skipped) overrides[index] = { ...rest, skip: false };
            else if (Object.keys(rest).length > 0) overrides[index] = rest;
            else delete overrides[index];
          }
          return reanalyze(state, { ...statement, overrides });
        });

      case 'rowReset':
        return updateCurrent(state, (statement) => {
          const { [action.index]: _removed, ...overrides } = statement.overrides;
          return reanalyze(state, { ...statement, overrides });
        });

      case 'duplicateExcluded':
        return updateCurrent(state, (statement) => {
          const excluded = new Set(statement.excludedDuplicateRows);
          if (action.excluded) excluded.add(action.index);
          else excluded.delete(action.index);
          return { ...statement, excludedDuplicateRows: [...excluded].sort((a, b) => a - b) };
        });

      case 'pairToggled':
        return updateCurrent(state, (statement) => {
          const selected = new Set(statement.selectedPairIds);
          if (action.selected) selected.add(action.pairId);
          else selected.delete(action.pairId);
          return { ...statement, selectedPairIds: [...selected] };
        });

      case 'rememberSet':
        return updateCurrent(state, (statement) => ({ ...statement, rememberFormat: action.remember }));

      case 'formatNameSet':
        return updateCurrent(state, (statement) => ({ ...statement, formatName: action.name }));

      case 'stagingStarted':
        return updateStatement(state, action.statementId, (statement) => ({
          ...statement,
          staging: { ...statement.staging, status: 'working', version: action.version, error: null },
        }));

      case 'staged':
        return updateStatement(state, action.statementId, (statement) => {
          // An answer for rows that have changed since is dropped; the controller stages again.
          if (action.version !== statement.rowsVersion) {
            return { ...statement, staging: { ...IDLE_STAGING, version: action.version } };
          }
          const repeated = new Set(action.result.duplicateGroups.flatMap((group) => group.rowIndexes));
          return {
            ...statement,
            staging: {
              status: 'ready',
              version: action.version,
              result: action.result,
              rowIndexes: action.rowIndexes,
              classification: action.classification,
              error: null,
            },
            excludedDuplicateRows: statement.excludedDuplicateRows.filter((index) => repeated.has(index)),
            // Recommended pairs start checked, weaker possibilities unchecked.
            selectedPairIds: (action.classification?.pairs ?? [])
              .filter((pair) => pair.recommended)
              .map((pair) => pair.pairId),
          };
        });

      case 'stagingFailed':
        return updateStatement(state, action.statementId, (statement) => ({
          ...statement,
          staging: { ...IDLE_STAGING, status: 'error', version: action.version, error: action.error },
        }));

      case 'importStarted':
        return { ...state, busy: 'importing', importError: null };

      case 'importFailed':
        // A failed commit empties the staging table, so the rows are staged again.
        return {
          ...updateCurrent(state, (statement) => ({ ...statement, staging: IDLE_STAGING })),
          busy: null,
          importError: action.error,
        };

      case 'statementFinished': {
        const finished = updateStatement(state, action.statementId, (statement) => ({
          ...statement,
          status: 'done',
          result: action.result,
          staging: IDLE_STAGING,
        }));
        return advanceQueue(finished);
      }

      case 'finished':
        return { ...state, busy: null, step: 'done' };

      case 'reset':
        return {
          ...createInitialState({
            today: action.today,
            fallbackDateOrder: state.fallbackDateOrder,
            fallbackDecimal: state.fallbackDecimal,
          }),
          accountFacts: state.accountFacts,
        };

      default:
        return state;
    }
  };
}

function emptyStats(): AnalysisReport['stats'] {
  return {
    totalRows: 0,
    readyRows: 0,
    blockedRows: 0,
    skippedRows: 0,
    firstDate: null,
    lastDate: null,
    moneyIn: 0,
    moneyOut: 0,
  };
}

/** The reducer the wizard runs: the real layout detection and analysis. */
export const wizardReducer = createWizardReducer({ propose: proposeLayout, analyze: analyzeStatement });
