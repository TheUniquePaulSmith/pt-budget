/**
 * Speed: a large export must not make the wizard feel stuck. The target is
 * about a second for 20,000 rows (detect the layout, then analyse every row);
 * the assertion leaves room for a slow CI machine.
 */

import { describe, expect, it } from 'vitest';

import { tableFromCells } from '../testing/tableFromCsv';

import { analyzeStatement } from './analyze';
import { proposeLayout } from './proposeLayout';

const ROWS = 20_000;
const BUDGET_MS = 3000;

/** Twenty thousand rows of a US-style checking export, oldest first, with a running balance. */
function largeStatement(timestamps: boolean) {
  const merchants = ['GROCERY MART', 'COFFEE HOUSE', 'GAS STATION', 'PHARMACY', 'HARDWARE DEPOT', 'STREAMING SERVICE', 'CITY PARKING'];
  const cells: string[][] = [['Date', 'Description', 'Amount', 'Running Balance', 'Reference Number', 'Category']];
  let cents = 5_000_000;
  const start = Date.UTC(2021, 0, 1);
  for (let row = 0; row < ROWS; row += 1) {
    const day = new Date(start + Math.floor(row / 11) * 86_400_000);
    const month = String(day.getUTCMonth() + 1).padStart(2, '0');
    const date = String(day.getUTCDate()).padStart(2, '0');
    const time = timestamps ? ` ${String(row % 24).padStart(2, '0')}:${String(row % 60).padStart(2, '0')}:${String((row * 7) % 60).padStart(2, '0')}` : '';
    const payroll = row % 150 === 0;
    const amountCents = payroll ? 325_000 : -(199 + ((row * 7919) % 28_000));
    cents += amountCents;
    const money = (value: number) => {
      const whole = Math.trunc(Math.abs(value) / 100).toLocaleString('en-US');
      return `${value < 0 ? '-' : ''}${whole}.${String(Math.abs(value) % 100).padStart(2, '0')}`;
    };
    cells.push([
      `${month}/${date}/${day.getUTCFullYear()}${time}`,
      payroll ? 'PAYROLL DEPOSIT ACME CORP' : `${merchants[row % merchants.length]} ${1000 + (row % 900)}`,
      money(amountCents),
      money(cents),
      `TX${String(row).padStart(7, '0')}`,
      'General',
    ]);
  }
  return tableFromCells(cells);
}

describe('speed', () => {
  it.each([
    ['dates that repeat', false],
    ['a different timestamp on every row', true],
  ])(`proposes a layout and analyses ${ROWS.toLocaleString('en-US')} rows within the budget: %s`, (_what, timestamps) => {
    const table = largeStatement(timestamps);

    const started = performance.now();
    const proposal = proposeLayout(table, { accountType: 'checking' });
    const report = analyzeStatement(table, proposal.layout, { today: '2026-11-10', accountType: 'checking' });
    const elapsed = performance.now() - started;

    expect(proposal.layout.roles).toEqual({ date: 0, description: [1], amount: 2, balance: 3, reference: 4 });
    expect(proposal.layout).toMatchObject({ dateOrder: 'MDY', decimal: '.', amountSign: 'asIs' });
    expect(report.stats).toMatchObject({ totalRows: ROWS, readyRows: ROWS, blockedRows: 0 });
    expect(report.issues.map((issue) => issue.code)).toEqual(['columnNotImported']);
    expect(elapsed, `took ${Math.round(elapsed)} ms`).toBeLessThan(BUDGET_MS);
  });
});
