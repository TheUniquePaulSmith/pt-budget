import { beforeEach, describe, expect, it } from 'vitest';

import type { ClassificationRule } from '../types/database';
import type { ClassifiableTransaction, ClassifyOptions } from '../types/classification';
import {
  classifyTransactions,
  countClassificationRuleMatches,
  dayGap,
  descriptionHintsTransfer,
  matchClassificationRule,
  signDefaultType,
  sortClassificationRules,
  typeAllowsSign,
} from './transactionClassifier';

// Accounts: 1 checking, 2 savings, 3 credit card, 4 a second checking (other bank).
const ACCOUNT_TYPES: Record<number, ClassifiableTransaction['account_type']> = {
  1: 'checking',
  2: 'savings',
  3: 'credit',
  4: 'checking',
};

let nextId = 1;
function row(overrides: Partial<ClassifiableTransaction> & { account_id: number; amount: number; date: string }): ClassifiableTransaction {
  const id = overrides.id ?? nextId++;
  const key = overrides.key ?? `tx:${id}`;
  return {
    key,
    id,
    tempId: null,
    account_type: ACCOUNT_TYPES[overrides.account_id],
    description: 'ROW',
    type: signDefaultType(overrides.amount),
    type_locked: false,
    type_source: 'sign',
    transfer_group_id: null,
    ...overrides,
  };
}

function staged(overrides: Partial<ClassifiableTransaction> & { account_id: number; amount: number; date: string }): ClassifiableTransaction {
  const tempId = overrides.tempId ?? nextId++;
  return row({ ...overrides, id: null, tempId, key: `tmp:${tempId}` });
}

