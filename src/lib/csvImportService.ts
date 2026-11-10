import type { Account, Transaction } from '../types/database';

import { DatabaseService } from './databaseService';
import { type CsvDateOrder, parseCsvDate } from './dateOnly';
import {
  deriveInstitutionHint,
  extractDigitsValue,
  extractLastFourValue,
  findTextHintedAccounts,
} from './statementImport/shared/accountText';
import { type CsvDecimalSeparator, parseCsvAmount } from './statementImport/shared/amounts';
import { detectUniqueIdentifierColumn, isPlaceholderReference } from './statementImport/shared/references';

// The pure parsing helpers moved to ./statementImport/shared so the Import
// Wizard's readers and analysis can use them without this module's database
// dependency; they are re-exported here so existing imports keep working.
export {
  deriveInstitutionHint,
  extractLastFourValue,
  findTextHintedAccounts,
} from './statementImport/shared/accountText';
export { type CsvDecimalSeparator, type ParseCsvAmountOptions, parseCsvAmount } from './statementImport/shared/amounts';
export { detectUniqueIdentifierColumn, isPlaceholderReference } from './statementImport/shared/references';

export interface CSVImportColumnMapping {
  accountColumn: string;
  dateColumn: string;
  amountColumn: string;
  descriptionColumn: string;
  uniqueIdentifierColumn: string;
}

export interface CSVAccountMatch {
  csvAccountValue: string;
  lastFourValue: string;
  /** Accounts whose card number matches the CSV value; a single match is auto-selected. */
  matchingAccounts: Account[];
  /**
   * Accounts whose name / institution text resembles the CSV value. Shown as
   * a hint in the mapping UI only; never auto-selected.
   */
  hintedAccounts: Account[];
  selectedAccountId: number | null;
  selectedCardId?: number | null;
  /** The user explicitly chose "Skip this account"; its rows are left out of the import. */
  skipped?: boolean;
}

/** Field prefill for the inline "Create new account…" dialog during import. */
export interface CsvAccountPrefill {
  name: string;
  institution: string;
  cardNumberInput: string;
}

/** Row accounting for the account-mapping step, shown before Analyze. */
export interface CsvAccountResolutionSummary {
  totalRows: number;
  /** Rows whose CSV account value is linked to an account. */
  importableRows: number;
  /** Rows whose CSV account value the user explicitly skipped. */
  skippedRows: number;
  /** Rows whose CSV account value is neither linked nor skipped yet. */
  unresolvedRows: number;
  skippedValues: string[];
  unresolvedValues: string[];
}

export interface MappedCsvTransaction {
  transaction: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>;
  csvAccountValue: string;
  lastFourValue: string;
  hash: string;
  uniqueIdentifier?: string;
}

export interface CSVImportDuplicateGroupItem {
  index: number;
  transaction: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>;
  csvAccountValue: string;
  tempId: number;
  lastFourValue: string;
  uniqueIdentifier?: string;
}

export interface CSVImportDuplicateGroup {
  hash: string;
  transactions: CSVImportDuplicateGroupItem[];
}

/**
 * Why a CSV row was rejected: a stable code plus the raw cell and column so the
 * import UI can translate it (`csvImport:rejectedReason.<code>`).
 */
export interface CsvRejectedRowReason {
  code: 'unrecognizedDate' | 'unrecognizedAmount';
  value: string;
  column: string;
}

/** A CSV data row (1-based, excluding the header) that could not be turned into a transaction. */
export interface CsvRejectedRow {
  rowNumber: number;
  reason: CsvRejectedRowReason;
}

export interface CsvMappingResult {
  mapped: MappedCsvTransaction[];
  rejected: CsvRejectedRow[];
}

export interface CSVImportAnalysisResult {
  totalRows: number;
  mappableRows: number;
  duplicateCount: number;
  internalDuplicates: number;
  uniqueCount: number;
  /** Rows whose account value matched none of the user's accounts. */
  skippedRows: number;
  /** Rows with an unreadable date or amount; never imported, always reported. */
  rejectedRows: CsvRejectedRow[];
  duplicateGroups?: CSVImportDuplicateGroup[];
}

