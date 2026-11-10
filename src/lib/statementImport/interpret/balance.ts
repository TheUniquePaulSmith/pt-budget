/**
 * Running-balance arithmetic: does each row's balance follow from the row
 * before it and the row's amount? Used three ways: to recognise a balance
 * column by its contents, to decide which sign the amounts have, and to
 * report rows where the bank's own balance disagrees (`balanceMismatch`).
 */

/** Half a cent, plus room for floating-point noise on large balances. */
function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.006 + Math.abs(b) * 1e-9;
}

export interface BalanceCheck {
  /** Neighbouring rows that both have a balance and an amount to compare. */
  comparable: number;
  /** Of those, how many reconcile. */
  matched: number;
  /** Of the matches, how many have a non-zero amount (a zero amount reconciles whatever the sign). */
  decisive: number;
  /** +1: the balance goes up by a positive amount. -1: it goes down (a balance owed, or inverted amounts). */
  orientation: 1 | -1;
  /** The file lists the newest row first. */
  newestFirst: boolean;
}

function fileDirection(dates: Array<string | null> | undefined): 'oldestFirst' | 'newestFirst' | 'unknown' {
  if (!dates) return 'unknown';
  let rising = 0;
  let falling = 0;
  let previous: string | null = null;
  for (const date of dates) {
    if (!date) continue;
    if (previous !== null) {
      if (date > previous) rising += 1;
      else if (date < previous) falling += 1;
    }
    previous = date;
  }
  if (rising > 0 && falling === 0) return 'oldestFirst';
  if (falling > 0 && rising === 0) return 'newestFirst';
  return 'unknown';
}

/** The balance the row at `index` starts from: the previous row's, or the next one's in a newest-first file. */
function startingBalance(balances: Array<number | null>, index: number, newestFirst: boolean): number | null {
  const neighbour = newestFirst ? index + 1 : index - 1;
  return neighbour >= 0 && neighbour < balances.length ? balances[neighbour] : null;
}

function count(
  amounts: Array<number | null>,
  balances: Array<number | null>,
  newestFirst: boolean,
  orientation: 1 | -1
): { comparable: number; matched: number; decisive: number } {
  let comparable = 0;
  let matched = 0;
  let decisive = 0;
  for (let index = 0; index < amounts.length; index += 1) {
    const amount = amounts[index];
    const balance = balances[index];
    const before = startingBalance(balances, index, newestFirst);
    if (amount === null || balance === null || before === null) continue;
    comparable += 1;
    if (near(balance - before, orientation * amount)) {
      matched += 1;
      // A zero amount reconciles whatever the sign, so it proves nothing.
      if (amount !== 0) decisive += 1;
    }
  }
  return { comparable, matched, decisive };
}

/**
 * Finds the reading under which the balance column reconciles best. Null when
 * there are no neighbouring rows to compare.
 * `dates` (in file order) settle whether the file is oldest or newest first;
 * without them both are tried.
 */
export function checkBalance(
  amounts: Array<number | null>,
  balances: Array<number | null>,
  dates?: Array<string | null>
): BalanceCheck | null {
  const direction = fileDirection(dates);
  const orders = direction === 'unknown' ? [false, true] : [direction === 'newestFirst'];
  let best: BalanceCheck | null = null;
  for (const newestFirst of orders) {
    for (const orientation of [1, -1] as const) {
      const result = count(amounts, balances, newestFirst, orientation);
      if (result.comparable === 0) continue;
      if (!best || result.decisive > best.decisive) best = { ...result, orientation, newestFirst };
    }
  }
  return best;
}

/** True when the column behaves like a running balance of the amounts: most rows reconcile. */
export function reconciles(check: BalanceCheck | null, minimumShare = 0.8): boolean {
  return (
    check !== null && check.decisive > 0 && check.comparable >= 2 && check.matched / check.comparable >= minimumShare
  );
}

/** Indexes of the rows whose balance does not follow from the row before, under the reading `check` found. */
export function balanceMismatchRows(
  amounts: Array<number | null>,
  balances: Array<number | null>,
  check: BalanceCheck
): number[] {
  const rows: number[] = [];
  for (let index = 0; index < amounts.length; index += 1) {
    const amount = amounts[index];
    const balance = balances[index];
    const before = startingBalance(balances, index, check.newestFirst);
    if (amount === null || balance === null || before === null) continue;
    if (!near(balance - before, check.orientation * amount)) rows.push(index);
  }
  return rows;
}
