/**
 * Format sniffing: what kind of file is this, judged by its content and never
 * by its extension (banks hand out ".csv" that is tab-separated, ".xls" that
 * is HTML and ".qfx" that is plain OFX).
 */

/**
 * `params.kind` of an `unsupportedFormat` issue: what the file is, so the
 * wizard can say what to export instead.
 *   xlsx / xls   a spreadsheet workbook            pdf     a PDF statement
 *   qif          Quicken Interchange Format        html    a web page (often saved as ".xls")
 *   zip          an archive that is not a workbook image   a picture or scan
 *   json / xml   structured data that is not OFX   text    text with no columns in it
 *   binary       anything else that is not text
 */
export type UnsupportedKind = 'xlsx' | 'xls' | 'pdf' | 'qif' | 'html' | 'zip' | 'image' | 'json' | 'xml' | 'text' | 'binary';

export type TextKind = 'ofx' | 'delimited' | UnsupportedKind;

function startsWithBytes(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function containsAscii(bytes: Uint8Array, needle: string, from: number, to: number): boolean {
  const first = needle.charCodeAt(0);
  const last = Math.min(to, bytes.length) - needle.length;
  for (let index = Math.max(from, 0); index <= last; index++) {
    if (bytes[index] !== first) continue;
    let matched = 1;
    while (matched < needle.length && bytes[index + matched] === needle.charCodeAt(matched)) matched++;
    if (matched === needle.length) return true;
  }
  return false;
}

const SCAN = 64 * 1024;

/** Recognises files that are not text at all by their first bytes. Null = go on and decode it. */
export function sniffBinaryKind(bytes: Uint8Array): UnsupportedKind | null {
  if (startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf'; // %PDF-
  if (startsWithBytes(bytes, [0x50, 0x4b]) && [0x03, 0x05, 0x07].includes(bytes[2])) {
    // A ZIP container: a workbook has its parts under "xl/". The names are
    // in the local headers at the start and again in the directory at the end.
    const isWorkbook =
      containsAscii(bytes, 'xl/', 0, SCAN) || containsAscii(bytes, 'xl/', bytes.length - SCAN, bytes.length);
    return isWorkbook ? 'xlsx' : 'zip';
  }
  if (startsWithBytes(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'xls'; // OLE2 compound file
  if (
    startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47]) || // PNG
    startsWithBytes(bytes, [0xff, 0xd8, 0xff]) || // JPEG
    startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38]) || // GIF8
    startsWithBytes(bytes, [0x49, 0x49, 0x2a, 0x00]) || // TIFF, little-endian
    startsWithBytes(bytes, [0x4d, 0x4d, 0x00, 0x2a]) // TIFF, big-endian
  ) {
    return 'image';
  }
  return null;
}

/** Decoded "text" that is really binary: zero characters, or control characters all over. */
function looksBinary(text: string): boolean {
  const length = Math.min(text.length, 8192);
  let controls = 0;
  for (let index = 0; index < length; index++) {
    const code = text.charCodeAt(index);
    if (code === 0) return true;
    // Tab, line feed, form feed, carriage return and the DOS end-of-file mark are fine.
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0c && code !== 0x0d && code !== 0x1a) controls++;
  }
  return controls > length / 200;
}

function isJson(text: string): boolean {
  const trimmed = text.trim();
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if (!((first === '{' && last === '}') || (first === '[' && last === ']'))) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/** What decoded text is: OFX / QFX, a format we name but do not read, or delimited text. */
export function sniffTextKind(text: string): TextKind {
  if (looksBinary(text)) return 'binary';
  const head = text.slice(0, 4096).trimStart();

  // OFX 1.x starts with an "OFXHEADER:100" block, OFX 2.x with an <?OFX ?>
  // instruction; a file with neither still opens with markup and has the
  // <OFX> element. ("<OFX>" inside a cell of a delimited file is just text.)
  if (/^OFXHEADER\s*[:=]/i.test(head)) return 'ofx';
  if (head.startsWith('<') && /<\?OFX\b|<OFX[\s>]/i.test(head)) return 'ofx';
  if (/^!(?:Type:|Option:|Clear:|Account\b)/i.test(head)) return 'qif';
  if (/^<(?:!DOCTYPE\s+html|html|head|body|table|meta)\b/i.test(head)) return 'html';
  if (/^<\?xml\b/i.test(head) || /^<[A-Za-z][\w:.-]*[\s>]/.test(head)) return 'xml';
  if (isJson(text)) return 'json';
  return 'delimited';
}