// Keyed on the resolved numeric account id (never the raw CSV account string)
// so a row imported from a file and the same row typed by hand dedupe.
export type HashGenerator = (
  accountId: number,
  date: string,
  amount: number,
  description: string,
  variationSeed?: number
) => Promise<string>;

export function autoDetectColumnMapping(
  headers: string[],
  rows?: Array<Record<string, unknown>>
): CSVImportColumnMapping {
  return {
    accountColumn:
      headers.find(
        (header) =>
          header.toLowerCase().includes('account') &&
          header.toLowerCase().includes('number')
      ) || '',
    dateColumn:
      headers.find(
        (header) =>
          header.toLowerCase().includes('date') ||
          header.toLowerCase().includes('time')
      ) || '',
    amountColumn:
      headers.find(
        (header) =>
          header.toLowerCase().includes('amount') ||
          header.toLowerCase().includes('billing')
      ) || '',
    descriptionColumn:
      headers.find(
        (header) =>
          header.toLowerCase().includes('merchant') ||
          header.toLowerCase().includes('description') ||
          header.toLowerCase().includes('memo')
      ) || '',
    uniqueIdentifierColumn: detectUniqueIdentifierColumn(headers, rows),
  };
}

// Filler dropped from the CSV value when it is reused as the account name.
const NAME_PREFILL_FILLER = new Set(['ending', 'number', 'no', 'xxxx', 'acct']);

/**
 * Prefill for "Create new account…" from the import: the CSV value's digits
 * become the card / account number, its words (if any) the account name, and
 * the file name hints the institution.
 */
export function buildAccountPrefillFromCsv(
  csvValue: string,
  fileName: string | null | undefined
): CsvAccountPrefill {
  const digits = extractDigitsValue(csvValue);
  const words = csvValue
    .replace(/\d+/g, ' ')
    .split(/[^A-Za-z]+/)
    .filter((word) => word && !NAME_PREFILL_FILLER.has(word.toLowerCase()));
  return {
    name: words.join(' ').trim(),
    institution: deriveInstitutionHint(fileName),
    cardNumberInput: digits.length >= 4 ? digits : '',
  };
}

export interface CreateAccountMatchesOptions {
  /** All of the user's accounts, used for the text hint. */
  accounts?: Account[];
}

export async function createAccountMatches(
  data: any[],
  accountColumn: string,
  findAccountsByLastFour: (lastFour: string) => Promise<Account[]>,
  findAccountsByFullNumber: (fullNumber: string) => Promise<Account[]>,
  options: CreateAccountMatchesOptions = {}
): Promise<CSVAccountMatch[]> {
  const uniqueAccountValues = [...new Set(data.map((row) => String(row[accountColumn])))];
  const allAccounts = options.accounts ?? [];

  return Promise.all(
    uniqueAccountValues.map(async (csvValue) => {
      const lastFourValue = extractLastFourValue(csvValue);
      const digitsValue = extractDigitsValue(csvValue);

      // Prefer an exact full-number match to disambiguate cards that share a
      // last_four; fall back to last-four matching (which may now return
      // more than one account) when no full-number match is found.
      let matchingAccounts: Account[] =
        digitsValue.length > 4 ? await findAccountsByFullNumber(digitsValue) : [];
      if (matchingAccounts.length === 0 && lastFourValue) {
        matchingAccounts = await findAccountsByLastFour(lastFourValue);
      }

      const matchedIds = new Set(matchingAccounts.map((account) => account.id));
      const hintedAccounts = findTextHintedAccounts(csvValue, allAccounts).filter(
        (account) => !matchedIds.has(account.id)
      );

      return {
        csvAccountValue: csvValue,
        lastFourValue,
        matchingAccounts,
        hintedAccounts,
        // Only a card-number match may auto-select; text hints never do.
        selectedAccountId:
          matchingAccounts.length === 1 ? matchingAccounts[0].id : null,
        selectedCardId: null,
      };
    })
  );
}

