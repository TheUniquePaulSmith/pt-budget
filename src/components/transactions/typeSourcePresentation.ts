/**
 * Labels for how a transaction's type was decided (schema v4).
 *
 * The text lives in the `transactions` namespace. Callers inside React pass
 * `useTranslation('transactions').t`; non-hook callers (column factories) can
 * omit it and get the global instance's current language.
 */

import type { TFunction } from 'i18next';

import { i18n } from '@/lib/i18n';
import type { Transaction } from '@/types/database';

/** `useTranslation(['transactions', 'common']).t` (the type labels come from `common`). */
export type TransactionsTranslate = TFunction<['transactions', 'common']>;

function defaultTranslate(): TransactionsTranslate {
  return i18n.getFixedT(null, ['transactions', 'common']);
}

/** True when the type was decided automatically and the user has not confirmed it. */
export function needsTypeReview(transaction: Pick<Transaction, 'type_locked' | 'type_source'>): boolean {
  const source = transaction.type_source ?? 'sign';
  return !transaction.type_locked && source !== 'sign' && source !== 'manual';
}

export function formatConfidence(
  confidence: number | null | undefined,
  t: TransactionsTranslate = defaultTranslate()
): string {
  if (confidence == null) return '';
  return t('typeDecision.confidence', { percent: Math.round(confidence * 100) });
}

/** "Transfer — decided by matching the other leg (87% confidence); confirm from the row menu" */
export function describeTypeDecision(transaction: Transaction, t: TransactionsTranslate = defaultTranslate()): string {
  const source = transaction.type_source ?? 'sign';
  const type = t(`common:transactionType.${transaction.type}`);
  const decidedBy = t(`typeDecision.source.${source}`);
  const confidence = formatConfidence(transaction.type_confidence, t);
  const parts = [
    confidence
      ? t('typeDecision.decidedWithConfidence', { type, source: decidedBy, confidence })
      : t('typeDecision.decided', { type, source: decidedBy }),
  ];
  if (transaction.type === 'transfer' && transaction.transfer_counterpart_account_name) {
    parts.push(t('typeDecision.otherLeg', { account: transaction.transfer_counterpart_account_name }));
  }
  if (needsTypeReview(transaction)) parts.push(t('typeDecision.reviewHint'));
  return parts.join('; ');
}
