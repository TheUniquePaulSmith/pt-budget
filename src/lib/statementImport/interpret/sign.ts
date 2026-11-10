/**
 * Which way a single amount column points: are negative cells money out
 * (`asIs`), or does the bank print charges as positive numbers (`inverted`)?
 *
 * Evidence, strongest first:
 *   1. a running balance: only one reading makes it add up;
 *   2. what the rows say ("PAYROLL", "REFUND", "PURCHASE") against their sign;
 *   3. the share of negative values: most rows of a checking or card
 *      statement are spending;
 *   4. the account type (a card file with only positive numbers lists charges).
 *
 * A separate debit / credit pair or a DR / CR indicator leaves no question,
 * so the callers skip this for those layouts.
 */

import type { AccountType } from '@/types/database';

import type { AmountSign, Assumption } from '../types';

import { checkBalance, reconciles } from './balance';
import { foldText } from './text';
import { directionOfDescription } from './vocabulary';

/** At or above this the sign is not reported as `signAssumed`. */
export const SIGN_CERTAIN = 0.9;

/** Enough rows to judge the wording by; keeps a 20,000-row file fast. */
const KEYWORD_SAMPLE_ROWS = 5000;

/** "Payment" is money in on a card or loan account (and money out everywhere else). */
const PAYMENT_WORD_RE = /\bpayment\b|\bpago\b|paiement|zahlung|pagamento|还款|返済|상환/;

export interface SignInput {
  /** Amounts exactly as printed (no sign flip), one per row; null where unreadable or left out. */
  amounts: Array<number | null>;
  /** The amount cells as text, for the worded example. */
  printed: string[];
  descriptions: string[];
  /** Running balance per row, when the file has one. */
  balances?: Array<number | null>;
  /** `yyyy-MM-dd` per row: tells whether the file is oldest or newest first. */
  dates?: Array<string | null>;
  accountType?: AccountType | null;
}

export interface SignInference {
  sign: AmountSign;
  confidence: number;
  assumption: Assumption;
}

interface Weighed {
  sign: AmountSign;
  confidence: number;
  code: string;
  params?: Record<string, string | number>;
  /** The wording of the rows took a side. */
  byKeywords: boolean;
}

