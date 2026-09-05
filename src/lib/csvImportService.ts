import type { Account, Transaction } from '../types/database';

import { DatabaseService } from './databaseService';
import { parseCsvDate } from './dateOnly';

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
  matchingAccounts: Account[];
  selectedAccountId: number | null;
  selectedCardId?: number | null;
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

/** A CSV data row (1-based, excluding the header) that could not be turned into a transaction. */
export interface CsvRejectedRow {
  rowNumber: number;
  reason: string;
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
  headers: string[]
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
    uniqueIdentifierColumn: detectUniqueIdentifierColumn(headers),
  };
}

// A bank reference/transaction number is a strong dedup key; a header that merely
// contains "id" (Paid, Valid, Card Holder ID) is not, and a wrong pick silently
// breaks duplicate detection on the next overlapping import.
const UNIQUE_ID_STRONG_RE = /reference|\btrans(?:action)?\s*(?:id|number|#|no\.?)\b|\btxn\s*(?:id|number)|\bfitid\b/i;
const UNIQUE_ID_WEAK_RE = /\bid\b/i;
const UNIQUE_ID_EXCLUDE_RE = /holder|customer|member|account|card|user|category|merchant|payee/i;

export function detectUniqueIdentifierColumn(headers: string[]): string {
  const strong = headers.find((header) => UNIQUE_ID_STRONG_RE.test(header));
  if (strong) return strong;
  return (
    headers.find(
      (header) => UNIQUE_ID_WEAK_RE.test(header) && !UNIQUE_ID_EXCLUDE_RE.test(header)
    ) || ''
  );
}

/**
 * Parses a bank-export amount cell. Understands accounting negatives "(12.34)",
 * trailing minus "12.34-", CR/DR markers (CR = money in, DR = money out), and
 * currency symbols / thousands separators. Returns null for anything that is
 * not a number so the row can be reported instead of imported as $0.
 */
export function parseCsvAmount(raw: unknown): number | null {
  if (raw == null) return null;
  let text = String(raw).trim();
  if (!text) return null;

  let sign = 1;
  if (/^\(.*\)$/.test(text)) {
    sign = -1;
    text = text.slice(1, -1);
  }

  const marker = text.match(/\b(CR|DR)\b\s*$/i) ?? text.match(/^\s*(CR|DR)\b/i);
  if (marker) {
    if (marker[1].toUpperCase() === 'DR') sign *= -1;
    text = text.replace(marker[0], '');
  }

  if (/-\s*$/.test(text) && !/^\s*-/.test(text)) {
    sign *= -1;
    text = text.replace(/-\s*$/, '');
  }

  const cleaned = text.replace(/[^\d.-]/g, '');
  if (!/\d/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return value * sign;
}

export function extractLastFourValue(csvValue: string): string {
  const lastFourMatch = csvValue.match(/(\d{4})$/);
  return lastFourMatch ? lastFourMatch[1] : '';
}

function extractDigitsValue(csvValue: string): string {
  return csvValue.replace(/\D/g, '');
}

export async function createAccountMatches(
  data: any[],
  accountColumn: string,
  findAccountsByLastFour: (lastFour: string) => Promise<Account[]>,
  findAccountsByFullNumber: (fullNumber: string) => Promise<Account[]>
): Promise<CSVAccountMatch[]> {
  const uniqueAccountValues = [...new Set(data.map((row) => String(row[accountColumn])))];

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

      return {
        csvAccountValue: csvValue,
        lastFourValue,
        matchingAccounts,
        selectedAccountId:
          matchingAccounts.length === 1 ? matchingAccounts[0].id : null,
        selectedCardId: null,
      };
    })
  );
}

/**
 * Turns parsed CSV rows into transactions. Rows whose account value is not
 * mapped are skipped silently (the caller reports them as "unmapped"); rows with
 * an unreadable date or amount are returned in `rejected` with a reason instead
 * of being defaulted to today / $0.
 */
export async function mapTransactionsFromCSV(
  data: any[],
  columnMapping: CSVImportColumnMapping,
  accountMappings: CSVAccountMatch[],
  generateTransactionHash: HashGenerator
): Promise<CsvMappingResult> {
  const isDirectAccount = columnMapping.accountColumn.startsWith('DIRECT_ACCOUNT:');
  const directAccountMapping = isDirectAccount ? accountMappings[0] : null;

  const mapped: MappedCsvTransaction[] = [];
  const rejected: CsvRejectedRow[] = [];

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
    const uniqueIdentifier = rawUniqueIdentifier || undefined;

    const date = parseCsvDate(rawDate);
    if (!date) {
      rejected.push({
        rowNumber,
        reason: `Unrecognized date "${String(rawDate ?? '').trim()}" in column "${columnMapping.dateColumn}"`,
      });
      continue;
    }

    const amount = parseCsvAmount(rawAmount);
    if (amount == null) {
      rejected.push({
        rowNumber,
        reason: `Unrecognized amount "${String(rawAmount ?? '').trim()}" in column "${columnMapping.amountColumn}"`,
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
      transaction_hash: hash,
      external_id: uniqueIdentifier ?? null,
    };

    mapped.push({
      transaction,
      csvAccountValue,
      lastFourValue,
      hash,
      uniqueIdentifier,
    });
  }

  return { mapped, rejected };
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

    for (const [variationIndex, item] of selectedInGroup.entries()) {
      if (variationIndex === 0) {
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