/**
 * Asking the user's AI provider to read a layout the built-in detection could
 * not work out.
 *
 * What leaves the device is exactly `buildAiLayoutSample(table)`: the header
 * names and up to ten rows with every long digit run masked. The reply must be
 * one JSON object; anything else, or a reply that points at columns the table
 * does not have, is unusable and yields null. A usable reply only decides
 * which column is what: the date order, the decimal mark and the sign are
 * still read from the whole file, and the AI's answer for them is used only
 * where the file itself is silent.
 */

import { DateReader } from '../interpret/cells';
import { accountTypeFor, buildProposal } from '../interpret/proposeLayout';
import { type DetectedRoles, directionValuesOf, inferDateOrderFor, inferDecimalFor } from '../interpret/roles';
import type {
  AiComplete,
  AiLayoutSample,
  AmountSign,
  ColumnRoles,
  DateOrder,
  DecimalSeparator,
  LayoutProposal,
  StatementTable,
} from '../types';

/** An AI suggestion is never more than this sure, whatever the file says. */
export const AI_MAX_CONFIDENCE = 0.7;

const SYSTEM_PROMPT = `You read exports of bank, credit card and loan statements.
You are given the column names of a table and a few sample rows. Account numbers and other long numbers are masked.
Work out which column plays which part and reply with ONE JSON object and nothing else: no explanation, no code fence.

Use the 0-based column index from the "columns" list, or null when the table has no such column.
{
  "date": index of the transaction date (when it happened),
  "postedDate": index of a second, later "posted" / "value" date, or null,
  "description": array of indexes of the text columns that describe the transaction (payee first, then memo), at least one,
  "amount": index of a single amount column, or null when money out and money in are separate columns,
  "debit": index of the money-out column of a debit / credit pair, or null,
  "credit": index of the money-in column of a debit / credit pair, or null,
  "direction": index of a column that says "DR" / "CR" or "Debit" / "Credit" for an unsigned amount, or null,
  "directionOut": array of the direction values that mean money out, or [],
  "directionIn": array of the direction values that mean money in, or [],
  "reference": index of the bank's own unique transaction id, or null,
  "account": index of a per-row account or card number, or null,
  "balance": index of the running balance, or null,
  "status": index of a posted / pending status, or null,
  "currency": index of a currency code, or null,
  "dateOrder": "MDY", "DMY" or "YMD",
  "decimal": "." or ",",
  "amountSign": "asIs" when negative amounts are money out, "inverted" when purchases are printed as positive numbers
}
Give either "amount" or "debit" / "credit", never both.`;

function userPrompt(sample: AiLayoutSample): string {
  return JSON.stringify(
    { columns: sample.headers.map((name, index) => ({ index, name })), rows: sample.rows },
    null,
    1
  );
}

/** The prompt for a sample; exported so the wizard and the tests can show what would be sent. */
export function buildAiLayoutPrompt(sample: AiLayoutSample): { system: string; user: string } {
  return { system: SYSTEM_PROMPT, user: userPrompt(sample) };
}

/** The first JSON object in a reply that may have prose or a code fence around it. */
function extractJsonObject(reply: string): unknown {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
}

export interface AiLayoutReply {
  roles: ColumnRoles;
  directionValues?: { out: string[]; in: string[] };
  dateOrder?: DateOrder;
  decimal?: DecimalSeparator;
  amountSign?: AmountSign;
}

const INVALID = Symbol('invalid');

/**
 * Validates a reply against the table. Null when it is not a JSON object,
 * names a column that does not exist, uses one column for two parts, or lacks
 * a date, a description or an amount. The format fields are optional: an
 * unknown value there is dropped, not fatal.
 */
