/**
 * Transaction Classifier
 *
 * Pure functions (no database access) that decide what a money movement
 * means — income, expense, refund or transfer — from three kinds of evidence,
 * in this order of authority:
 *
 *   1. classification_rules: the household's own description patterns
 *      ("PYMT BY FUNDS TRANSFER" → transfer). Deterministic, confidence 1.
 *   2. transfer pairing: a money-out row in one account and a money-in row of
 *      the same amount in another account, a few days apart, are the two legs
 *      of one transfer. Scored 0..1 from the date gap, transfer wording, the
 *      account types involved, rule hints and how often the same account pair
 *      repeats; pairs at or above the threshold are applied, the rest reported.
 *   3. refund inference: money back from a merchant that was charged earlier,
 *      or any money arriving on a credit card (cards do not receive earnings).
 *
 * Anything else keeps the sign default (negative = expense, positive = income).
 * Rows the user typed by hand (type_locked) are never changed; a locked
 * transfer may still be paired so it gains its counterpart.
 */

import type { ClassificationRule, TransactionType } from '../types/database';
import type {
  ClassifiableTransaction,
  ClassifyOptions,
  ClassifyResult,
  TransferPairSuggestion,
  TypeDecision,
} from '../types/classification';
import { normalizeDescription } from './merchantMatchingService';

export const DEFAULT_TRANSFER_WINDOW_DAYS = 7;
export const DEFAULT_MIN_PAIR_CONFIDENCE = 0.6;
/** A refund is matched to a charge from the same merchant up to this many days earlier. */
export const REFUND_LOOKBACK_DAYS = 90;

// Wording banks use for movements between the household's own accounts and
// for card payments. Only a hint: it raises the confidence of an amount match
// across two of the user's accounts, it never types a row on its own.
const TRANSFER_HINT_RE =
  /\b(?:TRANSFER|XFER|TRNSFR|TRANSF|PAYMENT|PYMT|PMT|AUTOPAY|AUTO ?PAY|THANK YOU|FUNDS|ACH|EPAY|E-?PAYMENT|BILL ?PAY|CARDMEMBER|CRCARDPMT|ONLINE PMT)\b/i;

// Below this, two unrelated rows of the same amount on the same day are a
// common coincidence (coffee here, coffee there), so an amount match without
// transfer wording counts for less.
const SMALL_AMOUNT_LIMIT = 20;

const DEPOSITORY_TYPES = new Set(['checking', 'savings']);
const BORROWING_TYPES = new Set(['credit', 'loan']);

/** The type the amount sign implies when nothing else is known. */
export function signDefaultType(amount: number): TransactionType {
  return amount > 0 ? 'income' : 'expense';
}

/** Whether `type` is compatible with a signed amount (mirrors DatabaseService.assertTypeMatchesSign). */
export function typeAllowsSign(type: TransactionType, amount: number): boolean {
  if (type === 'expense') return !(amount > 0);
  if (type === 'income' || type === 'refund') return !(amount < 0);
  return true;
}

export function descriptionHintsTransfer(description: string): boolean {
  return TRANSFER_HINT_RE.test(description);
}

/** Lowest priority first, then longest (most specific) pattern, then rule_key. */
export function sortClassificationRules(rules: ClassificationRule[]): ClassificationRule[] {
  return [...rules].sort(
    (a, b) => a.priority - b.priority || b.pattern.length - a.pattern.length || a.rule_key.localeCompare(b.rule_key)
  );
}

function patternMatches(normalized: string, rule: Pick<ClassificationRule, 'pattern' | 'match_type'>): boolean {
  switch (rule.match_type) {
    case 'exact':
      return normalized === rule.pattern;
    case 'prefix':
      return normalized.startsWith(rule.pattern);
    case 'contains':
      return normalized.includes(rule.pattern);
    default:
      return false;
  }
}

