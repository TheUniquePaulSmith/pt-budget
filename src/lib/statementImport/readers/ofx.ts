/**
 * OFX / QFX → one StatementTable per account statement in the file.
 *
 * Parsed by hand (no XML parser, no dependency) because OFX comes in two
 * dialects that one tolerant scanner covers:
 *   1.x  SGML: aggregates are closed (<STMTTRN>…</STMTTRN>), values are not (<TRNAMT>-4.50)
 *   2.x  XML:  everything is closed (<TRNAMT>-4.50</TRNAMT>)
 *
 * The fields are fixed, so the table has fixed columns and carries a preset
 * layout: nothing about an OFX file is guessed.
 */

import type { AccountType } from '@/types/database';

import { deriveInstitutionHint } from '../shared/accountText';
import type { AccountHint, ImportIssue, ImportLayout, ReadResult, SourceFile, StatementColumn, StatementTable } from '../types';

import type { DecodedText } from './encoding';
import { fingerprintOfOfx } from './fingerprint';
import { readerIssue, unreadable } from './issues';

export const OFX_COLUMN_NAMES = ['Date', 'Amount', 'Name', 'Memo', 'Reference', 'Type', 'Check Number'] as const;

const ofxLayout = (): ImportLayout => ({
  roles: { date: 0, amount: 1, description: [2, 3], reference: 4 },
  dateOrder: 'YMD',
  decimal: '.',
  amountSign: 'asIs',
});

interface OfxNode {
  name: string;
  /** Values directly inside this aggregate, by upper-cased tag; the first one wins. */
  fields: Map<string, string>;
  children: OfxNode[];
  /** 1-based file line of the opening tag. */
  line: number;
  /** Its closing tag was seen. */
  closed: boolean;
}

// Aggregates the reader walks. A complete file closes every aggregate, which
// is how they are told from empty values; this list keeps a file that was cut
// off before the closing tags readable.
const KNOWN_AGGREGATES = new Set([
  'OFX', 'SIGNONMSGSRSV1', 'SONRS', 'FI', 'BANKMSGSRSV1', 'STMTTRNRS', 'STMTRS', 'BANKACCTFROM', 'BANKTRANLIST',
  'STMTTRN', 'PAYEE', 'BANKACCTTO', 'CCACCTTO', 'LEDGERBAL', 'AVAILBAL', 'CREDITCARDMSGSRSV1', 'CCSTMTTRNRS',
  'CCSTMTRS', 'CCACCTFROM',
]);