/**
 * Links a CSV account value to an account (typically one just created from
 * the import), clearing any skip; `cardId` is the card the rows attach to.
 */
export function applyAccountSelection(
  matches: CSVAccountMatch[],
  csvValue: string,
  accountId: number,
  cardId: number | null
): CSVAccountMatch[] {
  return matches.map((match) =>
    match.csvAccountValue === csvValue
      ? { ...match, selectedAccountId: accountId, selectedCardId: cardId, skipped: false }
      : match
  );
}

/** Marks a CSV account value as explicitly skipped (its rows are not imported). */
export function applyAccountSkip(matches: CSVAccountMatch[], csvValue: string): CSVAccountMatch[] {
  return matches.map((match) =>
    match.csvAccountValue === csvValue
      ? { ...match, selectedAccountId: null, selectedCardId: null, skipped: true }
      : match
  );
}

/**
 * Counts rows per resolution state so the mapping step can say how many rows
 * will be skipped (and which values still need a decision) before Analyze.
 */
export function summarizeAccountResolutions(
  csvData: any[],
  columnMapping: CSVImportColumnMapping,
  accountMatches: CSVAccountMatch[]
): CsvAccountResolutionSummary {
  const totalRows = csvData.length;
  const empty: CsvAccountResolutionSummary = {
    totalRows,
    importableRows: 0,
    skippedRows: 0,
    unresolvedRows: 0,
    skippedValues: [],
    unresolvedValues: [],
  };
  if (!totalRows || !columnMapping.accountColumn) {
    return empty;
  }
  if (columnMapping.accountColumn.startsWith('DIRECT_ACCOUNT:')) {
    return { ...empty, importableRows: accountMatches.length ? totalRows : 0 };
  }

  const rowsByValue = new Map<string, number>();
  for (const row of csvData) {
    const csvValue = String(row[columnMapping.accountColumn]);
    rowsByValue.set(csvValue, (rowsByValue.get(csvValue) ?? 0) + 1);
  }

  const summary: CsvAccountResolutionSummary = { ...empty, skippedValues: [], unresolvedValues: [] };
  for (const [csvValue, rows] of rowsByValue) {
    const match = accountMatches.find((candidate) => candidate.csvAccountValue === csvValue);
    if (match?.selectedAccountId) {
      summary.importableRows += rows;
    } else if (match?.skipped) {
      summary.skippedRows += rows;
      summary.skippedValues.push(csvValue);
    } else {
      summary.unresolvedRows += rows;
      summary.unresolvedValues.push(csvValue);
    }
  }
  return summary;
}

/**
 * Turns parsed CSV rows into transactions. Rows whose account value is not
 * mapped are skipped silently (the caller reports them as "unmapped"); rows with
 * an unreadable date or amount are returned in `rejected` with a reason instead
 * of being defaulted to today / $0.
 */
export interface CsvParseOptions {
  /** Day/month order for ambiguous numeric dates (from the user's language). */
  dateOrder?: CsvDateOrder;
  /** Decimal separator convention for amounts (from the user's language). */
  decimal?: CsvDecimalSeparator;
}

