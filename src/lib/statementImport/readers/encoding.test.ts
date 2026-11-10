import { describe, expect, it } from 'vitest';

import { declaredOfxEncoding, decodeStatementBytes, decodeWindows1252 } from './encoding';

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0));
const utf8 = (text: string) => new TextEncoder().encode(text);
const join = (...parts: Uint8Array[]) => {
  const all = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    all.set(part, offset);
    offset += part.length;
  }
  return all;
};
function utf16(text: string, bigEndian = false): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    out[index * 2] = bigEndian ? unit >> 8 : unit & 0xff;
    out[index * 2 + 1] = bigEndian ? unit & 0xff : unit >> 8;
  }
  return out;
}

const SGML_HEADER = (encoding: string, charset: string) =>
  `OFXHEADER:100\r\nDATA:OFXSGML\r\nVERSION:102\r\nSECURITY:NONE\r\nENCODING:${encoding}\r\nCHARSET:${charset}\r\nCOMPRESSION:NONE\r\n\r\n<OFX>`;

describe('decodeStatementBytes', () => {
  it('reads UTF-8 and strips its byte-order mark', () => {
    expect(decodeStatementBytes(join(bytes(0xef, 0xbb, 0xbf), utf8('Date,Café')))).toEqual({
      text: 'Date,Café',
      encoding: 'utf-8',
      guessed: false,
    });
    expect(decodeStatementBytes(utf8('日付,金額\n2026年9月1日,¥1,200'))).toEqual({
      text: '日付,金額\n2026年9月1日,¥1,200',
      encoding: 'utf-8',
      guessed: false,
    });
  });

  it('reads UTF-16 by its byte-order mark, either byte order', () => {
    expect(decodeStatementBytes(join(bytes(0xff, 0xfe), utf16('Date\tCafé €')))).toEqual({
      text: 'Date\tCafé €',
      encoding: 'utf-16le',
      guessed: false,
    });
    expect(decodeStatementBytes(join(bytes(0xfe, 0xff), utf16('Date\tCafé €', true)))).toEqual({
      text: 'Date\tCafé €',
      encoding: 'utf-16be',
      guessed: false,
    });
  });

  it('recognises UTF-16 without a mark by its zero bytes, as a guess', () => {
    const text = 'Date\tDescription\tAmount\r\n2026-09-01\tCOFFEE\t-4.50\r\n';
    expect(decodeStatementBytes(utf16(text))).toEqual({ text, encoding: 'utf-16le', guessed: true });
    expect(decodeStatementBytes(utf16(text, true))).toEqual({ text, encoding: 'utf-16be', guessed: true });
  });

  it('falls back to Windows-1252 when the bytes are not valid UTF-8, and says so', () => {
    // "CAFÉ – 2 €" in Windows-1252: É = C9, en dash = 96, euro = 80.
    const decoded = decodeStatementBytes(bytes(0x43, 0x41, 0x46, 0xc9, 0x20, 0x96, 0x20, 0x32, 0x20, 0x80));
    expect(decoded).toEqual({ text: 'CAFÉ – 2 €', encoding: 'windows-1252', guessed: true });
  });

  it('validates UTF-8 strictly: a sequence cut short or overlong is not UTF-8', () => {
    expect(decodeStatementBytes(join(ascii('Caf'), bytes(0xc3))).encoding).toBe('windows-1252'); // lead byte, nothing after
    expect(decodeStatementBytes(join(ascii('a'), bytes(0xc0, 0xaf))).encoding).toBe('windows-1252'); // overlong "/"
    expect(decodeStatementBytes(join(ascii('a'), bytes(0xa9), ascii('b'))).encoding).toBe('windows-1252'); // stray continuation
  });

  it('drops a UTF-8 mark that sits on bytes that are not UTF-8', () => {
    expect(decodeStatementBytes(bytes(0xef, 0xbb, 0xbf, 0x43, 0xe9))).toEqual({
      text: 'Cé',
      encoding: 'windows-1252',
      guessed: true,
    });
  });

  it("lets the caller's encoding win, under its standard label", () => {
    // "é" as UTF-8 (C3 A9), forced to Windows-1252.
    expect(decodeStatementBytes(utf8('é'), 'windows-1252')).toEqual({ text: 'Ã©', encoding: 'windows-1252', guessed: false });
    expect(decodeStatementBytes(utf8('é'), 'latin1').encoding).toBe('windows-1252');
    expect(decodeStatementBytes(bytes(0x43, 0xe9), 'UTF8')).toEqual({ text: 'C�', encoding: 'utf-8', guessed: false });
    expect(decodeStatementBytes(utf16('A€'), 'utf-16le')).toEqual({ text: 'A€', encoding: 'utf-16le', guessed: false });
    expect(decodeStatementBytes(utf16('A€', true), 'utf-16be')).toEqual({ text: 'A€', encoding: 'utf-16be', guessed: false });
  });

  it('ignores an encoding name it does not know and detects instead', () => {
    expect(decodeStatementBytes(utf8('Café'), 'klingon')).toEqual({ text: 'Café', encoding: 'utf-8', guessed: false });
  });

  it('honours the charset an OFX 1.x header declares', () => {
    // É as the single byte C9, declared as code page 1252: nothing is guessed.
    const file = join(ascii(`${SGML_HEADER('USASCII', '1252')}<NAME>CAF`), bytes(0xc9));
    expect(decodeStatementBytes(file)).toMatchObject({ encoding: 'windows-1252', guessed: false });
    expect(decodeStatementBytes(file).text.endsWith('<NAME>CAFÉ')).toBe(true);

    // Pure ASCII under a declared code page is still that code page.
    expect(decodeStatementBytes(ascii(`${SGML_HEADER('USASCII', '1252')}<NAME>CAFE`))).toMatchObject({
      encoding: 'windows-1252',
      guessed: false,
    });
  });

  it('reads UTF-8 that a header mislabels as a one-byte charset, and says it overrode the header', () => {
    const file = join(ascii(`${SGML_HEADER('USASCII', '1252')}<NAME>`), utf8('PADARIA SÃO JOÃO'));
    const decoded = decodeStatementBytes(file);
    expect(decoded).toMatchObject({ encoding: 'utf-8', guessed: true });
    expect(decoded.text.endsWith('PADARIA SÃO JOÃO')).toBe(true);
  });

  it('falls back when an OFX header declares UTF-8 but the bytes are not', () => {
    const file = join(ascii(`${SGML_HEADER('UTF-8', 'NONE')}<NAME>CAF`), bytes(0xc9));
    expect(decodeStatementBytes(file)).toMatchObject({ encoding: 'windows-1252', guessed: true });
  });

  it('decodes a declared code page other than 1252', () => {
    // "Łódź" in Windows-1250: Ł = A3, ó = F3, d, ź = 9F.
    const file = join(ascii(`${SGML_HEADER('USASCII', '1250')}<NAME>`), bytes(0xa3, 0xf3, 0x64, 0x9f));
    const decoded = decodeStatementBytes(file);
    expect(decoded).toMatchObject({ encoding: 'windows-1250', guessed: false });
    expect(decoded.text.endsWith('<NAME>Łódź')).toBe(true);
  });
});

