/**
 * date-fns patterns tried by `parseCsvDate`, ordered by the day/month
 * convention of the user's language: an ambiguous "04/06/2026" is April 6 for
 * an en-US user and 4 June for almost everyone else. Unambiguous shapes
 * (ISO, year-first, month names, compact) are tried before and after.
 */

export type CsvDateOrder = 'MDY' | 'DMY' | 'YMD';

/** Year-first shapes: never ambiguous, tried first for every order. */
const YEAR_FIRST = [
  'yyyy-MM-dd',
  'yyyy-MM-dd HH:mm:ss',
  'yyyy-MM-dd HH:mm',
  'yyyy/MM/dd',
  'yyyy/M/d',
  'yyyy.MM.dd',
  'yyyy.M.d',
  'yyyy年M月d日',
  'yyyy年MM月dd日',
  'yyyyMMdd',
];

/** Month-first numeric shapes (US). */
const MONTH_FIRST = [
  'MM/dd/yyyy',
  'M/d/yyyy',
  'MM/dd/yyyy HH:mm:ss',
  'MM/dd/yyyy HH:mm',
  'M/d/yyyy HH:mm:ss',
  'M/d/yyyy HH:mm',
  'MM/dd/yy',
  'M/d/yy',
  'MM-dd-yyyy',
  'M-d-yyyy',
];

/** Day-first numeric shapes (Europe, Latin America, most of the world). */
const DAY_FIRST = [
  'dd/MM/yyyy',
  'd/M/yyyy',
  'dd/MM/yyyy HH:mm:ss',
  'dd/MM/yyyy HH:mm',
  'd/M/yyyy HH:mm:ss',
  'd/M/yyyy HH:mm',
  'dd/MM/yy',
  'd/M/yy',
  'dd-MM-yyyy',
  'd-M-yyyy',
  'dd.MM.yyyy',
  'd.M.yyyy',
  'dd.MM.yy',
];

/** Month-name shapes: unambiguous, tried last. */
const MONTH_NAMES = [
  'dd-MMM-yyyy',
  'd-MMM-yyyy',
  'dd MMM yyyy',
  'd MMM yyyy',
  'MMM d, yyyy',
  'MMMM d, yyyy',
  'MMM d yyyy',
];

/**
 * The patterns for exactly one day/month convention, with no fallback to the
 * other one: "13/06/2026" is not a date in a month-first file. The Import
 * Wizard decides the order once per file from the file's own evidence and
 * then reads every row this way, so one file is never read with two orders.
 * (`YMD` files write their slashed dates year-first; those are in YEAR_FIRST,
 * so a day/month pair in such a file is read day-first.)
 */
export function csvDateFormatsStrict(order: CsvDateOrder): readonly string[] {
  return [...YEAR_FIRST, ...(order === 'MDY' ? MONTH_FIRST : DAY_FIRST), ...MONTH_NAMES];
}

export function csvDateFormatsFor(order: CsvDateOrder): readonly string[] {
  switch (order) {
    case 'DMY':
      return [...YEAR_FIRST, ...DAY_FIRST, ...MONTH_FIRST, ...MONTH_NAMES];
    case 'YMD':
      // Year-first locales (zh, ja, ko) write slashed dates year-first; a
      // two-part ambiguity is resolved day-first like the rest of the world.
      return [...YEAR_FIRST, ...DAY_FIRST, ...MONTH_FIRST, ...MONTH_NAMES];
    case 'MDY':
    default:
      return [...YEAR_FIRST, ...MONTH_FIRST, ...DAY_FIRST, ...MONTH_NAMES];
  }
}
