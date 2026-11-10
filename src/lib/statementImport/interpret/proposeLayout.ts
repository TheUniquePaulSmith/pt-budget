/**
 * StatementTable → LayoutProposal: which column is what, the date order, the
 * decimal mark and the sign of the amounts, each with the evidence it rests
 * on. A saved layout wins, then a layout the reader knows for certain (OFX),
 * then detection.
 */

import type { AccountType } from '@/types/database';

import type {
  AmountSign,
  Assumption,
  ColumnRoles,
  ImportLayout,
  LayoutContext,
  LayoutProposal,
  StatementTable,
} from '../types';

import { DateReader } from './cells';
import { type DetectedRoles, detectRoles, readNumbers } from './roles';
import { type SignInference, inferAmountSign } from './sign';

const ACCOUNT_TYPES: readonly AccountType[] = ['checking', 'savings', 'credit', 'loan', 'investment', 'retirement'];

/** The account type the caller chose, else the one the file itself states (OFX `ACCTTYPE`, a preamble line). */
export function accountTypeFor(table: StatementTable, chosen: AccountType | null | undefined): AccountType | null {
  if (chosen) return chosen;
  const hint = table.meta.accountHints.find((candidate) => candidate.kind === 'accountType')?.value.trim().toLowerCase();
  return ACCOUNT_TYPES.find((type) => type === hint) ?? null;
}

/** True when the layout has a single amount column whose sign is a question (no debit / credit pair, no DR / CR column). */
export function signIsInferred(roles: ColumnRoles): boolean {
  return roles.amount != null && roles.direction == null;
}

/** The description of every row: its columns joined with a space, as the import will store it. */
export function joinDescriptions(table: StatementTable, columns: number[]): string[] {
  return table.rows.map((row) =>
    columns
      .map((column) => (row[column] ?? '').trim())
      .filter(Boolean)
      .join(' ')
  );
}

/** Runs the sign inference for a layout with a single amount column. */
export function inferSignFor(
  table: StatementTable,
  roles: ColumnRoles,
  formats: Pick<ImportLayout, 'dateOrder' | 'decimal'>,
  reader: DateReader,
  accountType: AccountType | null
): SignInference {
  const amountColumn = roles.amount as number;
  const dateColumn = roles.date;
  const dates =
    dateColumn === null ? undefined : table.rows.map((row) => reader.inOrder(row[dateColumn] ?? '', formats.dateOrder));
  const amounts = readNumbers(table, amountColumn, formats.decimal);
  return inferAmountSign({
    // A row without a date is a total line or broken, not a transaction: it does not get a vote.
    amounts: dates ? amounts.map((amount, row) => (dates[row] === null ? null : amount)) : amounts,
    printed: table.rows.map((row) => row[amountColumn] ?? ''),
    descriptions: joinDescriptions(table, roles.description),
    balances: roles.balance != null ? readNumbers(table, roles.balance, formats.decimal) : undefined,
    dates,
    accountType,
  });
}

export interface ProposalOptions {
  accountType: AccountType | null;
  /** The code of the "these are the columns" assumption; detection picks by-name or by-content. */
  summaryCode?: string;
  /** A sign to use when the file itself does not settle it (the AI's answer). */
  signHint?: { sign: AmountSign; asPrintedCode: string; flippedCode: string } | null;
}

