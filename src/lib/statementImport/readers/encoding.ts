/**
 * Decoding: bytes → text.
 *
 * What decides the encoding, strongest first:
 *   1. the caller's choice (`ReadOptions.encoding`: a saved layout or the Advanced panel);
 *   2. a byte-order mark (UTF-8, UTF-16 LE / BE);
 *   3. the charset an OFX / QFX header declares;
 *   4. UTF-16 with no mark, recognised by its zero bytes (reported as a guess);
 *   5. UTF-8, when every byte sequence is valid;
 *   6. Windows-1252, which can decode anything (reported as a guess).
 */

export interface DecodedText {
  text: string;
  /** WHATWG encoding label ("utf-8", "utf-16le", "windows-1252"). */
  encoding: string;
  /** True when nothing in the file said which encoding it is and UTF-8 did not fit. */
  guessed: boolean;
}

const WINDOWS_1252 = 'windows-1252';

// Bytes 0x80–0x9F of Windows-1252. The five bytes with no character keep
// their C1 code point, as the WHATWG encoding standard has it.
const CP1252_HIGH = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d,
  0x017d, 0x008f, 0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x009d, 0x017e, 0x0178,
];

const CHUNK = 0x8000;

function codeUnitsToString(units: Uint16Array): string {
  let text = '';
  for (let offset = 0; offset < units.length; offset += CHUNK) {
    text += String.fromCharCode.apply(null, units.subarray(offset, offset + CHUNK) as unknown as number[]);
  }
  return text;
}

/**
 * Windows-1252 by table, not `TextDecoder`: runtimes built without full ICU
 * have no such decoder, and some treat the label as ISO-8859-1.
 */
export function decodeWindows1252(bytes: Uint8Array): string {
  const units = new Uint16Array(bytes.length);
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index];
    units[index] = byte >= 0x80 && byte <= 0x9f ? CP1252_HIGH[byte - 0x80] : byte;
  }
  return codeUnitsToString(units);
}

function decodeUtf16(bytes: Uint8Array, bigEndian: boolean): string {
  const units = new Uint16Array(bytes.length >> 1);
  for (let index = 0; index < units.length; index++) {
    const first = bytes[index * 2];
    const second = bytes[index * 2 + 1];
    units[index] = bigEndian ? (first << 8) | second : (second << 8) | first;
  }
  return stripMark(codeUnitsToString(units));
}