// Elements that only ever hold a value. An empty one is nothing, even in a
// file that closes its values elsewhere: treating "<MEMO>" as an aggregate
// would hide the fields that follow it inside the transaction.
const KNOWN_VALUES = new Set([
  'TRNTYPE', 'DTPOSTED', 'DTUSER', 'DTAVAIL', 'TRNAMT', 'FITID', 'CORRECTFITID', 'CORRECTACTION', 'SRVRTID',
  'CHECKNUM', 'REFNUM', 'SIC', 'PAYEEID', 'NAME', 'EXTDNAME', 'MEMO', 'ADDR1', 'ADDR2', 'ADDR3', 'CITY', 'STATE',
  'POSTALCODE', 'COUNTRY', 'PHONE', 'BANKID', 'BRANCHID', 'ACCTID', 'ACCTTYPE', 'ACCTKEY', 'CURDEF', 'ORG', 'FID',
  'BALAMT', 'DTASOF', 'DTSTART', 'DTEND', 'DTSERVER', 'LANGUAGE', 'TRNUID', 'CODE', 'SEVERITY', 'MESSAGE',
]);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,5});/gi, (whole, body: string) => {
    if (body[0] !== '#') return ENTITIES[body.toLowerCase()] ?? whole;
    const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

const CDATA_OPEN = '<![CDATA[';

function parseOfx(text: string): OfxNode {
  const root: OfxNode = { name: '', fields: new Map(), children: [], line: 1, closed: true };
  const stack: OfxNode[] = [root];

  const closedNames = new Set<string>();
  for (const match of text.matchAll(/<\/([A-Za-z0-9_.]+)\s*>/g)) closedNames.add(match[1].toUpperCase());

  // Line numbers are counted forward as the scan advances, so every character is looked at once.
  let line = 1;
  let counted = 0;
  const lineAt = (index: number): number => {
    for (; counted < index; counted++) {
      const code = text.charCodeAt(counted);
      if (code === 10 || (code === 13 && text.charCodeAt(counted + 1) !== 10)) line++;
    }
    return line;
  };

  let position = Math.max(0, text.search(/<OFX[\s>]/i));
  for (;;) {
    const open = text.indexOf('<', position);
    if (open === -1) break;
    if (text.startsWith('<!--', open)) {
      const commentEnd = text.indexOf('-->', open + 4);
      position = commentEnd === -1 ? text.length : commentEnd + 3;
      continue;
    }
    const close = text.indexOf('>', open + 1);
    if (close === -1) break;
    const tag = text.slice(open + 1, close).trim();
    position = close + 1;
    if (tag === '' || tag[0] === '?' || tag[0] === '!') continue;

    if (tag[0] === '/') {
      const name = tag.slice(1).trim().toUpperCase();
      for (let depth = stack.length - 1; depth >= 1; depth--) {
        if (stack[depth].name !== name) continue;
        stack[depth].closed = true;
        stack.length = depth;
        break;
      }
      continue;
    }
    if (tag.endsWith('/')) continue; // <MEMO/>: an empty value

    const name = tag.split(/\s/, 1)[0].toUpperCase();
    let valueEnd = text.indexOf('<', position);
    if (valueEnd === -1) valueEnd = text.length;
    let value = text.slice(position, valueEnd).trim();
    if (value === '' && text.startsWith(CDATA_OPEN, valueEnd)) {
      const dataEnd = text.indexOf(']]>', valueEnd);
      value = text.slice(valueEnd + CDATA_OPEN.length, dataEnd === -1 ? text.length : dataEnd).trim();
      position = dataEnd === -1 ? text.length : dataEnd + 3;
    } else {
      value = decodeEntities(value);
      position = valueEnd;
    }

    const parent = stack[stack.length - 1];
    if (value !== '') {
      if (!parent.fields.has(name)) parent.fields.set(name, value);
    } else if (KNOWN_AGGREGATES.has(name) || (closedNames.has(name) && !KNOWN_VALUES.has(name))) {
      const node: OfxNode = { name, fields: new Map(), children: [], line: lineAt(open), closed: false };
      parent.children.push(node);
      stack.push(node);
    }
    // Otherwise an empty value ("<MEMO>", "<MEMO></MEMO>"): nothing to keep.
  }
  return root;
}

function findAll(node: OfxNode, names: readonly string[], found: OfxNode[] = []): OfxNode[] {
  for (const child of node.children) {
    if (names.includes(child.name)) found.push(child);
    else findAll(child, names, found);
  }
  return found;
}

function findFirst(node: OfxNode, name: string): OfxNode | null {
  for (const child of node.children) {
    if (child.name === name) return child;
    const nested = findFirst(child, name);
    if (nested) return nested;
  }
  return null;
}

/** "20260914120000.000[-5:EST]" → "2026-09-14": the date as the bank wrote it, time and zone ignored. */
export function ofxDate(value: string | undefined): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(value?.trim() ?? '');
  if (!match) return null;
  const [, year, month, day] = match;
  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > lastDay) return null;
  return `${year}-${month}-${day}`;
}

/**
 * An OFX amount with a dot decimal. The format has no thousands separators
 * and lets the decimal mark be "." or ",", so a lone comma is the decimal.
 * Anything that is not a number is passed through for the analysis to report.
 */
export function ofxAmount(value: string | undefined): string {
  const printed = value?.trim() ?? '';
  let amount = printed.replace(/\s+/g, '');
  if (amount.startsWith('+')) amount = amount.slice(1);
  const comma = amount.lastIndexOf(',');
  const dot = amount.lastIndexOf('.');
  if (comma > dot) amount = `${amount.slice(0, comma).replace(/[.,]/g, '')}.${amount.slice(comma + 1)}`;
  else if (comma !== -1) amount = amount.replace(/,/g, '');
  return /^-?(?:\d+\.?\d*|\.\d+)$/.test(amount) ? amount : printed;
}