function shorten(text: string, max = 48): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function weighRows({ amounts, printed, descriptions, accountType }: SignInput): Weighed {
  let negative = 0;
  let positive = 0;
  let asPrintedVotes = 0;
  let flippedVotes = 0;
  let asPrintedExample: number | null = null;
  let flippedExample: number | null = null;
  const paysIn = accountType === 'credit' || accountType === 'loan';

  for (let index = 0; index < amounts.length; index += 1) {
    const amount = amounts[index];
    if (amount === null || amount === 0) continue;
    if (amount < 0) negative += 1;
    else positive += 1;

    if (index >= KEYWORD_SAMPLE_ROWS) continue;
    const description = descriptions[index];
    let direction = directionOfDescription(description);
    if (direction === null && paysIn && PAYMENT_WORD_RE.test(foldText(description))) direction = 'in';
    if (direction === null) continue;
    if ((direction === 'in') === amount > 0) {
      asPrintedVotes += 1;
      asPrintedExample ??= index;
    } else {
      flippedVotes += 1;
      flippedExample ??= index;
    }
  }

  const total = negative + positive;
  const keywordVotes = asPrintedVotes + flippedVotes;
  const keywordSign: AmountSign | null =
    keywordVotes > 0 && Math.max(asPrintedVotes, flippedVotes) >= keywordVotes * 0.8
      ? asPrintedVotes > flippedVotes
        ? 'asIs'
        : 'inverted'
      : null;
  const keywordResult = (sign: AmountSign, confidence: number): Weighed => {
    const example = (sign === 'asIs' ? asPrintedExample : flippedExample) as number;
    return {
      sign,
      confidence,
      code: sign === 'asIs' ? 'signAsPrintedByKeywords' : 'signFlippedByKeywords',
      params: { description: shorten(descriptions[example]), amount: printed[example].trim() },
      byKeywords: true,
    };
  };

  // What the signs alone suggest.
  const spendingAccount = accountType == null || accountType === 'checking' || accountType === 'credit';
  let share: Weighed;
  if (total === 0) {
    share = { sign: 'asIs', confidence: 0.5, code: 'signAsPrintedDefault', byKeywords: false };
  } else if (negative > 0 && positive > 0) {
    const negativeShare = negative / total;
    if (!spendingAccount) {
      // Savings, loan and investment files are not mostly spending, so the split says little.
      share = { sign: 'asIs', confidence: 0.8, code: 'signAsPrintedDefault', byKeywords: false };
    } else if (negativeShare >= 0.5) {
      // Files that print a minus at all nearly always mean money out by it, so
      // three negative rows in four is already as good as certain.
      share = {
        sign: 'asIs',
        confidence: Math.min(0.95, 0.8 + 0.2 * (negativeShare - 0.5) * 2),
        code: 'signAsPrintedByShare',
        params: { percent: Math.round(negativeShare * 100) },
        byKeywords: false,
      };
    } else {
      share = {
        sign: 'inverted',
        confidence: 0.65 + 0.2 * (0.5 - negativeShare) * 2 + (accountType === 'credit' ? 0.05 : 0),
        code: 'signFlippedByShare',
        params: { percent: Math.round((1 - negativeShare) * 100) },
        byKeywords: false,
      };
    }
  } else if (negative === total) {
    share = {
      sign: 'asIs',
      confidence: spendingAccount ? 0.9 : 0.75,
      code: 'signAsPrintedByShare',
      params: { percent: 100 },
      byKeywords: false,
    };
  } else if (accountType === 'credit') {
    share = { sign: 'inverted', confidence: 0.8, code: 'signFlippedForCard', byKeywords: false };
  } else {
    // Only positive numbers and nothing to say what they are.
    share = { sign: 'asIs', confidence: spendingAccount ? 0.5 : 0.75, code: 'signAsPrintedDefault', byKeywords: false };
  }

  if (keywordSign === null) return share;
  if (keywordSign === share.sign) {
    // Several worded rows that agree with the signs settle it.
    const confidence = Math.min(0.97, share.confidence + (keywordVotes >= 3 ? 0.15 : 0.1));
    return keywordVotes >= 2 ? keywordResult(keywordSign, confidence) : { ...share, confidence };
  }
  // The wording and the signs disagree: several worded rows outweigh a head count.
  if (keywordVotes >= 2) return keywordResult(keywordSign, 0.7);
  return { ...share, confidence: Math.max(0.4, share.confidence - 0.2) };
}

export function inferAmountSign(input: SignInput): SignInference {
  const rows = weighRows(input);
  const toInference = (weighed: Weighed): SignInference => {
    // Two decimals: the thresholds (0.9 = certain, 0.6 = ask) must not hinge on floating-point dust.
    const confidence = Math.round(weighed.confidence * 100) / 100;
    return {
      sign: weighed.sign,
      confidence,
      assumption: {
        subject: 'amountSign',
        code: weighed.code,
        basis: weighed.code === 'signAsPrintedDefault' ? 'default' : 'file',
        confidence,
        ...(weighed.params ? { params: weighed.params } : {}),
      },
    };
  };

  const balance = input.balances ? checkBalance(input.amounts, input.balances, input.dates) : null;
  if (!input.balances || !reconciles(balance)) return toInference(rows);

  // A card or loan statement usually prints what is owed as a positive balance.
  let owedBalances = 0;
  let heldBalances = 0;
  for (const value of input.balances) {
    if (value === null || value === 0) continue;
    if (value > 0) owedBalances += 1;
    else heldBalances += 1;
  }
  const { accountType } = input;
  const balanceIsDebt = (accountType === 'credit' || accountType === 'loan') && owedBalances >= heldBalances;
  const movesWithAmounts = (balance as { orientation: 1 | -1 }).orientation === 1;
  const sign: AmountSign = movesWithAmounts !== balanceIsDebt ? 'asIs' : 'inverted';
  const byBalance = (confidence: number): SignInference =>
    toInference({
      sign,
      confidence,
      code: sign === 'asIs' ? 'signAsPrintedByBalance' : 'signFlippedByBalance',
      byKeywords: false,
    });

  if (accountType != null) return byBalance(0.97);
  // Without the account type the balance could be money held or money owed.
  if (rows.sign === sign) return byBalance(0.95);
  if (rows.byKeywords) return toInference({ ...rows, confidence: Math.min(rows.confidence, 0.8) });
  return byBalance(0.7);
}