export function parseAiLayoutReply(reply: string, columnCount: number): AiLayoutReply | null {
  const parsed = extractJsonObject(reply);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const answer = parsed as Record<string, unknown>;

  const column = (value: unknown): number | null | typeof INVALID => {
    if (value === null || value === undefined) return null;
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < columnCount ? value : INVALID;
  };
  const single = {
    date: column(answer.date),
    postedDate: column(answer.postedDate),
    amount: column(answer.amount),
    debit: column(answer.debit),
    credit: column(answer.credit),
    direction: column(answer.direction),
    reference: column(answer.reference),
    account: column(answer.account),
    balance: column(answer.balance),
    status: column(answer.status),
    currency: column(answer.currency),
  };
  if (Object.values(single).some((value) => value === INVALID)) return null;
  const roles = single as Record<keyof typeof single, number | null>;

  const descriptionAnswer = typeof answer.description === 'number' ? [answer.description] : answer.description;
  if (!Array.isArray(descriptionAnswer) || descriptionAnswer.length === 0) return null;
  const description = descriptionAnswer.map(column);
  if (description.some((value) => value === null || value === INVALID)) return null;

  if (roles.date === null) return null;
  if (roles.amount === null && roles.debit === null && roles.credit === null) return null;
  // A single amount and a pair at once is a confused answer; the single amount wins.
  if (roles.amount !== null) {
    roles.debit = null;
    roles.credit = null;
  } else {
    roles.direction = null;
  }
  const assigned = [...Object.values(roles), ...(description as number[])].filter((value): value is number => value !== null);
  if (new Set(assigned).size !== assigned.length) return null;

  const words = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((word): word is string => typeof word === 'string' && word.trim() !== '').map((word) => word.trim().toLowerCase())
      : [];
  const out = words(answer.directionOut);
  const moneyIn = words(answer.directionIn);

  const dateOrder = typeof answer.dateOrder === 'string' ? answer.dateOrder.toUpperCase() : '';
  const decimal = answer.decimal;
  const amountSign = answer.amountSign;
  return {
    roles: {
      date: roles.date,
      description: description as number[],
      ...(roles.postedDate !== null ? { postedDate: roles.postedDate } : {}),
      ...(roles.amount !== null ? { amount: roles.amount } : {}),
      ...(roles.debit !== null ? { debit: roles.debit } : {}),
      ...(roles.credit !== null ? { credit: roles.credit } : {}),
      ...(roles.direction !== null ? { direction: roles.direction } : {}),
      ...(roles.reference !== null ? { reference: roles.reference } : {}),
      ...(roles.account !== null ? { account: roles.account } : {}),
      ...(roles.balance !== null ? { balance: roles.balance } : {}),
      ...(roles.status !== null ? { status: roles.status } : {}),
      ...(roles.currency !== null ? { currency: roles.currency } : {}),
    },
    ...(roles.direction !== null && (out.length > 0 || moneyIn.length > 0) ? { directionValues: { out, in: moneyIn } } : {}),
    ...(dateOrder === 'MDY' || dateOrder === 'DMY' || dateOrder === 'YMD' ? { dateOrder } : {}),
    ...(decimal === '.' || decimal === ',' ? { decimal } : {}),
    ...(amountSign === 'asIs' || amountSign === 'inverted' ? { amountSign } : {}),
  };
}

/** Turns a validated reply into a proposal: every assumption is marked as the AI's and capped in confidence. */
export function proposalFromAiReply(table: StatementTable, reply: AiLayoutReply): LayoutProposal {
  // The reply's indexes are positions in the sample's header list.
  const at = (position: number) => table.columns[position].index;
  const optional = (position: number | null | undefined) => (position == null ? undefined : at(position));
  const roles: ColumnRoles = { date: at(reply.roles.date as number), description: reply.roles.description.map(at) };
  for (const part of ['postedDate', 'amount', 'debit', 'credit', 'direction', 'reference', 'account', 'balance', 'status', 'currency'] as const) {
    const column = optional(reply.roles[part]);
    if (column !== undefined) roles[part] = column;
  }

  const reader = new DateReader();
  const fallbacks = { dateOrder: reply.dateOrder, decimal: reply.decimal, basis: 'ai' as const };
  const dateColumns = [roles.date, roles.postedDate].filter((column): column is number => column != null);
  const moneyColumns = [roles.amount, roles.debit, roles.credit, roles.balance].filter((column): column is number => column != null);
  const direction = roles.direction != null ? directionValuesOf(table, roles.direction) : null;
  const directionValues =
    reply.directionValues ?? (direction && (direction.values.out.length > 0 || direction.values.in.length > 0) ? direction.values : undefined);
  const printedWords = (values: string[]) => {
    const wanted = new Set(values);
    const seen = new Set<string>();
    const words: string[] = [];
    if (roles.direction == null) return words;
    for (const row of table.rows) {
      const word = (row[roles.direction] ?? '').trim();
      const key = word.toLowerCase();
      if (!wanted.has(key) || seen.has(key)) continue;
      seen.add(key);
      words.push(word);
    }
    return words;
  };

  const detected: DetectedRoles = {
    roles,
    directionValues,
    directionWords: directionValues ? { out: printedWords(directionValues.out), in: printedWords(directionValues.in) } : undefined,
    confidence: { date: AI_MAX_CONFIDENCE, description: AI_MAX_CONFIDENCE, amount: AI_MAX_CONFIDENCE },
    fromContents: [],
    dateOrder: inferDateOrderFor(table, dateColumns, reader, fallbacks),
    decimal: inferDecimalFor(table, moneyColumns, fallbacks),
  };
  const proposal = buildProposal(table, detected, reader, {
    accountType: accountTypeFor(table, null),
    summaryCode: 'columnsByAi',
    signHint: reply.amountSign
      ? { sign: reply.amountSign, asPrintedCode: 'signAsPrintedByAi', flippedCode: 'signFlippedByAi' }
      : null,
  });
  return {
    ...proposal,
    confidence: Math.min(proposal.confidence, AI_MAX_CONFIDENCE),
    assumptions: proposal.assumptions.map((assumption) => ({
      ...assumption,
      basis: 'ai',
      confidence: Math.min(assumption.confidence, AI_MAX_CONFIDENCE),
    })),
  };
}

export async function suggestLayout(
  table: StatementTable,
  sample: AiLayoutSample,
  complete: AiComplete,
  signal?: AbortSignal
): Promise<LayoutProposal | null> {
  if (sample.headers.length === 0 || sample.rows.length === 0) return null;
  // A failed or aborted provider call rejects; only the reply itself is judged here.
  const reply = await complete(buildAiLayoutPrompt(sample), signal);
  if (typeof reply !== 'string') return null;
  const parsed = parseAiLayoutReply(reply, table.columns.length);
  return parsed ? proposalFromAiReply(table, parsed) : null;
}
