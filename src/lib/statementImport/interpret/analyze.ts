/**
 * StatementTable + ImportLayout → AnalysisReport: every row as it would be
 * imported, with the user's corrections applied, and everything worth telling
 * the user before anything is written.
 *
 * Findings come in three kinds (severity and scope are the catalog's, see
 * ../issueCodes.ts):
 *   - about a row      it cannot be read, or looks wrong (a date years off, a balance that does not add up);
 *   - about the layout the file does not settle the date order, the decimal mark or the sign;
 *   - about coverage   the file leaves a gap after, or overlaps, what the account already has.
 *
 * Rows the analysis leaves out on its own (total lines) come back `skipped`;
 * `{ skip: false }` in the overrides brings one back.
 */

import { addDaysISO, isDateOnly } from '../../dateOnly';
import { type ImportIssueCode, IMPORT_ISSUE_CODES } from '../issueCodes';
import { isPlaceholderReference } from '../shared/references';
import type {
  AnalysisContext,
  AnalysisReport,
  ImportIssue,
  ImportLayout,
  NormalizedRow,
  StatementTable,
} from '../types';

import { balanceMismatchRows, checkBalance } from './balance';
import { DateReader, decimalEvidenceOf, isExcelMangled, readAmountCell } from './cells';
import { GROUPING_CERTAIN_CELLS } from './decimal';
import { NOT_IMPORTED_CLASSES, matchHeader } from './headerAliases';
import { accountTypeFor } from './proposeLayout';
import { isUniqueReferenceColumn } from './roles';
import { SIGN_CERTAIN, inferAmountSign } from './sign';
import { directionOfToken, hasPendingPrefix, isPendingStatus, startsWithSummaryLabel } from './vocabulary';

const DAY_MS = 86_400_000;

function dayNumber(iso: string): number {
  return Math.round(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY_MS);
}

/** A date this far from the middle of the file is more likely a typo than a transaction. */
const FAR_DATE_DAYS = 366;
/** An amount this many times the largest of the rest stands out; a handful of rows is too few to say. */
const OUTLIER_FACTOR = 10;
const OUTLIER_MIN_ROWS = 8;
/** More rows than this share above the jump are a regular large payment, not outliers. */
const OUTLIER_MAX_SHARE = 0.001;
/** A gap after the last import shorter than this is a quiet week, not missing data. */
const MIN_GAP_DAYS = 7;

type AmountProblem = 'unreadable' | 'mangled' | null;

interface AmountReading {
  /** Signed as the import stores it (negative = money out); null when unreadable. */
  value: number | null;
  /** The single amount cell as a number, before the layout's sign is applied. */
  printed: number | null;
  problem: AmountProblem;
  bothFilled: boolean;
}