/** Turns detected (or AI-suggested) roles into a proposal: layout, assumptions, confidence, what is missing. */
export function buildProposal(
  table: StatementTable,
  detected: DetectedRoles,
  reader: DateReader,
  options: ProposalOptions
): LayoutProposal {
  const { roles, confidence } = detected;
  const nameOf = (column: number) => table.columns.find((candidate) => candidate.index === column)?.name ?? '';

  const missing: LayoutProposal['missing'] = [];
  if (roles.date === null) missing.push('date');
  if (roles.description.length === 0) missing.push('description');
  if (roles.amount == null && roles.debit == null && roles.credit == null) missing.push('amount');

  const formats = { dateOrder: detected.dateOrder.order, decimal: detected.decimal.decimal };
  let sign: SignInference | null = signIsInferred(roles) ? inferSignFor(table, roles, formats, reader, options.accountType) : null;
  if (sign && options.signHint && sign.confidence < 0.9) {
    const hinted = options.signHint;
    const code = hinted.sign === 'asIs' ? hinted.asPrintedCode : hinted.flippedCode;
    sign = {
      sign: hinted.sign,
      confidence: 0.7,
      assumption: { subject: 'amountSign', code, basis: 'ai', confidence: 0.7 },
    };
  }

  const layout: ImportLayout = {
    roles,
    dateOrder: formats.dateOrder,
    decimal: formats.decimal,
    amountSign: sign?.sign ?? 'asIs',
    ...(detected.directionValues ? { directionValues: detected.directionValues } : {}),
  };

  const assumptions: Assumption[] = [];
  const amountName =
    roles.amount != null
      ? nameOf(roles.amount)
      : [roles.debit, roles.credit]
          .filter((column): column is number => column != null)
          .map(nameOf)
          .join(' / ');
  const descriptionName = roles.description.map(nameOf).join(' + ');
  if (missing.length === 0) {
    assumptions.push({
      subject: 'columns',
      code: options.summaryCode ?? (detected.fromContents.length > 0 ? 'columnsByContent' : 'columnsByName'),
      basis: 'file',
      confidence: Math.min(confidence.date, confidence.description, confidence.amount),
      params: { date: nameOf(roles.date as number), description: descriptionName, amount: amountName },
    });
  }
  if (roles.date !== null && roles.postedDate != null) {
    assumptions.push({
      subject: 'columns',
      code: 'twoDateColumns',
      basis: 'file',
      confidence: confidence.date,
      params: { date: nameOf(roles.date), postedDate: nameOf(roles.postedDate) },
    });
  }
  if (roles.description.length > 1) {
    assumptions.push({
      subject: 'columns',
      code: 'descriptionJoined',
      basis: 'file',
      confidence: confidence.description,
      params: { columns: descriptionName },
    });
  }
  if (roles.debit != null && roles.credit != null) {
    assumptions.push({
      subject: 'columns',
      code: 'debitCreditColumns',
      basis: 'file',
      confidence: confidence.amount,
      params: { debit: nameOf(roles.debit), credit: nameOf(roles.credit) },
    });
  }
  if (roles.amount != null && roles.direction != null) {
    assumptions.push({
      subject: 'columns',
      code: 'directionColumn',
      basis: 'file',
      confidence: confidence.amount,
      params: {
        amount: nameOf(roles.amount),
        direction: nameOf(roles.direction),
        out: detected.directionWords?.out.join(' / ') || '—',
        in: detected.directionWords?.in.join(' / ') || '—',
      },
    });
  }
  if (roles.account != null) {
    assumptions.push({
      subject: 'columns',
      code: 'accountColumn',
      basis: 'file',
      confidence: 0.9,
      params: { column: nameOf(roles.account) },
    });
  }
  if (detected.dateOrder.assumption) assumptions.push(detected.dateOrder.assumption);
  if (detected.decimal.assumption) assumptions.push(detected.decimal.assumption);
  if (sign) assumptions.push(sign.assumption);

  const overall =
    missing.length > 0
      ? 0
      : Math.min(
          confidence.date,
          confidence.description,
          confidence.amount,
          detected.dateOrder.confidence,
          detected.decimal.confidence,
          sign?.confidence ?? 1
        );
  return { layout, confidence: overall, assumptions, missing };
}

export function proposeLayout(table: StatementTable, context: LayoutContext = {}): LayoutProposal {
  if (context.profile) {
    return {
      layout: context.profile.layout,
      confidence: 1,
      assumptions: [{ subject: 'columns', code: 'savedLayout', basis: 'profile', confidence: 1 }],
      missing: [],
    };
  }
  if (table.meta.presetLayout) {
    return { layout: table.meta.presetLayout, confidence: 1, assumptions: [], missing: [] };
  }

  const reader = new DateReader();
  const detected = detectRoles(table, reader, {
    dateOrder: context.fallbackDateOrder,
    decimal: context.fallbackDecimal,
  });
  return buildProposal(table, detected, reader, { accountType: accountTypeFor(table, context.accountType) });
}
