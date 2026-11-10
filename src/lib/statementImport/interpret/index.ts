/**
 * Interpretation and analysis: StatementTable → LayoutProposal → AnalysisReport.
 *
 * BASELINE (Import Wizard foundation). Column roles come from the header
 * names the old CSV dialog recognised, the date order and decimal separator
 * from the caller's fallback, and the analysis reports only unreadable dates,
 * unreadable amounts and blank descriptions. The interpretation agent replaces
 * the body with content-based detection, file-wide format inference, sign
 * inference and the full issue catalog; the signatures of `proposeLayout` and
 * `analyzeStatement` are part of the frozen contract.
 */

import { parseCsvDate } from '../../dateOnly';
import type { ImportIssueCode } from '../issueCodes';
import { IMPORT_ISSUE_CODES } from '../issueCodes';
import { parseCsvAmount } from '../shared/amounts';
import { detectUniqueIdentifierColumn, isPlaceholderReference } from '../shared/references';
import type {
  AnalysisContext,
  AnalysisReport,
  Assumption,
  ColumnRoles,
  ImportIssue,
  ImportLayout,
  LayoutContext,
  LayoutProposal,
  NormalizedRow,
  StatementTable,
} from '../types';

function findColumn(table: StatementTable, test: (lowerName: string) => boolean): number | null {
  const column = table.columns.find((candidate) => test(candidate.name.toLowerCase()));
  return column ? column.index : null;
}

function rolesFromHeaderNames(table: StatementTable): ColumnRoles {
  const description = findColumn(
    table,
    (name) => name.includes('merchant') || name.includes('description') || name.includes('memo')
  );
  const rowsByHeader = table.rows.map((cells) =>
    Object.fromEntries(table.columns.map((column) => [column.name, cells[column.index]]))
  );
  const referenceName = detectUniqueIdentifierColumn(
    table.columns.map((column) => column.name),
    rowsByHeader
  );
  return {
    date: findColumn(table, (name) => name.includes('date') || name.includes('time')),
    description: description === null ? [] : [description],
    amount: findColumn(table, (name) => name.includes('amount') || name.includes('billing')),
    reference: referenceName ? (table.columns.find((column) => column.name === referenceName)?.index ?? null) : null,
    account: findColumn(table, (name) => name.includes('account') && name.includes('number')),
  };
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

  const roles = rolesFromHeaderNames(table);
  const layout: ImportLayout = {
    roles,
    dateOrder: context.fallbackDateOrder ?? 'MDY',
    decimal: context.fallbackDecimal ?? '.',
    amountSign: 'asIs',
  };

  const missing: LayoutProposal['missing'] = [];
  if (roles.date === null) missing.push('date');
  if (roles.description.length === 0) missing.push('description');
  if (roles.amount == null && roles.debit == null && roles.credit == null) missing.push('amount');

  const formatBasis = context.fallbackDateOrder ? 'language' : 'default';
  const assumptions: Assumption[] = [
    { subject: 'dateOrder', code: 'dateOrderFallback', basis: formatBasis, confidence: 0.5, params: { order: layout.dateOrder } },
    { subject: 'decimal', code: 'decimalFallback', basis: context.fallbackDecimal ? 'language' : 'default', confidence: 0.5 },
    { subject: 'amountSign', code: 'signAsPrinted', basis: 'default', confidence: 0.5 },
  ];
  return { layout, confidence: missing.length > 0 ? 0 : 0.5, assumptions, missing };
}

function readAmount(cells: string[], layout: ImportLayout): number | null {
  const { roles, decimal } = layout;
  if (roles.amount != null) {
    const amount = parseCsvAmount(cells[roles.amount], { decimal });
    if (amount === null) return null;
    return layout.amountSign === 'inverted' ? -amount : amount;
  }
  // A debit / credit pair: money out in one column, money in in the other.
  const debit = roles.debit != null && cells[roles.debit].trim() ? parseCsvAmount(cells[roles.debit], { decimal }) : 0;
  const credit = roles.credit != null && cells[roles.credit].trim() ? parseCsvAmount(cells[roles.credit], { decimal }) : 0;
  if (debit === null || credit === null) return null;
  if (roles.debit == null && roles.credit == null) return null;
  return Math.abs(credit) - Math.abs(debit);
}

export function analyzeStatement(table: StatementTable, layout: ImportLayout, context: AnalysisContext): AnalysisReport {
  const { roles } = layout;
  const overrides = context.overrides ?? {};
  const rowsByCode = new Map<ImportIssueCode, number[]>();
  const flag = (code: ImportIssueCode, row: NormalizedRow) => {
    row.issueCodes.push(code);
    rowsByCode.set(code, [...(rowsByCode.get(code) ?? []), row.index]);
  };

  const rows = table.rows.map((cells, index): NormalizedRow => {
    const override = overrides[index] ?? {};
    const reference = roles.reference != null ? cells[roles.reference].trim() : '';
    const row: NormalizedRow = {
      index,
      sourceLine: table.sourceLines[index],
      date: override.date ?? (roles.date === null ? null : parseCsvDate(cells[roles.date], { order: layout.dateOrder, strict: true })),
      amount: override.amount ?? readAmount(cells, layout),
      description:
        override.description ??
        roles.description
          .map((column) => cells[column].trim())
          .filter(Boolean)
          .join(' '),
      reference: reference && !isPlaceholderReference(reference) ? reference : null,
      accountValue: roles.account != null ? cells[roles.account] : null,
      balance: roles.balance != null ? parseCsvAmount(cells[roles.balance], { decimal: layout.decimal }) : null,
      skipped: Boolean(override.skip),
      blocked: false,
      issueCodes: [],
    };
    if (row.skipped) return row;

    if (roles.date !== null && row.date === null) flag('unreadableDate', row);
    if (row.amount === null && !(roles.amount == null && roles.debit == null && roles.credit == null)) {
      flag('unreadableAmount', row);
    }
    if (roles.description.length > 0 && !row.description) flag('blankDescription', row);
    row.blocked = row.date === null || row.amount === null;
    return row;
  });

  const issues: ImportIssue[] = [];
  if (roles.date === null) issues.push({ code: 'noDateColumn', severity: 'blocker', scope: 'column' });
  if (roles.amount == null && roles.debit == null && roles.credit == null) {
    issues.push({ code: 'noAmountColumn', severity: 'blocker', scope: 'column' });
  }
  if (roles.description.length === 0) issues.push({ code: 'noDescriptionColumn', severity: 'blocker', scope: 'column' });
  for (const [code, affected] of rowsByCode) {
    issues.push({
      code,
      severity: IMPORT_ISSUE_CODES[code].severity,
      scope: IMPORT_ISSUE_CODES[code].scope,
      rows: affected,
      params: { count: affected.length },
    });
  }

  const ready = rows.filter((row) => !row.skipped && !row.blocked);
  const dates = ready.map((row) => row.date as string).sort();
  return {
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
}