/**
 * First enabled rule that applies to the row: pattern matches the normalized
 * description, the rule is unscoped or scoped to the row's account, and the
 * rule's type is compatible with the amount sign. Rules must be sorted.
 */
export function matchClassificationRule(
  row: Pick<ClassifiableTransaction, 'account_id' | 'amount'>,
  normalizedDescription: string,
  sortedRules: ClassificationRule[]
): ClassificationRule | null {
  if (!normalizedDescription) return null;
  for (const rule of sortedRules) {
    if (!rule.enabled) continue;
    if (rule.account_id != null && rule.account_id !== row.account_id) continue;
    if (!typeAllowsSign(rule.type, row.amount)) continue;
    if (patternMatches(normalizedDescription, rule)) return rule;
  }
  return null;
}

/** Dry-run helper for the rule editor: how many rows one rule would type (no precedence). */
export function countClassificationRuleMatches(
  rule: Pick<ClassificationRule, 'pattern' | 'match_type' | 'type'> & { account_id?: number | null },
  rows: Array<Pick<ClassifiableTransaction, 'account_id' | 'amount' | 'description'>>
): number {
  const probe = {
    ...rule,
    account_id: rule.account_id ?? null,
    enabled: 1,
    priority: 0,
    rule_key: 'preview',
  } as ClassificationRule;
  let count = 0;
  for (const row of rows) {
    if (matchClassificationRule(row, normalizeDescription(row.description), [probe])) count++;
  }
  return count;
}

function parseDateUtc(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, (month || 1) - 1, day || 1);
}

/** Whole days between two YYYY-MM-DD dates (b - a). */
export function dayGap(a: string, b: string): number {
  return Math.round((parseDateUtc(b) - parseDateUtc(a)) / 86_400_000);
}

const cents = (amount: number) => Math.round(Math.abs(amount) * 100);

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp01(value: number): number {
  return round2(Math.max(0, Math.min(1, value)));
}

interface Leg {
  row: ClassifiableTransaction;
  hint: boolean;
  /** A locked transfer: may gain a counterpart but never changes type. */
  fixedTransfer: boolean;
  /** counterpart_account_id of the transfer rule that matched this row, if any. */
  ruleCounterpart: number | null;
  ruleId: number | null;
}

interface ScoredPair {
  out: Leg;
  in: Leg;
  gap: number;
  score: number;
  reasons: string[];
}

function gapScore(gap: number): { score: number; reason: string } {
  if (gap === 0) return { score: 0.25, reason: 'same day' };
  if (gap === 1) return { score: 0.2, reason: '1 day apart' };
  if (gap <= 3) return { score: 0.12, reason: `${gap} days apart` };
  if (gap <= 5) return { score: 0.05, reason: `${gap} days apart` };
  return { score: 0, reason: `${gap} days apart` };
}

function scorePair(out: Leg, inn: Leg, gap: number, ambiguous: boolean): ScoredPair {
  const reasons: string[] = ['same amount, opposite direction, different accounts'];
  let score = 0.45;

  const byGap = gapScore(gap);
  score += byGap.score;
  reasons.push(byGap.reason);

  if (out.hint && inn.hint) {
    score += 0.25;
    reasons.push('both descriptions mention a transfer or payment');
  } else if (out.hint || inn.hint) {
    score += 0.2;
    reasons.push('description mentions a transfer or payment');
  }

  const outType = out.row.account_type;
  const inType = inn.row.account_type;
  if (DEPOSITORY_TYPES.has(outType) && BORROWING_TYPES.has(inType)) {
    score += 0.1;
    reasons.push(`${outType} paying a ${inType} account`);
  } else if (DEPOSITORY_TYPES.has(outType) && DEPOSITORY_TYPES.has(inType)) {
    score += 0.05;
    reasons.push(`${outType} to ${inType}`);
  } else if (BORROWING_TYPES.has(outType)) {
    score -= 0.1;
    reasons.push(`money leaving a ${outType} account is rarely a transfer`);
  }

  if (out.ruleCounterpart === inn.row.account_id || inn.ruleCounterpart === out.row.account_id) {
    score += 0.25;
    reasons.push('a transfer rule names this account pair');
  } else if (out.fixedTransfer || inn.fixedTransfer) {
    score += 0.1;
    reasons.push('one leg is already marked as a transfer');
  }

  if (cents(out.row.amount) < SMALL_AMOUNT_LIMIT * 100 && !out.hint && !inn.hint) {
    score -= 0.2;
    reasons.push('small amount without transfer wording');
  }

  if (ambiguous) {
    score -= 0.1;
    reasons.push('other rows of this amount are nearby');
  }

  return { out, in: inn, gap, score, reasons };
}

