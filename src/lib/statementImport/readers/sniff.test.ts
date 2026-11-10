import { describe, expect, it } from 'vitest';

import { sourceFileFromText } from '../testing/tableFromCsv';
import type { SourceFile } from '../types';

import { readStatement } from './index';
import { sniffBinaryKind, sniffTextKind } from './sniff';

const ascii = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0));
const fileOf = (bytes: Uint8Array, name: string): SourceFile => ({ name, size: bytes.length, bytes });
const unsupported = (kind: string) => ({
  tables: [],
  issues: [{ code: 'unsupportedFormat', severity: 'blocker', scope: 'file', params: { kind } }],
});

describe('sniffBinaryKind', () => {
  it('knows a PDF, a workbook, another ZIP, a legacy workbook and pictures by their first bytes', () => {
    expect(sniffBinaryKind(ascii('%PDF-1.7\n%âã'))).toBe('pdf');
    expect(sniffBinaryKind(ascii('PK\u0003\u0004\u0014\u0000\u0000\u0000xl/workbook.xml<workbook/>'))).toBe('xlsx');
    expect(sniffBinaryKind(ascii('PK\u0003\u0004\u0014\u0000\u0000\u0000statements/2026-09.csv'))).toBe('zip');
    expect(sniffBinaryKind(ascii('PK\u0005\u0006' + '\u0000'.repeat(18)))).toBe('zip'); // an empty archive
    expect(sniffBinaryKind(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]))).toBe('xls');
    expect(sniffBinaryKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe('image');
    expect(sniffBinaryKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image');
    expect(sniffBinaryKind(ascii('GIF89a'))).toBe('image');
  });

  it('finds the workbook parts of a large ZIP in the directory at its end', () => {
    const big = new Uint8Array(200_000);
    big.set(ascii('PK\u0003\u0004'), 0);
    big.set(ascii('xl/worksheets/sheet1.xml'), 199_900);
    expect(sniffBinaryKind(big)).toBe('xlsx');
  });

  it('leaves text alone, including UTF-16 with a mark', () => {
    expect(sniffBinaryKind(ascii('Date,Amount\n2026-09-01,1.00'))).toBeNull();
    expect(sniffBinaryKind(new Uint8Array([0xff, 0xfe, 0x44, 0x00]))).toBeNull();
    expect(sniffBinaryKind(ascii('PKG,Amount\n1,2'))).toBeNull();
    expect(sniffBinaryKind(new Uint8Array([]))).toBeNull();
  });
});

describe('sniffTextKind', () => {
  it('recognises OFX by its header block, its processing instruction or its root element', () => {
    expect(sniffTextKind('OFXHEADER:100\nDATA:OFXSGML\n\n<OFX>')).toBe('ofx');
    expect(sniffTextKind('\r\n\r\nOFXHEADER:100\r\nDATA:OFXSGML')).toBe('ofx');
    expect(sniffTextKind('<?xml version="1.0"?>\n<?OFX OFXHEADER="200" VERSION="211"?>\n<OFX>')).toBe('ofx');
    expect(sniffTextKind('<OFX><SIGNONMSGSRSV1>')).toBe('ofx');
    expect(sniffTextKind('<ofx><signonmsgsrsv1>')).toBe('ofx');
  });

  it('names text formats it does not read', () => {
    expect(sniffTextKind('!Type:CCard\nD09/02/2026\nT-4.25\n^')).toBe('qif');
    expect(sniffTextKind('!Account\nNChecking\n^')).toBe('qif');
    expect(sniffTextKind('<!DOCTYPE html>\n<html><body><table>')).toBe('html');
    expect(sniffTextKind('  <TABLE border=1><tr><td>Date</td></tr></TABLE>')).toBe('html');
    expect(sniffTextKind('<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">')).toBe('xml');
    expect(sniffTextKind('<Statement><Entry/></Statement>')).toBe('xml');
    expect(sniffTextKind('{"transactions":[{"date":"2026-09-01","amount":-4.5}]}')).toBe('json');
    expect(sniffTextKind('[{"date":"2026-09-01"}]\n')).toBe('json');
  });

  it('calls decoded text with zero or control characters binary', () => {
    expect(sniffTextKind('Date\u0000,Amount')).toBe('binary');
    expect(sniffTextKind('\u0001\u0002\u0003\u0004\u0005\u0006 data')).toBe('binary');
  });

  it('takes everything else for delimited text', () => {
    expect(sniffTextKind('Date,Description,Amount\n2026-09-01,COFFEE,-4.50')).toBe('delimited');
    expect(sniffTextKind('[Date],[Amount]\n2026-09-01,1.00')).toBe('delimited'); // looks like JSON, is not
    expect(sniffTextKind('Date,Note\n2026-09-01,"<OFX> is a tag"')).toBe('delimited');
    expect(sniffTextKind('Date\tAmount\f\n2026-09-01\t1.00\u001a')).toBe('delimited'); // form feed, DOS end-of-file
  });
});

