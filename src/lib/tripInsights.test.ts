import { describe, expect, it } from 'vitest';

import { buildTripInsights, businessParts, fullBusinessAmount, rowValue, summarizeTrip } from './tripInsights';
import type { TripInsightRow } from '../types/tripExpenses';

function row(overrides: Partial<TripInsightRow> & { transaction_id: number }): TripInsightRow {
  const base: TripInsightRow = {
    trip_id: 3,
    date: '2026-10-10',
    description: 'Row',
    type: 'expense',
    is_excluded: false,
    amount: -100,
    account_id: 1,
    account_currency: 'USD',
    user_id: 1,
    user_name: 'Alex',
    category_id: 10,
    category_name: 'Travel',
    category_color: '#123456',
    company_id: null,
    company_name: null,
    gross_spend: 100,
    rate: 1,
    business_share: 0,
    denied_share: 0,
    business_amount: null,
    status: null,
    note: null,
    ...overrides,
  } as TripInsightRow;
  // Derive the default-currency parts the way the service mapper does.
  const parts = businessParts(base);
  return {
    ...base,
    business_share: overrides.business_share !== undefined ? overrides.business_share : parts.business,
    denied_share: overrides.denied_share !== undefined ? overrides.denied_share : parts.denied,
  };
}

// The San Francisco weekend: a flight and rides fully business, a hotel
// partly business, the spouse's dinner and shopping personal, a refund.
const sfRows: TripInsightRow[] = [
  row({ transaction_id: 1, description: 'Airline', amount: -450, gross_spend: 450, business_amount: 450, status: 'submitted', category_id: 10, company_id: 100, company_name: 'Airline' }),
  row({ transaction_id: 2, description: 'Hotel', amount: -900, gross_spend: 900, business_amount: 600, status: 'pending', category_id: 11, category_name: 'Lodging', company_id: 101, company_name: 'Hotel' }),
  row({ transaction_id: 3, description: 'Rides', amount: -60, gross_spend: 60, business_amount: 60, status: 'reimbursed', category_id: 10, company_id: 102, company_name: 'Rides', date: '2026-10-11' }),
  row({ transaction_id: 4, description: 'Dinner', amount: -120, gross_spend: 120, user_id: 2, user_name: 'Sam', category_id: 12, category_name: 'Dining', company_id: 103, company_name: 'Bistro', date: '2026-10-11' }),
  row({ transaction_id: 5, description: 'Shop refund', type: 'refund', amount: 20, gross_spend: -20, user_id: 2, user_name: 'Sam', category_id: null, category_name: null, date: '2026-10-12' }),
  row({ transaction_id: 6, description: 'Denied museum', amount: -40, gross_spend: 40, business_amount: 40, status: 'denied', category_id: 13, category_name: 'Fun', date: '2026-10-12' }),
  // Not spending: ignored by every figure.
  row({ transaction_id: 7, description: 'Transfer', type: 'transfer', amount: -500, gross_spend: 0 }),
  row({ transaction_id: 8, description: 'Excluded', is_excluded: true, amount: -999, gross_spend: 0 }),
];

describe('businessParts', () => {
  it('converts the stored business amount, moving a denied part to denied', () => {
    expect(businessParts({ type: 'expense', is_excluded: false, business_amount: 50, status: 'pending', rate: 1.1 })).toEqual({
      business: 55.00000000000001,
      denied: 0,
    });
    expect(businessParts({ type: 'expense', is_excluded: false, business_amount: 50, status: 'denied', rate: 1 })).toEqual({
      business: 0,
      denied: 50,
    });
  });

  it('has no business part for refunds, excluded rows or rows without an allocation', () => {
    expect(businessParts({ type: 'refund', is_excluded: false, business_amount: 50, status: 'pending', rate: 1 }).business).toBe(0);
    expect(businessParts({ type: 'expense', is_excluded: true, business_amount: 50, status: 'pending', rate: 1 }).business).toBe(0);
    expect(businessParts({ type: 'expense', is_excluded: false, business_amount: null, status: null, rate: 1 }).business).toBe(0);
  });

  it('is unknown when the currency has no rate', () => {
    expect(businessParts({ type: 'expense', is_excluded: false, business_amount: 50, status: 'pending', rate: null })).toEqual({
      business: null,
      denied: null,
    });
  });
});

