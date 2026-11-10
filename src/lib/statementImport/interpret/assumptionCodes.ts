/**
 * Every assumption the layout detection (and the AI help) can make. Each code
 * has a text in `src/locales/<lang>/importIssues.json` under
 * `assumptions.<code>`, with the `params` listed here interpolated;
 * `issueTexts.test.ts` keeps the two in step.
 *
 * The wizard renders `t(\`importIssues:assumptions.${assumption.code}\`, assumption.params)`.
 */

export const ASSUMPTION_CODES = {
  // Columns
  /** A saved format was reused. */
  savedLayout: [],
  /** Every required column was recognised by its header. */
  columnsByName: ['date', 'description', 'amount'],
  /** At least one required column was recognised by what it contains. */
  columnsByContent: ['date', 'description', 'amount'],
  /** The AI assistant picked the columns. */
  columnsByAi: ['date', 'description', 'amount'],
  twoDateColumns: ['date', 'postedDate'],
  descriptionJoined: ['columns'],
  debitCreditColumns: ['debit', 'credit'],
  directionColumn: ['amount', 'direction', 'out', 'in'],
  accountColumn: ['column'],

  // Date order
  /** ISO, year-first or month-name dates: one reading only. */
  datesUnambiguous: ['example'],
  dayFirstFromFile: ['example', 'line'],
  monthFirstFromFile: ['example', 'line'],
  /** Ambiguous dates, but only one order keeps the rows in date order. */
  dayFirstBySequence: ['example'],
  monthFirstBySequence: ['example'],
  /** Ambiguous dates: the fallback (UI language, default or the AI's answer) decided. */
  dayFirstAssumed: ['example'],
  monthFirstAssumed: ['example'],
  /** The file has both kinds of date; the more common order was taken. */
  dayFirstByMajority: ['count', 'otherCount'],
  monthFirstByMajority: ['count', 'otherCount'],

  // Decimal mark
  decimalFromFile: ['mark', 'example'],
  /** Only "1,234"-style values: the mark groups thousands, so the other one is the decimal. */
  decimalByGrouping: ['mark', 'group', 'example'],
  decimalAssumed: ['mark', 'example'],

  // Sign of a single amount column
  signAsPrintedByBalance: [],
  signFlippedByBalance: [],
  signAsPrintedByKeywords: ['description', 'amount'],
  signFlippedByKeywords: ['description', 'amount'],
  signAsPrintedByShare: ['percent'],
  signFlippedByShare: ['percent'],
  signFlippedForCard: [],
  signAsPrintedDefault: [],
  signAsPrintedByAi: [],
  signFlippedByAi: [],
} as const satisfies Record<string, readonly string[]>;

export type AssumptionCode = keyof typeof ASSUMPTION_CODES;
