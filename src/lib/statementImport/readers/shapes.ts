/**
 * Cell shapes: a rough, format-agnostic answer to "does this cell look like a
 * date, a number or words?". The readers use it only to find where the table
 * starts and ends (a header row is all words; data rows have dates and
 * numbers in the same columns). Which date order or decimal separator a
 * column uses is the interpretation stage's job, not decided here.
 */

export type CellShape = 'empty' | 'date' | 'number' | 'text';

const HAS_DIGIT = /\d/;
const YEAR_FIRST_DATE = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:[T\s].*)?$/;
const NUMERIC_DATE = /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}(?:\s.*)?$/;
const LETTERS = 'A-Za-z\\u00c0-\\u024f';
// "14 Sep 2026", "14-Sep-26", "14. September 2026"
const DAY_MONTH_NAME = new RegExp(`^\\d{1,2}(?:st|nd|rd|th)?[\\s./-]{1,3}[${LETTERS}]{3,12}\\.?[\\s./,-]{1,3}\\d{2,4}$`);
// "Sep 14, 2026"
const MONTH_NAME_DAY = new RegExp(`^[${LETTERS}]{3,12}\\.?\\s{1,3}\\d{1,2}(?:st|nd|rd|th)?,?\\s{1,3}\\d{2,4}$`);
// "2026年9月14日", "2026년 9월 14일"
const CJK_DATE = /^\d{2,4}\s?[年년]\s?\d{1,2}\s?[月월]\s?\d{1,2}\s?[日일]/;
const COMPACT_DATE = /^\d{8}$/;

const NUMBER_PREFIX = /^(?:[+\-−]\s?)?(?:(?:R\$|[$€£¥₩₹]|[A-Z]{3}\s)\s?)?(?:[+\-−]\s?)?/;
const NUMBER_SUFFIX = /(?:\s?(?:[$€£¥₩₹%]|[+\-−])|\s?(?:CR|DR|Cr|Dr|cr|dr)|\s[A-Z]{3})$/;
const NUMBER_CORE = /^\d[\d.,'   ]*$/;

// Longer than any date or amount; also keeps the patterns above off long text.
const MAX_TYPED_LENGTH = 40;

function isCompactDate(value: string): boolean {
  if (!COMPACT_DATE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  return year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

function isDateLike(value: string): boolean {
  return (
    YEAR_FIRST_DATE.test(value) ||
    NUMERIC_DATE.test(value) ||
    isCompactDate(value) ||
    DAY_MONTH_NAME.test(value) ||
    MONTH_NAME_DAY.test(value) ||
    CJK_DATE.test(value)
  );
}

function isNumberLike(value: string): boolean {
  let core = value;
  // Accounting negatives: "(12.34)".
  if (core.charCodeAt(0) === 40 && core.charCodeAt(core.length - 1) === 41) core = core.slice(1, -1).trim();
  core = core.replace(NUMBER_PREFIX, '').replace(NUMBER_SUFFIX, '');
  return NUMBER_CORE.test(core);
}

export function shapeOf(cell: string | undefined): CellShape {
  if (!cell) return 'empty';
  const value = cell.trim();
  if (value === '') return 'empty';
  if (value.length > MAX_TYPED_LENGTH || !HAS_DIGIT.test(value)) return 'text';
  if (isDateLike(value)) return 'date';
  return isNumberLike(value) ? 'number' : 'text';
}

export function isBlankCell(cell: string | undefined): boolean {
  return !cell || cell.trim() === '';
}

export function filledCount(cells: string[]): number {
  let filled = 0;
  for (const cell of cells) {
    if (!isBlankCell(cell)) filled++;
  }
  return filled;
}

/** True when a line holds a date or a number somewhere: it is data (or a total), not labels. */
export function hasTypedCell(cells: string[]): boolean {
  for (const cell of cells) {
    const shape = shapeOf(cell);
    if (shape === 'date' || shape === 'number') return true;
  }
  return false;
}

export interface ColumnProfile {
  /** The shape most filled cells of each column have; dates and numbers win a tie with words. */
  shapes: CellShape[];
  /** Columns that hold dates or numbers. */
  typed: number[];
  /** Columns that hold dates. */
  dateColumns: number[];
}

export function profileColumns(rows: string[][], width: number): ColumnProfile {
  const dates = new Array<number>(width).fill(0);
  const numbers = new Array<number>(width).fill(0);
  const texts = new Array<number>(width).fill(0);
  for (const cells of rows) {
    for (let column = 0; column < width; column++) {
      const shape = shapeOf(cells[column]);
      if (shape === 'date') dates[column]++;
      else if (shape === 'number') numbers[column]++;
      else if (shape === 'text') texts[column]++;
    }
  }

  const shapes: CellShape[] = [];
  const typed: number[] = [];
  const dateColumns: number[] = [];
  for (let column = 0; column < width; column++) {
    const date = dates[column];
    const number = numbers[column];
    const text = texts[column];
    let shape: CellShape = 'empty';
    if (date + number + text > 0) {
      shape = date >= number && date >= text ? 'date' : number >= text ? 'number' : 'text';
    }
    shapes.push(shape);
    if (shape === 'date' || shape === 'number') typed.push(column);
    if (shape === 'date') dateColumns.push(column);
  }
  return { shapes, typed, dateColumns };
}

/**
 * How many cells of a line sit in a date / number column and have that shape,
 * or -1 when one of them has the wrong shape. `limit` stops before a cell
 * that may be incomplete (the last cell of a cut-off line).
 */
export function typedHits(cells: string[], profile: ColumnProfile, limit = cells.length): number {
  let hits = 0;
  for (const column of profile.typed) {
    if (column >= limit) continue;
    const shape = shapeOf(cells[column]);
    if (shape === 'empty') continue;
    if (shape !== profile.shapes[column]) return -1;
    hits++;
  }
  return hits;
}

/** True when at least one cell has the date / number shape its column expects (wrong shapes elsewhere allowed). */
export function hasTypedHit(cells: string[], profile: ColumnProfile): boolean {
  for (const column of profile.typed) {
    if (shapeOf(cells[column]) === profile.shapes[column]) return true;
  }
  return false;
}