describe('summarizeTrip', () => {
  it('splits gross into business and personal and compares with what came back', () => {
    const summary = summarizeTrip(3, sfRows, [{ amount: 400 }, { amount: 700 }]);
    // 450 + 900 + 60 + 120 - 20 + 40
    expect(summary.gross_spend).toBe(1550);
    // 450 + 600 + 60 (the denied 40 is personal again)
    expect(summary.business_share).toBe(1110);
    expect(summary.personal_share).toBe(440);
    expect(summary.denied_share).toBe(40);
    expect(summary.received).toBe(1100);
    expect(summary.outstanding).toBe(10);
    expect(summary.net_cost).toBe(450);
    expect(summary.status_counts).toEqual({ pending: 1, submitted: 1, reimbursed: 1, denied: 1 });
    expect(summary.status_amounts).toEqual({ pending: 600, submitted: 450, reimbursed: 60, denied: 40 });
    expect(summary.transaction_count).toBe(8);
    expect(summary.missing_rate_count).toBe(0);
  });

  it('shows a negative outstanding when more came back than was claimed', () => {
    expect(summarizeTrip(3, sfRows, [{ amount: 1200 }]).outstanding).toBe(-90);
  });

  it('leaves out rows whose currency has no rate and counts them', () => {
    const summary = summarizeTrip(3, [...sfRows, row({ transaction_id: 9, gross_spend: null, rate: null, business_amount: 10, status: 'pending' })], []);
    expect(summary.gross_spend).toBe(1550);
    expect(summary.missing_rate_count).toBe(1);
  });

  it('is all zero for an empty trip', () => {
    const summary = summarizeTrip(4, [], []);
    expect(summary).toMatchObject({ gross_spend: 0, business_share: 0, personal_share: 0, received: 0, outstanding: 0, net_cost: 0 });
  });
});

describe('rowValue', () => {
  it('gives the row amount for each view', () => {
    const hotel = sfRows[1];
    expect(rowValue(hotel, 'all')).toBe(900);
    expect(rowValue(hotel, 'business')).toBe(600);
    expect(rowValue(hotel, 'personal')).toBe(300);
    expect(rowValue(row({ transaction_id: 9, gross_spend: null, rate: null }), 'all')).toBeNull();
  });
});

describe('buildTripInsights', () => {
  it('shows only what was really spent personally in the personal view', () => {
    const insights = buildTripInsights(sfRows, { view: 'personal' });
    // hotel 300 + dinner 120 + refund -20 + denied 40; flight and rides are fully business.
    expect(insights.total).toBe(440);
    expect(insights.rows.map((r) => r.description)).toEqual(['Hotel', 'Dinner', 'Denied museum', 'Shop refund']);
    expect(insights.byUser).toEqual([
      expect.objectContaining({ key: 1, label: 'Alex', value: 340, count: 2 }),
      expect.objectContaining({ key: 2, label: 'Sam', value: 100, count: 2 }),
    ]);
  });

  it('shows the business part only in the business view', () => {
    const insights = buildTripInsights(sfRows, { view: 'business' });
    expect(insights.total).toBe(1110);
    expect(insights.byCategory).toEqual([
      expect.objectContaining({ key: 11, label: 'Lodging', value: 600 }),
      expect.objectContaining({ key: 10, label: 'Travel', value: 510, count: 2 }),
    ]);
  });

  it('filters by category, merchant, account and person, with null for the empty bucket', () => {
    expect(buildTripInsights(sfRows, { view: 'all', categoryIds: [10] }).total).toBe(510);
    expect(buildTripInsights(sfRows, { view: 'all', categoryIds: [null] }).total).toBe(-20);
    expect(buildTripInsights(sfRows, { view: 'all', companyIds: [103] }).total).toBe(120);
    expect(buildTripInsights(sfRows, { view: 'all', accountIds: [2] }).count).toBe(0);
    expect(buildTripInsights(sfRows, { view: 'personal', userIds: [2] }).total).toBe(100);
  });

  it('orders the days oldest first and counts rows without a rate', () => {
    const insights = buildTripInsights(
      [...sfRows, row({ transaction_id: 9, gross_spend: null, rate: null })],
      { view: 'all' }
    );
    expect(insights.byDay.map((day) => day.key)).toEqual(['2026-10-10', '2026-10-11', '2026-10-12']);
    expect(insights.missingRateCount).toBe(1);
    expect(insights.total).toBe(1550);
  });
});

describe('fullBusinessAmount', () => {
  it('is the charge as a positive amount, or 0 for money in', () => {
    expect(fullBusinessAmount(-123.456)).toBe(123.46);
    expect(fullBusinessAmount(20)).toBe(0);
  });
});
