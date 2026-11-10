import type { Account } from '@/types/database';

export function extractLastFourValue(csvValue: string): string {
  const lastFourMatch = csvValue.match(/(\d{4})$/);
  return lastFourMatch ? lastFourMatch[1] : '';
}

export function extractDigitsValue(csvValue: string): string {
  return csvValue.replace(/\D/g, '');
}

// Words that appear in bank-export account labels and file names but say
// nothing about which account or institution is meant.
const ACCOUNT_TEXT_STOPWORDS = new Set([
  'account', 'accounts', 'acct', 'card', 'ending', 'number', 'no', 'xxxx', 'the', 'and', 'for',
  'export', 'exports', 'transaction', 'transactions', 'statement', 'statements', 'download',
  'downloads', 'history', 'data', 'csv', 'activity', 'report', 'file', 'details', 'detail',
  'list', 'all', 'my', 'import', 'sample',
  // Account-type words are shared by unrelated accounts, so they are not a hint either.
  'checking', 'savings', 'credit', 'debit', 'loan', 'mortgage', 'investment', 'retirement',
]);

function textTokens(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((token) => token.length >= 3 && !ACCOUNT_TEXT_STOPWORDS.has(token));
}

/**
 * Accounts whose name or institution shares a meaningful word with the CSV
 * account value ("Huntington Checking 1234" → the Huntington accounts). A hint
 * for the mapping UI only: text is too weak to pick an account on its own.
 */
export function findTextHintedAccounts(csvValue: string, accounts: Account[]): Account[] {
  const valueTokens = new Set(textTokens(csvValue));
  if (valueTokens.size === 0) return [];
  return accounts.filter((account) => {
    const accountTokens = textTokens(`${account.name} ${account.institution ?? ''}`);
    return accountTokens.some((token) => valueTokens.has(token));
  });
}

/**
 * Guesses the institution from an export's file name ("HuntingtonExport.csv"
 * → "Huntington"). Only a prefill: the user can clear or change it.
 */
export function deriveInstitutionHint(fileName: string | null | undefined): string {
  if (!fileName) return '';
  const base = fileName.replace(/\.[^.]+$/, '');
  const [first] = textTokens(base);
  if (!first) return '';
  return first.charAt(0).toUpperCase() + first.slice(1);
}
