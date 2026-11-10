/**
 * A stand-in for the pure pipeline with the contract's shapes: roles by exact
 * header name, ISO dates and plain numbers. The wizard's tests run against
 * it, so they pin the wizard's behaviour and not whatever the interpretation
 * module detects this week. Imports types only (it is used inside vi.mock).
 */

import type {
  AnalysisContext,
  AnalysisReport,
  ImportIssue,
  ImportLayout,
  LayoutContext,
  LayoutProposal,
  NormalizedRow,
  StatementTable,
} from '@/lib/statementImport';

type Propose = (table: StatementTable, context?: LayoutContext) => LayoutProposal;
type Analyze = (table: StatementTable, layout: ImportLayout, context: AnalysisContext) => AnalysisReport;

export const TODAY = '2030-03-01';

export function makeTable(
  rows: string[][],
  columns: string[] = ['Date', 'Description', 'Amount'],
  overrides: Partial<StatementTable> = {}
): StatementTable {
  return {
    format: 'delimited',
    fingerprint: `delimited:${columns.map((name) => name.toLowerCase()).join('|')}`,
    columns: columns.map((name, index) => ({ index, name })),
    rows,
    sourceLines: rows.map((_, index) => index + 2),
    meta: { fileName: 'statement.csv', encoding: 'utf-8', delimiter: ',', headerLine: 1, preamble: [], trailer: [], accountHints: [] },
    notes: [],
    ...overrides,
  };
}

export const SIMPLE_ROWS = [
  ['2030-02-01', 'Coffee Shop', '-4.50'],
  ['2030-02-02', 'Paycheck', '1200.00'],
  ['2030-02-03', 'Grocery Store', '-63.20'],
];

function columnByName(table: StatementTable, name: string): number | null {
  const column = table.columns.find((candidate) => candidate.name.toLowerCase() === name);
  return column ? column.index : null;
}

/** Roles by exact header name; the formats are low-confidence guesses unless a saved format says otherwise. */
export const fakePropose: Propose = (table, context = {}) => {
  if (context.profile) {
    return {
      layout: context.profile.layout,
      confidence: 1,
      assumptions: [{ subject: 'columns', code: 'savedLayout', basis: 'profile', confidence: 1 }],
      missing: [],
    };
  }
  if (table.meta.presetLayout) return { layout: table.meta.presetLayout, confidence: 1, assumptions: [], missing: [] };
  const description = columnByName(table, 'description');
  const layout: ImportLayout = {
    roles: {
      date: columnByName(table, 'date'),
      description: description === null ? [] : [description],
      amount: columnByName(table, 'amount'),
      debit: columnByName(table, 'debit'),
      credit: columnByName(table, 'credit'),
      account: columnByName(table, 'account'),
      reference: columnByName(table, 'reference'),
    },
    dateOrder: context.fallbackDateOrder ?? 'MDY',
    decimal: context.fallbackDecimal ?? '.',
    // A card file prints charges as positive numbers.
    amountSign: context.accountType === 'credit' ? 'inverted' : 'asIs',
  };
  const missing: LayoutProposal['missing'] = [];
  if (layout.roles.date === null) missing.push('date');
  if (layout.roles.description.length === 0) missing.push('description');
  if (layout.roles.amount == null && layout.roles.debit == null && layout.roles.credit == null) missing.push('amount');
  return {
    layout,
    confidence: missing.length > 0 ? 0 : 0.5,
    assumptions: [
      { subject: 'dateOrder', code: 'dateOrderFallback', basis: 'language', confidence: 0.5 },
      { subject: 'decimal', code: 'decimalFallback', basis: 'language', confidence: 0.9 },
      { subject: 'amountSign', code: 'signAsPrinted', basis: 'default', confidence: 0.5 },
    ],
    missing,
  };
};

/**
 * Reads ISO dates and plain numbers; anything else is a blocker on its row. A line with no date whose
 * description starts with "Total" is left out as a summary row. Honours overrides. Like the real
 * analysis it repeats `signAssumed` for every single-amount layout, whatever the user confirmed, and
 * reports an overlap when the account was imported into before.
 */