const BANK_ACCOUNT_TYPES: Record<string, AccountType> = {
  CHECKING: 'checking',
  SAVINGS: 'savings',
  MONEYMRKT: 'savings',
  CD: 'savings',
  CREDITLINE: 'credit',
};

function sameText(a: string, b: string): boolean {
  return a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();
}

function readTransaction(node: OfxNode): string[] {
  const field = (name: string) => node.fields.get(name) ?? '';
  const posted = field('DTPOSTED') || field('DTUSER');
  const name = field('NAME') || (node.children.find((child) => child.name === 'PAYEE')?.fields.get('NAME') ?? '');
  // Many banks repeat the name in the memo; once is enough in the description.
  const memo = sameText(field('MEMO'), name) ? '' : field('MEMO');
  return [
    ofxDate(posted) ?? posted,
    ofxAmount(field('TRNAMT')),
    name,
    memo,
    field('FITID'),
    field('TRNTYPE'),
    field('CHECKNUM'),
  ];
}

export function readOfx(file: SourceFile, decoded: DecodedText): ReadResult {
  const root = parseOfx(decoded.text);
  const envelope = findFirst(root, 'OFX');
  const institutionNode = findFirst(root, 'FI');
  const institution = institutionNode?.fields.get('ORG') ?? institutionNode?.fields.get('FID') ?? null;
  // No closing </OFX>: the download stopped early, and its last transaction may be half there.
  const cutOff = envelope !== null && !envelope.closed;

  const tables: StatementTable[] = [];
  for (const statement of findAll(root, ['STMTRS', 'CCSTMTRS'])) {
    const isCard = statement.name === 'CCSTMTRS';
    const account = findFirst(statement, isCard ? 'CCACCTFROM' : 'BANKACCTFROM');
    const list = findFirst(statement, 'BANKTRANLIST');
    const transactions = findAll(statement, ['STMTTRN']).filter((transaction) => transaction.closed || !cutOff);
    if (transactions.length === 0) continue;

    const accountType: AccountType | null = isCard
      ? 'credit'
      : (BANK_ACCOUNT_TYPES[(account?.fields.get('ACCTTYPE') ?? '').toUpperCase()] ?? null);
    const currency = statement.fields.get('CURDEF') ?? null;

    const accountHints: AccountHint[] = [];
    const hint = (kind: AccountHint['kind'], value: string | null | undefined, source: AccountHint['source'] = 'ofx') => {
      if (value) accountHints.push({ kind, value, source });
    };
    hint('number', account?.fields.get('ACCTID'));
    hint('accountType', accountType);
    hint('institution', institution);
    hint('currency', currency?.toUpperCase());
    if (!institution) hint('institution', deriveInstitutionHint(file.name), 'fileName');

    const ledger = findFirst(statement, 'LEDGERBAL');
    const balance = Number(ofxAmount(ledger?.fields.get('BALAMT')) || NaN);

    const notes: ImportIssue[] = [];
    if (decoded.guessed) notes.push(readerIssue('encodingGuessed', { params: { encoding: decoded.encoding } }));
    if (cutOff) notes.push(readerIssue('truncatedFile', { params: { line: transactions[transactions.length - 1].line } }));

    tables.push({
      format: 'ofx',
      fingerprint: fingerprintOfOfx(institution, accountType),
      columns: OFX_COLUMN_NAMES.map((name, index): StatementColumn => ({ index, name })),
      rows: transactions.map(readTransaction),
      sourceLines: transactions.map((transaction) => transaction.line),
      meta: {
        fileName: file.name,
        encoding: decoded.encoding,
        preamble: [],
        trailer: [],
        accountHints,
        statementStart: ofxDate(list?.fields.get('DTSTART')),
        statementEnd: ofxDate(list?.fields.get('DTEND')),
        ledgerBalance: ledger && Number.isFinite(balance) ? { amount: balance, asOf: ofxDate(ledger.fields.get('DTASOF')) } : null,
        presetLayout: ofxLayout(),
      },
      notes,
    });
  }

  if (tables.length === 0) return unreadable('noDataRows');
  if (tables.length > 1) {
    for (const table of tables) table.notes.push(readerIssue('multipleAccountsInFile', { params: { count: tables.length } }));
  }
  return { tables, issues: [] };
}
