/**
 * What one raw cell looks like: an amount, a number a spreadsheet mangled, a
 * date and which day / month orders it allows. Cheap string tests, so the
 * layout detection can look at every row of a large file.
 */

import { SUPPORTED_CURRENCIES } from '../../currencies';
import { type CsvDateOrder, parseCsvDate } from '../../dateOnly';
import { parseCsvAmount } from '../shared/amounts';
import type { DecimalSeparator } from '../types';

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

/** "4.00E+14", "1.23e5": a spreadsheet replaced a long number with scientific notation. */
const EXCEL_MANGLED_RE = /^[-+]?\d(?:[.,]\d+)?e[-+]?\d+$/i;

export function isExcelMangled(cell: string): boolean {
  return EXCEL_MANGLED_RE.test(cell.trim());
}

/** Codes a statement plausibly prints; any three letters would also match "ATM" or "FEE". */
export const KNOWN_CURRENCIES: ReadonlySet<string> = new Set([
  ...SUPPORTED_CURRENCIES,
  'AED', 'ARS', 'BGN', 'CLP', 'COP', 'CZK', 'EGP', 'HUF', 'IDR', 'ILS', 'ISK', 'KES', 'MYR', 'NGN', 'PEN', 'PHP',
  'RON', 'RUB', 'SAR', 'THB', 'TRY', 'UAH', 'VND',
]);

