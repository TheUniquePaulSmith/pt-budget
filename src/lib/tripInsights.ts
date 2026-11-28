// Trip business expenses (schema v8): pure maths over a trip's rows. No
// React, no database. The service maps SQL rows to TripInsightRow (with every
// amount already in the default currency); this module turns them into the
// trip's figures and the Insights tab's breakdowns.
//
//   gross     expenses less refunds on the trip (spendExpr)
//   business  the non-denied business parts, each capped at its charge, less
//             the business share of refunds (applyRefundShares)
//   personal  gross - business (a denied business part is personal again)
//   received  the reimbursements recorded for the trip
//   outstanding = business - received (negative = received more than claimed)
//   net cost    = gross - received

import type {
  TripExpenseSummary,
  TripInsightRow,
  TripReimbursement,
  TripReimbursementStatus,
} from '../types/tripExpenses';
import { TRIP_REIMBURSEMENT_STATUSES } from '../types/tripExpenses';

export type TripInsightView = 'all' | 'personal' | 'business';

/** `null` in an id list selects the rows without one (Uncategorized, No merchant, …). */
export interface TripInsightFilters {
  view: TripInsightView;
  categoryIds?: Array<number | null>;
  companyIds?: Array<number | null>;
  accountIds?: number[];
  userIds?: Array<number | null>;
}

export interface TripInsightBucket {
  key: number | string | null;
  label: string | null;
  color?: string | null;
  value: number;
  count: number;
}

export interface TripInsightResultRow extends TripInsightRow {
  /** The row's amount for the selected view, in the default currency. */
  value: number;
}

export interface TripInsights {
  total: number;
  count: number;
  /** Filtered rows left out because their currency has no exchange rate. */
  missingRateCount: number;
  byCategory: TripInsightBucket[];
  byCompany: TripInsightBucket[];
  byAccount: TripInsightBucket[];
  byUser: TripInsightBucket[];
  /** Oldest day first. */
  byDay: TripInsightBucket[];
  /** Largest first. */
  rows: TripInsightResultRow[];
}

const EPSILON = 0.005;

/** A row that counts as trip spending: an expense or a refund that is not excluded. */
export function isSpendingRow(row: Pick<TripInsightRow, 'type' | 'is_excluded'>): boolean {
  return (row.type === 'expense' || row.type === 'refund') && !row.is_excluded;
}

/**
 * Business and denied parts of one row in the default currency, from its
 * stored (already capped) business amount and its rate.
 */
export function businessParts(
  row: Pick<TripInsightRow, 'type' | 'is_excluded' | 'business_amount' | 'status' | 'rate'>
): { business: number | null; denied: number | null } {
  if (row.type !== 'expense' || row.is_excluded || row.business_amount == null || row.business_amount <= 0) {
    return { business: 0, denied: 0 };
  }
  if (row.rate == null) return { business: null, denied: null };
  const converted = row.business_amount * row.rate;
  return row.status === 'denied' ? { business: 0, denied: converted } : { business: converted, denied: 0 };
}

/**
 * Gives each refund of one trip a business share (negative, default currency),
 * so money back on a business charge lowers the business part instead of the
 * personal one. The share is the refund times the business ratio of the
 * trip's expenses at the same merchant. A refund that matches no merchant is
 * business only on a trip whose spending is all business, and otherwise
 * personal (it cannot be tied to a charge, as with a spouse's shop return).
 */
export function applyRefundShares(rows: readonly TripInsightRow[]): TripInsightRow[] {
  const totals = new Map<number | 'trip', { gross: number; business: number }>();
  const add = (key: number | 'trip', gross: number, business: number) => {
    const total = totals.get(key) ?? { gross: 0, business: 0 };
    total.gross += gross;
    total.business += business;
    totals.set(key, total);
  };
  for (const row of rows) {
    if (row.type !== 'expense' || !isSpendingRow(row) || row.gross_spend == null || row.business_share == null) continue;
    add('trip', row.gross_spend, row.business_share);
    if (row.company_id != null) add(row.company_id, row.gross_spend, row.business_share);
  }
  const ratio = (key: number | 'trip') => {
    const total = totals.get(key);
    return total && total.gross > 0 ? Math.min(1, Math.max(0, total.business / total.gross)) : null;
  };
  return rows.map((row) => {
    if (row.type !== 'refund' || !isSpendingRow(row) || row.gross_spend == null) return row;
    const merchant = row.company_id != null ? ratio(row.company_id) : null;
    const share = merchant ?? ((ratio('trip') ?? 0) > 1 - 1e-6 ? 1 : 0);
    return { ...row, business_share: row.gross_spend * share };
  });
}

/** The row's amount for a view, or null when its currency has no rate. */
export function rowValue(row: TripInsightRow, view: TripInsightView): number | null {
  if (row.gross_spend == null) return null;
  if (view === 'all') return row.gross_spend;
  const business = row.business_share;
  if (business == null) return null;
  return view === 'business' ? business : row.gross_spend - business;
}