export const fakeAnalyze: Analyze = (table, layout, context) => {
  const { roles } = layout;
  const overrides = context.overrides ?? {};
  const unreadableDates: number[] = [];
  const unreadableAmounts: number[] = [];
  const summaryRows: number[] = [];
  const rows = table.rows.map((cells, index): NormalizedRow => {
    const override = overrides[index] ?? {};
    const rawDate = roles.date == null ? '' : cells[roles.date];
    const date = override.date ?? (/^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null);
    let amount: number | null = override.amount ?? null;
    if (override.amount === undefined) {
      if (roles.amount != null) {
        const parsed = Number(cells[roles.amount]);
        amount = cells[roles.amount].trim() !== '' && Number.isFinite(parsed) ? parsed : null;
        if (amount !== null && layout.amountSign === 'inverted') amount = -amount;
      } else if (roles.debit != null || roles.credit != null) {
        const debit = roles.debit != null ? Number(cells[roles.debit] || 0) : 0;
        const credit = roles.credit != null ? Number(cells[roles.credit] || 0) : 0;
        amount = Number.isFinite(debit) && Number.isFinite(credit) ? credit - debit : null;
      }
    }
    const description = override.description ?? roles.description.map((column) => cells[column]).join(' ');
    const isTotalLine = date === null && /^total/i.test(description) && override.skip !== false;
    if (isTotalLine && override.skip !== true) summaryRows.push(index);
    const skipped = Boolean(override.skip) || isTotalLine;
    const blocked = !skipped && (date === null || amount === null);
    const issueCodes: NormalizedRow['issueCodes'] = [];
    if (!skipped && date === null) {
      unreadableDates.push(index);
      issueCodes.push('unreadableDate');
    }
    if (!skipped && amount === null) {
      unreadableAmounts.push(index);
      issueCodes.push('unreadableAmount');
    }
    return {
      index,
      sourceLine: table.sourceLines[index],
      date,
      amount,
      description,
      reference: roles.reference != null ? cells[roles.reference] : null,
      accountValue: roles.account != null ? cells[roles.account] : null,
      balance: null,
      skipped,
      blocked,
      issueCodes,
    };
  });

  const issues: ImportIssue[] = [];
  if (unreadableDates.length > 0) {
    issues.push({ code: 'unreadableDate', severity: 'blocker', scope: 'row', rows: unreadableDates, params: { count: unreadableDates.length } });
  }
  if (unreadableAmounts.length > 0) {
    issues.push({ code: 'unreadableAmount', severity: 'blocker', scope: 'row', rows: unreadableAmounts, params: { count: unreadableAmounts.length } });
  }
  if (summaryRows.length > 0) {
    issues.push({ code: 'summaryRow', severity: 'info', scope: 'row', rows: summaryRows, params: { count: summaryRows.length } });
  }
  if (roles.amount != null && roles.debit == null && roles.credit == null) {
    issues.push({
      code: 'signAssumed',
      severity: 'warning',
      scope: 'column',
      column: roles.amount,
      params: { moneyOutRows: 2, moneyInRows: 1 },
    });
  }
  if (context.coverage?.lastImportThrough && context.coverage.firstDate) {
    issues.push({
      code: 'overlapsExisting',
      severity: 'info',
      scope: 'coverage',
      params: { from: context.coverage.firstDate, to: context.coverage.lastImportThrough },
    });
  }
  const ready = rows.filter((row) => !row.skipped && !row.blocked);
  const dates = ready.map((row) => row.date as string).sort();
  const report: AnalysisReport = {
    rows,
    issues,
    stats: {
      totalRows: rows.length,
      readyRows: ready.length,
      blockedRows: rows.filter((row) => row.blocked).length,
      skippedRows: rows.filter((row) => row.skipped).length,
      firstDate: dates[0] ?? null,
      lastDate: dates.at(-1) ?? null,
      moneyIn: ready.reduce((sum, row) => sum + Math.max(row.amount as number, 0), 0),
      moneyOut: ready.reduce((sum, row) => sum + Math.max(-(row.amount as number), 0), 0),
    },
  };
  return report;
};
