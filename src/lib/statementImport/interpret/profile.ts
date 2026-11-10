/**
 * What each column contains, from a sample of its cells. This is how a column
 * with a header nobody has seen before is still recognised: dates look like
 * dates, money like money, a description is long varied text.
 */

import type { StatementTable } from '../types';

import { type DateReader, KNOWN_CURRENCIES, isAmountShaped, isExcelMangled } from './cells';
import { countLetters } from './text';
import { directionOfToken, isStatusWord } from './vocabulary';

/** Enough rows to know a column; statements are the same shape top to bottom. */
export const PROFILE_SAMPLE_ROWS = 500;

export interface ColumnProfile {
  index: number;
  /** Rows looked at. */
  rows: number;
  /** Of those, cells that are not blank. Every share below is a share of `filled`. */
  filled: number;
  dateShare: number;
  /** Amount-shaped cells (including numbers a spreadsheet mangled) that are not dates. */
  moneyShare: number;
  /** Money cells with one or two decimals ("12.50", "1.234,5"). */
  decimals: number;
  /** Money cells printed as negative: a minus, parentheses or a DR marker. */
  negatives: number;
  /** Money cells with a currency symbol. */
  symbols: number;
  /** Money cells that are a long run of digits with no separator: an id, not an amount. */
  longIntegers: number;
  distinct: number;
  averageLength: number;
  /** Cells with at least two letters. */
  letterShare: number;
  /** Cells with at least four digits. */
  digitShare: number;
  /** Cells that are a money-in / money-out word ("DR", "Credit", "支出"). */
  directionShare: number;
  /** Cells that are a status word ("Posted", "Pending"). */
  statusShare: number;
  /** Cells that are an ISO 4217 code. */
  currencyShare: number;
  /** Cells that are a masked account number ("****4821", "XXXX-1234"). */
  maskedShare: number;
}

const NEGATIVE_RE = /^\s*\(.*\)\s*$|^\s*[-−]|[-−]\s*$|\bDR\b/i;
const CURRENCY_SYMBOL_RE = /[$€£¥￥₩₹₽₺]/;
const SHORT_DECIMALS_RE = /[.,]\d{1,2}(?!\d)/;
const LONG_INTEGER_RE = /^\d{7,}$/;
const MASKED_ACCOUNT_RE = /^[xX*•·#.\-\s]{2,}\d{2,6}$|^\d{0,6}[xX*•·]{3,}[-\s]?\d{2,6}$/;

export function profileColumns(table: StatementTable, reader: DateReader): ColumnProfile[] {
  const rows = Math.min(table.rows.length, PROFILE_SAMPLE_ROWS);
  return table.columns.map((column) => {
    let filled = 0;
    let dates = 0;
    let money = 0;
    let decimals = 0;
    let negatives = 0;
    let symbols = 0;
    let longIntegers = 0;
    let length = 0;
    let lettered = 0;
    let digitRich = 0;
    let directions = 0;
    let statuses = 0;
    let currencies = 0;
    let masked = 0;
    const seen = new Set<string>();

    for (let row = 0; row < rows; row += 1) {
      const cell = (table.rows[row][column.index] ?? '').trim();
      if (!cell) continue;
      filled += 1;
      seen.add(cell);
      length += cell.length;
      if (countLetters(cell) >= 2) lettered += 1;
      if ((cell.match(/\d/g)?.length ?? 0) >= 4) digitRich += 1;
      if (directionOfToken(cell)) directions += 1;
      if (isStatusWord(cell)) statuses += 1;
      if (cell.length === 3 && KNOWN_CURRENCIES.has(cell.toUpperCase())) currencies += 1;
      if (MASKED_ACCOUNT_RE.test(cell)) masked += 1;

      if (reader.read(cell).evidence !== 'none') {
        dates += 1;
      } else if (isAmountShaped(cell) || isExcelMangled(cell)) {
        money += 1;
        if (SHORT_DECIMALS_RE.test(cell)) decimals += 1;
        if (NEGATIVE_RE.test(cell)) negatives += 1;
        if (CURRENCY_SYMBOL_RE.test(cell)) symbols += 1;
        if (LONG_INTEGER_RE.test(cell)) longIntegers += 1;
      }
    }

    const share = (count: number) => (filled === 0 ? 0 : count / filled);
    return {
      index: column.index,
      rows,
      filled,
      dateShare: share(dates),
      moneyShare: share(money),
      decimals,
      negatives,
      symbols,
      longIntegers,
      distinct: seen.size,
      averageLength: filled === 0 ? 0 : length / filled,
      letterShare: share(lettered),
      digitShare: share(digitRich),
      directionShare: share(directions),
      statusShare: share(statuses),
      currencyShare: share(currencies),
      maskedShare: share(masked),
    };
  });
}

/** 0..1: how much a numeric column with an unknown header looks like money rather than an id or a count. */
export function moneyLikeness(profile: ColumnProfile): number {
  if (profile.filled === 0 || profile.moneyShare < 0.8) return 0;
  const cells = profile.filled * profile.moneyShare;
  if (profile.longIntegers / cells > 0.5) return 0;
  let score = 0.4;
  if (profile.decimals / cells >= 0.5) score += 0.4;
  if (profile.negatives > 0) score += 0.15;
  if (profile.symbols > 0) score += 0.15;
  // The same whole number on every row is a code or a count, not an amount.
  if (profile.distinct === 1 && profile.filled > 3 && profile.decimals === 0) score = 0.1;
  return Math.min(1, score);
}

/** 0..1: how much a text column reads like a transaction description (filled in, varied, more than a code). */
export function descriptiveness(profile: ColumnProfile): number {
  if (profile.filled === 0 || profile.rows === 0) return 0;
  const fill = profile.filled / profile.rows;
  const variety = profile.distinct / profile.filled;
  const length = Math.min(1, profile.averageLength / 16);
  return fill * (0.3 + 0.7 * variety) * length;
}
