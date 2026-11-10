import { describe, expect, it } from 'vitest';

import { analyzeStatement, proposeLayout } from '../index';
import { sourceFileFromText } from '../testing/tableFromCsv';
import type { ReadResult } from '../types';

import { readStatement } from './index';
import { ofxAmount, ofxDate } from './ofx';

const SGML_HEADER = 'OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:USASCII\nCHARSET:1252\nCOMPRESSION:NONE\n\n';

interface Transaction {
  type?: string;
  posted?: string;
  amount?: string;
  id?: string;
  name?: string;
  memo?: string;
  extra?: string;
}

const sgmlTransaction = ({ type = 'DEBIT', posted = '20260901', amount = '-1.00', id = 'T1', name = 'SHOP', memo, extra = '' }: Transaction) =>
  `<STMTTRN>\n<TRNTYPE>${type}\n<DTPOSTED>${posted}\n<TRNAMT>${amount}\n<FITID>${id}\n<NAME>${name}\n${memo === undefined ? '' : `<MEMO>${memo}\n`}${extra}</STMTTRN>\n`;

/** A bank statement in OFX 1.x SGML. */
function sgmlStatement(transactions: Transaction[], { account = '000123456789', type = 'CHECKING', currency = 'USD' } = {}): string {
  return (
    `<STMTTRNRS>\n<TRNUID>1\n<STMTRS>\n<CURDEF>${currency}\n` +
    `<BANKACCTFROM>\n<BANKID>000000000\n<ACCTID>${account}\n<ACCTTYPE>${type}\n</BANKACCTFROM>\n` +
    `<BANKTRANLIST>\n<DTSTART>20260901\n<DTEND>20260930\n${transactions.map(sgmlTransaction).join('')}</BANKTRANLIST>\n` +
    `<LEDGERBAL>\n<BALAMT>100.00\n<DTASOF>20260930\n</LEDGERBAL>\n</STMTRS>\n</STMTTRNRS>\n`
  );
}

const SIGNON = '<SIGNONMSGSRSV1>\n<SONRS>\n<FI>\n<ORG>Example Bank\n<FID>1234\n</FI>\n</SONRS>\n</SIGNONMSGSRSV1>\n';

const sgmlFile = (statements: string, signon = SIGNON) => `${SGML_HEADER}<OFX>\n${signon}<BANKMSGSRSV1>\n${statements}</BANKMSGSRSV1>\n</OFX>\n`;

const read = (text: string, name = 'download.ofx'): Promise<ReadResult> => readStatement(sourceFileFromText(text, name));

describe('ofxDate', () => {
  it('keeps the calendar date the bank wrote, whatever time and zone follow it', () => {
    expect(ofxDate('20260914')).toBe('2026-09-14');
    expect(ofxDate('20260914235959')).toBe('2026-09-14');
    expect(ofxDate('20260914235959.000[-5:EST]')).toBe('2026-09-14');
    expect(ofxDate('20260101000000.000[+12:NZST]')).toBe('2026-01-01');
    expect(ofxDate(' 20240229 ')).toBe('2024-02-29');
  });

  it('rejects what is not a date', () => {
    expect(ofxDate('20260231')).toBeNull();
    expect(ofxDate('20261301')).toBeNull();
    expect(ofxDate('20250229')).toBeNull();
    expect(ofxDate('2026-09-14')).toBeNull();
    expect(ofxDate('')).toBeNull();
    expect(ofxDate(undefined)).toBeNull();
  });
});

describe('ofxAmount', () => {
  it('writes amounts with a dot decimal', () => {
    expect(ofxAmount('-45.67')).toBe('-45.67');
    expect(ofxAmount('+100.00')).toBe('100.00');
    expect(ofxAmount('1500')).toBe('1500');
    expect(ofxAmount('-45,67')).toBe('-45.67');
    expect(ofxAmount('1.234,56')).toBe('1234.56');
    expect(ofxAmount('1,234.56')).toBe('1234.56');
    expect(ofxAmount(' -0.5 ')).toBe('-0.5');
    expect(ofxAmount('.50')).toBe('.50');
  });

  it('passes through what is not a number, for the analysis to report', () => {
    expect(ofxAmount('N/A')).toBe('N/A');
    expect(ofxAmount('12.3.4x')).toBe('12.3.4x');
    expect(ofxAmount('')).toBe('');
    expect(ofxAmount(undefined)).toBe('');
  });
});