function emptyStatusRecord(): Record<TripReimbursementStatus, number> {
  return Object.fromEntries(TRIP_REIMBURSEMENT_STATUSES.map((status) => [status, 0])) as Record<
    TripReimbursementStatus,
    number
  >;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** The trip's figures from its rows and its reimbursements. */
export function summarizeTrip(
  tripId: number,
  rows: readonly TripInsightRow[],
  receipts: readonly Pick<TripReimbursement, 'amount'>[]
): TripExpenseSummary {
  let gross = 0;
  let business = 0;
  let denied = 0;
  let missing = 0;
  const statusCounts = emptyStatusRecord();
  const statusAmounts = emptyStatusRecord();

  for (const row of rows) {
    if (!isSpendingRow(row)) continue;
    if (row.gross_spend == null) {
      missing += 1;
      continue;
    }
    gross += row.gross_spend;
    business += row.business_share ?? 0;
    denied += row.denied_share ?? 0;
    if (row.status && (row.business_amount ?? 0) > 0) {
      statusCounts[row.status] += 1;
      statusAmounts[row.status] +=
        row.status === 'denied' ? row.denied_share ?? 0 : row.business_share ?? 0;
    }
  }

  const received = receipts.reduce((sum, receipt) => sum + (Number(receipt.amount) || 0), 0);
  for (const status of TRIP_REIMBURSEMENT_STATUSES) statusAmounts[status] = round2(statusAmounts[status]);

  return {
    trip_id: tripId,
    transaction_count: rows.length,
    gross_spend: round2(gross),
    business_share: round2(business),
    personal_share: round2(gross - business),
    denied_share: round2(denied),
    received: round2(received),
    outstanding: round2(business - received),
    net_cost: round2(gross - received),
    status_counts: statusCounts,
    status_amounts: statusAmounts,
    missing_rate_count: missing,
  };
}

function matches<T>(selected: readonly T[] | undefined, value: T): boolean {
  return !selected || selected.length === 0 || selected.includes(value);
}

/** Rows that pass the dimension filters, before the view is applied. */
export function filterTripRows(rows: readonly TripInsightRow[], filters: TripInsightFilters): TripInsightRow[] {
  return rows.filter(
    (row) =>
      isSpendingRow(row) &&
      matches(filters.categoryIds, row.category_id) &&
      matches(filters.companyIds, row.company_id) &&
      matches(filters.accountIds, row.account_id) &&
      matches(filters.userIds, row.user_id)
  );
}

type BucketKey = number | string | null;

function bucketize(
  rows: readonly TripInsightResultRow[],
  keyOf: (row: TripInsightResultRow) => BucketKey,
  labelOf: (row: TripInsightResultRow) => string | null,
  colorOf?: (row: TripInsightResultRow) => string | null
): TripInsightBucket[] {
  const buckets = new Map<BucketKey, TripInsightBucket>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = buckets.get(key) ?? {
      key,
      label: labelOf(row),
      color: colorOf?.(row) ?? null,
      value: 0,
      count: 0,
    };
    bucket.value += row.value;
    bucket.count += 1;
    buckets.set(key, bucket);
  }
  return [...buckets.values()]
    .map((bucket) => ({ ...bucket, value: round2(bucket.value) }))
    .sort((a, b) => b.value - a.value || String(a.label ?? '').localeCompare(String(b.label ?? '')));
}

/** The Insights tab: totals and breakdowns for one view and set of filters. */
export function buildTripInsights(rows: readonly TripInsightRow[], filters: TripInsightFilters): TripInsights {
  const filtered = filterTripRows(rows, filters);
  let missingRateCount = 0;
  const valued: TripInsightResultRow[] = [];
  for (const row of filtered) {
    const value = rowValue(row, filters.view);
    if (value == null) {
      missingRateCount += 1;
      continue;
    }
    // A view shows the rows that have something in it: a personal row has no
    // business part, a fully business row no personal part.
    if (filters.view !== 'all' && Math.abs(value) < EPSILON) continue;
    valued.push({ ...row, value });
  }

  const byDay = bucketize(valued, (row) => row.date, (row) => row.date).sort((a, b) =>
    String(a.key).localeCompare(String(b.key))
  );

  return {
    total: round2(valued.reduce((sum, row) => sum + row.value, 0)),
    count: valued.length,
    missingRateCount,
    byCategory: bucketize(valued, (row) => row.category_id, (row) => row.category_name, (row) => row.category_color),
    byCompany: bucketize(valued, (row) => row.company_id, (row) => row.company_name),
    byAccount: bucketize(valued, (row) => row.account_id, () => null),
    byUser: bucketize(valued, (row) => row.user_id, (row) => row.user_name),
    byDay,
    rows: [...valued].sort((a, b) => b.value - a.value || b.date.localeCompare(a.date)),
  };
}

/**
 * Business part for "All business" on an expense: the whole charge as a
 * positive magnitude in the account currency.
 */
export function fullBusinessAmount(amount: number): number {
  return amount < 0 ? round2(-amount) : 0;
}
