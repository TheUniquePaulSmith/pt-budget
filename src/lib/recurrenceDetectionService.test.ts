import { describe, expect, it } from 'vitest';

import {
  analyzeRecurrence,
  qualifiesAsSeries,
  type RecurrenceInputTransaction,
} from './recurrenceDetectionService';

let nextId = 1;
function txn(date: string, amount: number): RecurrenceInputTransaction {
  return { id: nextId++, date, amount };
}

describe('analyzeRecurrence', () => {
  it('returns null for zero or one occurrence', () => {
    expect(analyzeRecurrence([])).toBeNull();
    expect(analyzeRecurrence([txn('2026-01-15', -15.49)])).toBeNull();
  });

  it('detects a fixed monthly subscription with day-of-month drift', () => {
    // Netflix-style: charge lands on slightly different days each month
    const analysis = analyzeRecurrence([
      txn('2025-09-23', -24.6),
      txn('2025-10-23', -24.6),
      txn('2025-11-23', -24.6),
      txn('2025-12-23', -24.6),
      txn('2026-01-23', -24.6),
      txn('2026-02-22', -26.74),
      txn('2026-03-22', -26.74),
      txn('2026-04-22', -26.74),
    ]);

    expect(analysis).not.toBeNull();
    expect(analysis!.cadence).toBe('monthly');
    expect(analysis!.amountIsVariable).toBe(false);
    // Trailing-6 window straddles the price change: median of 3x24.60 + 3x26.74
    expect(analysis!.expectedAmount).toBeCloseTo(25.67, 2);
    expect(analysis!.lastSeenDate).toBe('2026-04-22');
    // Modal charge day across history is the 23rd
    expect(analysis!.nextExpectedDate).toBe('2026-05-23');
  });

  it('flags a variable monthly bill as variable', () => {
    // Breezeline-style: monthly with changing amounts
    const analysis = analyzeRecurrence([
      txn('2026-01-25', -152.32),
      txn('2026-02-25', -152.32),
      txn('2026-03-25', -152.32),
      txn('2026-04-25', -162.32),
      txn('2026-05-25', -162.32),
      txn('2026-06-25', -195.0),
    ]);

    expect(analysis!.cadence).toBe('monthly');
    expect(analysis!.amountIsVariable).toBe(true);
  });

  it('tolerates a single price hike in an otherwise fixed subscription', () => {
    // Trailing window of 6 sees only the new price after enough occurrences
    const analysis = analyzeRecurrence([
      txn('2025-06-21', -12.83),
      txn('2025-07-21', -13.9),
      txn('2025-08-21', -13.9),
      txn('2025-09-21', -13.9),
      txn('2025-10-21', -13.9),
      txn('2025-11-21', -13.9),
      txn('2025-12-21', -13.9),
      txn('2026-01-21', -13.9),
    ]);

    expect(analysis!.cadence).toBe('monthly');
    expect(analysis!.amountIsVariable).toBe(false);
    expect(analysis!.expectedAmount).toBeCloseTo(13.9, 2);
  });

  it('detects yearly cadence from two occurrences a year apart', () => {
    const analysis = analyzeRecurrence([
      txn('2025-03-14', -139.0),
      txn('2026-03-14', -139.0),
    ]);

    expect(analysis!.cadence).toBe('yearly');
    expect(analysis!.occurrences).toBe(2);
    expect(analysis!.nextExpectedDate).toBe('2027-03-14');
  });

  it('returns irregular for a 40-day gap that fits no bucket', () => {
    const analysis = analyzeRecurrence([
      txn('2026-01-01', -20),
      txn('2026-02-10', -20),
    ]);

    expect(analysis!.cadence).toBe('irregular');
    expect(analysis!.nextExpectedDate).toBeNull();
  });

  it('stays monthly when one month is missed', () => {
    // Gaps: 28, 30, 61, 30 -> median 30, regularity 3/4 = 0.75
    const analysis = analyzeRecurrence([
      txn('2026-01-01', -50),
      txn('2026-01-29', -50),
      txn('2026-02-28', -50),
      txn('2026-04-30', -50),
      txn('2026-05-30', -50),
    ]);

    expect(analysis!.cadence).toBe('monthly');
    expect(analysis!.regularity).toBeCloseTo(0.75, 2);
  });

  it('marks erratic gaps as irregular below the regularity threshold', () => {
    // Gaps: 5, 60, 3, 90 -> nothing near the median consistently
    const analysis = analyzeRecurrence([
      txn('2026-01-01', -10),
      txn('2026-01-06', -10),
      txn('2026-03-07', -10),
      txn('2026-03-10', -10),
      txn('2026-06-08', -10),
    ]);

    expect(analysis!.cadence).toBe('irregular');
  });

  it('collapses same-day charges into one occurrence for cadence math', () => {
    const analysis = analyzeRecurrence([
      txn('2026-01-15', -5),
      txn('2026-01-15', -5),
      txn('2026-02-15', -5),
      txn('2026-03-15', -5),
    ]);

    expect(analysis!.occurrences).toBe(3);
    expect(analysis!.cadence).toBe('monthly');
  });

  it('clamps monthly next-expected dates at month end', () => {
    const analysis = analyzeRecurrence([
      txn('2025-11-30', -30),
      txn('2025-12-31', -30),
      txn('2026-01-31', -30),
    ]);

    expect(analysis!.cadence).toBe('monthly');
    // Modal day 31 clamped to February's 28 days
    expect(analysis!.nextExpectedDate).toBe('2026-02-28');
  });

  it('detects weekly cadence', () => {
    const analysis = analyzeRecurrence([
      txn('2026-01-05', -12),
      txn('2026-01-12', -12),
      txn('2026-01-19', -12),
      txn('2026-01-26', -12),
    ]);

    expect(analysis!.cadence).toBe('weekly');
    expect(analysis!.nextExpectedDate).toBe('2026-02-02');
  });
});

