/**
 * Worded examples for "Check how we read it": a cell of the file next to what
 * the analysis made of it. They come from the analysis report, never from a
 * second parse, so the example is exactly how the row will be imported. Pure.
 */

import type { StatementSession } from './wizardModel';

export interface DateExample {
  /** The cell as printed in the file. */
  raw: string;
  /** `yyyy-MM-dd` as read. */
  date: string;
}

export interface AmountExample {
  raw: string;
  /** Signed: negative = money out. */
  amount: number;
  description: string;
}

type Readable = Pick<StatementSession, 'table' | 'layout' | 'report'>;

function cell(statement: Readable, rowIndex: number, column: number | null | undefined): string {
  return column == null ? '' : (statement.table.rows[rowIndex]?.[column] ?? '').trim();
}

/** The amount as printed: the single amount cell, or whichever of the debit / credit cells is filled. */
export function rawAmountCell(statement: Readable, rowIndex: number): string {
  const { roles } = statement.layout;
  if (roles.amount != null) return cell(statement, rowIndex, roles.amount);
  return cell(statement, rowIndex, roles.debit) || cell(statement, rowIndex, roles.credit);
}

export function rawDateCell(statement: Readable, rowIndex: number): string {
  return cell(statement, rowIndex, statement.layout.roles.date);
}

/**
 * A date that shows the consequence of the day / month order: one whose day
 * could also be a month ("03/04/2026"), else the first readable one.
 */
export function dateExample(statement: Readable): DateExample | null {
  let fallback: DateExample | null = null;
  for (const row of statement.report.rows) {
    if (row.skipped || !row.date) continue;
    const raw = rawDateCell(statement, row.index);
    if (!raw) continue;
    const month = Number(row.date.slice(5, 7));
    const day = Number(row.date.slice(8, 10));
    if (day <= 12 && day !== month) return { raw, date: row.date };
    fallback ??= { raw, date: row.date };
  }
  return fallback;
}

/** An amount whose cell carries a separator, so the decimal reading is visible; else the first readable one. */
export function decimalExample(statement: Readable): AmountExample | null {
  let fallback: AmountExample | null = null;
  for (const row of statement.report.rows) {
    if (row.skipped || row.amount === null) continue;
    const raw = rawAmountCell(statement, row.index);
    if (!raw) continue;
    const example = { raw, amount: row.amount, description: row.description };
    if (/[.,]/.test(raw)) return example;
    fallback ??= example;
  }
  return fallback;
}

/** The first row read as money out and the first read as money in (D9: the sign, shown by example). */
export function signExamples(statement: Readable): { out: AmountExample | null; in: AmountExample | null } {
  const examples: { out: AmountExample | null; in: AmountExample | null } = { out: null, in: null };
  for (const row of statement.report.rows) {
    if (row.skipped || row.amount === null || row.amount === 0) continue;
    const raw = rawAmountCell(statement, row.index);
    if (!raw) continue;
    const key = row.amount < 0 ? 'out' : 'in';
    examples[key] ??= { raw, amount: row.amount, description: row.description };
    if (examples.out && examples.in) break;
  }
  return examples;
}