function toSuggestion(pair: ScoredPair): TransferPairSuggestion {
  return {
    outKey: pair.out.row.key,
    inKey: pair.in.row.key,
    confidence: clamp01(pair.score),
    dateGapDays: pair.gap,
    reasons: pair.reasons,
  };
}

/**
 * Finds the two legs of each transfer among `legs`: same amount, opposite
 * direction, different accounts, within `windowDays`. Each row joins at most
 * one pair (best score first). Returns accepted and below-threshold pairs.
 */
function pairTransfers(
  legs: Leg[],
  options: { windowDays: number; minConfidence: number; mustIncludeKeys: ReadonlySet<string> | null }
): { accepted: ScoredPair[]; possible: ScoredPair[] } {
  const buckets = new Map<number, { outs: Leg[]; ins: Leg[] }>();
  for (const leg of legs) {
    const amount = leg.row.amount;
    if (!amount) continue;
    const bucket = buckets.get(cents(amount)) ?? { outs: [], ins: [] };
    (amount < 0 ? bucket.outs : bucket.ins).push(leg);
    buckets.set(cents(amount), bucket);
  }

  const candidates: Array<{ out: Leg; in: Leg; gap: number }> = [];
  const partnerCount = new Map<string, number>();
  for (const { outs, ins } of buckets.values()) {
    if (outs.length === 0 || ins.length === 0) continue;
    for (const out of outs) {
      for (const inn of ins) {
        if (out.row.account_id === inn.row.account_id) continue;
        if (
          options.mustIncludeKeys &&
          !options.mustIncludeKeys.has(out.row.key) &&
          !options.mustIncludeKeys.has(inn.row.key)
        ) {
          continue;
        }
        const gap = Math.abs(dayGap(out.row.date, inn.row.date));
        if (gap > options.windowDays) continue;
        candidates.push({ out, in: inn, gap });
        partnerCount.set(out.row.key, (partnerCount.get(out.row.key) ?? 0) + 1);
        partnerCount.set(inn.row.key, (partnerCount.get(inn.row.key) ?? 0) + 1);
      }
    }
  }

  const scored = candidates.map(({ out, in: inn, gap }) =>
    scorePair(out, inn, gap, (partnerCount.get(out.row.key) ?? 0) > 1 || (partnerCount.get(inn.row.key) ?? 0) > 1)
  );

  // Recurrence: the same two accounts moving money repeatedly (a weekly card
  // payment) is itself evidence, so every pair of a repeating account pair
  // scores a little higher.
  const accountPairCount = new Map<string, number>();
  for (const pair of scored) {
    const key = `${pair.out.row.account_id}>${pair.in.row.account_id}`;
    accountPairCount.set(key, (accountPairCount.get(key) ?? 0) + 1);
  }
  for (const pair of scored) {
    if ((accountPairCount.get(`${pair.out.row.account_id}>${pair.in.row.account_id}`) ?? 0) >= 2) {
      pair.score += 0.1;
      pair.reasons.push('these two accounts move money repeatedly');
    }
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.gap - b.gap ||
      a.out.row.key.localeCompare(b.out.row.key) ||
      a.in.row.key.localeCompare(b.in.row.key)
  );

  const used = new Set<string>();
  const accepted: ScoredPair[] = [];
  const possible: ScoredPair[] = [];
  for (const pair of scored) {
    if (used.has(pair.out.row.key) || used.has(pair.in.row.key)) continue;
    used.add(pair.out.row.key);
    used.add(pair.in.row.key);
    // Below the threshold the best remaining possibility per row is still
    // reported once, so the import can offer it unchecked.
    (pair.score >= options.minConfidence ? accepted : possible).push(pair);
  }
  return { accepted, possible };
}