function rule(overrides: Partial<ClassificationRule> & { pattern: string; type: ClassificationRule['type'] }): ClassificationRule {
  return {
    id: overrides.id ?? nextId++,
    rule_key: overrides.rule_key ?? `user:${overrides.pattern}`,
    source: 'user',
    match_type: 'contains',
    priority: 100,
    account_id: null,
    counterpart_account_id: null,
    enabled: 1,
    notes: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

let groupCounter = 0;
const newGroupId = () => `group-${++groupCounter}`;
beforeEach(() => {
  groupCounter = 0;
});

function classify(rows: ClassifiableTransaction[], options: Partial<ClassifyOptions> = {}) {
  return classifyTransactions({ rules: [], rows, mode: 'scan', newGroupId, ...options });
}

const byKey = (result: ReturnType<typeof classify>) => new Map(result.decisions.map((d) => [d.key, d]));

describe('transactionClassifier helpers', () => {
  it('derives the sign default and checks type / sign compatibility', () => {
    expect(signDefaultType(-5)).toBe('expense');
    expect(signDefaultType(5)).toBe('income');
    expect(typeAllowsSign('expense', -5)).toBe(true);
    expect(typeAllowsSign('expense', 5)).toBe(false);
    expect(typeAllowsSign('income', -5)).toBe(false);
    expect(typeAllowsSign('refund', 5)).toBe(true);
    expect(typeAllowsSign('transfer', -5)).toBe(true);
    expect(typeAllowsSign('transfer', 5)).toBe(true);
  });

  it('recognises transfer wording and counts whole days between dates', () => {
    expect(descriptionHintsTransfer('PYMT BY FUNDS TRANSFER')).toBe(true);
    expect(descriptionHintsTransfer('EXT Transfer to Huntington Bank')).toBe(true);
    expect(descriptionHintsTransfer('PAYMENT - THANK YOU')).toBe(true);
    expect(descriptionHintsTransfer('KROGER #123')).toBe(false);
    expect(dayGap('2026-03-01', '2026-03-04')).toBe(3);
    expect(dayGap('2026-03-04', '2026-03-01')).toBe(-3);
    expect(dayGap('2026-02-28', '2026-03-01')).toBe(1);
  });

  it('sorts rules by priority, then pattern length, then key, and matches scope and sign', () => {
    const rules = sortClassificationRules([
      rule({ rule_key: 'b', pattern: 'TRANSFER', type: 'transfer', priority: 100 }),
      rule({ rule_key: 'a', pattern: 'EXT TRANSFER TO HUNTINGTON', type: 'transfer', priority: 100 }),
      rule({ rule_key: 'c', pattern: 'PAYROLL', type: 'income', priority: 50 }),
      rule({ rule_key: 'd', pattern: 'REFUND', type: 'refund', priority: 100, account_id: 3 }),
    ]);
    expect(rules.map((r) => r.rule_key)).toEqual(['c', 'a', 'b', 'd']);

    // The specific pattern wins over the generic one at the same priority.
    expect(matchClassificationRule({ account_id: 4, amount: -1000 }, 'EXT TRANSFER TO HUNTINGTON BANK', rules)?.rule_key).toBe('a');
    // Income rule is skipped for money out.
    expect(matchClassificationRule({ account_id: 1, amount: -50 }, 'PAYROLL CO', rules)).toBeNull();
    // Account-scoped rule only applies to its account.
    expect(matchClassificationRule({ account_id: 1, amount: 20 }, 'MERCHANT REFUND', rules)).toBeNull();
    expect(matchClassificationRule({ account_id: 3, amount: 20 }, 'MERCHANT REFUND', rules)?.rule_key).toBe('d');
    // Disabled rules never match.
    expect(matchClassificationRule({ account_id: 1, amount: -5 }, 'TRANSFER', [{ ...rules[2], enabled: 0 }])).toBeNull();
    expect(matchClassificationRule({ account_id: 1, amount: -5 }, '', rules)).toBeNull();
  });

  it('previews how many rows a rule would type', () => {
    const rows = [
      { account_id: 1, amount: -500, description: 'PYMT BY FUNDS TRANSFER 1234' },
      { account_id: 1, amount: -40, description: 'KROGER #55' },
      { account_id: 3, amount: 500, description: 'pymt by funds transfer' },
    ];
    expect(countClassificationRuleMatches({ pattern: 'PYMT BY FUNDS TRANSFER', match_type: 'prefix', type: 'transfer' }, rows)).toBe(2);
    expect(countClassificationRuleMatches({ pattern: 'PYMT BY FUNDS TRANSFER', match_type: 'prefix', type: 'transfer', account_id: 3 }, rows)).toBe(1);
    expect(countClassificationRuleMatches({ pattern: 'KROGER', match_type: 'exact', type: 'expense' }, rows)).toBe(1);
  });
});

describe('classifyTransactions – transfer pairing', () => {
  it('pairs a weekly card payment from checking with the deposit on the card', () => {
    const out = row({ account_id: 1, amount: -500, date: '2026-03-10', description: 'PYMT BY FUNDS TRANSFER' });
    const inn = row({ account_id: 3, amount: 500, date: '2026-03-11', description: 'PAYMENT - THANK YOU' });
    const result = classify([out, inn]);

    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]).toMatchObject({ outKey: out.key, inKey: inn.key, dateGapDays: 1 });
    expect(result.pairs[0].confidence).toBeGreaterThanOrEqual(0.9);

    const decisions = byKey(result);
    expect(decisions.get(out.key)).toMatchObject({ type: 'transfer', source: 'pair', transferGroupId: 'group-1', pairedWithKey: inn.key });
    expect(decisions.get(inn.key)).toMatchObject({ type: 'transfer', source: 'pair', transferGroupId: 'group-1', pairedWithKey: out.key });
    expect(decisions.get(inn.key)?.reasons).toContain('checking paying a credit account');
  });

  it('pairs external transfers between two banks worded differently on each side', () => {
    const out = row({ account_id: 4, amount: -1000, date: '2026-03-10', description: 'EXT Transfer to Huntington Bank' });
    const inn = row({ account_id: 1, amount: 1000, date: '2026-03-12', description: 'EXT Transfer from Fifth Third' });
    const result = classify([out, inn]);
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0].confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('never pairs rows in the same account, beyond the window, or with the same direction', () => {
    const out = () => row({ account_id: 1, amount: -75, date: '2026-03-10', description: 'TRANSFER' });
    const cases = [
      row({ account_id: 1, amount: 75, date: '2026-03-10', description: 'TRANSFER' }), // same account
      row({ account_id: 2, amount: 75, date: '2026-04-10', description: 'TRANSFER' }), // 31 days later
      row({ account_id: 3, amount: -75, date: '2026-03-10', description: 'TRANSFER' }), // same direction
    ];
    for (const other of cases) {
      const result = classify([out(), other]);
      expect(result.pairs).toHaveLength(0);
      expect(result.possiblePairs).toHaveLength(0);
      expect(result.decisions.filter((d) => d.type === 'transfer')).toHaveLength(0);
    }
  });

  it('reports a small same-day coincidence as possible instead of applying it', () => {
    const out = row({ account_id: 1, amount: -12.5, date: '2026-03-10', description: 'COFFEE CORNER' });
    const inn = row({ account_id: 2, amount: 12.5, date: '2026-03-10', description: 'INTEREST CREDIT' });
    const result = classify([out, inn]);

    expect(result.pairs).toHaveLength(0);
    expect(result.possiblePairs).toHaveLength(1);
    expect(result.possiblePairs[0].confidence).toBeLessThan(0.6);
    expect(result.possiblePairs[0].reasons).toContain('small amount without transfer wording');
    expect(byKey(result).has(out.key)).toBe(false);
  });

  it('lifts a borderline pair above the threshold when the same two accounts repeat', () => {
    const single = classify([
      row({ account_id: 2, amount: -300, date: '2026-03-02', description: 'WITHDRAWAL' }),
      row({ account_id: 1, amount: 300, date: '2026-03-06', description: 'DEPOSIT' }),
    ]);
    expect(single.pairs).toHaveLength(0);
    expect(single.possiblePairs[0].confidence).toBeCloseTo(0.55, 2);

    const repeated = classify([
      row({ account_id: 2, amount: -300, date: '2026-03-02', description: 'WITHDRAWAL' }),
      row({ account_id: 1, amount: 300, date: '2026-03-06', description: 'DEPOSIT' }),
      row({ account_id: 2, amount: -300, date: '2026-04-02', description: 'WITHDRAWAL' }),
      row({ account_id: 1, amount: 300, date: '2026-04-06', description: 'DEPOSIT' }),
    ]);
    expect(repeated.pairs).toHaveLength(2);
    expect(repeated.pairs[0].reasons).toContain('these two accounts move money repeatedly');
    expect(repeated.pairs[0].confidence).toBeCloseTo(0.65, 2);
  });

  it('matches each row at most once, preferring the closest date, and marks ambiguity', () => {
    const out = row({ account_id: 1, amount: -200, date: '2026-03-10', description: 'ONLINE TRANSFER' });
    const near = row({ account_id: 2, amount: 200, date: '2026-03-10', description: 'ONLINE TRANSFER' });
    const far = row({ account_id: 2, amount: 200, date: '2026-03-14', description: 'ONLINE TRANSFER' });
    const result = classify([out, near, far]);

    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]).toMatchObject({ outKey: out.key, inKey: near.key });
    expect(result.pairs[0].reasons).toContain('other rows of this amount are nearby');
    expect(byKey(result).has(far.key)).toBe(false);
  });

  it('uses the counterpart account of a transfer rule as strong evidence and keeps the rule as source', () => {
    const rules = [rule({ pattern: 'PYMT BY FUNDS TRANSFER', type: 'transfer', counterpart_account_id: 3 })];
    const out = row({ account_id: 1, amount: -42, date: '2026-03-10', description: 'PYMT BY FUNDS TRANSFER' });
    const inn = row({ account_id: 3, amount: 42, date: '2026-03-15', description: 'CREDIT' });
    const result = classify([out, inn], { rules });

    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0].reasons).toContain('a transfer rule names this account pair');
    const decisions = byKey(result);
    expect(decisions.get(out.key)).toMatchObject({ type: 'transfer', source: 'rule', ruleId: rules[0].id, transferGroupId: 'group-1' });
    expect(decisions.get(inn.key)).toMatchObject({ type: 'transfer', source: 'pair', ruleId: null, transferGroupId: 'group-1' });
  });

  it('lets a locked transfer gain its counterpart but never re-types locked rows', () => {
    const lockedTransfer = row({ account_id: 1, amount: -900, date: '2026-03-01', description: 'MOVE', type: 'transfer', type_locked: true, type_source: 'manual' });
    const deposit = row({ account_id: 2, amount: 900, date: '2026-03-01', description: 'MOVE' });
    const lockedExpense = row({ account_id: 1, amount: -60, date: '2026-03-05', description: 'PAYMENT', type: 'expense', type_locked: true, type_source: 'manual' });
    const credit = row({ account_id: 3, amount: 60, date: '2026-03-05', description: 'PAYMENT' });
    const result = classify([lockedTransfer, deposit, lockedExpense, credit]);

    const decisions = byKey(result);
    expect(result.pairs).toHaveLength(1);
    expect(decisions.get(lockedTransfer.key)).toMatchObject({ type: 'transfer', transferGroupId: 'group-1' });
    expect(decisions.get(deposit.key)).toMatchObject({ type: 'transfer', source: 'pair', transferGroupId: 'group-1' });
    expect(result.pairs[0].reasons).toContain('one leg is already marked as a transfer');
    // The locked expense is untouched and its would-be counterpart is a refund instead.
    expect(decisions.has(lockedExpense.key)).toBe(false);
    expect(decisions.get(credit.key)).toMatchObject({ type: 'refund', source: 'inferred' });
  });

  it('leaves existing pairs alone and re-evaluates an orphaned leg', () => {
    const a = row({ account_id: 1, amount: -100, date: '2026-03-01', description: 'XFER', type: 'transfer', type_source: 'pair', transfer_group_id: 'g1' });
    const b = row({ account_id: 2, amount: 100, date: '2026-03-01', description: 'XFER', type: 'transfer', type_source: 'pair', transfer_group_id: 'g1' });
    const orphan = row({ account_id: 1, amount: -55, date: '2026-03-03', description: 'OLD XFER', type: 'transfer', type_source: 'pair', transfer_group_id: 'gone' });
    const result = classify([a, b, orphan]);

    const decisions = byKey(result);
    expect(decisions.has(a.key)).toBe(false);
    expect(decisions.has(b.key)).toBe(false);
    expect(decisions.get(orphan.key)).toMatchObject({ type: 'expense', source: 'sign', transferGroupId: null });
  });
});

