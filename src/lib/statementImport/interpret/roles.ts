/**
 * Which column plays which part.
 *
 * Two sources, in this order: what the header says (aliases in nine
 * languages) as long as the contents do not contradict it, then what the
 * contents look like, so a file with unfamiliar or missing headers still
 * works. The date order and the decimal mark are settled along the way,
 * because recognising a running balance or the earlier of two dates needs the
 * cells read as numbers and dates.
 */

import { detectUniqueIdentifierColumn, isPlaceholderReference } from '../shared/references';
import type { AssumptionBasis, ColumnRoles, DateOrder, DecimalSeparator, StatementTable } from '../types';

import { checkBalance, reconciles } from './balance';
import { type DateReader, isExcelMangled, readAmountCell } from './cells';
import { type DateOrderInference, inferDateOrder } from './dateOrder';
import { type DecimalInference, inferDecimal } from './decimal';
import { type HeaderClass, type HeaderMatch, matchHeader } from './headerAliases';
import { type ColumnProfile, descriptiveness, moneyLikeness, profileColumns } from './profile';
import { directionOfToken } from './vocabulary';

export interface FormatFallbacks {
  dateOrder?: DateOrder;
  decimal?: DecimalSeparator;
  /** What the fallbacks are based on; 'language' when they come from the UI language. */
  basis?: AssumptionBasis;
}

export type RequiredPart = 'date' | 'description' | 'amount';

export interface DetectedRoles {
  roles: ColumnRoles;
  directionValues?: { out: string[]; in: string[] };
  /** The direction words as the file prints them, for the assumption text. */
  directionWords?: { out: string[]; in: string[] };
  /** How sure each required part is; 0 when it was not found. */
  confidence: Record<RequiredPart, number>;
  /** Required parts recognised by what the column contains, not by its header. */
  fromContents: RequiredPart[];
  dateOrder: DateOrderInference;
  decimal: DecimalInference;
}

interface ColumnInfo {
  index: number;
  name: string;
  match: HeaderMatch | null;
  /** What the header says, when the contents allow it. */
  headerClass: HeaderClass | null;
  profile: ColumnProfile;
}

const HEADER_EXACT = 0.98;
const HEADER_PARTIAL = 0.92;

function headerConfidence(info: ColumnInfo): number {
  return info.match?.exact ? HEADER_EXACT : HEADER_PARTIAL;
}

function isDateClass(headerClass: HeaderClass | null): boolean {
  return headerClass === 'date' || headerClass === 'transactionDate' || headerClass === 'postedDate';
}

/** Do the cells fit what the header claims? Decides between the classes of a word with several meanings. */
function fits(headerClass: HeaderClass, alias: string, profile: ColumnProfile): boolean {
  const { filled } = profile;
  switch (headerClass) {
    case 'date':
    case 'transactionDate':
    case 'postedDate':
      return filled > 0 && profile.dateShare >= 0.5;
    case 'amount':
    case 'balance':
    case 'principal':
    case 'interest':
    case 'escrow':
    case 'fees':
      return filled > 0 && profile.moneyShare >= 0.5;
    case 'debit':
    case 'credit':
      // One side of a pair can be empty for a whole file (no deposits this month).
      return filled === 0 || profile.moneyShare >= 0.5;
    case 'direction':
      return filled > 0 && profile.directionShare >= 0.9;
    case 'currency':
      return filled > 0 && profile.currencyShare >= 0.8;
    case 'status':
      return filled > 0 && (alias !== 'state' || profile.statusShare >= 0.5);
    case 'description':
    case 'altDescription':
    case 'payee':
    case 'memo':
      return filled > 0 && profile.dateShare < 0.5 && profile.moneyShare < 0.5;
    default:
      return true;
  }
}

