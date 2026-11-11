/**
 * Pure helpers for the "History & formats" view: reading the JSON columns of
 * an import batch, ordering what the analysis found, and deciding how an
 * account identifier may be shown (a number never appears in full).
 */

import { IMPORT_ISSUE_CODES } from '@/lib/statementImport/issueCodes';
import type { IssueSeverity } from '@/lib/statementImport/types';
import type { Account, AccountIdentifier, ImportBatch } from '@/types/database';

/** How many import runs the history asks for, and how many it shows before "Show all". */
export const HISTORY_LIMIT = 200;
export const HISTORY_PREVIEW_COUNT = 10;

/** `import_batches.account_ids_json` → distinct account ids, in file order. */
export function parseAccountIds(json: string | null | undefined): number[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    const ids = parsed.map((value) => Number(value)).filter((id) => Number.isInteger(id) && id > 0);
    return [...new Set(ids)];
  } catch {
    return [];
  }
}

export interface BatchAccount {
  id: number;
  /** null when the account has been deleted since the import. */
  name: string | null;
}

export function batchAccounts(batch: Pick<ImportBatch, 'account_ids_json'>, accounts: readonly Account[]): BatchAccount[] {
  const names = new Map(accounts.map((account) => [account.id, account.name]));
  return parseAccountIds(batch.account_ids_json).map((id) => ({ id, name: names.get(id) ?? null }));
}

export interface IssueCount {
  code: string;
  count: number;
  severity: IssueSeverity;
}

export interface BatchFindings {
  /** Most serious first, then the most frequent. */
  issues: IssueCount[];
  /** Assumptions the user accepted during the import. */
  assumptions: number;
  fixedRows: number;
}

const SEVERITY_ORDER: Record<IssueSeverity, number> = { blocker: 0, warning: 1, info: 2 };

function severityOfCode(code: string): IssueSeverity {
  // A code from a newer or older catalog is still shown, as a note.
  const definition = (IMPORT_ISSUE_CODES as Record<string, { severity: IssueSeverity } | undefined>)[code];
  return definition?.severity ?? 'info';
}

const wholeCount = (value: unknown): number => {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
};

/**
 * `import_batches.issues_json` (an `ImportIssuesSummary`) → what the history
 * row shows. Null when nothing was recorded: imports made before schema v7,
 * or a value that cannot be read.
 */
export function parseIssuesSummary(json: string | null | undefined): BatchFindings | null {
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const summary = parsed as { counts?: unknown; assumptions?: unknown; fixedRows?: unknown };

  const counts = summary.counts && typeof summary.counts === 'object' ? (summary.counts as Record<string, unknown>) : {};
  const issues = Object.entries(counts)
    .map(([code, value]) => ({ code, count: wholeCount(value), severity: severityOfCode(code) }))
    .filter((issue) => issue.count > 0)
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.count - a.count || a.code.localeCompare(b.code)
    );

  return {
    issues,
    assumptions: Array.isArray(summary.assumptions) ? summary.assumptions.length : 0,
    fixedRows: wholeCount(summary.fixedRows),
  };
}

/** Whether a parsed summary has anything to show. */
export function hasFindings(findings: BatchFindings): boolean {
  return findings.issues.length > 0 || findings.assumptions > 0 || findings.fixedRows > 0;
}

const LONG_DIGIT_RUN = /\d{5,}/g;

/**
 * Text from a file may carry an account number. Every run of more than four
 * digits keeps only its last four ("acct 400012344821" → "acct ••••4821").
 */
export function maskDigitRuns(text: string): string {
  return text.replace(LONG_DIGIT_RUN, (digits) => `••••${digits.slice(-4)}`);
}

export type IdentifierDisplay =
  /** `lastFour` is null for a number too short to have one; nothing of it is shown. */
  | { kind: 'number'; lastFour: string | null }
  | { kind: 'label'; text: string };

/** What may be shown of an identifier. A number is its last four digits, never the stored value. */
export function identifierDisplay(identifier: Pick<AccountIdentifier, 'kind' | 'value' | 'last_four'>): IdentifierDisplay {
  if (identifier.kind === 'number') {
    const lastFour = /^\d{4}$/.test(identifier.last_four ?? '') ? identifier.last_four : null;
    return { kind: 'number', lastFour };
  }
  return { kind: 'label', text: maskDigitRuns(identifier.value) };
}

export interface IdentifierGroup {
  accountId: number;
  accountName: string;
  identifiers: AccountIdentifier[];
}

/** Identifiers grouped by account, accounts by name; within an account, in the order they were added. */
export function groupIdentifiersByAccount(
  identifiers: readonly AccountIdentifier[],
  accounts: readonly Account[]
): IdentifierGroup[] {
  const names = new Map(accounts.map((account) => [account.id, account.name]));
  const groups = new Map<number, IdentifierGroup>();
  for (const identifier of identifiers) {
    let group = groups.get(identifier.account_id);
    if (!group) {
      group = {
        accountId: identifier.account_id,
        accountName: names.get(identifier.account_id) ?? identifier.account_name ?? '',
        identifiers: [],
      };
      groups.set(identifier.account_id, group);
    }
    group.identifiers.push(identifier);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, identifiers: [...group.identifiers].sort((a, b) => a.id - b.id) }))
    .sort((a, b) => a.accountName.localeCompare(b.accountName, undefined, { sensitivity: 'base' }) || a.accountId - b.accountId);
}

const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

/**
 * What the imports service rejects with when a batch id is not (or no longer)
 * an import run, for example one undone in another tab. Kept as a literal so
 * the view does not import the service; manageModel.test.ts holds it to the
 * service's own constant.
 */
export const BATCH_NOT_FOUND_CODE = 'IMPORT_BATCH_NOT_FOUND';

/**
 * The service reports failures as code-like messages ("IMPORT_BATCH_NOT_FOUND").
 * Returns that code, or null for anything else (a SQLite message, a timeout).
 */
export function errorCodeOf(error: unknown): string | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const trimmed = message.trim();
  return ERROR_CODE_PATTERN.test(trimmed) ? trimmed : null;
}

/** The provider's own message while the database is still starting. */
export function isDatabaseNotReady(error: unknown): boolean {
  return error instanceof Error && error.message === 'Database service not initialized';
}