describe('decodeWindows1252', () => {
  it('maps 0x80–0x9F to their characters and keeps the five unassigned bytes as control codes', () => {
    expect(decodeWindows1252(bytes(0x80, 0x85, 0x91, 0x92, 0x93, 0x94, 0x99, 0x9c))).toBe('€…‘’“”™œ');
    expect(decodeWindows1252(bytes(0x81, 0x8d, 0x8f, 0x90, 0x9d))).toBe('\u0081\u008d\u008f\u0090\u009d');
    expect(decodeWindows1252(bytes(0x41, 0xe9, 0xff))).toBe('Aéÿ');
  });

  it('decodes input larger than one chunk', () => {
    const big = new Uint8Array(100_000).fill(0xe9);
    const text = decodeWindows1252(big);
    expect(text).toHaveLength(100_000);
    expect(text[0]).toBe('é');
    expect(text[99_999]).toBe('é');
  });
});

describe('declaredOfxEncoding', () => {
  it('reads ENCODING / CHARSET from an OFX 1.x header', () => {
    expect(declaredOfxEncoding(ascii(SGML_HEADER('USASCII', '1252')))).toBe('windows-1252');
    expect(declaredOfxEncoding(ascii(SGML_HEADER('USASCII', 'ISO-8859-1')))).toBe('iso-8859-1');
    expect(declaredOfxEncoding(ascii(SGML_HEADER('USASCII', '932')))).toBe('shift_jis');
    expect(declaredOfxEncoding(ascii(SGML_HEADER('UTF-8', 'NONE')))).toBe('utf-8');
    expect(declaredOfxEncoding(ascii(SGML_HEADER('UNICODE', 'NONE')))).toBe('utf-8');
    expect(declaredOfxEncoding(ascii(SGML_HEADER('USASCII', 'NONE')))).toBeNull();
  });

  it('reads the XML declaration of an OFX 2.x file', () => {
    const xml = '<?xml version="1.0" encoding="ISO-8859-1"?>\n<?OFX OFXHEADER="200" VERSION="211"?>\n<OFX>';
    expect(declaredOfxEncoding(ascii(xml))).toBe('ISO-8859-1');
    expect(declaredOfxEncoding(ascii('<?xml version="1.0"?>\n<?OFX OFXHEADER="200"?>\n<OFX>'))).toBeNull();
  });

  it('says nothing about files that are not OFX', () => {
    expect(declaredOfxEncoding(ascii('Date,Amount\n2026-09-01,1.00'))).toBeNull();
    expect(declaredOfxEncoding(ascii('<?xml version="1.0" encoding="UTF-16"?><Document></Document>'))).toBeNull();
    expect(declaredOfxEncoding(ascii('Note: ENCODING:USASCII CHARSET:1252 is typical'))).toBeNull();
  });
});