describe('readStatement: what kind of file', () => {
  it('returns no tables and one unsupportedFormat issue with the kind', async () => {
    expect(await readStatement(fileOf(ascii('%PDF-1.4\n1 0 obj'), 'september.pdf'))).toEqual(unsupported('pdf'));
    expect(await readStatement(fileOf(ascii('PK\u0003\u0004....xl/workbook.xml'), 'export.xlsx'))).toEqual(unsupported('xlsx'));
    expect(await readStatement(sourceFileFromText('!Type:Bank\nD09/02/2026\nT-4.25\n^\n', 'export.qif'))).toEqual(unsupported('qif'));
    expect(await readStatement(sourceFileFromText('<html><body><table></table></body></html>', 'export.xls'))).toEqual(
      unsupported('html')
    );
    expect(await readStatement(sourceFileFromText('{"rows":[]}', 'export.json'))).toEqual(unsupported('json'));
    expect(await readStatement(fileOf(new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00]), 'export.csv.gz'))).toEqual(
      unsupported('binary')
    );
  });

  it('goes by the content, not the extension', async () => {
    // A statement saved under the wrong name still reads.
    const csv = await readStatement(sourceFileFromText('Date,Description,Amount\n2026-09-01,COFFEE,-4.50\n', 'export.xlsx'));
    expect(csv.tables).toHaveLength(1);
    expect(csv.tables[0].format).toBe('delimited');
    // And a PDF renamed to .csv does not.
    expect(await readStatement(fileOf(ascii('%PDF-1.4\n'), 'export.csv'))).toEqual(unsupported('pdf'));
    // OFX under a .txt name is OFX.
    const ofx = await readStatement(
      sourceFileFromText(
        'OFXHEADER:100\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST><STMTTRN><DTPOSTED>20260901<TRNAMT>-1.00<FITID>1<NAME>X</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>',
        'download.txt'
      )
    );
    expect(ofx.tables[0].format).toBe('ofx');
  });

  it('reports text with no columns in it as unsupported, unless a delimiter was chosen', async () => {
    const letter = 'Dear customer\nYour statement is ready\nKind regards\n';
    expect(await readStatement(sourceFileFromText(letter, 'letter.txt'))).toEqual(unsupported('text'));

    const forced = await readStatement(sourceFileFromText(letter, 'letter.txt'), { delimiter: ',' });
    expect(forced.tables).toHaveLength(1);
    expect(forced.tables[0].columns).toHaveLength(1);
  });

  it('reports a file with nothing in it as empty', async () => {
    const empty = { tables: [], issues: [{ code: 'emptyFile', severity: 'blocker', scope: 'file' }] };
    expect(await readStatement(fileOf(new Uint8Array([]), 'empty.csv'))).toEqual(empty);
    expect(await readStatement(sourceFileFromText(' \r\n\t\r\n', 'blank.csv'))).toEqual(empty);
    expect(await readStatement(fileOf(new Uint8Array([0xef, 0xbb, 0xbf]), 'bom-only.csv'))).toEqual(empty);
    expect(await readStatement(sourceFileFromText(',,,\n,,,\n', 'commas.csv'))).toEqual(empty);
  });
});
