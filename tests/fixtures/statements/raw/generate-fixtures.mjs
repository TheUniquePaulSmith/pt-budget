#!/usr/bin/env node
/**
 * Writes the byte-exact reader fixtures in this folder and their
 * `<name>.expected.json` manifests.
 *
 *   node tests/fixtures/statements/raw/generate-fixtures.mjs
 *
 * These files exist to pin encodings, byte-order marks, line endings and
 * binary signatures, which an editor would quietly change, so they are
 * written from this script and never edited by hand. Rerunning it rewrites
 * the same bytes. `utf8-bom-crlf.csv` (the foundation's seed fixture) is not
 * generated here and is left alone.
 *
 * Every row is invented: no real statement, account number or person.
 * The manifest format is in ../README.md; `read` states what `readStatement`
 * must return, `layout` / `analysis` only what is a plain fact of the file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CRLF = '\r\n';
const LF = '\n';

// --- encoders ---------------------------------------------------------------

const utf8 = (text) => Buffer.from(text, 'utf8');
const utf16le = (text) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);

const CP1252_SPECIALS = { '€': 0x80, '–': 0x96, '’': 0x92 };
/** Windows-1252: Latin-1 for everything below U+0100, plus the few 0x80–0x9F characters used here. */
function windows1252(text) {
  return Buffer.from(
    [...text].map((character) => {
      const special = CP1252_SPECIALS[character];
      if (special !== undefined) return special;
      const code = character.codePointAt(0);
      if (code > 0xff) throw new Error(`"${character}" has no Windows-1252 byte in this script`);
      return code;
    })
  );
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A ZIP archive with stored (uncompressed) entries and a fixed timestamp, so the bytes never change. */
function zip(entries) {
  const DOS_TIME = 0;
  const DOS_DATE = ((2026 - 1980) << 9) | (9 << 5) | 30;
  const locals = [];
  const directory = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directoryBytes, end]);
}

/** A one-page PDF with a correct cross-reference table. */
function pdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null, // the content stream, built below
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = 'BT /F1 12 Tf 72 720 Td (Statement 09/01/2026 - 09/30/2026: synthetic sample) Tj ET';
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;

  const parts = [Buffer.from('%PDF-1.4\n', 'latin1'), Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])];
  const offsets = [];
  let length = parts.reduce((total, part) => total + part.length, 0);
  objects.forEach((body, index) => {
    offsets.push(length);
    const object = Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`, 'latin1');
    parts.push(object);
    length += object.length;
  });
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    '0000000000 65535 f \n',
    ...offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`,
  ].join('');
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
}

// --- fixtures ---------------------------------------------------------------

/** `lines` joined with `eol`; a final line break unless `open` (the file stops mid-line). */
const text = (lines, eol, { open = false } = {}) => lines.join(eol) + (open ? '' : eol);

const OFX_LAYOUT = {
  roles: { date: 0, amount: 1, description: [2, 3], reference: 4 },
  dateOrder: 'YMD',
  decimal: '.',
  amountSign: 'asIs',
};
const OFX_COLUMNS = ['Date', 'Amount', 'Name', 'Memo', 'Reference', 'Type', 'Check Number'];

const SGML_HEADER = [
  'OFXHEADER:100',
  'DATA:OFXSGML',
  'VERSION:102',
  'SECURITY:NONE',
  'ENCODING:USASCII',
  'CHARSET:1252',
  'COMPRESSION:NONE',
  'OLDFILEUID:NONE',
  'NEWFILEUID:NONE',
  '',
];