function stripMark(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function decodeStrictUtf8(bytes: Uint8Array): string | null {
  try {
    return stripMark(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

/** Decodes with a named encoding; null when the runtime does not know the label. */
function decodeAs(bytes: Uint8Array, label: string): { text: string; encoding: string } | null {
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(label);
  } catch {
    return null;
  }
  const { encoding } = decoder;
  if (encoding === WINDOWS_1252) return { text: decodeWindows1252(bytes), encoding };
  if (encoding === 'utf-16le') return { text: decodeUtf16(bytes, false), encoding };
  if (encoding === 'utf-16be') return { text: decodeUtf16(bytes, true), encoding };
  return { text: stripMark(decoder.decode(bytes)), encoding };
}

function byteOrderMark(bytes: Uint8Array): 'utf-8' | 'utf-16le' | 'utf-16be' | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return null;
}

/**
 * UTF-16 saved without a mark: mostly-Latin text has a zero in every other
 * byte, always on the same side.
 */
function unmarkedUtf16(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const length = Math.min(bytes.length & ~1, 4096);
  if (length < 4) return null;
  let evenZeros = 0;
  let oddZeros = 0;
  for (let index = 0; index < length; index += 2) {
    if (bytes[index] === 0) evenZeros++;
    if (bytes[index + 1] === 0) oddZeros++;
  }
  const pairs = length / 2;
  if (oddZeros >= pairs * 0.6 && evenZeros <= pairs * 0.05) return 'utf-16le';
  if (evenZeros >= pairs * 0.6 && oddZeros <= pairs * 0.05) return 'utf-16be';
  return null;
}

const OFX_CODE_PAGES: Record<string, string> = {
  '874': 'windows-874',
  '932': 'shift_jis',
  '936': 'gbk',
  '949': 'euc-kr',
  '950': 'big5',
};

/**
 * The encoding an OFX / QFX file says it is in, as a `TextDecoder` label.
 * OFX 1.x: `ENCODING:USASCII` + `CHARSET:1252`, or `ENCODING:UTF-8`.
 * OFX 2.x: the XML declaration's `encoding="…"`. Null when the file is not
 * OFX or names nothing.
 */
export function declaredOfxEncoding(bytes: Uint8Array): string | null {
  // The header is ASCII whatever the body is in.
  const head = decodeWindows1252(bytes.subarray(0, 1024)).trimStart();

  if (/^<\?xml\b/i.test(head)) {
    if (!/<\?OFX\b|<OFX[\s>]/i.test(head)) return null;
    return /^<\?xml\b[^>]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(head)?.[1] ?? null;
  }
  if (!/^OFXHEADER\s*[:=]/i.test(head)) return null;

  const encoding = /\bENCODING\s*:\s*([^\s<]+)/i.exec(head)?.[1]?.toUpperCase() ?? '';
  if (encoding === 'UTF-8' || encoding === 'UTF8' || encoding === 'UNICODE') return 'utf-8';

  const charset = /\bCHARSET\s*:\s*([^\s<]+)/i.exec(head)?.[1]?.toUpperCase() ?? '';
  if (!charset || charset === 'NONE') return null;
  if (charset === 'UTF-8' || charset === 'UTF8') return 'utf-8';
  if (/^(?:CP|WINDOWS-)?125\d$/.test(charset)) return `windows-${charset.slice(-4)}`;
  if (/^(?:ISO-?)?8859-\d{1,2}$/.test(charset)) return `iso-8859-${charset.slice(charset.lastIndexOf('-') + 1)}`;
  return OFX_CODE_PAGES[charset] ?? null;
}

function hasHighBytes(bytes: Uint8Array): boolean {
  for (let index = 0; index < bytes.length; index++) {
    if (bytes[index] >= 0x80) return true;
  }
  return false;
}

export function decodeStatementBytes(bytes: Uint8Array, override?: string): DecodedText {
  if (override) {
    const chosen = decodeAs(bytes, override);
    if (chosen) return { ...chosen, guessed: false };
  }

  const mark = byteOrderMark(bytes);
  if (mark === 'utf-16le' || mark === 'utf-16be') {
    return { text: decodeUtf16(bytes, mark === 'utf-16be'), encoding: mark, guessed: false };
  }

  // A UTF-8 mark on bytes that are not valid UTF-8 is dropped, not decoded.
  const body = mark === 'utf-8' ? bytes.subarray(3) : bytes;
  const utf8 = decodeStrictUtf8(body);
  if (mark === 'utf-8' && utf8 !== null) return { text: utf8, encoding: 'utf-8', guessed: false };

  const declared = declaredOfxEncoding(body);
  if (declared) {
    const named = decodeAs(body, declared);
    if (named && named.encoding === 'utf-8') {
      if (utf8 !== null) return { text: utf8, encoding: 'utf-8', guessed: false };
    } else if (named) {
      // Some banks declare a one-byte charset and send UTF-8 anyway. Bytes
      // above 0x7F that all form valid UTF-8 sequences are not an accident.
      if (utf8 !== null && hasHighBytes(body)) return { text: utf8, encoding: 'utf-8', guessed: true };
      return { ...named, guessed: false };
    }
  }

  const unmarked = unmarkedUtf16(body);
  if (unmarked) return { text: decodeUtf16(body, unmarked === 'utf-16be'), encoding: unmarked, guessed: true };

  if (utf8 !== null) return { text: utf8, encoding: 'utf-8', guessed: false };
  return { text: decodeWindows1252(body), encoding: WINDOWS_1252, guessed: true };
}