function resolveClass(match: HeaderMatch | null, profile: ColumnProfile): HeaderClass | null {
  if (!match) return null;
  // A header that is exactly one known word is trusted even when its cells are bad:
  // "Date" full of typos is still the date column, and the rows are reported.
  if (match.exact && match.classes.length === 1) {
    const [only] = match.classes;
    const needsCells = only !== 'debit' && only !== 'credit';
    return needsCells && profile.filled === 0 ? null : only;
  }
  return match.classes.find((headerClass) => fits(headerClass, match.alias, profile)) ?? null;
}

function cellsOf(table: StatementTable, column: number): string[] {
  return table.rows.map((row) => row[column] ?? '');
}

/** The file-wide date order, from the transaction-date column and the posted-date column when there is one. */
export function inferDateOrderFor(
  table: StatementTable,
  dateColumns: number[],
  reader: DateReader,
  fallbacks: FormatFallbacks
): DateOrderInference {
  const cells = dateColumns.flatMap((column) => cellsOf(table, column));
  const rowCount = Math.max(1, table.rows.length);
  return inferDateOrder(cells, reader, (at) => table.sourceLines[at % rowCount] ?? at + 1, {
    order: fallbacks.dateOrder,
    basis: fallbacks.basis,
  });
}

/** The file-wide decimal mark, from every money column. */
export function inferDecimalFor(table: StatementTable, moneyColumns: number[], fallbacks: FormatFallbacks): DecimalInference {
  function* cells(): Generator<string> {
    for (const row of table.rows) {
      for (const column of moneyColumns) yield row[column] ?? '';
    }
  }
  return inferDecimal(cells(), { decimal: fallbacks.decimal, basis: fallbacks.basis });
}

/** A column read as numbers: null for a blank or unreadable cell. */
export function readNumbers(table: StatementTable, column: number, decimal: DecimalSeparator): Array<number | null> {
  return table.rows.map((row) => {
    const cell = row[column] ?? '';
    return cell.trim() ? readAmountCell(cell, decimal) : null;
  });
}

/** The money-out / money-in words of a direction column, lower-cased for the layout and as printed for display. */
export function directionValuesOf(
  table: StatementTable,
  column: number
): { values: { out: string[]; in: string[] }; words: { out: string[]; in: string[] } } {
  const values = { out: [] as string[], in: [] as string[] };
  const words = { out: [] as string[], in: [] as string[] };
  const seen = new Set<string>();
  for (const row of table.rows) {
    const printed = (row[column] ?? '').trim();
    const value = printed.toLowerCase();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    const direction = directionOfToken(printed);
    if (!direction) continue;
    values[direction].push(value);
    words[direction].push(printed);
  }
  return { values, words };
}

/** A reference is only useful as a duplicate key when every row has its own. */
export function isUniqueReferenceColumn(table: StatementTable, column: number): boolean {
  const seen = new Set<string>();
  for (const row of table.rows) {
    const value = (row[column] ?? '').trim();
    if (isPlaceholderReference(value)) continue;
    if (isExcelMangled(value) || seen.has(value)) return false;
    seen.add(value);
  }
  return seen.size > 0 && seen.size * 2 >= table.rows.length;
}