const fixtures = [
  {
    file: 'utf16-tab.txt',
    bytes: utf16le(
      text(
        [
          'Posting Date\tDescription\tAmount\tBalance',
          '09/03/2026\tCAFÉ LUNA\t-6.75\t1,243.25',
          '09/04/2026\tPAYROLL NORTHWIND LLC\t2,150.00\t3,393.25',
          "09/05/2026\tGROCER'S OUTLET, MAIN ST\t-82.19\t3,311.06",
        ],
        CRLF
      )
    ),
    description:
      'UTF-16 little-endian with a byte-order mark (FF FE), tab-separated, CRLF line endings: what a spreadsheet program writes for "Unicode text". One description has a comma, which must not split the cell. Written with Buffer.from(text, "utf16le") behind the two mark bytes.',
    read: {
      issues: [],
      tables: 1,
      format: 'delimited',
      encoding: 'utf-16le',
      delimiter: '\t',
      headerLine: 1,
      columns: ['Posting Date', 'Description', 'Amount', 'Balance'],
      rows: 3,
      notes: [],
      fingerprint: 'delimited:posting date|description|amount|balance',
    },
    analysis: { readyRows: 3, firstDate: '2026-09-03', lastDate: '2026-09-05', moneyIn: 2150, moneyOut: 88.94 },
  },
  {
    file: 'windows-1252-accents.csv',
    bytes: windows1252(
      text(
        [
          'Date,Description,Amount',
          '2026-09-06,CRÉDIT AGRICOLE – VIREMENT,120.00',
          '2026-09-07,BÄCKEREI MÜLLER,-3.80',
          '2026-09-08,"FRAIS BANCAIRES, 2 €",-2.00',
        ],
        LF
      )
    ),
    description:
      'Windows-1252 with no byte-order mark: accented capitals (C9, C4, DC), an en dash (96) and a euro sign (80), none of which is valid UTF-8. The reader must fall back to Windows-1252 and say that it guessed. Written byte by byte from a character table.',
    read: {
      issues: [],
      tables: 1,
      format: 'delimited',
      encoding: 'windows-1252',
      delimiter: ',',
      headerLine: 1,
      columns: ['Date', 'Description', 'Amount'],
      rows: 3,
      notes: ['encodingGuessed'],
      fingerprint: 'delimited:date|description|amount',
    },
    analysis: { readyRows: 3, firstDate: '2026-09-06', lastDate: '2026-09-08', moneyIn: 120, moneyOut: 5.8 },
  },
  {
    file: 'semicolon-decimal-comma.csv',
    bytes: utf8(
      text(
        [
          'Buchungstag;Verwendungszweck;Betrag;Währung',
          '01.09.2026;Miete September;-1.250,00;EUR',
          '03.09.2026;Gehalt Nordwind GmbH;3.400,50;EUR',
          '14.09.2026;Bäckerei Sonnenschein;-7,35;EUR',
          '28.09.2026;Stadtwerke Abschlag;-89,90;EUR',
        ],
        CRLF
      )
    ),
    description:
      'Semicolon-separated, as exports from decimal-comma countries are: every data row has exactly one comma (the decimal mark), so a reader that only counts commas sees a consistent two-column file. The header line, which has none, settles it. UTF-8, CRLF.',
    read: {
      issues: [],
      tables: 1,
      format: 'delimited',
      encoding: 'utf-8',
      delimiter: ';',
      headerLine: 1,
      columns: ['Buchungstag', 'Verwendungszweck', 'Betrag', 'Währung'],
      rows: 4,
      notes: [],
      fingerprint: 'delimited:buchungstag|verwendungszweck|betrag|währung',
    },
  },
  {
    file: 'pipe-delimited.txt',
    bytes: utf8(
      text(
        [
          'Date|Description|Amount|Type',
          '2026-09-10|TRANSIT PASS, MONTHLY|-64.00|DEBIT',
          '2026-09-11|REFUND; ORDER 1182|18.25|CREDIT',
          '2026-09-12|BOOKSHOP|-22.40|DEBIT',
        ],
        LF
      )
    ),
    description:
      'Pipe-separated text. One description has a comma and another a semicolon; neither is the separator because neither splits every line alike. UTF-8, LF.',
    read: {
      issues: [],
      tables: 1,
      format: 'delimited',
      encoding: 'utf-8',
      delimiter: '|',
      headerLine: 1,
      columns: ['Date', 'Description', 'Amount', 'Type'],
      rows: 3,
      notes: [],
      fingerprint: 'delimited:date|description|amount|type',
    },
    analysis: { readyRows: 3, firstDate: '2026-09-10', lastDate: '2026-09-12', moneyIn: 18.25, moneyOut: 86.4 },
  },
  {
    file: 'preamble-account-number.csv',
    bytes: utf8(
      text(
        [
          'Northwind Community Bank',
          'Account Number: 000123456789',
          'Account Type: Checking',
          'Statement Period: 09/01/2026 - 09/30/2026',
          '',
          'Date,Description,Amount,Balance',
          '09/02/2026,COFFEE ROASTERS,-4.25,995.75',
          '09/09/2026,PAYROLL NORTHWIND LLC,1500.00,2495.75',
          '09/15/2026,ELECTRIC UTILITY,-74.10,2421.65',
        ],
        CRLF
      )
    ),
    description:
      'Four lines of bank preamble (name, account number, account type, statement period) and a blank line above the header, which is on line 6. The preamble is skipped, kept in meta.preamble, and gives a "number" and an "accountType" hint. UTF-8, CRLF.',
    read: {
      issues: [],
      tables: 1,
      format: 'delimited',
      encoding: 'utf-8',
      delimiter: ',',
      headerLine: 6,
      columns: ['Date', 'Description', 'Amount', 'Balance'],
      rows: 3,
      notes: ['preambleSkipped'],
      fingerprint: 'delimited:date|description|amount|balance',
    },
    analysis: { readyRows: 3, firstDate: '2026-09-02', lastDate: '2026-09-15', moneyIn: 1500, moneyOut: 78.35 },
  },
  {
    file: 'trailing-total-row.csv',
    bytes: utf8(
      text(
        [
          'Date,Description,Category,Amount',
          '2026-09-01,RENT,Housing,-1200.00',
          '2026-09-05,GROCERY MART,Food,-56.30',
          '2026-09-12,INTEREST PAID,Income,1.12',
          'Total,,,-1255.18',
          '',
          '"This export lists posted transactions only, as of 2026-09-30."',
        ],
        LF
      )
    ),
    description:
      'A total row in table shape and, after a blank line, a quoted disclaimer below the data. Both are skipped and kept in meta.trailer; importing the total would double the spending. UTF-8, LF.',
    read: {
      issues: [],
      tables: 1,
      format: 'delimited',
      encoding: 'utf-8',
      delimiter: ',',
      headerLine: 1,
      columns: ['Date', 'Description', 'Category', 'Amount'],
      rows: 3,
      notes: ['trailerSkipped'],
      fingerprint: 'delimited:date|description|category|amount',
    },
    analysis: { readyRows: 3, firstDate: '2026-09-01', lastDate: '2026-09-12', moneyIn: 1.12, moneyOut: 1256.3 },
  },
  {
    file: 'no-header-row.csv',
    bytes: utf8(
      text(
        [
          '2026-09-01,CARD PURCHASE,HARDWARE DEPOT,-35.99',
          '2026-09-03,DIRECT DEPOSIT,NORTHWIND LLC,980.00',
          '2026-09-04,CARD PURCHASE,CORNER BAKERY,-8.40',
        ],
        LF
      )
    ),
    description:
      'No header row: the first line is already a transaction. The columns are named "Column 1" to "Column 4" (synthetic), headerLine is null and the fingerprint is the column count. UTF-8, LF.',
    read: {
      issues: [],
      tables: 1,
      format: 'delimited',
      encoding: 'utf-8',
      delimiter: ',',
      headerLine: null,
      columns: ['Column 1', 'Column 2', 'Column 3', 'Column 4'],
      rows: 3,
      notes: ['headerMissing'],
      fingerprint: 'delimited:noheader:4',
    },
  },
  {
    file: 'ragged-rows.csv',
    bytes: utf8(
      text(
        [
          'Date,Description,Amount,Memo',
          '2026-09-01,COFFEE BAR,-3.50,',
          '2026-09-02,STREAMING SERVICE,-12.99',
          '2026-09-03,ACME SUPPLY, UNIT 4,-41.00,office',
          '2026-09-04,PAYROLL,2000.00,',
        ],
        LF
      )
    ),
    description:
      'Rows that do not match the header width: line 3 is one cell short (padded) and line 4 has an unquoted comma in the description, so it is one cell long (cut to the header width, which shifts its amount). Both are reported in raggedRows with their row indexes. UTF-8, LF.',
    read: {
      issues: [],
      tables: 1,
      format: 'delimited',
      encoding: 'utf-8',
      delimiter: ',',
      headerLine: 1,
      columns: ['Date', 'Description', 'Amount', 'Memo'],
      rows: 4,
      notes: ['raggedRows'],
      fingerprint: 'delimited:date|description|amount|memo',
    },
  },
  {
    file: 'truncated-mid-row.csv',
    bytes: utf8(
      text(
        [
          'Date,Description,Amount,Balance',
          '2026-09-20,PHARMACY,-18.20,512.44',
          '2026-09-21,GAS STATION,-40.00,472.44',
          '2026-09-22,ONLINE MARKETP',
        ],
        CRLF,
        { open: true }
      )
    ),
    description:
      'A download that was cut short: the last line stops in the middle of the description, with no line break after it. The half row is left out (kept in meta.trailer) and the table carries truncatedFile. UTF-8, CRLF, no final line break.',
    read: {
      issues: [],
      tables: 1,
      format: 'delimited',
      encoding: 'utf-8',
      delimiter: ',',
      headerLine: 1,
      columns: ['Date', 'Description', 'Amount', 'Balance'],
      rows: 2,
      notes: ['truncatedFile'],
      fingerprint: 'delimited:date|description|amount|balance',
    },
    analysis: { readyRows: 2, firstDate: '2026-09-20', lastDate: '2026-09-21', moneyIn: 0, moneyOut: 58.2 },
  },
  {
    file: 'quoted-multiline-blank-lines.csv',
    bytes: utf8(
      text(
        [
          'Date,Description,Amount',
          '2026-09-01,"WIRE TRANSFER',
          'REF 99-1182',
          'BENEFICIARY: ACME SUPPLY",-410.00',
          '',
          '2026-09-02,COFFEE BAR,-3.50',
          '',
          '',
          '2026-09-05,PAYROLL,2000.00',
        ],
        CRLF
      )
    ),
    description:
      'A quoted description that runs over three lines, and blank lines between rows. Three rows, on file lines 2, 6 and 9: sourceLines must be the real line each row starts on. UTF-8, CRLF.',
    read: {
      issues: [],
      tables: 1,
      format: 'delimited',
      encoding: 'utf-8',
      delimiter: ',',
      headerLine: 1,
      columns: ['Date', 'Description', 'Amount'],
      rows: 3,
      notes: [],
      fingerprint: 'delimited:date|description|amount',
    },
    analysis: { readyRows: 3, firstDate: '2026-09-01', lastDate: '2026-09-05', moneyIn: 2000, moneyOut: 413.5 },
  },
  {
    file: 'duplicate-header-names.csv',
    bytes: utf8(
      text(['Date,Description,Amount,Amount', '2026-09-01,COFFEE BAR,-3.50,', '2026-09-02,PAYROLL,,2000.00'], LF)
    ),
    description:
      'Two columns with the same header name (money out and money in, both called "Amount"). The second is renamed "Amount (2)" so that a column can be picked by name, and the table carries duplicateHeaderNames. UTF-8, LF.',
    read: {
      issues: [],
      tables: 1,
      format: 'delimited',
      encoding: 'utf-8',
      delimiter: ',',
      headerLine: 1,
      columns: ['Date', 'Description', 'Amount', 'Amount (2)'],
      rows: 2,
      notes: ['duplicateHeaderNames'],
      fingerprint: 'delimited:date|description|amount|amount (2)',
    },
  },
  {
    file: 'ofx1-bank.ofx',
    bytes: windows1252(
      text(
        [
          ...SGML_HEADER,
          '<OFX>',
          '<SIGNONMSGSRSV1>',
          '<SONRS>',
          '<STATUS>',
          '<CODE>0',
          '<SEVERITY>INFO',
          '</STATUS>',
          '<DTSERVER>20260930120000[-5:EST]',
          '<LANGUAGE>ENG',
          '<FI>',
          '<ORG>Northwind Community Bank',
          '<FID>90210',
          '</FI>',
          '</SONRS>',
          '</SIGNONMSGSRSV1>',
          '<BANKMSGSRSV1>',
          '<STMTTRNRS>',
          '<TRNUID>1',
          '<STATUS>',
          '<CODE>0',
          '<SEVERITY>INFO',
          '</STATUS>',
          '<STMTRS>',
          '<CURDEF>USD',
          '<BANKACCTFROM>',
          '<BANKID>000000000',
          '<ACCTID>000123456789',
          '<ACCTTYPE>CHECKING',
          '</BANKACCTFROM>',
          '<BANKTRANLIST>',
          '<DTSTART>20260901000000[-5:EST]',
          '<DTEND>20260930235959[-5:EST]',
          '<STMTTRN>',
          '<TRNTYPE>DEBIT',
          '<DTPOSTED>20260902120000[-5:EST]',
          '<TRNAMT>-4.25',
          '<FITID>202609020001',
          '<NAME>CAFÉ LUNA',
          '<MEMO>CARD 4821 CAFÉ LUNA &amp; BAKERY',
          '</STMTTRN>',
          '<STMTTRN>',
          '<TRNTYPE>DIRECTDEP',
          '<DTPOSTED>20260909',
          '<TRNAMT>1500.00',
          '<FITID>202609090001',
          '<NAME>NORTHWIND LLC PAYROLL',
          '<MEMO>NORTHWIND LLC PAYROLL',
          '</STMTTRN>',
          '<STMTTRN>',
          '<TRNTYPE>CHECK',
          '<DTPOSTED>20260915120000.000[-5:EST]',
          '<TRNAMT>-250.00',
          '<FITID>202609150001',
          '<CHECKNUM>1042',
          '<NAME>CHECK 1042',
          '</STMTTRN>',
          '</BANKTRANLIST>',
          '<LEDGERBAL>',
          '<BALAMT>2245.75',
          '<DTASOF>20260930235959[-5:EST]',
          '</LEDGERBAL>',
          '<AVAILBAL>',
          '<BALAMT>2200.00',
          '<DTASOF>20260930235959[-5:EST]',
          '</AVAILBAL>',
          '</STMTRS>',
          '</STMTTRNRS>',
          '</BANKMSGSRSV1>',
          '</OFX>',
        ],
        CRLF
      )
    ),
    description:
      'OFX 1.x (SGML: values are not closed) for one checking account, three transactions. The header declares CHARSET:1252 and a name has É as the single byte C9, so the declared charset must be honoured. One memo repeats its name, one transaction has a check number, dates carry a time and a zone. CRLF.',
    read: {
      issues: [],
      tables: 1,
      format: 'ofx',
      encoding: 'windows-1252',
      columns: OFX_COLUMNS,
      rows: 3,
      notes: [],
      fingerprint: 'ofx:northwind community bank:checking',
    },
    layout: OFX_LAYOUT,
    analysis: { readyRows: 3, firstDate: '2026-09-02', lastDate: '2026-09-15', moneyIn: 1500, moneyOut: 254.25 },
  },
  {
    file: 'ofx2-credit-card.ofx',
    bytes: utf8(
      text(
        [
          '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
          '<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>',
          '<OFX>',
          '  <SIGNONMSGSRSV1>',
          '    <SONRS>',
          '      <STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>',
          '      <DTSERVER>20260930120000.000[0:GMT]</DTSERVER>',
          '      <LANGUAGE>ENG</LANGUAGE>',
          '      <FI><ORG>Harbor Card Services</ORG><FID>4477</FID></FI>',
          '    </SONRS>',
          '  </SIGNONMSGSRSV1>',
          '  <CREDITCARDMSGSRSV1>',
          '    <CCSTMTTRNRS>',
          '      <TRNUID>0</TRNUID>',
          '      <STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>',
          '      <CCSTMTRS>',
          '        <CURDEF>USD</CURDEF>',
          '        <CCACCTFROM><ACCTID>4000000000004821</ACCTID></CCACCTFROM>',
          '        <BANKTRANLIST>',
          '          <DTSTART>20260901</DTSTART>',
          '          <DTEND>20260930</DTEND>',
          '          <STMTTRN>',
          '            <TRNTYPE>DEBIT</TRNTYPE>',
          '            <DTPOSTED>20260904120000.000[0:GMT]</DTPOSTED>',
          '            <TRNAMT>-58.12</TRNAMT>',
          '            <FITID>CC-20260904-0001</FITID>',
          '            <NAME>GROCER&apos;S OUTLET</NAME>',
          '            <MEMO></MEMO>',
          '          </STMTTRN>',
          '          <STMTTRN>',
          '            <TRNTYPE>DEBIT</TRNTYPE>',
          '            <DTPOSTED>20260911120000.000[0:GMT]</DTPOSTED>',
          '            <TRNAMT>-19.99</TRNAMT>',
          '            <FITID>CC-20260911-0001</FITID>',
          '            <PAYEE><NAME>STREAMBOX</NAME><ADDR1>1 Example Way</ADDR1><CITY>Springfield</CITY><STATE>NA</STATE><POSTALCODE>00000</POSTALCODE></PAYEE>',
          '            <MEMO>Monthly plan — 東京</MEMO>',
          '          </STMTTRN>',
          '          <STMTTRN>',
          '            <TRNTYPE>CREDIT</TRNTYPE>',
          '            <DTPOSTED>20260920120000.000[0:GMT]</DTPOSTED>',
          '            <TRNAMT>250.00</TRNAMT>',
          '            <FITID>CC-20260920-0001</FITID>',
          '            <NAME>PAYMENT THANK YOU</NAME>',
          '            <CCACCTTO><ACCTID>999999</ACCTID></CCACCTTO>',
          '          </STMTTRN>',
          '        </BANKTRANLIST>',
          '        <LEDGERBAL>',
          '          <BALAMT>-431.07</BALAMT>',
          '          <DTASOF>20260930120000.000[0:GMT]</DTASOF>',
          '        </LEDGERBAL>',
          '      </CCSTMTRS>',
          '    </CCSTMTTRNRS>',
          '  </CREDITCARDMSGSRSV1>',
          '</OFX>',
        ],
        LF
      )
    ),
    description:
      'OFX 2.x (XML: every element closed) for one credit card, three transactions. Covers an XML entity in a name, an empty MEMO element, a PAYEE aggregate in place of NAME, multi-byte UTF-8 in a memo, and a CCACCTTO whose ACCTID must not be mistaken for the statement account. UTF-8, LF.',
    read: {
      issues: [],
      tables: 1,
      format: 'ofx',
      encoding: 'utf-8',
      columns: OFX_COLUMNS,
      rows: 3,
      notes: [],
      fingerprint: 'ofx:harbor card services:credit',
    },
    layout: OFX_LAYOUT,
    analysis: { readyRows: 3, firstDate: '2026-09-04', lastDate: '2026-09-20', moneyIn: 250, moneyOut: 78.11 },
  },
  {
    file: 'qfx-two-accounts.qfx',
    bytes: utf8(
      text(
        [
          ...SGML_HEADER,
          '<OFX>',
          '<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20260930<LANGUAGE>ENG<FI><ORG>Lakeside Credit Union<FID>7001</FI><INTU.BID>7001</SONRS></SIGNONMSGSRSV1>',
          '<BANKMSGSRSV1>',
          '<STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS>',
          '<STMTRS><CURDEF>USD<BANKACCTFROM><BANKID>000000000<ACCTID>5550001111<ACCTTYPE>CHECKING</BANKACCTFROM>',
          '<BANKTRANLIST><DTSTART>20260901<DTEND>20260930',
          '<STMTTRN><TRNTYPE>POS<DTPOSTED>20260905<TRNAMT>-23.10<FITID>C1<NAME>FARM STAND</STMTTRN>',
          '<STMTTRN><TRNTYPE>XFER<DTPOSTED>20260910<TRNAMT>-300.00<FITID>C2<NAME>TRANSFER TO SAVINGS<MEMO>To share 0002</STMTTRN>',
          '</BANKTRANLIST>',
          '<LEDGERBAL><BALAMT>1820.44<DTASOF>20260930</LEDGERBAL>',
          '</STMTRS></STMTTRNRS>',
          '<STMTTRNRS><TRNUID>2<STATUS><CODE>0<SEVERITY>INFO</STATUS>',
          '<STMTRS><CURDEF>USD<BANKACCTFROM><BANKID>000000000<ACCTID>5550002222<ACCTTYPE>SAVINGS</BANKACCTFROM>',
          '<BANKTRANLIST><DTSTART>20260901<DTEND>20260930',
          '<STMTTRN><TRNTYPE>XFER<DTPOSTED>20260910<TRNAMT>300.00<FITID>S1<NAME>TRANSFER FROM CHECKING</STMTTRN>',
          '<STMTTRN><TRNTYPE>INT<DTPOSTED>20260930<TRNAMT>0.42<FITID>S2<NAME>DIVIDEND</STMTTRN>',
          '</BANKTRANLIST>',
          '<LEDGERBAL><BALAMT>5300.42<DTASOF>20260930</LEDGERBAL>',
          '</STMTRS></STMTTRNRS>',
          '</BANKMSGSRSV1>',
          '</OFX>',
        ],
        LF
      )
    ),
    description:
      'QFX (OFX 1.x with Intuit tags) carrying two accounts: a checking and a savings statement, written the compact way with several tags on a line. One table per account, each with multipleAccountsInFile; the manifest describes the first (checking). LF.',
    read: {
      issues: [],
      tables: 2,
      format: 'ofx',
      encoding: 'windows-1252',
      columns: OFX_COLUMNS,
      rows: 2,
      notes: ['multipleAccountsInFile'],
      fingerprint: 'ofx:lakeside credit union:checking',
    },
    layout: OFX_LAYOUT,
    analysis: { readyRows: 2, firstDate: '2026-09-05', lastDate: '2026-09-10', moneyIn: 0, moneyOut: 323.1 },
  },
  {
    file: 'unsupported-workbook.xlsx',
    bytes: zip([
      [
        '[Content_Types].xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      ],
      [
        '_rels/.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      ],
      [
        'xl/workbook.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Transactions" sheetId="1" r:id="rId1"/></sheets></workbook>',
      ],
      [
        'xl/_rels/workbook.xml.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      ],
      [
        'xl/worksheets/sheet1.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Date</t></is></c><c r="B1" t="inlineStr"><is><t>Description</t></is></c><c r="C1" t="inlineStr"><is><t>Amount</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>2026-09-02</t></is></c><c r="B2" t="inlineStr"><is><t>COFFEE ROASTERS</t></is></c><c r="C2"><v>-4.25</v></c></row></sheetData></worksheet>',
      ],
    ]),
    description:
      'An Excel workbook (a ZIP container with its parts under xl/). Not read: no tables and one unsupportedFormat issue with params.kind "xlsx". Built as a stored (uncompressed) ZIP with a fixed timestamp and computed CRC-32s.',
    read: { issues: ['unsupportedFormat'], tables: 0 },
  },
  {
    file: 'unsupported-statement.pdf',
    bytes: pdf(),
    description:
      'A one-page PDF (starts with %PDF-). Not read: no tables and one unsupportedFormat issue with params.kind "pdf". Assembled object by object with a computed cross-reference table.',
    read: { issues: ['unsupportedFormat'], tables: 0 },
  },
  {
    file: 'unsupported-quicken.qif',
    bytes: utf8(
      text(
        ['!Type:Bank', 'D09/02/2026', 'T-4.25', 'PCOFFEE ROASTERS', '^', 'D09/09/2026', 'T1,500.00', 'PPAYROLL NORTHWIND LLC', '^'],
        CRLF
      )
    ),
    description:
      'Quicken Interchange Format (starts with !Type:). Plain text, but one field per line rather than a table. Not read: unsupportedFormat with params.kind "qif". UTF-8, CRLF.',
    read: { issues: ['unsupportedFormat'], tables: 0 },
  },
  {
    file: 'unsupported-html-table.xls',
    bytes: utf8(
      text(
        [
          '<html><head><meta charset="utf-8"><title>Transactions</title></head><body>',
          '<table><tr><th>Date</th><th>Description</th><th>Amount</th></tr>',
          '<tr><td>2026-09-02</td><td>COFFEE ROASTERS</td><td>-4.25</td></tr></table>',
          '</body></html>',
        ],
        LF
      )
    ),
    description:
      'A web page saved with an .xls extension, as some banks offer for "Excel": judged by its content, not its name. Not read: unsupportedFormat with params.kind "html". UTF-8, LF.',
    read: { issues: ['unsupportedFormat'], tables: 0 },
  },
];

for (const { file, bytes, description, read, layout, analysis } of fixtures) {
  fs.writeFileSync(path.join(HERE, file), bytes);
  const manifest = { file, description, read, ...(layout ? { layout } : {}), ...(analysis ? { analysis } : {}) };
  const manifestName = `${file.replace(/\.[^.]+$/, '')}.expected.json`;
  fs.writeFileSync(path.join(HERE, manifestName), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${file.padEnd(36)} ${String(bytes.length).padStart(5)} bytes`);
}
console.log(`\n${fixtures.length} fixtures written to ${path.relative(process.cwd(), HERE) || '.'}`);
