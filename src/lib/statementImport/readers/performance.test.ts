/**
 * A year or two of a busy account is some 20,000 rows. Reading that must
 * stay around a second on an ordinary machine, so the bounds here are loose
 * enough for a loaded CI runner and tight enough to catch a scan that has
 * turned quadratic.
 */

import { describe, expect, it } from 'vitest';

import { sourceFileFromText } from '../testing/tableFromCsv';

import { readStatement } from './index';

const ROWS = 20_000;
const BUDGET_MS = 3000;

const pad = (value: number) => String(value).padStart(2, '0');
const dateOf = (index: number) => `2026-${pad((index % 12) + 1)}-${pad((index % 28) + 1)}`;

async function timed<T>(run: () => Promise<T>): Promise<{ result: T; elapsed: number }> {
  const started = performance.now();
  const result = await run();
  return { result, elapsed: performance.now() - started };
}

describe('reader performance', () => {
  it(`reads a ${ROWS}-row delimited file well inside the budget`, async () => {
    const rows = ['Bank of Examples', 'Account Number: 000123456789', '', 'Date,Description,Amount,Balance,Reference'];
    for (let index = 0; index < ROWS; index++) {
      const description = index % 7 === 0 ? `"MERCHANT ${index}, STORE #${index % 90}"` : `MERCHANT ${index} PURCHASE`;
      rows.push(`${dateOf(index)},${description},${index % 5 === 0 ? '' : '-'}${(index % 900) + 1}.${pad(index % 100)},"1,${pad(index % 100)}0.00",REF${index}`);
    }
    rows.push('Total,,-123456.78,,');
    const file = sourceFileFromText(`${rows.join('\r\n')}\r\n`, 'big-export.csv');

    const { result, elapsed } = await timed(() => readStatement(file));
    expect(result.tables[0].rows).toHaveLength(ROWS);
    expect(result.tables[0].sourceLines[ROWS - 1]).toBe(ROWS + 4);
    expect(result.tables[0].notes.map((note) => note.code)).toEqual(['preambleSkipped', 'trailerSkipped']);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it(`reads a ${ROWS}-transaction OFX file well inside the budget`, async () => {
    const parts = [
      'OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:USASCII\nCHARSET:1252\nCOMPRESSION:NONE\n\n<OFX>\n',
      '<BANKMSGSRSV1>\n<STMTTRNRS>\n<STMTRS>\n<CURDEF>USD\n<BANKACCTFROM>\n<ACCTID>000123456789\n<ACCTTYPE>CHECKING\n</BANKACCTFROM>\n<BANKTRANLIST>\n',
    ];
    for (let index = 0; index < ROWS; index++) {
      const posted = dateOf(index).replace(/-/g, '');
      parts.push(
        `<STMTTRN>\n<TRNTYPE>DEBIT\n<DTPOSTED>${posted}120000[-5:EST]\n<TRNAMT>-${(index % 900) + 1}.${pad(index % 100)}\n<FITID>F${index}\n<NAME>MERCHANT ${index} &amp; CO\n<MEMO>CARD PURCHASE ${index}\n</STMTTRN>\n`
      );
    }
    parts.push('</BANKTRANLIST>\n</STMTRS>\n</STMTTRNRS>\n</BANKMSGSRSV1>\n</OFX>\n');
    const file = sourceFileFromText(parts.join(''), 'big-download.ofx');

    const { result, elapsed } = await timed(() => readStatement(file));
    expect(result.tables[0].rows).toHaveLength(ROWS);
    expect(result.tables[0].rows[ROWS - 1][2]).toBe(`MERCHANT ${ROWS - 1} & CO`);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it('does not slow down on a file full of stray quotes', async () => {
    // Every description opens a quote and never closes it properly: each scan
    // for a closing quote must not start over from the top.
    const rows = ['Date,Description,Amount'];
    for (let index = 0; index < ROWS; index++) rows.push(`${dateOf(index)},"UNCLOSED ${index},-1.00`);

    const { result, elapsed } = await timed(() => readStatement(sourceFileFromText(`${rows.join('\n')}\n`, 'quotes.csv')));
    expect(result.tables).toHaveLength(1);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it('does not slow down on thousands of lines with no separator in them', async () => {
    const prose = Array.from({ length: ROWS }, (_, index) => `Line ${index} of a long letter that is not a statement`).join('\n');
    const { result, elapsed } = await timed(() => readStatement(sourceFileFromText(prose, 'letter.txt')));
    expect(result.issues.map((issue) => issue.code)).toEqual(['unsupportedFormat']);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});