describe('classifyTransactions – rules and refunds', () => {
  it('types rows by the first matching rule and reports nothing for rows that keep their sign default', () => {
    const rules = [
      rule({ pattern: 'ZELLE TO MOM', type: 'expense', priority: 10 }),
      rule({ pattern: 'ZELLE', type: 'transfer', priority: 100 }),
    ];
    const toMom = row({ account_id: 1, amount: -40, date: '2026-03-01', description: 'Zelle to Mom ref 991' });
    const other = row({ account_id: 1, amount: -40, date: '2026-03-02', description: 'ZELLE PAYMENT TO SELF' });
    const groceries = row({ account_id: 1, amount: -80, date: '2026-03-02', description: 'KROGER' });
    const result = classify([toMom, other, groceries], { rules });

    const decisions = byKey(result);
    // Already an expense: the rule confirms it, but the source changes to rule.
    expect(decisions.get(toMom.key)).toMatchObject({ type: 'expense', source: 'rule', ruleId: rules[0].id, confidence: 1 });
    expect(decisions.get(other.key)).toMatchObject({ type: 'transfer', source: 'rule', ruleId: rules[1].id, transferGroupId: null });
    expect(decisions.has(groceries.key)).toBe(false);
  });

  it('infers refunds from an earlier charge by the same merchant, and from any money in on a credit card', () => {
    const charge = row({ account_id: 1, amount: -89.99, date: '2026-02-20', description: 'AMAZON MKTPL*AB12CD' });
    const refund = row({ account_id: 1, amount: 89.99, date: '2026-03-02', description: 'AMAZON MKTPL*ZZ99YY' });
    const cardCredit = row({ account_id: 3, amount: 15, date: '2026-03-02', description: 'STATEMENT CREDIT' });
    const paycheck = row({ account_id: 1, amount: 2500, date: '2026-03-01', description: 'ACME PAYROLL' });
    const result = classify([charge, refund, cardCredit, paycheck]);

    const decisions = byKey(result);
    expect(decisions.get(refund.key)).toMatchObject({ type: 'refund', source: 'inferred', confidence: 0.9 });
    expect(decisions.get(refund.key)?.reasons[0]).toMatch(/same merchant 10 days earlier/);
    expect(decisions.get(cardCredit.key)).toMatchObject({ type: 'refund', source: 'inferred', confidence: 0.65 });
    expect(decisions.has(paycheck.key)).toBe(false);
    expect(decisions.has(charge.key)).toBe(false);
  });

  it('does not treat a smaller earlier charge or a charge too long ago as refund evidence', () => {
    const small = row({ account_id: 1, amount: -10, date: '2026-03-01', description: 'SHOP' });
    const old = row({ account_id: 1, amount: -100, date: '2025-10-01', description: 'SHOP' });
    const moneyIn = row({ account_id: 1, amount: 50, date: '2026-03-05', description: 'SHOP' });
    const result = classify([small, old, moneyIn]);
    expect(byKey(result).has(moneyIn.key)).toBe(false);
  });

  it('reverts an automatic type whose evidence is gone and records the provenance change', () => {
    const stale = row({ account_id: 1, amount: 50, date: '2026-03-05', description: 'SHOP', type: 'refund', type_source: 'inferred' });
    const result = classify([stale]);
    expect(byKey(result).get(stale.key)).toMatchObject({ type: 'income', source: 'sign', confidence: null });
  });
});