export function detectRoles(table: StatementTable, reader: DateReader, fallbacks: FormatFallbacks): DetectedRoles {
  const profiles = profileColumns(table, reader);
  const infos: ColumnInfo[] = table.columns.map((column, position) => {
    const match = column.synthetic ? null : matchHeader(column.name);
    return {
      index: column.index,
      name: column.name,
      match,
      headerClass: resolveClass(match, profiles[position]),
      profile: profiles[position],
    };
  });
  const used = new Set<number>();
  const take = (info: ColumnInfo | null | undefined): number | null => {
    if (!info) return null;
    used.add(info.index);
    return info.index;
  };
  const free = (info: ColumnInfo) => !used.has(info.index);
  const byClass = (headerClass: HeaderClass) =>
    infos
      .filter((info) => info.headerClass === headerClass && free(info))
      // The header that is exactly the word comes before one that merely contains it.
      .sort((a, b) => Number(b.match?.exact ?? false) - Number(a.match?.exact ?? false) || a.index - b.index);
  const fromContents: RequiredPart[] = [];
  const confidence: Record<RequiredPart, number> = { date: 0, description: 0, amount: 0 };

  // --- Dates ---------------------------------------------------------------
  const dateTier = (info: ColumnInfo) =>
    info.headerClass === 'transactionDate' ? 0 : info.headerClass === 'date' ? 1 : info.headerClass === null ? 2 : 3;
  const dateCandidates = infos
    .filter((info) =>
      isDateClass(info.headerClass)
        ? true
        : info.headerClass === null && info.profile.dateShare >= 0.9 && info.profile.filled * 2 >= info.profile.rows
    )
    .filter((info) => info.profile.filled > 0 || isDateClass(info.headerClass))
    .sort((a, b) => dateTier(a) - dateTier(b) || a.index - b.index);
  let dateInfo: ColumnInfo | null = dateCandidates[0] ?? null;
  let postedInfo: ColumnInfo | null = null;
  if (dateInfo) {
    const rest = dateCandidates.slice(1);
    postedInfo =
      rest.find((info) => info.headerClass === 'postedDate') ??
      (dateInfo.headerClass === null
        ? rest.find((info) => info.headerClass === null)
        : rest.find((info) => isDateClass(info.headerClass))) ??
      null;
  }
  const dateOrder = inferDateOrderFor(
    table,
    [dateInfo, postedInfo].filter((info): info is ColumnInfo => info !== null).map((info) => info.index),
    reader,
    fallbacks
  );
  if (dateInfo && postedInfo && dateTier(dateInfo) === dateTier(postedInfo)) {
    // Two dates and the headers do not say which is which: a purchase happens
    // on or before the day it is posted, so the earlier column is the transaction date.
    let firstEarlier = 0;
    let secondEarlier = 0;
    const sample = Math.min(table.rows.length, 500);
    for (let row = 0; row < sample; row += 1) {
      const first = reader.inOrder(table.rows[row][dateInfo.index] ?? '', dateOrder.order);
      const second = reader.inOrder(table.rows[row][postedInfo.index] ?? '', dateOrder.order);
      if (!first || !second || first === second) continue;
      if (first < second) firstEarlier += 1;
      else secondEarlier += 1;
    }
    if (secondEarlier > firstEarlier) [dateInfo, postedInfo] = [postedInfo, dateInfo];
  }
  if (dateInfo) {
    if (dateInfo.headerClass === null) {
      fromContents.push('date');
      confidence.date = dateCandidates.filter((info) => info.headerClass === null).length === 1 ? 0.75 : 0.65;
    } else {
      confidence.date = headerConfidence(dateInfo);
    }
  }
  const dateColumn = take(dateInfo);
  const postedColumn = take(postedInfo);
  const dates = dateColumn === null ? undefined : table.rows.map((row) => reader.inOrder(row[dateColumn] ?? '', dateOrder.order));

  // --- Money ---------------------------------------------------------------
  const amountInfos = byClass('amount');
  let debitInfo: ColumnInfo | null = byClass('debit')[0] ?? null;
  let creditInfo: ColumnInfo | null = byClass('credit')[0] ?? null;
  let amountInfo: ColumnInfo | null = amountInfos[0] ?? null;
  if (debitInfo && !creditInfo) {
    // "Charges" + "Payment": on its own "Payment" is an amount, next to a money-out column it is money in.
    const paired = amountInfos.find((info) => info.match?.classes.includes('credit'));
    if (paired) {
      creditInfo = paired;
      amountInfo = amountInfos.find((info) => info !== paired) ?? null;
    }
  } else if (creditInfo && !debitInfo) {
    // "お支払金額" + "お預り金額": the payment amount next to a deposits column is money out.
    const paired = amountInfos.find((info) => info.match?.classes.includes('debit'));
    if (paired) {
      debitInfo = paired;
      amountInfo = amountInfos.find((info) => info !== paired) ?? null;
    }
  }
  const balanceHeaderInfo: ColumnInfo | null = byClass('balance')[0] ?? null;
  const unlabelledMoney = infos.filter(
    (info) => free(info) && info.headerClass === null && info.profile.dateShare < 0.5 && moneyLikeness(info.profile) >= 0.4
  );

  const moneyColumns = [...amountInfos, debitInfo, creditInfo, balanceHeaderInfo, ...unlabelledMoney]
    .filter((info): info is ColumnInfo => info !== null)
    .map((info) => info.index);
  const decimal = inferDecimalFor(table, [...new Set(moneyColumns)], fallbacks);
  const numbers = new Map<number, Array<number | null>>();
  const numbersOf = (column: number) => {
    let values = numbers.get(column);
    if (!values) {
      values = readNumbers(table, column, decimal.decimal);
      numbers.set(column, values);
    }
    return values;
  };
  const pairAmounts = (debit: number | null, credit: number | null): Array<number | null> => {
    const debits = debit === null ? null : numbersOf(debit);
    const credits = credit === null ? null : numbersOf(credit);
    return table.rows.map((_, row) => Math.abs(credits?.[row] ?? 0) - Math.abs(debits?.[row] ?? 0));
  };

  const roles: ColumnRoles = { date: dateColumn, description: [] };
  if (postedColumn !== null) roles.postedDate = postedColumn;
  let directionValues: DetectedRoles['directionValues'];
  let directionWords: DetectedRoles['directionWords'];
  /** Signed amounts as far as the layout fixes them, for recognising a balance column. */
  let amounts: Array<number | null> | null = null;

  const pairHasCells = (debitInfo?.profile.filled ?? 0) + (creditInfo?.profile.filled ?? 0) > 0;
  if (debitInfo && creditInfo && (pairHasCells || !amountInfo)) {
    roles.debit = take(debitInfo);
    roles.credit = take(creditInfo);
    confidence.amount = Math.min(headerConfidence(debitInfo), headerConfidence(creditInfo));
    amounts = pairAmounts(roles.debit, roles.credit);
  } else if (amountInfo) {
    roles.amount = take(amountInfo);
    confidence.amount = headerConfidence(amountInfo);
    amounts = numbersOf(amountInfo.index);
  } else if (debitInfo || creditInfo) {
    roles.debit = take(debitInfo);
    roles.credit = take(creditInfo);
    confidence.amount = 0.9;
    amounts = pairAmounts(roles.debit, roles.credit);
  } else if (unlabelledMoney.length > 0) {
    fromContents.push('amount');
    const candidates = unlabelledMoney.slice(0, 6);
    // Two columns where every row fills exactly one: money out and money in.
    let pair: [ColumnInfo, ColumnInfo] | null = null;
    for (let a = 0; a < candidates.length && !pair; a += 1) {
      for (let b = a + 1; b < candidates.length && !pair; b += 1) {
        const first = numbersOf(candidates[a].index);
        const second = numbersOf(candidates[b].index);
        let onlyFirst = 0;
        let onlySecond = 0;
        let both = 0;
        for (let row = 0; row < first.length; row += 1) {
          const hasFirst = first[row] !== null && first[row] !== 0;
          const hasSecond = second[row] !== null && second[row] !== 0;
          if (hasFirst && hasSecond) both += 1;
          else if (hasFirst) onlyFirst += 1;
          else if (hasSecond) onlySecond += 1;
        }
        if (both === 0 && onlyFirst > 0 && onlySecond > 0 && onlyFirst + onlySecond >= 3) {
          // Most rows of a statement are spending, so the fuller column is money out.
          pair = onlySecond > onlyFirst ? [candidates[b], candidates[a]] : [candidates[a], candidates[b]];
        }
      }
    }
    if (pair) {
      let [debit, credit] = pair;
      confidence.amount = 0.6;
      const others = candidates.filter((info) => info !== debit && info !== credit && info.profile.filled * 10 >= info.profile.rows * 9);
      for (const other of others) {
        const check = checkBalance(pairAmounts(debit.index, credit.index), numbersOf(other.index), dates);
        if (reconciles(check, 0.9) && (check?.comparable ?? 0) >= 3) {
          // The balance settles which side is which: it goes down by money out.
          if (check?.orientation === -1) [debit, credit] = [credit, debit];
          confidence.amount = 0.8;
          roles.balance = take(other);
          break;
        }
      }
      roles.debit = take(debit);
      roles.credit = take(credit);
      amounts = pairAmounts(roles.debit, roles.credit);
    } else {
      const full = candidates.filter((info) => info.profile.filled * 10 >= info.profile.rows * 9);
      let found: [ColumnInfo, ColumnInfo] | null = null;
      for (const amount of full) {
        for (const balance of full) {
          if (amount === balance || found) continue;
          const check = checkBalance(numbersOf(amount.index), numbersOf(balance.index), dates);
          if (reconciles(check, 0.9) && (check?.comparable ?? 0) >= 3) found = [amount, balance];
        }
      }
      if (found) {
        roles.amount = take(found[0]);
        roles.balance = take(found[1]);
        confidence.amount = 0.85;
      } else {
        const best = [...candidates].sort(
          (a, b) => moneyLikeness(b.profile) - moneyLikeness(a.profile) || a.index - b.index
        )[0];
        roles.amount = take(best);
        confidence.amount = Math.min(0.75, 0.45 + 0.25 * moneyLikeness(best.profile) + (candidates.length === 1 ? 0.05 : 0));
      }
      amounts = numbersOf(roles.amount as number);
    }
  }

  // An unsigned amount with a "DR" / "CR" column beside it.
  if (roles.amount != null) {
    const amountProfile = profiles.find((profile) => profile.index === roles.amount) as ColumnProfile;
    const directionInfo =
      byClass('direction')[0] ??
      infos.find(
        (info) =>
          free(info) &&
          (info.headerClass === null || info.headerClass === 'type') &&
          info.profile.directionShare >= 0.95 &&
          info.profile.filled * 10 >= info.profile.rows * 9
      ) ??
      null;
    if (directionInfo && amountProfile.negatives === 0) {
      const { values, words } = directionValuesOf(table, directionInfo.index);
      if (values.out.length > 0 || values.in.length > 0) {
        roles.direction = take(directionInfo);
        directionValues = values;
        directionWords = words;
        const out = new Set(values.out);
        const moneyIn = new Set(values.in);
        const printed = numbersOf(roles.amount);
        amounts = table.rows.map((row, at) => {
          const value = printed[at];
          const word = (row[directionInfo.index] ?? '').trim().toLowerCase();
          if (value === null) return null;
          return out.has(word) ? -Math.abs(value) : moneyIn.has(word) ? Math.abs(value) : null;
        });
      }
    }
  }

  // A running balance: named so and adding up, or recognised by adding up alone.
  if (roles.balance == null && amounts) {
    const known = amounts;
    if (balanceHeaderInfo && free(balanceHeaderInfo)) {
      const check = checkBalance(known, numbersOf(balanceHeaderInfo.index), dates);
      // Too few rows to check: take the header's word. Otherwise at least half
      // the rows must add up: a statement with a missing row still does, a
      // loan's "principal balance" (which does not follow the payment amounts) does not.
      if (check === null || check.comparable < 3 || reconciles(check, 0.5)) roles.balance = take(balanceHeaderInfo);
    } else {
      const candidate = unlabelledMoney.find((info) => {
        if (!free(info) || info.profile.filled * 10 < info.profile.rows * 9) return false;
        const check = checkBalance(known, numbersOf(info.index), dates);
        return reconciles(check, 0.9) && (check?.comparable ?? 0) >= 3;
      });
      if (candidate) roles.balance = take(candidate);
    }
  }

  // --- Description ---------------------------------------------------------
  const mostDescriptive = (candidates: ColumnInfo[]) =>
    [...candidates].sort((a, b) => descriptiveness(b.profile) - descriptiveness(a.profile) || a.index - b.index)[0] ?? null;
  const payeeInfo =
    byClass('payee').find((info) => info.profile.filled > 0 && (info.profile.distinct > 1 || info.profile.rows <= 3)) ?? null;
  const mainInfo = mostDescriptive(byClass('description').filter((info) => info.profile.filled > 0));
  const memoInfo = byClass('memo').find((info) => info.profile.filled > 0) ?? null;
  const named = [payeeInfo, mainInfo, memoInfo].filter((info): info is ColumnInfo => info !== null);
  if (named.length > 0) {
    roles.description = named.map((info) => take(info) as number);
    confidence.description = headerConfidence(mainInfo ?? payeeInfo ?? (memoInfo as ColumnInfo));
  } else {
    const alternative = byClass('altDescription')[0] ?? null;
    if (alternative) {
      roles.description = [take(alternative) as number];
      confidence.description = headerConfidence(alternative);
    } else {
      const candidates = infos
        .filter(
          (info) =>
            free(info) &&
            info.headerClass === null &&
            info.profile.letterShare >= 0.6 &&
            info.profile.dateShare < 0.5 &&
            info.profile.moneyShare < 0.5
        )
        .sort((a, b) => descriptiveness(b.profile) - descriptiveness(a.profile) || a.index - b.index);
      const [best, second] = candidates;
      if (best && descriptiveness(best.profile) >= 0.2) {
        fromContents.push('description');
        roles.description = [take(best) as number];
        const clear = !second || descriptiveness(best.profile) >= descriptiveness(second.profile) * 1.5;
        confidence.description = clear ? 0.7 : 0.6;
      }
    }
  }

  // --- Reference, account, status, currency --------------------------------
  const hinted = detectUniqueIdentifierColumn(table.columns.filter((column) => !column.synthetic).map((column) => column.name));
  const referenceCandidates = [
    ...byClass('reference'),
    ...infos.filter((info) => hinted !== '' && free(info) && info.headerClass === null && info.name === hinted),
  ];
  const referenceInfo = referenceCandidates.find((info) => isUniqueReferenceColumn(table, info.index));
  if (referenceInfo) roles.reference = take(referenceInfo);

  const accountInfo =
    byClass('account')
      .filter((info) => info.profile.filled > 0)
      .sort((a, b) => b.profile.digitShare - a.profile.digitShare || a.index - b.index)[0] ??
    infos.find(
      (info) =>
        free(info) &&
        info.headerClass === null &&
        info.profile.maskedShare >= 0.9 &&
        info.profile.filled * 10 >= info.profile.rows * 9
    );
  if (accountInfo) roles.account = take(accountInfo);

  const statusInfo =
    byClass('status')[0] ??
    infos.find(
      (info) =>
        free(info) &&
        (info.headerClass === null || info.headerClass === 'type') &&
        info.profile.statusShare >= 0.9 &&
        info.profile.filled * 2 >= info.profile.rows
    );
  if (statusInfo) roles.status = take(statusInfo);

  const currencyInfo =
    byClass('currency')[0] ??
    infos.find(
      (info) =>
        free(info) &&
        info.headerClass === null &&
        info.profile.currencyShare >= 0.95 &&
        info.profile.distinct <= 3 &&
        info.profile.filled * 10 >= info.profile.rows * 9
    );
  if (currencyInfo) roles.currency = take(currencyInfo);

  return { roles, directionValues, directionWords, confidence, fromContents, dateOrder, decimal };
}