export async function mapTransactionsFromCSV(
  data: any[],
  columnMapping: CSVImportColumnMapping,
  accountMappings: CSVAccountMatch[],
  generateTransactionHash: HashGenerator,
  parseOptions: CsvParseOptions = {}
): Promise<CsvMappingResult> {
  const isDirectAccount = columnMapping.accountColumn.startsWith('DIRECT_ACCOUNT:');
  const directAccountMapping = isDirectAccount ? accountMappings[0] : null;

  const mapped: MappedCsvTransaction[] = [];
  const rejected: CsvRejectedRow[] = [];
  const seenHashes = new Map<string, number>();

  for (const [index, row] of data.entries()) {
    let csvAccountValue: string;
    let accountMapping: CSVAccountMatch | undefined | null;
    let lastFourValue: string;

    if (isDirectAccount) {
      csvAccountValue = 'ALL_TRANSACTIONS';
      accountMapping = directAccountMapping;
      lastFourValue = '';
    } else {
      csvAccountValue = String(row[columnMapping.accountColumn]);
      accountMapping = accountMappings.find(
        (match) => match.csvAccountValue === csvAccountValue
      );
      lastFourValue = accountMapping?.lastFourValue || '';
    }

    // Unmapped account: skipped, not rejected (the account-mapping step already told the user).
    if (!accountMapping?.selectedAccountId) continue;

    const rowNumber = index + 1;
    const rawDate = row[columnMapping.dateColumn];
    const rawAmount = row[columnMapping.amountColumn];
    const description = String(row[columnMapping.descriptionColumn] ?? '');
    const rawUniqueIdentifier = columnMapping.uniqueIdentifierColumn
      ? String(row[columnMapping.uniqueIdentifierColumn] ?? '').trim()
      : '';
    const uniqueIdentifier = isPlaceholderReference(rawUniqueIdentifier) ? undefined : rawUniqueIdentifier;

    const date = parseCsvDate(rawDate, { order: parseOptions.dateOrder });
    if (!date) {
      rejected.push({
        rowNumber,
        reason: { code: 'unrecognizedDate', value: String(rawDate ?? '').trim(), column: columnMapping.dateColumn },
      });
      continue;
    }

    const amount = parseCsvAmount(rawAmount, { decimal: parseOptions.decimal });
    if (amount == null) {
      rejected.push({
        rowNumber,
        reason: { code: 'unrecognizedAmount', value: String(rawAmount ?? '').trim(), column: columnMapping.amountColumn },
      });
      continue;
    }

    // Refund and transfer typing is a later step (transaction classifier);
    // the import itself only knows the direction of the money.
    const type: 'income' | 'expense' = amount > 0 ? 'income' : 'expense';
    const signedAmount = Math.abs(amount) * (type === 'expense' ? -1 : 1);

    // The bank's reference number is a second dedup key, not part of the hash,
    // so rows that predate this import can still be rehashed deterministically.
    const hash = await generateTransactionHash(
      accountMapping.selectedAccountId,
      date,
      signedAmount,
      description
    );
    // Identical rows in one file (two same-day $100 cash-outs) are all kept by
    // default: the n-th repeat of a content hash is staged with variation seed
    // n, as the internal-duplicates resolver assigns when every copy is
    // included. They never collide on the UNIQUE hash in the bulk insert, and
    // an overlapping re-import matches each stored copy by its seed. `hash`
    // stays the unseeded content hash, which groups the copies for the resolver.
    const variationSeed = seenHashes.get(hash) ?? 0;
    seenHashes.set(hash, variationSeed + 1);
    const stagedHash = variationSeed === 0
      ? hash
      : await generateTransactionHash(accountMapping.selectedAccountId, date, signedAmount, description, variationSeed);

    const transaction: Omit<Transaction, 'id' | 'created_at' | 'updated_at'> = {
      date,
      amount: signedAmount,
      description: description || 'Imported transaction',
      comment: null,
      account_id: accountMapping.selectedAccountId,
      card_id: accountMapping.selectedCardId ?? null,
      category_id: null,
      company_id: null,
      project_id: null,
      trip_id: null,
      type,
      transaction_hash: stagedHash,
      external_id: uniqueIdentifier ?? null,
      ...(variationSeed > 0 ? { hash_variation_seed: variationSeed } : {}),
    };

    mapped.push({
      transaction,
      csvAccountValue,
      lastFourValue,
      hash,
      uniqueIdentifier,
    });
  }

  dropRepeatedReferences(mapped);
  return { mapped, rejected };
}

/**
 * A reference that repeats within one account in the same file does not
 * identify a transaction, so none of those rows carries it: they dedupe on the
 * hash (account, date, amount, description) alone.
 */