const CURRENCY_SYMBOL_RE = /[$€£¥￥₩₹₽₺₫₴₦₱฿]|R\$|kr\.?|zł|Fr\./g;
/** "USD 12.34" / "12.34 EUR": a currency code at either end. */
const CURRENCY_CODE_EDGE_RE = /^([A-Z]{3})(?=[\s\d(+-])|([A-Z]{3})$/g;
const DR_CR_MARKER_RE = /^\s*(?:CR|DR)\b|\b(?:CR|DR)\s*$/gi;
/** Digits with group / decimal marks between them: "1,234.56", "1.234,56", "1 234,56", "1'234.56", ".50". */
const NUMBER_CORE_RE = /^(?:\d+(?:[.,'’   ]\d+)*|[.,]\d+)$/;

/**
 * True when the cell is a number the way a bank prints money: optional sign
 * (leading, trailing or accounting parentheses), currency symbol or code,
 * "CR" / "DR" marker. Unlike `parseCsvAmount`, text that merely contains
 * digits ("GROCERY MART 0421") is not an amount.
 */
export function isAmountShaped(cell: string): boolean {
  let text = cell.trim();
  if (!text || !/\d/.test(text)) return false;
  if (/^\(.*\)$/.test(text)) text = text.slice(1, -1).trim();
  text = text
    .replace(DR_CR_MARKER_RE, '')
    .trim()
    .replace(CURRENCY_CODE_EDGE_RE, (code) => (KNOWN_CURRENCIES.has(code) ? '' : code))
    .replace(CURRENCY_SYMBOL_RE, '')
    .trim()
    .replace(/^[-+−]\s*/, '')
    .replace(/\s*[-−]$/, '')
    .trim();
  return NUMBER_CORE_RE.test(text);
}

/**
 * What the separators in one amount say about the file's decimal mark.
 *   point / comma    only that mark can be the decimal ("12.50", "1.234,56", "1,234,567")
 *   ambiguousComma   one comma followed by exactly three digits ("1,234"): thousands, or three decimals
 *   ambiguousPoint   the same with a point ("1.234")
 *   none             no separator, or not an amount
 */
export type DecimalEvidence = 'point' | 'comma' | 'ambiguousComma' | 'ambiguousPoint' | 'none';

/** The number inside the cell, without the currency text around it ("Fr. 1'234.50" → "1'234.50"). */
const NUMBER_RUN_RE = /[.,]?\d[\d.,'’   ]*\d|[.,]?\d/;

export function decimalEvidenceOf(cell: string): DecimalEvidence {
  const digits = (cell.match(NUMBER_RUN_RE)?.[0] ?? '').replace(/[^\d.,]/g, '');
  const points = digits.split('.').length - 1;
  const commas = digits.split(',').length - 1;
  if (points === 0 && commas === 0) return 'none';
  if (points > 0 && commas > 0) return digits.lastIndexOf('.') > digits.lastIndexOf(',') ? 'point' : 'comma';

  const mark = points > 0 ? '.' : ',';
  // The same mark twice can only be grouping, so the other one is the decimal: "1,234,567".
  if (points + commas > 1) return mark === '.' ? 'comma' : 'point';
  const [whole, fraction] = digits.split(mark);
  // Grouping always has exactly three digits after it and one to three before.
  if (fraction.length === 3 && whole.length >= 1 && whole.length <= 3 && whole !== '0') {
    return mark === '.' ? 'ambiguousPoint' : 'ambiguousComma';
  }
  return mark === '.' ? 'point' : 'comma';
}

/** Reads an amount cell with the file's decimal mark; null when the cell is not an amount. */
export function readAmountCell(cell: string, decimal: DecimalSeparator): number | null {
  if (!isAmountShaped(cell) || isExcelMangled(cell)) return null;
  // A typographic minus (U+2212) is a minus; the shared parser only knows the hyphen.
  return parseCsvAmount(cell.replace(/−/g, '-'), { decimal });
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * What one date cell allows:
 *   fixed      reads the same whatever the order (ISO, year first, month names, "05/05/2026")
 *   dayFirst   only works day / month ("23/04/2026", "01.10.2026")
 *   monthFirst only works month / day ("04/23/2026")
 *   either     works both ways with different results ("04/06/2026")
 *   none       not a date
 */
export type DateEvidence = 'fixed' | 'dayFirst' | 'monthFirst' | 'either' | 'none';

export interface DateReading {
  evidence: DateEvidence;
  /** `yyyy-MM-dd` when read day first / month first; null when that order cannot read it. */
  dayFirst: string | null;
  monthFirst: string | null;
}

const NOT_A_DATE: DateReading = { evidence: 'none', dayFirst: null, monthFirst: null };

/** Everything `parseCsvDate` can read has one of these starts; it keeps amounts and text away from the slow parser. */
const DATE_CANDIDATE_RE =
  /^(?:\d{1,4}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{1,4}|\d{4}\s*年|\d{8}$|\d{1,2}[-\s]\p{L}{3,}|\p{L}{3,}\.?\s+\d{1,2})/u;

/**
 * A date the parser knows with a time after it (`yyyy-MM-dd`, `M/d/yyyy` or
 * `d/M/yyyy`, then `HH:mm` or `HH:mm:ss`). Only these shapes have a timed
 * pattern in dateOnly.csvFormats.ts; anything else goes to the parser whole.
 */
const TIMED_RE = /^(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}) (?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

function classifyDate(cell: string): DateReading {
  const text = cell
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
  if (!DATE_CANDIDATE_RE.test(text)) return NOT_A_DATE;
  const dayFirst = parseCsvDate(text, { order: 'DMY', strict: true });
  const monthFirst = parseCsvDate(text, { order: 'MDY', strict: true });
  if (dayFirst === null && monthFirst === null) return NOT_A_DATE;
  if (dayFirst === null) return { evidence: 'monthFirst', dayFirst, monthFirst };
  if (monthFirst === null) return { evidence: 'dayFirst', dayFirst, monthFirst };
  return { evidence: dayFirst === monthFirst ? 'fixed' : 'either', dayFirst, monthFirst };
}

/**
 * Reads date cells, remembering every distinct text: a statement repeats the
 * same few hundred dates, and trying each date pattern is the slow part.
 * The readings are exactly `parseCsvDate(cell, { order, strict: true })`.
 */
export class DateReader {
  private readonly seen = new Map<string, DateReading>();

  read(cell: string): DateReading {
    let reading = this.seen.get(cell);
    if (reading) return reading;
    // "09/14/2026 14:33:12": every row has its own time, but the day is one of
    // a few hundred. The parser reads such a cell as its date part, so read that.
    const timed = TIMED_RE.exec(cell.trim());
    if (timed) return this.read(timed[1]);
    reading = cell.trim() ? classifyDate(cell) : NOT_A_DATE;
    this.seen.set(cell, reading);
    return reading;
  }

  /** The date in the file's order (one order per file, never a per-row fallback). */
  inOrder(cell: string, order: CsvDateOrder): string | null {
    const reading = this.read(cell);
    return order === 'MDY' ? reading.monthFirst : reading.dayFirst;
  }
}
