/**
 * Account hints: what a file says about the account it belongs to, outside
 * its rows. The lines above the header ("Account Number: …", "Account: …",
 * an IBAN) and the file name. Values are passed on as printed; the import
 * service normalises and matches them (only a full number is "recognised").
 */

import type { AccountType } from '@/types/database';

import { deriveInstitutionHint } from '../shared/accountText';
import type { AccountHint, AccountHintSource } from '../types';

// Labels a bank puts in front of an account or card number / name, in the
// nine languages the app ships. Compared lower-cased, without the trailing
// ":", "#", "." or "№".
const ACCOUNT_LABELS = new Set([
  // English
  'account', 'account number', 'account no', 'account num', 'account id', 'account name', 'account nickname',
  'acct', 'acct number', 'acct no', 'card', 'card number', 'card no', 'account ending', 'account ending in',
  'card ending', 'card ending in', 'iban',
  // German
  'konto', 'kontonummer', 'konto-nr', 'kontonr', 'kontoname', 'kartennummer',
  // French
  'compte', 'numéro de compte', 'numero de compte', 'n° de compte', 'no de compte', 'numéro de carte',
  // Spanish
  'cuenta', 'número de cuenta', 'numero de cuenta', 'nº de cuenta', 'número de tarjeta', 'numero de tarjeta',
  // Portuguese
  'conta', 'número da conta', 'numero da conta', 'número do cartão', 'numero do cartao',
  // Italian
  'conto', 'numero conto', 'numero di conto', 'numero del conto', 'numero carta',
  // Japanese, Chinese, Korean
  '口座', '口座番号', 'カード番号', '账号', '账户', '帐号', '卡号', '帳號', '帳戶', '계좌', '계좌번호', '카드번호',
]);

// Labels specific enough to be followed by their value with no separator ("Account Number 000123").
const SPACED_ACCOUNT_LABELS = [
  'account ending in', 'account number', 'card ending in', 'account ending', 'card number', 'card ending',
  'acct number', 'account no', 'kontonummer', 'acct no', 'card no',
];

const INSTITUTION_LABELS = new Set([
  'bank', 'bank name', 'institution', 'financial institution', 'kreditinstitut', 'banque', 'banco', 'banca',
  '銀行', '金融機関', '银行', '은행',
]);

const CURRENCY_LABELS = new Set([
  'currency', 'account currency', 'währung', 'devise', 'moneda', 'divisa', 'moeda', 'valuta', '通貨', '货币', '币种', '통화',
]);

const ACCOUNT_TYPE_LABELS = new Set([
  'account type', 'type of account', 'kontoart', 'type de compte', 'tipo de cuenta', 'tipo de conta',
  'tipo di conto', '口座種別', '账户类型', '계좌종류',
]);

const ACCOUNT_TYPE_WORDS: Array<[RegExp, AccountType]> = [
  [/credit\s?card|kreditkarte|carte de cr[ée]dit|tarjeta de cr[ée]dito|cart[ãa]o de cr[ée]dito|carta di credito/i, 'credit'],
  [/che(?:ck|qu)ing|current|giro|courant|corriente|corrente/i, 'checking'],
  [/saving|spar|[ée]pargne|ahorro|poupan[çc]a|risparmio/i, 'savings'],
  [/mortgage|loan|darlehen|hypothek|pr[êe]t|pr[ée]stamo|hipoteca|empr[ée]stimo|prestito|mutuo/i, 'loan'],
  [/credit|kredit|cr[ée]dit/i, 'credit'],
];

/** An app account type from the words a bank uses for one ("Everyday Checking" → checking). */
export function accountTypeFromText(text: string): AccountType | null {
  for (const [pattern, type] of ACCOUNT_TYPE_WORDS) {
    if (pattern.test(text)) return type;
  }
  return null;
}

const SEPARATORS = [':', '：', '='];
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/gi;

/** ISO 13616 check: move the first four characters to the end, letters become 10–35, mod 97 is 1. */
export function isValidIban(printed: string): boolean {
  const iban = printed.replace(/\s+/g, '').toUpperCase();
  if (iban.length < 15 || iban.length > 34 || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (let index = 0; index < rearranged.length; index++) {
    const code = rearranged.charCodeAt(index);
    remainder = code >= 65 ? (remainder * 100 + code - 55) % 97 : (remainder * 10 + code - 48) % 97;
  }
  return remainder === 1;
}

function normalizeLabel(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s:#.№]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function digitCount(text: string): number {
  let digits = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 48 && code <= 57) digits++;
  }
  return digits;
}