function dropRepeatedReferences(mapped: MappedCsvTransaction[]): void {
  const keyOf = (entry: MappedCsvTransaction) => `${entry.transaction.account_id}\u0000${entry.uniqueIdentifier}`;
  const counts = new Map<string, number>();
  for (const entry of mapped) {
    if (entry.uniqueIdentifier === undefined) continue;
    counts.set(keyOf(entry), (counts.get(keyOf(entry)) ?? 0) + 1);
  }
  for (const entry of mapped) {
    if (entry.uniqueIdentifier === undefined || (counts.get(keyOf(entry)) ?? 0) < 2) continue;
    entry.uniqueIdentifier = undefined;
    entry.transaction.external_id = null;
  }
}

export function buildDuplicateGroups(
  mappedTransactions: MappedCsvTransaction[],
  tempIds: number[]
): {
  duplicateGroups: CSVImportDuplicateGroup[];
  internalDuplicateCount: number;
} {
  const hashMap = new Map<string, CSVImportDuplicateGroupItem[]>();

  mappedTransactions.forEach((mappedTransaction, index) => {
    const existingGroup = hashMap.get(mappedTransaction.hash);
    const nextItem: CSVImportDuplicateGroupItem = {
      index,
      transaction: mappedTransaction.transaction,
      csvAccountValue: mappedTransaction.csvAccountValue,
      tempId: tempIds[index],
      lastFourValue: mappedTransaction.lastFourValue,
      uniqueIdentifier: mappedTransaction.uniqueIdentifier,
    };

    if (existingGroup) {
      existingGroup.push(nextItem);
      return;
    }

    hashMap.set(mappedTransaction.hash, [nextItem]);
  });

  const duplicateGroups: CSVImportDuplicateGroup[] = [];
  let internalDuplicateCount = 0;

  hashMap.forEach((transactions, hash) => {
    if (transactions.length <= 1) {
      return;
    }

    duplicateGroups.push({ hash, transactions });
    internalDuplicateCount += transactions.length - 1;
  });

  return { duplicateGroups, internalDuplicateCount };
}

export async function createHashUpdatesForSelectedDuplicates(
  duplicateGroups: CSVImportDuplicateGroup[],
  selectedIndices: Set<number>,
  generateTransactionHash: HashGenerator = DatabaseService.generateTransactionHashFromFields
): Promise<{
  hashUpdates: Array<{ tempId: number; newHash: string; variationSeed: number }>;
  tempIdsToDelete: number[];
}> {
  const hashUpdates: Array<{
    tempId: number;
    newHash: string;
    variationSeed: number;
  }> = [];
  const tempIdsToDelete: number[] = [];

  for (const group of duplicateGroups) {
    const selectedInGroup = group.transactions.filter((item) =>
      selectedIndices.has(item.index)
    );

    // The kept copies take seeds 0, 1, 2… in order. Rows arrive pre-seeded by
    // occurrence, so only a row whose position among the kept copies changed
    // (an earlier copy was left out) needs a new hash.
    for (const [variationIndex, item] of selectedInGroup.entries()) {
      if ((item.transaction.hash_variation_seed ?? 0) === variationIndex) {
        continue;
      }

      hashUpdates.push({
        tempId: item.tempId,
        newHash: await generateTransactionHash(
          item.transaction.account_id,
          item.transaction.date,
          item.transaction.amount,
          item.transaction.description,
          variationIndex
        ),
        variationSeed: variationIndex,
      });
    }

    for (const item of group.transactions) {
      if (!selectedIndices.has(item.index)) {
        tempIdsToDelete.push(item.tempId);
      }
    }
  }

  return { hashUpdates, tempIdsToDelete };
}

export function calculateImportableTransactions(
  csvData: any[],
  columnMapping: CSVImportColumnMapping,
  accountMatches: CSVAccountMatch[]
): number {
  if (!csvData.length || !columnMapping.accountColumn || !accountMatches.length) {
    return 0;
  }

  if (columnMapping.accountColumn.startsWith('DIRECT_ACCOUNT:')) {
    return csvData.length;
  }

  return csvData.filter((row) => {
    const csvAccountValue = String(row[columnMapping.accountColumn]);
    const accountMapping = accountMatches.find(
      (match) => match.csvAccountValue === csvAccountValue
    );
    return Boolean(accountMapping?.selectedAccountId);
  }).length;
}