describe('classifyTransactions – import mode', () => {
  it('pairs a staged row with a row already in the database and only changes existing rows by pairing', () => {
    const existingOut = row({ account_id: 1, amount: -250, date: '2026-03-10', description: 'PYMT BY FUNDS TRANSFER' });
    const existingCredit = row({ account_id: 3, amount: 30, date: '2026-03-12', description: 'MERCHANT CREDIT' });
    const stagedIn = staged({ account_id: 3, amount: 250, date: '2026-03-11', description: 'PAYMENT THANK YOU' });
    const stagedRefund = staged({ account_id: 3, amount: 12, date: '2026-03-12', description: 'STORE CREDIT' });
    const result = classify([existingOut, existingCredit, stagedIn, stagedRefund], {
      mode: 'import',
      newKeys: new Set([stagedIn.key, stagedRefund.key]),
    });

    const decisions = byKey(result);
    expect(result.pairs).toHaveLength(1);
    expect(decisions.get(existingOut.key)).toMatchObject({ type: 'transfer', source: 'pair' });
    expect(decisions.get(stagedIn.key)).toMatchObject({ type: 'transfer', source: 'pair' });
    // Existing rows are not re-typed by inference during an import...
    expect(decisions.has(existingCredit.key)).toBe(false);
    // ...but staged rows are.
    expect(decisions.get(stagedRefund.key)).toMatchObject({ type: 'refund', source: 'inferred' });
  });

  it('never pairs two existing rows with each other during an import', () => {
    const existingOut = row({ account_id: 1, amount: -70, date: '2026-03-10', description: 'TRANSFER' });
    const existingIn = row({ account_id: 2, amount: 70, date: '2026-03-10', description: 'TRANSFER' });
    const stagedOther = staged({ account_id: 4, amount: -5, date: '2026-03-10', description: 'SNACK' });
    const result = classify([existingOut, existingIn, stagedOther], {
      mode: 'import',
      newKeys: new Set([stagedOther.key]),
    });
    expect(result.pairs).toHaveLength(0);
    expect(result.decisions).toHaveLength(0);
  });

  it('skips a rule-typed existing row as a pairing candidate but pairs an existing transfer rule hit', () => {
    const ruleTypedIncome = row({ account_id: 1, amount: 300, date: '2026-03-10', description: 'BONUS', type: 'income', type_source: 'rule' });
    const stagedOut = staged({ account_id: 2, amount: -300, date: '2026-03-10', description: 'TRANSFER TO CHECKING' });
    const result = classify([ruleTypedIncome, stagedOut], { mode: 'import', newKeys: new Set([stagedOut.key]) });
    expect(result.pairs).toHaveLength(0);
  });
});