export function analyzeStatement(table: StatementTable, layout: ImportLayout, context: AnalysisContext): AnalysisReport {
  const known = new Set(table.columns.map((column) => column.index));
  const pick = (column: number | null | undefined): number | null =>
    typeof column === 'number' && known.has(column) ? column : null;
  const dateColumn = pick(layout.roles.date);
  const descriptionColumns = (layout.roles.description ?? []).filter((column) => known.has(column));
  const amountColumn = pick(layout.roles.amount);
  const debitColumn = amountColumn === null ? pick(layout.roles.debit) : null;
  const creditColumn = amountColumn === null ? pick(layout.roles.credit) : null;
  const directionColumn = amountColumn === null ? null : pick(layout.roles.direction);
  const referenceColumn = pick(layout.roles.reference);
  const accountColumn = pick(layout.roles.account);
  const balanceColumn = pick(layout.roles.balance);
  const statusColumn = pick(layout.roles.status);
  const currencyColumn = pick(layout.roles.currency);
  const hasAmount = amountColumn !== null || debitColumn !== null || creditColumn !== null;
  const hasDescription = descriptionColumns.length > 0;
  const monthFirst = layout.dateOrder === 'MDY';
  const { decimal } = layout;
  const otherDecimalEvidence = decimal === '.' ? 'comma' : 'point';
  const inverted = layout.amountSign === 'inverted';
  const directionOut = layout.directionValues ? new Set(layout.directionValues.out) : null;
  const directionIn = layout.directionValues ? new Set(layout.directionValues.in) : null;
  const overrides = context.overrides ?? {};
  const reader = new DateReader();
  const nameOf = (column: number) => table.columns.find((candidate) => candidate.index === column)?.name ?? '';

  const rowsByCode = new Map<ImportIssueCode, number[]>();
  const flag = (code: ImportIssueCode, row: NormalizedRow) => {
    row.issueCodes.push(code);
    const rows = rowsByCode.get(code);
    if (rows) rows.push(row.index);
    else rowsByCode.set(code, [row.index]);
  };

  /** One money cell: a number, or why not. A value that only makes sense with the other decimal mark is not guessed at. */
  const readMoney = (cell: string): { value: number | null; problem: AmountProblem } => {
    if (isExcelMangled(cell)) return { value: null, problem: 'mangled' };
    const value = readAmountCell(cell, decimal);
    if (value === null) return { value: null, problem: 'unreadable' };
    if (decimalEvidenceOf(cell) === otherDecimalEvidence && readAmountCell(cell, decimal === '.' ? ',' : '.') !== value) {
      return { value: null, problem: 'unreadable' };
    }
    return { value, problem: null };
  };

  const readAmount = (cells: string[]): AmountReading => {
    if (amountColumn !== null) {
      const cell = cells[amountColumn] ?? '';
      const { value, problem } = cell.trim() ? readMoney(cell) : { value: null, problem: 'unreadable' as const };
      if (value === null) return { value: null, printed: null, problem, bothFilled: false };
      let signed = value;
      if (directionColumn !== null) {
        const word = (cells[directionColumn] ?? '').trim().toLowerCase();
        const direction = directionOut || directionIn
          ? directionOut?.has(word)
            ? 'out'
            : directionIn?.has(word)
              ? 'in'
              : null
          : directionOfToken(word);
        if (direction === null) return { value: null, printed: value, problem: 'unreadable', bothFilled: false };
        signed = direction === 'out' ? -Math.abs(value) : Math.abs(value);
      }
      return { value: inverted ? -signed : signed, printed: value, problem: null, bothFilled: false };
    }

    // A debit / credit pair: money out in one column, money in in the other.
    let debit = 0;
    let credit = 0;
    let filled = 0;
    let problem: AmountProblem = null;
    for (const [column, side] of [
      [debitColumn, 'debit'],
      [creditColumn, 'credit'],
    ] as const) {
      const cell = column === null ? '' : (cells[column] ?? '');
      if (!cell.trim()) continue;
      filled += 1;
      const reading = readMoney(cell);
      if (reading.value === null) problem = problem === 'mangled' ? problem : reading.problem;
      else if (side === 'debit') debit = Math.abs(reading.value);
      else credit = Math.abs(reading.value);
    }
    if (problem) return { value: null, printed: null, problem, bothFilled: false };
    // Neither side filled in: there is no amount to import.
    if (filled === 0) return { value: null, printed: null, problem: 'unreadable', bothFilled: false };
    return { value: credit - debit, printed: null, problem: null, bothFilled: debit !== 0 && credit !== 0 };
  };

  // Per-row facts the file-wide checks need afterwards.
  const printedAmounts: Array<number | null> = [];
  const chainAmounts: Array<number | null> = [];
  const balances: Array<number | null> = [];
  const fileDates: Array<string | null> = [];
  const mixedOrderRows: number[] = [];
  const blankDescriptionRows: NormalizedRow[] = [];
  let orderEvidenceRows = 0;
  // (`null as …`: these are assigned inside the row callback, which the compiler cannot follow.)
  let ambiguousDate = null as { text: string; readAs: string } | null;
  let decimalEvidenceCells = 0;
  /** "1,234"-style cells: read as thousands (the layout's mark is the other one) or as three decimals. */
  let groupedCells = 0;
  let threeDecimalCells = 0;
  let ambiguousAmount = null as string | null;
  const ambiguousAsDecimal = decimal === '.' ? 'ambiguousPoint' : 'ambiguousComma';
  const moneyColumns = [amountColumn, debitColumn, creditColumn, balanceColumn].filter(
    (column): column is number => column !== null
  );

  const rows = table.rows.map((cells, index): NormalizedRow => {
    const override = overrides[index] ?? {};
    const reference = referenceColumn !== null ? (cells[referenceColumn] ?? '').trim() : '';
    const balanceCell = balanceColumn !== null ? (cells[balanceColumn] ?? '') : '';
    const balance = balanceCell.trim() ? readAmountCell(balanceCell, decimal) : null;
    const dateCell = dateColumn !== null ? (cells[dateColumn] ?? '') : '';
    const dateReading = dateColumn !== null ? reader.read(dateCell) : null;
    const fileDate = dateReading ? (monthFirst ? dateReading.monthFirst : dateReading.dayFirst) : null;
    const amountReading = hasAmount ? readAmount(cells) : { value: null, printed: null, problem: null, bothFilled: false };
    const fixedDate = override.date !== undefined && isDateOnly(override.date) ? override.date : null;
    const fixedAmount = override.amount !== undefined && Number.isFinite(override.amount) ? override.amount : null;

    const row: NormalizedRow = {
      index,
      sourceLine: table.sourceLines[index],
      date: fixedDate ?? fileDate,
      amount: fixedAmount ?? amountReading.value,
      description:
        override.description ??
        descriptionColumns
          .map((column) => (cells[column] ?? '').trim())
          .filter(Boolean)
          .join(' '),
      reference: reference && !isPlaceholderReference(reference) && !isExcelMangled(reference) ? reference : null,
      accountValue: accountColumn !== null ? (cells[accountColumn] ?? '') : null,
      balance,
      skipped: override.skip === true,
      blocked: false,
      issueCodes: [],
    };
    balances.push(balance);
    fileDates.push(fileDate);
    // A row without a readable date does not get a vote on the sign (as in the layout proposal).
    printedAmounts.push(dateColumn !== null && fileDate === null ? null : amountReading.printed);
    chainAmounts.push(row.amount);
    if (row.skipped) return row;

    // A total or balance line among the transactions: left out, and said so.
    if (override.skip !== false && fixedDate === null && fixedAmount === null) {
      const noDate = dateColumn !== null && fileDate === null;
      const noAmount = hasAmount && amountReading.value === null && amountReading.problem !== 'mangled';
      if ((noDate || noAmount) && (cells.every((cell) => !cell.trim()) || cells.some(startsWithSummaryLabel))) {
        row.skipped = true;
        flag('summaryRow', row);
        printedAmounts[index] = null;
        chainAmounts[index] = null;
        return row;
      }
    }

    if (fixedDate === null && dateReading) {
      if (fileDate === null) {
        const otherOrder = monthFirst ? dateReading.dayFirst : dateReading.monthFirst;
        if (otherOrder !== null) {
          row.issueCodes.push('dateOrderMixed');
          mixedOrderRows.push(index);
        } else {
          flag('unreadableDate', row);
        }
      } else if (dateReading.evidence === 'either') {
        ambiguousDate ??= { text: dateCell.trim(), readAs: fileDate };
      } else if (dateReading.evidence !== 'fixed') {
        orderEvidenceRows += 1;
      }
    }

    if (fixedAmount === null && hasAmount) {
      if (amountReading.problem === 'mangled') flag('excelMangledNumber', row);
      else if (amountReading.value === null) flag('unreadableAmount', row);
      else if (amountReading.bothFilled) flag('debitCreditBothFilled', row);
    }
    // What this row's numbers say about the decimal mark.
    for (const column of moneyColumns) {
      const cell = cells[column] ?? '';
      if (!cell.trim() || readAmountCell(cell, decimal) === null) continue;
      const evidence = decimalEvidenceOf(cell);
      if (evidence === 'ambiguousComma' || evidence === 'ambiguousPoint') {
        if (evidence === ambiguousAsDecimal) threeDecimalCells += 1;
        else groupedCells += 1;
        if (column !== balanceColumn) ambiguousAmount ??= cell.trim();
      } else if (evidence !== 'none' && evidence !== otherDecimalEvidence) {
        decimalEvidenceCells += 1;
      }
    }
    if (row.amount === 0) flag('zeroAmount', row);
    if (hasDescription && !row.description) blankDescriptionRows.push(row);
    if (row.date !== null && row.date > context.today) flag('futureDate', row);
    if (
      (statusColumn !== null && isPendingStatus(cells[statusColumn] ?? '')) ||
      (row.description && hasPendingPrefix(row.description))
    ) {
      flag('pendingTransaction', row);
    }
    return row;
  });

  const active = rows.filter((row) => !row.skipped);

  // --- Rows that stand out from the rest -----------------------------------
  let usualDates: { from: string; to: string } | null = null;
  const dated = active.filter((row) => row.date !== null);
  if (dated.length >= 4) {
    const days = dated.map((row) => dayNumber(row.date as string));
    const middle = [...days].sort((a, b) => a - b)[Math.floor((days.length - 1) / 2)];
    const near = dated.filter((_, at) => Math.abs(days[at] - middle) <= FAR_DATE_DAYS);
    if (near.length < dated.length && near.length / dated.length >= 0.75) {
      const nearDates = near.map((row) => row.date as string).sort();
      usualDates = { from: nearDates[0], to: nearDates[nearDates.length - 1] };
      dated.forEach((row, at) => {
        if (Math.abs(days[at] - middle) > FAR_DATE_DAYS) flag('dateFarFromOthers', row);
      });
    }
  }

  const sized = active.filter((row) => row.amount !== null && row.amount !== 0);
  if (sized.length >= OUTLIER_MIN_ROWS) {
    const magnitudes = sized.map((row) => Math.abs(row.amount as number)).sort((a, b) => a - b);
    // The last place where the sorted amounts jump by the factor: what lies above it stands apart.
    let jump = -1;
    for (let at = magnitudes.length - 1; at > 0; at -= 1) {
      if (magnitudes[at] > magnitudes[at - 1] * OUTLIER_FACTOR) {
        jump = at;
        break;
      }
    }
    // Only a stray row or two is an outlier; a salary that comes every month is not.
    const above = jump === -1 ? 0 : magnitudes.length - jump;
    if (above > 0 && above <= Math.max(2, Math.floor(magnitudes.length * OUTLIER_MAX_SHARE))) {
      for (const row of sized) {
        if (Math.abs(row.amount as number) >= magnitudes[jump]) flag('amountOutlier', row);
      }
    }
  }

  // --- The bank's own running balance --------------------------------------
  if (balanceColumn !== null && hasAmount) {
    const check = checkBalance(chainAmounts, balances, fileDates);
    // Only when the column really is a running balance of these amounts; a
    // loan's remaining principal is not, and would flag every row.
    if (check && check.decisive > 0 && check.comparable >= 2 && check.matched * 2 >= check.comparable) {
      for (const index of balanceMismatchRows(chainAmounts, balances, check)) {
        if (!rows[index].skipped) flag('balanceMismatch', rows[index]);
      }
    }
  }

  // --- Descriptions ---------------------------------------------------------
  const mostlyBlank = blankDescriptionRows.length >= 3 && blankDescriptionRows.length * 2 > active.length;
  for (const row of blankDescriptionRows) flag(mostlyBlank ? 'descriptionMostlyBlank' : 'blankDescription', row);

  // --- References -----------------------------------------------------------
  let repeatedReference: { column: number; example: string } | null = null;
  if (referenceColumn !== null) {
    const seen = new Set<string>();
    for (const row of active) {
      if (row.reference === null) continue;
      if (seen.has(row.reference)) {
        repeatedReference = { column: referenceColumn, example: row.reference };
        break;
      }
      seen.add(row.reference);
    }
    // A reference that repeats would make the second row look like a duplicate of the first.
    if (repeatedReference) for (const row of rows) row.reference = null;
  }

  for (const row of active) {
    row.blocked =
      row.date === null || row.amount === null || row.issueCodes.some((code) => IMPORT_ISSUE_CODES[code].severity === 'blocker');
  }
  const ready = active.filter((row) => !row.blocked);

  // --- Findings -------------------------------------------------------------
  const issues: ImportIssue[] = [];
  const add = (code: ImportIssueCode, extra: Omit<ImportIssue, 'code' | 'severity' | 'scope'> = {}) => {
    issues.push({ code, severity: IMPORT_ISSUE_CODES[code].severity, scope: IMPORT_ISSUE_CODES[code].scope, ...extra });
  };
  const addRows = (code: ImportIssueCode, extra: Omit<ImportIssue, 'code' | 'severity' | 'scope' | 'rows'> = {}) => {
    const affected = rowsByCode.get(code);
    if (!affected) return;
    add(code, { rows: affected, ...extra, params: { count: affected.length, ...extra.params } });
  };

  if (dateColumn === null) add('noDateColumn');
  if (!hasAmount) add('noAmountColumn');
  if (!hasDescription) add('noDescriptionColumn');

  // The layout: what the file does not settle. A layout the reader knows for
  // certain (OFX: ISO dates, dot decimals, signed amounts) leaves nothing open.
  const fixedFormat = table.meta.presetLayout !== undefined;
  if (dateColumn !== null) {
    if (mixedOrderRows.length > 0) {
      const first = mixedOrderRows[0];
      add('dateOrderMixed', {
        column: dateColumn,
        rows: mixedOrderRows,
        params: {
          count: mixedOrderRows.length,
          example: (table.rows[first][dateColumn] ?? '').trim(),
          line: table.sourceLines[first],
        },
      });
    } else if (!fixedFormat && orderEvidenceRows === 0 && ambiguousDate !== null) {
      add('dateOrderAmbiguous', { column: dateColumn, params: { example: ambiguousDate.text, readAs: ambiguousDate.readAs } });
    }
  }
  // Nothing in the file proves the decimal mark, and either some amounts are
  // read with three decimals or too few look like thousands to be sure.
  if (
    !fixedFormat &&
    hasAmount &&
    decimalEvidenceCells === 0 &&
    ambiguousAmount !== null &&
    (threeDecimalCells > 0 || groupedCells < GROUPING_CERTAIN_CELLS)
  ) {
    add('decimalAmbiguous', {
      column: (amountColumn ?? debitColumn ?? creditColumn) as number,
      params: { example: ambiguousAmount, mark: decimal },
    });
  }
  if (
    !fixedFormat &&
    amountColumn !== null &&
    directionColumn === null &&
    printedAmounts.some((value) => value !== null && value !== 0)
  ) {
    const inference = inferAmountSign({
      amounts: printedAmounts,
      printed: table.rows.map((cells) => cells[amountColumn] ?? ''),
      descriptions: rows.map((row) => row.description),
      balances: balanceColumn !== null ? balances : undefined,
      dates: fileDates,
      accountType: accountTypeFor(table, context.accountType),
    });
    if (inference.confidence < SIGN_CERTAIN || inference.sign !== layout.amountSign) {
      add('signAssumed', {
        column: amountColumn,
        params: {
          moneyOutRows: ready.filter((row) => (row.amount as number) < 0).length,
          moneyInRows: ready.filter((row) => (row.amount as number) > 0).length,
        },
      });
    }
  }

  // Rows, in the order of the catalog.
  addRows('unreadableDate');
  addRows('unreadableAmount');
  const firstMangled = rowsByCode.get('excelMangledNumber')?.[0];
  if (firstMangled !== undefined) {
    const mangledCell = [amountColumn, debitColumn, creditColumn]
      .map((column) => (column === null ? '' : (table.rows[firstMangled][column] ?? '').trim()))
      .find(isExcelMangled);
    addRows('excelMangledNumber', { params: { example: mangledCell ?? '' } });
  }
  addRows('debitCreditBothFilled');
  addRows('descriptionMostlyBlank', { column: descriptionColumns[0], params: { total: active.length } });
  addRows('blankDescription');
  addRows('zeroAmount');
  addRows('futureDate');
  addRows('dateFarFromOthers', { params: { from: usualDates?.from ?? '', to: usualDates?.to ?? '' } });
  addRows('amountOutlier');
  addRows('pendingTransaction');
  addRows('summaryRow');
  addRows('balanceMismatch');

  // Columns.
  if (repeatedReference) {
    add('referenceNotUnique', { column: repeatedReference.column, params: { column: nameOf(repeatedReference.column) } });
  }
  const usedColumns = new Set(
    [
      dateColumn,
      pick(layout.roles.postedDate),
      ...descriptionColumns,
      amountColumn,
      debitColumn,
      creditColumn,
      directionColumn,
      referenceColumn,
      accountColumn,
      balanceColumn,
      statusColumn,
      currencyColumn,
    ].filter((column): column is number => column !== null)
  );
  for (const column of table.columns) {
    if (usedColumns.has(column.index) || column.synthetic) continue;
    const headerClass = matchHeader(column.name)?.classes[0];
    if (!headerClass) continue;
    const hasCells = table.rows.some((cells) => (cells[column.index] ?? '').trim() !== '');
    if (!hasCells) continue;
    // A balance the layout does not use (a loan's remaining principal) is left out like any other extra column.
    if (NOT_IMPORTED_CLASSES.has(headerClass) || headerClass === 'balance') {
      add('columnNotImported', { column: column.index, params: { column: column.name } });
    } else if (
      headerClass === 'reference' &&
      referenceColumn === null &&
      !repeatedReference &&
      !isUniqueReferenceColumn(table, column.index)
    ) {
      // Named like a bank reference, but blank or repeated on too many rows to tell rows apart.
      add('referenceNotUnique', { column: column.index, params: { column: column.name } });
      repeatedReference = { column: column.index, example: '' };
    }
  }

  const accountCurrency = context.accountCurrency?.trim().toUpperCase() || null;
  if (accountCurrency) {
    if (currencyColumn !== null) {
      const foreign = active.filter((row) => {
        const value = (table.rows[row.index][currencyColumn] ?? '').trim().toUpperCase();
        return value !== '' && value !== accountCurrency;
      });
      if (foreign.length > 0) {
        for (const row of foreign) row.issueCodes.push('currencyMismatch');
        add('currencyMismatch', {
          column: currencyColumn,
          rows: foreign.map((row) => row.index),
          params: {
            count: foreign.length,
            fileCurrency: (table.rows[foreign[0].index][currencyColumn] ?? '').trim().toUpperCase(),
            accountCurrency,
          },
        });
      }
    } else {
      const fileCurrency = table.meta.accountHints
        .find((hint) => hint.kind === 'currency')
        ?.value.trim()
        .toUpperCase();
      if (fileCurrency && fileCurrency !== accountCurrency && active.length > 0) {
        add('currencyMismatch', { params: { count: active.length, fileCurrency, accountCurrency } });
      }
    }
  }

  // What the file says it is (OFX `ACCTTYPE`, a preamble line) against the account the rows are going into.
  const fileAccountType = accountTypeFor(table, null);
  if (context.accountType && fileAccountType && fileAccountType !== context.accountType && active.length > 0) {
    add('accountTypeMismatch');
  }

  if (accountColumn !== null) {
    const accounts = new Set(active.map((row) => (row.accountValue ?? '').trim()).filter(Boolean));
    if (accounts.size > 1) add('multipleAccountsInFile', { column: accountColumn, params: { count: accounts.size } });
  }

  // --- Totals ---------------------------------------------------------------
  const readyDates = ready.map((row) => row.date as string).sort();
  const firstDate = readyDates[0] ?? null;
  const lastDate = readyDates[readyDates.length - 1] ?? null;
  let moneyIn = 0;
  let moneyOut = 0;
  for (const row of ready) {
    const amount = row.amount as number;
    if (amount > 0) moneyIn += amount;
    else moneyOut -= amount;
  }

  // --- Coverage against what the account already has ------------------------
  const { coverage } = context;
  if (coverage && firstDate && lastDate) {
    const storedThrough = [coverage.lastDate, coverage.lastImportThrough].filter((date): date is string => Boolean(date)).sort().pop();
    if (storedThrough && firstDate > storedThrough) {
      const missingDays = dayNumber(firstDate) - dayNumber(storedThrough) - 1;
      // How far apart this account's transactions usually are: a savings
      // account with one row a month does not have a gap after three weeks.
      let widestInFile = 0;
      for (let at = 1; at < readyDates.length; at += 1) {
        widestInFile = Math.max(widestInFile, dayNumber(readyDates[at]) - dayNumber(readyDates[at - 1]));
      }
      const storedSpacing =
        coverage.firstDate && coverage.lastDate && coverage.transactionCount > 1
          ? (dayNumber(coverage.lastDate) - dayNumber(coverage.firstDate)) / (coverage.transactionCount - 1)
          : 0;
      if (missingDays > Math.max(MIN_GAP_DAYS, widestInFile * 3, storedSpacing * 3)) {
        add('gapSinceLastImport', {
          params: { count: missingDays, from: addDaysISO(storedThrough, 1), to: addDaysISO(firstDate, -1) },
        });
      }
    }
    if (coverage.firstDate && coverage.lastDate && firstDate <= coverage.lastDate && lastDate >= coverage.firstDate) {
      add('overlapsExisting', {
        params: {
          from: firstDate > coverage.firstDate ? firstDate : coverage.firstDate,
          to: lastDate < coverage.lastDate ? lastDate : coverage.lastDate,
        },
      });
    }
  }

  return {
    rows,
    issues,
    stats: {
      totalRows: rows.length,
      readyRows: ready.length,
      blockedRows: active.length - ready.length,
      skippedRows: rows.length - active.length,
      firstDate,
      lastDate,
      moneyIn,
      moneyOut,
    },
  };
}
