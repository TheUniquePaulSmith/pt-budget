/**
 * Labels for how a transaction's type was decided (schema v4).
 */

import type { Transaction, TransactionType, TransactionTypeSource } from '@/types/database';

export const TYPE_LABELS: Record<TransactionType, string> = {
  income: 'Income',
  expense: 'Expense',
  refund: 'Refund',
  transfer: 'Transfer',
};

export const TYPE_SOURCE_LABELS: Record<TransactionTypeSource, string> = {
  sign: 'from the amount sign',
  rule: 'by one of your type rules',
  pair: 'by matching the other leg of the transfer',
  inferred: 'by inference',
  manual: 'by you',
};

/** True when the type was decided automatically and the user has not confirmed it. */
export function needsTypeReview(transaction: Pick<Transaction, 'type_locked' | 'type_source'>): boolean {
  const source = transaction.type_source ?? 'sign';
  return !transaction.type_locked && source !== 'sign' && source !== 'manual';
}

export function formatConfidence(confidence: number | null | undefined): string {
  if (confidence == null) return '';
  return `${Math.round(confidence * 100)}% confidence`;
}

/** "Transfer — decided by matching the other leg (87% confidence); confirm from the row menu" */
export function describeTypeDecision(transaction: Transaction): string {
  const source = transaction.type_source ?? 'sign';
  const parts = [`${TYPE_LABELS[transaction.type]} — decided ${TYPE_SOURCE_LABELS[source]}`];
  const confidence = formatConfidence(transaction.type_confidence);
  if (confidence) parts[0] += ` (${confidence})`;
  if (transaction.type === 'transfer' && transaction.transfer_counterpart_account_name) {
    parts.push(`other leg: ${transaction.transfer_counterpart_account_name}`);
  }
  if (needsTypeReview(transaction)) parts.push('confirm or change it from the row menu');
  return parts.join('; ');
}