describe('qualifiesAsSeries', () => {
  const regularMonthly = analyzeRecurrence([
    txn('2026-01-15', -15.49),
    txn('2026-02-15', -15.49),
    txn('2026-03-15', -15.49),
  ]);

  it('auto-activates rule-backed groups with 3+ regular occurrences', () => {
    expect(qualifiesAsSeries(regularMonthly, { ruleBacked: true })).toEqual({
      qualifies: true,
      status: 'active',
    });
  });

  it('keeps 2-occurrence rule-backed groups as candidates', () => {
    const twoMonthly = analyzeRecurrence([
      txn('2026-01-15', -15.49),
      txn('2026-02-15', -15.49),
    ]);
    expect(qualifiesAsSeries(twoMonthly, { ruleBacked: true })).toEqual({
      qualifies: true,
      status: 'candidate',
    });
  });

  it('stages heuristic groups as candidates, never active', () => {
    expect(qualifiesAsSeries(regularMonthly, { ruleBacked: false })).toEqual({
      qualifies: true,
      status: 'candidate',
    });
  });

  it('rejects variable-amount heuristic groups', () => {
    const variable = analyzeRecurrence([
      txn('2026-01-15', -100),
      txn('2026-02-15', -150),
      txn('2026-03-15', -220),
    ]);
    expect(qualifiesAsSeries(variable, { ruleBacked: false }).qualifies).toBe(false);
  });

  it('accepts 2-occurrence yearly heuristic groups (annual subscriptions)', () => {
    const yearly = analyzeRecurrence([
      txn('2025-03-14', -139),
      txn('2026-03-14', -139),
    ]);
    expect(qualifiesAsSeries(yearly, { ruleBacked: false })).toEqual({
      qualifies: true,
      status: 'candidate',
    });
  });

  it('rejects 2-occurrence non-yearly heuristic groups', () => {
    const twoMonthly = analyzeRecurrence([
      txn('2026-01-15', -15.49),
      txn('2026-02-15', -15.49),
    ]);
    expect(qualifiesAsSeries(twoMonthly, { ruleBacked: false }).qualifies).toBe(false);
  });

  it('rejects null analyses', () => {
    expect(qualifiesAsSeries(null, { ruleBacked: true }).qualifies).toBe(false);
  });
});
