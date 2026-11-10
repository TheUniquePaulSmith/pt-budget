/**
 * Delimited text → records of raw cells, with the file line each record
 * starts on. Written by hand rather than on PapaParse because the readers
 * need the real line numbers (blank lines and quoted line breaks included),
 * the raw text of skipped lines, and to know when the file ends mid-row.
 *
 * Quoting follows RFC 4180: a cell that starts with `"` runs to the closing
 * quote, `""` inside it is a literal quote, and delimiters and line breaks
 * inside it are part of the cell. A quote anywhere else is an ordinary
 * character.
 */

export interface RawRecord {
  /** Cell text as written: unquoted, not trimmed. */
  cells: string[];
  /** 1-based file line the record starts on. */
  line: number;
  /** Where the record's text sits in the decoded file, line terminator excluded. */
  start: number;
  end: number;
  /** The file ended inside a quoted cell that was opened on its last line. */
  openQuote: boolean;
}

export interface TokenizedText {
  /** Every record that has something in it, in file order. Blank lines and lines of empty cells are dropped. */
  records: RawRecord[];
  /** False when the last record ran into the end of the file with no line break after it. */
  lastRecordTerminated: boolean;
}

const QUOTE = 34;
const LF = 10;
const CR = 13;
const SPACE = 32;
const NON_BLANK = /\S/;

export function tokenizeDelimited(text: string, delimiter: string, maxRecords = Number.POSITIVE_INFINITY): TokenizedText {
  const records: RawRecord[] = [];
  const length = text.length;
  const delimiterCode = delimiter.charCodeAt(0);
  const delimiterLength = delimiter.length;
  const singleCharacter = delimiterLength === 1;
  const lastQuote = text.lastIndexOf('"');

  const isDelimiterAt = (index: number, code: number): boolean =>
    singleCharacter ? code === delimiterCode : code === delimiterCode && text.startsWith(delimiter, index);

  /** End of an unquoted run: the next delimiter, line break or the end of the file. */
  const scanToBoundary = (from: number): number => {
    let index = from;
    while (index < length) {
      const code = text.charCodeAt(index);
      if (code === LF || code === CR || isDelimiterAt(index, code)) break;
      index++;
    }
    return index;
  };

  let position = 0;
  let line = 1;
  let lastRecordTerminated = true;

  while (position < length && records.length < maxRecords) {
    const start = position;
    const startLine = line;
    const cells: string[] = [];
    let openQuote = false;
    let blank = true;
    let end = length;
    let terminated = false;

    for (;;) {
      let cell: string | null = null;
      let cursor = position;

      // A quote opens a cell at its start, or after spaces ('a, "b, c"').
      let quoteAt = position;
      if (delimiterCode !== SPACE) {
        while (quoteAt < length && text.charCodeAt(quoteAt) === SPACE) quoteAt++;
      }
      if (quoteAt < length && text.charCodeAt(quoteAt) === QUOTE) {
        let value = '';
        let chunkStart = quoteAt + 1;
        let index = chunkStart;
        let closed = false;
        let lineBreaks = 0;
        if (quoteAt < lastQuote) {
          while (index < length) {
            const code = text.charCodeAt(index);
            if (code === QUOTE) {
              if (text.charCodeAt(index + 1) === QUOTE) {
                value += text.slice(chunkStart, index + 1);
                index += 2;
                chunkStart = index;
                continue;
              }
              value += text.slice(chunkStart, index);
              index++;
              closed = true;
              break;
            }
            if (code === LF || (code === CR && text.charCodeAt(index + 1) !== LF)) lineBreaks++;
            index++;
          }
        } else {
          // No quote character is left in the file to close this one.
          const boundary = scanToLineEnd(text, quoteAt);
          lineBreaks = boundary < length ? 1 : 0;
        }

        if (closed) {
          // Text between the closing quote and the delimiter is malformed but kept.
          const boundary = scanToBoundary(index);
          const rest = text.slice(index, boundary);
          cell = NON_BLANK.test(rest) ? value + rest : value;
          line += lineBreaks;
          cursor = boundary;
        } else if (lineBreaks === 0) {
          // The file stops inside this cell.
          cell = value + text.slice(chunkStart);
          openQuote = true;
          cursor = length;
        }
        // Otherwise the quote never closes and would swallow the lines below
        // it: it is a stray character, and the cell is read as unquoted.
      }

      if (cell === null) {
        cursor = scanToBoundary(position);
        cell = text.slice(position, cursor);
      }

      cells.push(cell);
      if (blank && NON_BLANK.test(cell)) blank = false;

      if (cursor >= length) {
        position = length;
        break;
      }
      const code = text.charCodeAt(cursor);
      if (code === LF || code === CR) {
        end = cursor;
        position = code === CR && text.charCodeAt(cursor + 1) === LF ? cursor + 2 : cursor + 1;
        line++;
        terminated = true;
        break;
      }
      // At a delimiter: another cell follows, an empty one when the file ends here.
      position = cursor + delimiterLength;
    }

    if (!blank) {
      records.push({ cells, line: startLine, start, end, openQuote });
      lastRecordTerminated = terminated;
    }
  }

  return { records, lastRecordTerminated };
}

function scanToLineEnd(text: string, from: number): number {
  let index = from;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code === LF || code === CR) break;
    index++;
  }
  return index;
}

/**
 * The cell count most records have, looking only at records with two or more
 * cells (a one-cell line is a title, a note or a blank). 1 when no record has
 * more than one cell.
 */
export function modalWidth(records: RawRecord[]): number {
  const counts = new Map<number, number>();
  for (const record of records) {
    const width = record.cells.length;
    if (width >= 2) counts.set(width, (counts.get(width) ?? 0) + 1);
  }
  let best = 1;
  let bestCount = 0;
  for (const [width, count] of counts) {
    if (count > bestCount || (count === bestCount && width > best)) {
      best = width;
      bestCount = count;
    }
  }
  return best;
}

/** In order of preference when two separators explain the file equally well. */
export const DELIMITER_CANDIDATES = [',', '\t', ';', '|'] as const;

const SAMPLE_RECORDS = 200;

/**
 * The separator that splits the most lines into the same number of cells,
 * quoting respected. A decimal comma inside a semicolon file loses because
 * the header line has no comma; on a tie the wider table wins. Null when no
 * candidate splits anything.
 */
export function detectDelimiter(text: string): string | null {
  let best: { delimiter: string; score: number; width: number } | null = null;
  for (const delimiter of DELIMITER_CANDIDATES) {
    if (!text.includes(delimiter)) continue;
    const { records } = tokenizeDelimited(text, delimiter, SAMPLE_RECORDS);
    const width = modalWidth(records);
    if (width < 2) continue;
    let score = 0;
    for (const record of records) {
      if (record.cells.length === width) score++;
    }
    if (!best || score > best.score || (score === best.score && width > best.width)) {
      best = { delimiter, score, width };
    }
  }
  return best?.delimiter ?? null;
}
