/**
 * Recurrence Detection Service
 *
 * Pure functions (no database access) that infer cadence, amount stability,
 * and the next expected date for a group of transactions believed to belong
 * to one recurring charge (subscription or bill).
 */

import type { RecurringSeriesCadence } from '../types/database';

export interface RecurrenceInputTransaction {
  id: number;
  date: string; // YYYY-MM-DD
  amount: number;
}

export interface RecurrenceAnalysis {
  cadence: RecurringSeriesCadence;
  occurrences: number; // unique charge dates
  medianGapDays: number;
  regularity: number; // fraction of gaps within ±25% of the median gap
  expectedAmount: number; // median |amount| over the trailing window
  amountIsVariable: boolean;
  lastSeenDate: string;
  nextExpectedDate: string | null;
}

// Share of gaps that must sit within ±25% of the median gap for the
// cadence to count as regular.
const REGULARITY_THRESHOLD = 0.7;
const GAP_TOLERANCE = 0.25;

// Trailing occurrences used for amount stability, so a single price hike in
// an otherwise fixed subscription does not flag it as variable.
const AMOUNT_WINDOW = 6;
const AMOUNT_VARIABILITY_THRESHOLD = 0.15;

const CADENCE_BUCKETS: Array<{ cadence: RecurringSeriesCadence; min: number; max: number }> = [
  { cadence: 'weekly', min: 6, max: 8 },
  { cadence: 'biweekly', min: 12, max: 16 },
  { cadence: 'monthly', min: 27, max: 34 },
  { cadence: 'quarterly', min: 80, max: 100 },
  { cadence: 'yearly', min: 350, max: 380 },
];

function parseDateUtc(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, (month || 1) - 1, day || 1);
}

function formatDateUtc(utcMs: number): string {
  const date = new Date(utcMs);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mode(values: number[]): number {
  const counts = new Map<number, number>();
  let best = values[0];
  let bestCount = 0;
  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function cadenceForGap(medianGapDays: number): RecurringSeriesCadence {
  for (const bucket of CADENCE_BUCKETS) {
    if (medianGapDays >= bucket.min && medianGapDays <= bucket.max) return bucket.cadence;
  }
  return 'irregular';
}

// Adds one month in UTC targeting a specific day-of-month, clamped to the
// target month's length (so a Jan 31 subscription lands on Feb 28/29).
function addOneMonthUtc(utcMs: number, targetDayOfMonth: number): number {
  const date = new Date(utcMs);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1; // move to next month
  const daysInTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(targetDayOfMonth, daysInTargetMonth);
  return Date.UTC(year, month, day);
}

/**
 * Analyzes a group of transactions for recurrence. Returns null when there
 * are fewer than 2 unique charge dates (no gaps to measure). Same-day
 * charges collapse to one occurrence for cadence math; all amounts still
 * feed the amount analysis.
 */
export function analyzeRecurrence(
  transactions: RecurrenceInputTransaction[]
): RecurrenceAnalysis | null {
  if (!transactions || transactions.length === 0) return null;

  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));

  const uniqueDates: string[] = [];
  for (const txn of sorted) {
    if (uniqueDates[uniqueDates.length - 1] !== txn.date) uniqueDates.push(txn.date);
  }
  if (uniqueDates.length < 2) return null;

  const dateMs = uniqueDates.map(parseDateUtc);
  const gaps: number[] = [];
  for (let i = 1; i < dateMs.length; i++) {
    gaps.push(Math.round((dateMs[i] - dateMs[i - 1]) / 86400000));
  }

  const medianGapDays = median(gaps);
  const tolerance = medianGapDays * GAP_TOLERANCE;
  const regularGaps = gaps.filter((gap) => Math.abs(gap - medianGapDays) <= tolerance).length;
  const regularity = regularGaps / gaps.length;

  const cadence: RecurringSeriesCadence =
    regularity >= REGULARITY_THRESHOLD ? cadenceForGap(medianGapDays) : 'irregular';

  // Amount stability over the trailing window (absolute values)
  const amounts = sorted.map((txn) => Math.abs(txn.amount));
  const windowAmounts = amounts.slice(-AMOUNT_WINDOW);
  const expectedAmount = median(windowAmounts);
  const spread = Math.max(...windowAmounts) - Math.min(...windowAmounts);
  const amountIsVariable =
    expectedAmount > 0 ? spread / expectedAmount > AMOUNT_VARIABILITY_THRESHOLD : false;

  const lastSeenMs = dateMs[dateMs.length - 1];
  const lastSeenDate = uniqueDates[uniqueDates.length - 1];

  let nextExpectedDate: string | null = null;
  if (cadence === 'monthly') {
    const modalDay = mode(dateMs.map((ms) => new Date(ms).getUTCDate()));
    nextExpectedDate = formatDateUtc(addOneMonthUtc(lastSeenMs, modalDay));
  } else if (cadence !== 'irregular') {
    nextExpectedDate = formatDateUtc(lastSeenMs + Math.round(medianGapDays) * 86400000);
  }

  return {
    cadence,
    occurrences: uniqueDates.length,
    medianGapDays,
    regularity,
    expectedAmount,
    amountIsVariable,
    lastSeenDate,
    nextExpectedDate,
  };
}

/**
 * Decides whether a detected group qualifies for a series and at what status.
 * Rule-backed subscription/bill groups auto-activate with enough regular
 * occurrences; everything else that qualifies becomes a reviewable candidate.
 * The one 2-occurrence path is a yearly-looking gap (annual subscriptions).
 */
export function qualifiesAsSeries(
  analysis: RecurrenceAnalysis | null,
  options: { ruleBacked: boolean }
): { qualifies: boolean; status: 'active' | 'candidate' } {
  if (!analysis) return { qualifies: false, status: 'candidate' };

  const { occurrences, cadence, amountIsVariable } = analysis;

  if (options.ruleBacked) {
    if (occurrences >= 3 && cadence !== 'irregular') {
      return { qualifies: true, status: 'active' };
    }
    // Rule says this is recurring; keep low-evidence groups as candidates
    return { qualifies: occurrences >= 2, status: 'candidate' };
  }

  // Heuristic (unmatched-description) groups need stronger evidence
  if (occurrences >= 3 && cadence !== 'irregular' && !amountIsVariable) {
    return { qualifies: true, status: 'candidate' };
  }
  if (occurrences === 2 && cadence === 'yearly') {
    return { qualifies: true, status: 'candidate' };
  }
  return { qualifies: false, status: 'candidate' };
}