describe('OFX reader', () => {
  it('reads a bank statement into the fixed columns with a preset layout', async () => {
    const { tables, issues } = await read(
      sgmlFile(
        sgmlStatement([
          { posted: '20260902120000[-5:EST]', amount: '-4.25', id: 'A1', name: 'COFFEE BAR', memo: 'CARD 4821' },
          { type: 'CHECK', posted: '20260915', amount: '-250.00', id: 'A2', name: 'CHECK', extra: '<CHECKNUM>1042\n' },
        ])
      )
    );
    expect(issues).toEqual([]);
    expect(tables).toHaveLength(1);
    const [table] = tables;
    expect(table.format).toBe('ofx');
    expect(table.columns).toEqual([
      { index: 0, name: 'Date' },
      { index: 1, name: 'Amount' },
      { index: 2, name: 'Name' },
      { index: 3, name: 'Memo' },
      { index: 4, name: 'Reference' },
      { index: 5, name: 'Type' },
      { index: 6, name: 'Check Number' },
    ]);
    expect(table.rows).toEqual([
      ['2026-09-02', '-4.25', 'COFFEE BAR', 'CARD 4821', 'A1', 'DEBIT', ''],
      ['2026-09-15', '-250.00', 'CHECK', '', 'A2', 'CHECK', '1042'],
    ]);
    expect(table.fingerprint).toBe('ofx:example bank:checking');
    expect(table.meta.presetLayout).toEqual({
      roles: { date: 0, amount: 1, description: [2, 3], reference: 4 },
      dateOrder: 'YMD',
      decimal: '.',
      amountSign: 'asIs',
    });
    expect(table.meta).toMatchObject({
      statementStart: '2026-09-01',
      statementEnd: '2026-09-30',
      ledgerBalance: { amount: 100, asOf: '2026-09-30' },
      preamble: [],
      trailer: [],
    });
    expect(table.meta.delimiter).toBeUndefined();
    expect(table.notes).toEqual([]);
  });

  it('produces a table the rest of the pipeline reads without guessing: FITID is the reference', async () => {
    const { tables } = await read(
      sgmlFile(
        sgmlStatement([
          { posted: '20260902235959.000[-8:PST]', amount: '-4.25', id: 'A1', name: 'COFFEE BAR', memo: 'CARD 4821' },
          { posted: '20260909', amount: '1500.00', id: 'A2', name: 'PAYROLL', memo: 'PAYROLL' },
        ])
      )
    );
    const proposal = proposeLayout(tables[0]);
    expect(proposal).toMatchObject({ confidence: 1, missing: [] });
    const report = analyzeStatement(tables[0], proposal.layout, { today: '2026-11-10' });
    expect(report.rows.map((row) => [row.date, row.amount, row.description, row.reference])).toEqual([
      ['2026-09-02', -4.25, 'COFFEE BAR CARD 4821', 'A1'],
      // A memo that only repeats the name is dropped, so the description does not say it twice.
      ['2026-09-09', 1500, 'PAYROLL', 'A2'],
    ]);
    expect(report.stats).toMatchObject({ readyRows: 2, blockedRows: 0 });
  });

  it('reads OFX 2.x XML and a credit card statement', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
  <SIGNONMSGSRSV1><SONRS><FI><ORG>Card Co</ORG><FID>77</FID></FI></SONRS></SIGNONMSGSRSV1>
  <CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS>
    <CURDEF>cad</CURDEF>
    <CCACCTFROM><ACCTID>4000000000004821</ACCTID></CCACCTFROM>
    <BANKTRANLIST>
      <DTSTART>20260901</DTSTART><DTEND>20260930</DTEND>
      <STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260904</DTPOSTED><TRNAMT>-58.12</TRNAMT><FITID>X1</FITID><NAME>A &amp; B &lt;Deli&gt; &#233;&#x20AC;</NAME><MEMO/></STMTTRN>
      <STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260920</DTPOSTED><TRNAMT>250.00</TRNAMT><FITID>X2</FITID><NAME><![CDATA[PAYMENT <THANK YOU>]]></NAME></STMTTRN>
    </BANKTRANLIST>
    <LEDGERBAL><BALAMT>-431.07</BALAMT><DTASOF>20260930120000</DTASOF></LEDGERBAL>
  </CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>
</OFX>`;
    const { tables } = await read(xml, 'card.qfx');
    expect(tables).toHaveLength(1);
    const [table] = tables;
    expect(table.rows).toEqual([
      ['2026-09-04', '-58.12', 'A & B <Deli> é€', '', 'X1', 'DEBIT', ''],
      ['2026-09-20', '250.00', 'PAYMENT <THANK YOU>', '', 'X2', 'CREDIT', ''],
    ]);
    expect(table.sourceLines).toEqual([10, 11]);
    expect(table.fingerprint).toBe('ofx:card co:credit');
    expect(table.meta.accountHints).toEqual([
      { kind: 'number', value: '4000000000004821', source: 'ofx' },
      { kind: 'accountType', value: 'credit', source: 'ofx' },
      { kind: 'institution', value: 'Card Co', source: 'ofx' },
      { kind: 'currency', value: 'CAD', source: 'ofx' },
    ]);
    expect(table.meta.ledgerBalance).toEqual({ amount: -431.07, asOf: '2026-09-30' });
  });

  it('maps ACCTTYPE to an app account type and leaves an unknown one out', async () => {
    const typeOf = async (acctType: string) => {
      const { tables } = await read(sgmlFile(sgmlStatement([{}], { type: acctType })));
      return [tables[0].meta.accountHints.find((hint) => hint.kind === 'accountType')?.value, tables[0].fingerprint];
    };
    expect(await typeOf('CHECKING')).toEqual(['checking', 'ofx:example bank:checking']);
    expect(await typeOf('SAVINGS')).toEqual(['savings', 'ofx:example bank:savings']);
    expect(await typeOf('MONEYMRKT')).toEqual(['savings', 'ofx:example bank:savings']);
    expect(await typeOf('CREDITLINE')).toEqual(['credit', 'ofx:example bank:credit']);
    expect(await typeOf('checking')).toEqual(['checking', 'ofx:example bank:checking']);
    expect(await typeOf('ESCROW')).toEqual([undefined, 'ofx:example bank:unknown']);
  });

  it('names the institution by ORG, else FID, else not at all', async () => {
    const withFidOnly = await read(sgmlFile(sgmlStatement([{}]), '<SIGNONMSGSRSV1>\n<SONRS>\n<FI>\n<FID>1234\n</FI>\n</SONRS>\n</SIGNONMSGSRSV1>\n'));
    expect(withFidOnly.tables[0].fingerprint).toBe('ofx:1234:checking');
    expect(withFidOnly.tables[0].meta.accountHints).toContainEqual({ kind: 'institution', value: '1234', source: 'ofx' });

    // No <FI>: the fingerprint says so, and the file name is the only hint there is.
    const anonymous = await read(sgmlFile(sgmlStatement([{}]), ''), 'LakesideDownload.qfx');
    expect(anonymous.tables[0].fingerprint).toBe('ofx:unknown:checking');
    expect(anonymous.tables[0].meta.accountHints).toEqual([
      { kind: 'number', value: '000123456789', source: 'ofx' },
      { kind: 'accountType', value: 'checking', source: 'ofx' },
      { kind: 'currency', value: 'USD', source: 'ofx' },
      { kind: 'institution', value: 'Lakeside', source: 'fileName' },
    ]);
  });

  it('returns one table per statement and tells each the file has several', async () => {
    const { tables } = await read(
      sgmlFile(
        sgmlStatement([{ id: 'C1' }], { account: '111', type: 'CHECKING' }) +
          sgmlStatement([{ id: 'S1' }, { id: 'S2' }], { account: '222', type: 'SAVINGS', currency: 'EUR' })
      )
    );
    expect(tables.map((table) => [table.fingerprint, table.rows.length, table.meta.accountHints[0].value])).toEqual([
      ['ofx:example bank:checking', 1, '111'],
      ['ofx:example bank:savings', 2, '222'],
    ]);
    expect(tables[1].meta.accountHints).toContainEqual({ kind: 'currency', value: 'EUR', source: 'ofx' });
    for (const table of tables) {
      expect(table.notes).toEqual([{ code: 'multipleAccountsInFile', severity: 'info', scope: 'file', params: { count: 2 } }]);
    }
  });

  it('leaves out a statement with no transactions and does not count it as an account', async () => {
    const { tables } = await read(sgmlFile(sgmlStatement([], { account: '111' }) + sgmlStatement([{ id: 'S1' }], { account: '222', type: 'SAVINGS' })));
    expect(tables).toHaveLength(1);
    expect(tables[0].meta.accountHints[0].value).toBe('222');
    expect(tables[0].notes).toEqual([]);
  });

  it('reports an envelope with no transactions as having no rows', async () => {
    const noRows = { tables: [], issues: [{ code: 'noDataRows', severity: 'blocker', scope: 'file' }] };
    expect(await read(sgmlFile(sgmlStatement([])))).toEqual(noRows);
    expect(await read(`${SGML_HEADER}<OFX>\n${SIGNON}</OFX>\n`)).toEqual(noRows);
    // An investment statement has no bank transaction list.
    expect(
      await read(`${SGML_HEADER}<OFX>\n<INVSTMTMSGSRSV1>\n<INVSTMTTRNRS>\n<INVSTMTRS>\n<CURDEF>USD\n</INVSTMTRS>\n</INVSTMTTRNRS>\n</INVSTMTMSGSRSV1>\n</OFX>\n`)
    ).toEqual(noRows);
  });

  it('takes the payee name when there is no NAME, and never the other side of a transfer as the account', async () => {
    const { tables } = await read(
      sgmlFile(
        sgmlStatement([
          {
            id: 'P1',
            name: '',
            extra: '<PAYEE>\n<NAME>CITY WATER\n<ADDR1>1 Example Way\n<CITY>Springfield\n</PAYEE>\n<BANKACCTTO>\n<BANKID>111\n<ACCTID>999999999\n<ACCTTYPE>SAVINGS\n</BANKACCTTO>\n',
          },
        ])
      )
    );
    expect(tables[0].rows[0][2]).toBe('CITY WATER');
    expect(tables[0].meta.accountHints.slice(0, 2)).toEqual([
      { kind: 'number', value: '000123456789', source: 'ofx' },
      { kind: 'accountType', value: 'checking', source: 'ofx' },
    ]);
  });

  it('copes with empty values, lower-case tags and a file written on one line', async () => {
    const oneLine = sgmlFile(sgmlStatement([{ id: 'L1', name: 'ONE', memo: '' }, { id: 'L2', name: 'TWO' }]))
      .replace(SGML_HEADER, '')
      .replace(/\n/g, '')
      .replace(/<(\/?)([A-Z.]+)>/g, (_, slash: string, tag: string) => `<${slash}${tag.toLowerCase()}>`);
    const { tables } = await read(oneLine);
    expect(tables[0].rows).toEqual([
      ['2026-09-01', '-1.00', 'ONE', '', 'L1', 'DEBIT', ''],
      ['2026-09-01', '-1.00', 'TWO', '', 'L2', 'DEBIT', ''],
    ]);
    expect(tables[0].sourceLines).toEqual([1, 1]);
  });

  it('does not lose the fields after an empty value in a file that closes some of its values', async () => {
    // One memo is closed the XML way, the next is empty and left open the SGML way, with the name after it.
    const mixed = sgmlFile(
      sgmlStatement([
        { id: 'M1', name: 'FIRST', memo: 'closed memo</MEMO>' },
        { id: 'M2', name: '', extra: '<MEMO>\n<NAME>SECOND\n<CHECKNUM>77\n' },
      ])
    );
    const { tables } = await read(mixed);
    expect(tables[0].rows).toEqual([
      ['2026-09-01', '-1.00', 'FIRST', 'closed memo', 'M1', 'DEBIT', ''],
      ['2026-09-01', '-1.00', 'SECOND', '', 'M2', 'DEBIT', '77'],
    ]);
  });

  it('passes a date or an amount it cannot read through as written', async () => {
    const { tables } = await read(sgmlFile(sgmlStatement([{ posted: '2026-09-01', amount: 'N/A' }, { posted: '20260902', amount: '-12,50' }])));
    expect(tables[0].rows.map((row) => row.slice(0, 2))).toEqual([
      ['2026-09-01', 'N/A'],
      ['2026-09-02', '-12.50'],
    ]);
  });

  it('flags a file that was cut off and leaves out the transaction it stops in', async () => {
    const whole = sgmlFile(sgmlStatement([{ id: 'K1', name: 'FIRST' }, { id: 'K2', name: 'SECOND' }, { id: 'K3', name: 'THIRD' }]));
    const cut = whole.slice(0, whole.indexOf('<NAME>THIRD') + 9);
    const { tables, issues } = await read(cut);
    expect(issues).toEqual([]);
    expect(tables[0].rows.map((row) => row[2])).toEqual(['FIRST', 'SECOND']);
    expect(tables[0].notes.map((note) => note.code)).toEqual(['truncatedFile']);
    // The account and the institution were read before the cut.
    expect(tables[0].fingerprint).toBe('ofx:example bank:checking');
    expect(tables[0].meta.accountHints[0]).toEqual({ kind: 'number', value: '000123456789', source: 'ofx' });
    expect(tables[0].meta.ledgerBalance).toBeNull();

    const complete = await read(whole);
    expect(complete.tables[0].rows).toHaveLength(3);
    expect(complete.tables[0].notes).toEqual([]);
  });

  it('honours the charset the header declares', async () => {
    const text = sgmlFile(sgmlStatement([{ name: 'CAFÉ MÜLLER' }]));
    // É and Ü as single Windows-1252 bytes, which is not valid UTF-8.
    const bytes = Uint8Array.from(text, (character) => character.charCodeAt(0));
    const { tables } = await readStatement({ name: 'bank.ofx', size: bytes.length, bytes });
    expect(tables[0].rows[0][2]).toBe('CAFÉ MÜLLER');
    expect(tables[0].meta.encoding).toBe('windows-1252');
    expect(tables[0].notes).toEqual([]);
  });

  it('notes a guessed encoding on every table of the file', async () => {
    const text = sgmlFile(sgmlStatement([{ name: 'CAFÉ' }], { account: '111' }) + sgmlStatement([{}], { account: '222' })).replace(
      'ENCODING:USASCII\nCHARSET:1252',
      'ENCODING:UTF-8\nCHARSET:NONE'
    );
    const bytes = Uint8Array.from(text, (character) => character.charCodeAt(0));
    const { tables } = await readStatement({ name: 'bank.ofx', size: bytes.length, bytes });
    expect(tables.map((table) => table.notes.map((note) => note.code))).toEqual([
      ['encodingGuessed', 'multipleAccountsInFile'],
      ['encodingGuessed', 'multipleAccountsInFile'],
    ]);
  });

  it('counts source lines across CRLF line endings', async () => {
    const { tables } = await read(sgmlFile(sgmlStatement([{ id: 'R1' }, { id: 'R2' }])).replace(/\n/g, '\r\n'));
    // Header on lines 1–7, a blank line, <OFX> on 9, sign-on on 10–17, <BANKMSGSRSV1> on 18, the
    // statement's twelve opening lines on 19–30, then a seven-line transaction on 31 and the next on 38.
    expect(tables[0].sourceLines).toEqual([31, 38]);
  });
});