interface RefundEvidence {
  confidence: number;
  reason: string;
}

/**
 * Money in that nets against earlier spending: the same merchant charged this
 * account a matching or larger amount within the look-back window; or, on a
 * credit card, any money in (cards receive refunds and credits, not earnings).
 */
export function inferRefund(
  row: ClassifiableTransaction,
  normalized: string,
  chargesByAccountMerchant: Map<string, ClassifiableTransaction[]>
): RefundEvidence | null {
  if (!(row.amount > 0)) return null;
  const charges = normalized ? (chargesByAccountMerchant.get(`${row.account_id}|${normalized}`) ?? []) : [];
  const refundCents = cents(row.amount);
  for (const charge of charges) {
    const gap = dayGap(charge.date, row.date);
    if (gap < 0 || gap > REFUND_LOOKBACK_DAYS) continue;
    if (cents(charge.amount) >= refundCents) {
      const when = gap === 0 ? 'the same day' : `${gap} day${gap === 1 ? '' : 's'} earlier`;
      return { confidence: 0.9, reason: `matches a charge from the same merchant ${when}` };
    }
  }
  if (row.account_type === 'credit') {
    return {
      confidence: 0.65,
      reason: 'money arriving on a credit card is a refund or statement credit, not earnings',
    };
  }
  return null;
}

/**
 * Classifies `rows` (see ClassifyOptions for the two modes) and returns the
 * decisions that differ from what the rows carry now.
 */
