import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_NOTIFICATION_SETTINGS } from './databaseServiceNotifications';
import { computeLoanSummary } from './loanMath';
import { loanPromoDedupeKey, planLoanPromoAlerts, scanNotifications } from './notificationService';
import type { AppNotification, Loan, NotificationSetting } from '@/types/database';
import type { LoanSummary } from '@/types/loans';
import type { NotificationScanContext } from '@/types/notifications';

const TODAY = '2026-11-02';

function loan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: 1,
    name: 'Furnace financing',
    loan_type: 'deferred_interest',
    status: 'active',
    owner_user_id: 1,
    project_id: null,
    account_id: null,
    lender: 'Synchrony',
    opened_date: '2026-01-01',
    original_principal: 3000,
    interest_rate: 0,
    term_months: null,
    expected_payment: 250,
    payment_due_day: 15,
    first_payment_date: null,
    allows_full_payoff: 1,
    prepayment_terms: null,
    promo_end_date: '2026-12-31',
    deferred_interest_rate: 29.99,
    notes: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function summaryFor(entry: Loan, paid: number[] = []): LoanSummary {
  return computeLoanSummary(
    entry,
    paid.map((amount, index) => ({
      id: index + 1,
      transaction_id: null,
      payment_date: `2026-${String(index + 1).padStart(2, '0')}-15`,
      amount,
      principal_amount: null,
      interest_amount: null,
      split_source: 'computed' as const,
      match_source: 'manual' as const,
    })),
    TODAY
  );
}

function settings(lead = 60, enabled = 1): NotificationSetting[] {
  return DEFAULT_NOTIFICATION_SETTINGS.map((setting) =>
    setting.type === 'loan_promo_ending' ? { ...setting, lead_days: lead, enabled } : { ...setting }
  );
}

function existingAlert(overrides: Partial<AppNotification>): AppNotification {
  return {
    id: 50,
    kind: 'alert',
    type: 'loan_promo_ending',
    title: 'old',
    body: null,
    due_date: '2026-12-31',
    recurrence: 'once',
    lead_days: 60,
    status: 'active',
    snoozed_until: null,
    source: 'system',
    dedupe_key: loanPromoDedupeKey(1, '2026-12-31'),
    entity_table: 'loans',
    entity_id: 1,
    payload_json: null,
    last_notified_at: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

describe('planLoanPromoAlerts', () => {
  it('raises an on-track alert inside the lead window', () => {
    const entry = loan();
    const plan = planLoanPromoAlerts([entry], new Map([[1, summaryFor(entry, [250, 250, 250, 250, 250, 250, 250, 250, 250, 250])]]), [], settings(60), TODAY);
    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0]).toMatchObject({
      type: 'loan_promo_ending',
      dedupe_key: 'loan-promo:1:2026-12-31',
      due_date: '2026-12-31',
      entity_table: 'loans',
      entity_id: 1,
      title: 'Furnace financing: pay off by 2026-12-31',
    });
    expect(JSON.parse(plan.upserts[0].payload_json as string)).toMatchObject({ loan_id: 1, on_track: true, charged: false });
  });

  it('warns with the required payment when the expected payment will not clear the balance', () => {
    const entry = loan({ expected_payment: 100 });
    const plan = planLoanPromoAlerts([entry], new Map([[1, summaryFor(entry, [100, 100, 100])]]), [], settings(60), TODAY);
    expect(plan.upserts[0].title).toBe('Furnace financing: not on track for 2026-12-31');
    expect(plan.upserts[0].body).toContain('Pay $1,350.00 a month');
    expect(plan.upserts[0].body).toContain('deferred interest would be charged');
  });

  it('stays quiet outside the lead window, when disabled, and for other loan types', () => {
    const entry = loan();
    const summaries = new Map([[1, summaryFor(entry)]]);
    expect(planLoanPromoAlerts([entry], summaries, [], settings(30), TODAY).upserts).toHaveLength(0);
    expect(planLoanPromoAlerts([entry], summaries, [], settings(60, 0), TODAY).upserts).toHaveLength(0);
    const installment = loan({ loan_type: 'installment', promo_end_date: null });
    expect(planLoanPromoAlerts([installment], new Map([[1, summaryFor(installment)]]), [], settings(60), TODAY).upserts).toHaveLength(0);
  });

  it('reports the charge once the promo was missed and resolves alerts for paid-off loans', () => {
    const missed = loan({ promo_end_date: '2026-09-30' });
    const plan = planLoanPromoAlerts([missed], new Map([[1, summaryFor(missed)]]), [], settings(60), TODAY);
    expect(plan.upserts[0].title).toBe('Furnace financing: deferred interest charged');
    expect(JSON.parse(plan.upserts[0].payload_json as string)).toMatchObject({ charged: true });

    const paid = loan();
    const resolved = planLoanPromoAlerts([paid], new Map([[1, summaryFor(paid, [3000])]]), [existingAlert({})], settings(60), TODAY);
    expect(resolved.upserts).toHaveLength(0);
    expect(resolved.resolvedIds).toEqual([50]);

    // Dismissed alerts are left alone.
    const dismissed = planLoanPromoAlerts([paid], new Map([[1, summaryFor(paid, [3000])]]), [existingAlert({ status: 'dismissed' })], settings(60), TODAY);
    expect(dismissed.resolvedIds).toEqual([]);
  });
});

describe('scanNotifications with loans', () => {
  it('upserts the loan alert through the context and skips loans when the context has none', async () => {
    const entry = loan();
    const upsertByDedupeKey = vi.fn(async () => 1);
    const ctx: NotificationScanContext = {
      notifications: [],
      settings: settings(60),
      recurringSeries: [],
      listSeriesPaymentsSince: async () => [],
      getBudgetStatus: async () => {
        throw new Error('no plan');
      },
      loans: [entry],
      getLoanSummary: async (id) => (id === 1 ? summaryFor(entry, [250]) : null),
      upsertByDedupeKey,
      setStatus: vi.fn(async () => undefined),
      update: vi.fn(async () => undefined),
    };
    const summary = await scanNotifications(ctx, TODAY);
    expect(summary.alertsUpserted).toBe(1);
    expect(upsertByDedupeKey).toHaveBeenCalledWith(expect.objectContaining({ type: 'loan_promo_ending', entity_id: 1 }));

    const { loans: _loans, getLoanSummary: _getLoanSummary, ...withoutLoans } = ctx;
    upsertByDedupeKey.mockClear();
    const quiet = await scanNotifications(withoutLoans, TODAY);
    expect(quiet.alertsUpserted).toBe(0);
    expect(upsertByDedupeKey).not.toHaveBeenCalled();
  });
});
