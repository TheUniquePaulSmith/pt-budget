import type { Account, Transaction } from '../types/database';

import { DatabaseService } from './databaseService';

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

export interface CSVImportAnalysisResult {
  totalRows: number;
  mappableRows: number;
  duplicateCount: number;
  internalDuplicates: number;
  uniqueCount: number;
  skippedRows: number;
  duplicateGroups?: CSVImportDuplicateGroup[];
}

type HashGenerator = (
  accountId: string,
  date: string,
  amount: number,
  description: string,
  uniqueIdentifier?: string
) => string;

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
    uniqueIdentifierColumn:
      headers.find(
        (header) =>
          header.toLowerCase().includes('reference') ||
          header.toLowerCase().includes('id')
      ) || '',
  };
}

export function extractLastFourValue(csvValue: string): string {
  const lastFourMatch = csvValue.match(/(\d{4})$/);
  return lastFourMatch ? lastFourMatch[1] : '';
}

export async function createAccountMatches(
  data: any[],
  accountColumn: string,
  findAccountsByLastFour: (lastFour: string) => Promise<Account[]>
): Promise<CSVAccountMatch[]> {
  const uniqueAccountValues = [...new Set(data.map((row) => String(row[accountColumn])))];

  return Promise.all(
    uniqueAccountValues.map(async (csvValue) => {
      const lastFourValue = extractLastFourValue(csvValue);
      const matchingAccounts = lastFourValue
        ? await findAccountsByLastFour(lastFourValue)
        : [];

      return {
        csvAccountValue: csvValue,
        lastFourValue,
        matchingAccounts,
        selectedAccountId:
          matchingAccounts.length === 1 ? matchingAccounts[0].id : null,
      };
    })
  );
}

export function mapTransactionsFromCSV(
  data: any[],
  columnMapping: CSVImportColumnMapping,
  accountMappings: CSVAccountMatch[],
  generateTransactionHash: HashGenerator
): MappedCsvTransaction[] {
  const isDirectAccount = columnMapping.accountColumn.startsWith('DIRECT_ACCOUNT:');
  const directAccountMapping = isDirectAccount ? accountMappings[0] : null;

  return data
    .filter((row) => {
      if (isDirectAccount) {
        return Boolean(directAccountMapping?.selectedAccountId);
      }

      const csvAccountValue = String(row[columnMapping.accountColumn]);
      const accountMapping = accountMappings.find(
        (match) => match.csvAccountValue === csvAccountValue
      );
      return Boolean(accountMapping?.selectedAccountId);
    })
    .map((row) => {
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

      if (!accountMapping?.selectedAccountId) {
        throw new Error(`No account mapping found for ${csvAccountValue}`);
      }

      const dateStr = row[columnMapping.dateColumn];
      const amountStr = String(row[columnMapping.amountColumn]);
      const description = String(row[columnMapping.descriptionColumn]);
      const uniqueIdentifier = columnMapping.uniqueIdentifierColumn
        ? String(row[columnMapping.uniqueIdentifierColumn])
        : undefined;

      let date: string;
      try {
        const parsedDate = new Date(dateStr);
        if (Number.isNaN(parsedDate.getTime())) {
          throw new Error('Invalid date');
        }
        date = parsedDate.toISOString().split('T')[0];
      } catch {
        date = new Date().toISOString().split('T')[0];
      }

      const cleanAmount = amountStr.replace(/[^\d.-]/g, '');
      const amount = parseFloat(cleanAmount) || 0;
      const type: 'income' | 'expense' = amount > 0 ? 'income' : 'expense';

      const transaction: Omit<Transaction, 'id' | 'created_at' | 'updated_at'> = {
        date,
        amount: Math.abs(amount) * (type === 'expense' ? -1 : 1),
        description: description || 'Imported transaction',
        account_id: accountMapping.selectedAccountId,
        category_id: null,
        company_id: null,
        project_id: null,
        trip_id: null,
        type,
      };

      const hash = generateTransactionHash(
        csvAccountValue,
        date,
        amount,
        description,
        uniqueIdentifier
      );

      return {
        transaction: { ...transaction, transaction_hash: hash },
        csvAccountValue,
        lastFourValue,
        hash,
        uniqueIdentifier,
      };
    });
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

export function createHashUpdatesForSelectedDuplicates(
  duplicateGroups: CSVImportDuplicateGroup[],
  selectedIndices: Set<number>
): {
  hashUpdates: Array<{ tempId: number; newHash: string; variationSeed: number }>;
  tempIdsToDelete: number[];
} {
  const hashUpdates: Array<{
    tempId: number;
    newHash: string;
    variationSeed: number;
  }> = [];
  const tempIdsToDelete: number[] = [];

  duplicateGroups.forEach((group) => {
    const selectedInGroup = group.transactions.filter((item) =>
      selectedIndices.has(item.index)
    );

    selectedInGroup.forEach((item, variationIndex) => {
      if (variationIndex === 0) {
        return;
      }

      hashUpdates.push({
        tempId: item.tempId,
        newHash: DatabaseService.generateTransactionHashFromFields(
          item.csvAccountValue,
          item.transaction.date,
          item.transaction.amount,
          item.transaction.description,
          item.uniqueIdentifier,
          variationIndex
        ),
        variationSeed: variationIndex,
      });
    });

    group.transactions.forEach((item) => {
      if (!selectedIndices.has(item.index)) {
        tempIdsToDelete.push(item.tempId);
      }
    });
  });

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