export function classifyTransactions(options: ClassifyOptions): ClassifyResult {
  const windowDays = options.windowDays ?? DEFAULT_TRANSFER_WINDOW_DAYS;
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_PAIR_CONFIDENCE;
  const newKeys = options.newKeys ?? new Set<string>();
  const isNew = (row: ClassifiableTransaction) => options.mode === 'scan' || newKeys.has(row.key);
  const rules = sortClassificationRules(options.rules.filter((rule) => rule.enabled));

  const normalizedByKey = new Map<string, string>();
  for (const row of options.rows) normalizedByKey.set(row.key, normalizeDescription(row.description));

  // Grouped rows keep their pairing unless the counterpart is gone (scan mode
  // re-evaluates the orphan; import mode leaves existing rows as they are).
  const groupMembers = new Map<string, number>();
  for (const row of options.rows) {
    if (row.transfer_group_id) {
      groupMembers.set(row.transfer_group_id, (groupMembers.get(row.transfer_group_id) ?? 0) + 1);
    }
  }
  const keepsGroup = (row: ClassifiableTransaction) =>
    row.transfer_group_id != null &&
    (row.type_locked || options.mode === 'import' || (groupMembers.get(row.transfer_group_id) ?? 0) >= 2);

  // 1. Rules — evaluated for every unlocked, ungrouped row in scan mode and for
  // the staged rows in import mode.
  const ruleHits = new Map<string, ClassificationRule>();
  for (const row of options.rows) {
    if (row.type_locked || keepsGroup(row) || !isNew(row)) continue;
    const rule = matchClassificationRule(row, normalizedByKey.get(row.key) ?? '', rules);
    if (rule) ruleHits.set(row.key, rule);
  }

  // 2. Pairing — candidates are rows that may be (or already are) transfers.
  const legs: Leg[] = [];
  for (const row of options.rows) {
    if (keepsGroup(row)) continue;
    const rule = ruleHits.get(row.key);
    if (rule && rule.type !== 'transfer') continue;
    if (row.type_locked && row.type !== 'transfer') continue;
    // An existing row the import did not stage keeps a rule-decided type.
    if (!isNew(row) && !row.type_locked && row.type_source === 'rule' && row.type !== 'transfer') continue;
    legs.push({
      row,
      hint: descriptionHintsTransfer(row.description),
      fixedTransfer: row.type_locked && row.type === 'transfer',
      ruleCounterpart: rule?.counterpart_account_id ?? null,
      ruleId: rule?.id ?? null,
    });
  }
  const pairing = pairTransfers(legs, {
    windowDays,
    minConfidence,
    mustIncludeKeys: options.mode === 'import' ? newKeys : null,
  });
  const pairedKeys = new Map<string, { pair: ScoredPair; groupId: string }>();
  const pairs: TransferPairSuggestion[] = [];
  for (const pair of pairing.accepted) {
    const groupId = pair.out.row.transfer_group_id ?? pair.in.row.transfer_group_id ?? options.newGroupId();
    pairedKeys.set(pair.out.row.key, { pair, groupId });
    pairedKeys.set(pair.in.row.key, { pair, groupId });
    pairs.push(toSuggestion(pair));
  }

  // 3. Refund inference — charges indexed by account + merchant.
  const chargesByAccountMerchant = new Map<string, ClassifiableTransaction[]>();
  for (const row of options.rows) {
    if (!(row.amount < 0)) continue;
    const normalized = normalizedByKey.get(row.key);
    if (!normalized) continue;
    const key = `${row.account_id}|${normalized}`;
    const list = chargesByAccountMerchant.get(key) ?? [];
    list.push(row);
    chargesByAccountMerchant.set(key, list);
  }

  // 4. Decide every evaluable row and emit what changed.
  const decisions: TypeDecision[] = [];
  for (const row of options.rows) {
    if (row.type_locked && !pairedKeys.has(row.key)) continue;
    if (keepsGroup(row)) continue;

    const paired = pairedKeys.get(row.key);
    let decision: TypeDecision;
    if (paired) {
      const isOut = paired.pair.out.row.key === row.key;
      const leg = isOut ? paired.pair.out : paired.pair.in;
      const other = isOut ? paired.pair.in.row : paired.pair.out.row;
      decision = {
        key: row.key,
        type: 'transfer',
        source: leg.ruleId != null ? 'rule' : 'pair',
        confidence: clamp01(paired.pair.score),
        transferGroupId: paired.groupId,
        ruleId: leg.ruleId,
        pairedWithKey: other.key,
        reasons: paired.pair.reasons,
      };
    } else if (!isNew(row)) {
      continue; // import mode: existing rows only change by pairing
    } else if (ruleHits.has(row.key)) {
      const rule = ruleHits.get(row.key)!;
      decision = {
        key: row.key,
        type: rule.type,
        source: 'rule',
        confidence: 1,
        transferGroupId: null,
        ruleId: rule.id,
        pairedWithKey: null,
        reasons: [`matches your rule "${rule.pattern}"`],
      };
    } else {
      const refund = inferRefund(row, normalizedByKey.get(row.key) ?? '', chargesByAccountMerchant);
      decision = refund
        ? {
            key: row.key,
            type: 'refund',
            source: 'inferred',
            confidence: refund.confidence,
            transferGroupId: null,
            ruleId: null,
            pairedWithKey: null,
            reasons: [refund.reason],
          }
        : {
            key: row.key,
            type: signDefaultType(row.amount),
            source: 'sign',
            confidence: null,
            transferGroupId: null,
            ruleId: null,
            pairedWithKey: null,
            reasons: [],
          };
    }

    const unchanged =
      decision.type === row.type &&
      decision.source === row.type_source &&
      (decision.transferGroupId ?? null) === (row.transfer_group_id ?? null);
    if (!unchanged) decisions.push(decision);
  }

  return { decisions, pairs, possiblePairs: pairing.possible.map(toSuggestion) };
}