/** Splits "Label: value" at the first separator; a cell with none is all label. */
function splitLabel(cell: string): { label: string; value: string } {
  let cut = -1;
  for (const separator of SEPARATORS) {
    const at = cell.indexOf(separator);
    if (at !== -1 && (cut === -1 || at < cut)) cut = at;
  }
  if (cut === -1) return { label: cell, value: '' };
  return { label: cell.slice(0, cut), value: cell.slice(cut + 1).trim() };
}

class HintList {
  private readonly seen = new Set<string>();
  readonly hints: AccountHint[] = [];

  add(kind: AccountHint['kind'], value: string, source: AccountHintSource): void {
    const trimmed = value.trim();
    if (!trimmed) return;
    // The same number printed with and without spaces is one hint.
    const key = `${kind}:${(kind === 'number' ? trimmed.replace(/\s+/g, '') : trimmed).toLowerCase()}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.hints.push({ kind, value: trimmed, source });
  }

  /** An account value is a number when it carries four digits or more, otherwise a label. */
  addAccount(value: string, source: AccountHintSource): void {
    this.add(digitCount(value) >= 4 ? 'number' : 'label', value, source);
  }
}

function readPreambleLine(cells: string[], hints: HintList): void {
  const filled = cells.map((cell) => cell.trim()).filter(Boolean);

  for (let index = 0; index < filled.length; index++) {
    const cell = filled[index];
    const split = splitLabel(cell);
    const label = normalizeLabel(split.label);
    let value = split.value;
    // "Account Number:" in one cell, the number in the next.
    const takesNextCell = value === '' && index + 1 < filled.length;
    if (takesNextCell) value = filled[index + 1];

    if (value !== '') {
      let matched = true;
      if (ACCOUNT_LABELS.has(label)) {
        hints.addAccount(value, 'preamble');
      } else if (INSTITUTION_LABELS.has(label)) {
        hints.add('institution', value, 'preamble');
      } else if (CURRENCY_LABELS.has(label)) {
        const code = /\b[A-Z]{3}\b/.exec(value.toUpperCase());
        if (code) hints.add('currency', code[0], 'preamble');
      } else if (ACCOUNT_TYPE_LABELS.has(label)) {
        const type = accountTypeFromText(value);
        if (type) hints.add('accountType', type, 'preamble');
      } else {
        matched = false;
      }
      if (matched) {
        if (takesNextCell) index++;
        continue;
      }
    }

    // "Account Number 000123456789", "Card ending in 4821": no separator at all.
    const lower = cell.normalize('NFKC').toLowerCase();
    const spaced = SPACED_ACCOUNT_LABELS.find((phrase) => lower.startsWith(`${phrase} `));
    if (spaced) hints.addAccount(cell.slice(spaced.length + 1), 'preamble');
  }

  // An IBAN is recognisable wherever it is printed.
  for (const match of filled.join(' ').match(IBAN) ?? []) {
    if (isValidIban(match)) hints.add('number', match, 'preamble');
  }
}

function isDateStamp(run: string): boolean {
  const part = (from: number, length: number) => Number(run.slice(from, from + length));
  const isDate = (year: number, month: number, day: number) =>
    year >= 1990 && year <= 2099 && month >= 1 && month <= 12 && day >= 1 && day <= 31;
  switch (run.length) {
    case 4:
      return isDate(part(0, 4), 1, 1);
    case 6:
      return isDate(part(0, 4), part(4, 2), 1) || isDate(2000 + part(0, 2), part(2, 2), part(4, 2));
    case 8:
      return (
        isDate(part(0, 4), part(4, 2), part(6, 2)) ||
        isDate(part(4, 4), part(0, 2), part(2, 2)) ||
        isDate(part(4, 4), part(2, 2), part(0, 2))
      );
    case 12:
    case 14:
      return isDate(part(0, 4), part(4, 2), part(6, 2));
    default:
      return false;
  }
}

/**
 * Hints from the lines above the header, then from the file name: a run of
 * four or more digits that is not a date stamp is taken as (part of) the
 * account number, and the first meaningful word as the institution.
 */
export function collectAccountHints(preamble: string[][], fileName: string): AccountHint[] {
  const hints = new HintList();
  for (const cells of preamble) readPreambleLine(cells, hints);

  const baseName = fileName.replace(/\.[^.]+$/, '');
  for (const run of baseName.match(/\d{4,}/g) ?? []) {
    if (!isDateStamp(run)) hints.add('number', run, 'fileName');
  }
  hints.add('institution', deriveInstitutionHint(fileName), 'fileName');
  return hints.hints;
}
