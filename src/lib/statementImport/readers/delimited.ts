/**
 * Delimited text (comma, semicolon, tab, pipe) → one StatementTable.
 *
 * A bank export is rarely just a header and rows. This reader finds the
 * table inside the file:
 *
 *   Example Bank                        ┐ preamble: skipped, kept in meta.preamble,
 *   Account Number: 000123456789        ┘ mined for account hints
 *   Date,Description,Amount             ← header (or none: "Column 1"…)
 *   2026-09-01,COFFEE,-4.50             ┐
 *   2026-09-02,PAYROLL,1250.00          ┘ rows, each exactly as wide as the header
 *   Total,,1245.50                      ← trailer: skipped, kept in meta.trailer
 *
 * It works from the shape of the cells (dates and numbers line up in columns,
 * a header is all words), never from the language of the header names or of
 * the user interface.
 */

import type { ImportIssue, ReadOptions, ReadResult, SourceFile, StatementColumn, StatementTable } from '../types';

import { collectAccountHints } from './accountHints';
import type { DecodedText } from './encoding';
import { fingerprintOfColumns } from './fingerprint';
import { readerIssue, unreadable, unsupported } from './issues';
import {
  type ColumnProfile,
  filledCount,
  hasTypedCell,
  hasTypedHit,
  isBlankCell,
  profileColumns,
  shapeOf,
  typedHits,
} from './shapes';
import { type RawRecord, detectDelimiter, modalWidth, tokenizeDelimited } from './tokenize';

// Excel's own hint for the separator, on a line of its own above everything else.
const SEPARATOR_DIRECTIVE = /^\s*"?sep=([^\r\n"])"?[ \t]*(?:\r\n|\r|\n|$)/i;
const SEPARATOR_LINE = /^\s*"?sep=.?"?\s*$/i;

const PROFILE_SAMPLE = 1000;

/** Up to `PROFILE_SAMPLE` records, spread evenly over the list. */
function sampleCells(records: RawRecord[]): string[][] {
  if (records.length <= PROFILE_SAMPLE) return records.map((record) => record.cells);
  const step = records.length / PROFILE_SAMPLE;
  const sample: string[][] = [];
  for (let index = 0; index < PROFILE_SAMPLE; index++) sample.push(records[Math.floor(index * step)].cells);
  return sample;
}

/**
 * How many cells wide the table is. Usually the width most lines have. But a
 * short statement under a long block of "Label,Value" lines would lose that
 * vote, so when no width clearly dominates, each one is judged by how many
 * of its lines look like rows of one table (dates and numbers in the same
 * columns), with wider tables counting for more.
 */
function tableWidth(records: RawRecord[]): number {
  const modal = modalWidth(records);
  const byWidth = new Map<number, RawRecord[]>();
  let splitLines = 0;
  for (const record of records) {
    const width = record.cells.length;
    if (width < 2) continue;
    splitLines++;
    const group = byWidth.get(width);
    if (group) group.push(record);
    else byWidth.set(width, [record]);
  }
  if (byWidth.size <= 1) return modal;
  if (modal >= 3 && (byWidth.get(modal)?.length ?? 0) >= splitLines * 0.8) return modal;

  let best = modal;
  let bestScore = 0;
  let bestRows = 0;
  for (const [width, group] of byWidth) {
    const sample = sampleCells(group);
    const profile = profileColumns(
      sample.filter((cells) => hasTypedCell(cells)),
      width
    );
    let fitting = 0;
    for (const cells of sample) {
      if (typedHits(cells, profile) > 0) fitting++;
    }
    const rows = Math.round((fitting * group.length) / sample.length);
    const score = rows * (width - 1);
    if (score > bestScore || (score === bestScore && (rows > bestRows || (rows === bestRows && width > best)))) {
      best = width;
      bestScore = score;
      bestRows = rows;
    }
  }
  return bestScore > 0 ? best : modal;
}

/**
 * A header row: nothing but words, and (nearly) every column named. One
 * column may be unnamed. A line one cell short of the table counts only when
 * all of its cells are names and the table is wide, so that "Account,Everyday
 * Checking" above three columns of data stays preamble.
 */
function isLabelRow(record: RawRecord, effectiveWidth: number): boolean {
  let filled = 0;
  for (const cell of record.cells) {
    const shape = shapeOf(cell);
    if (shape === 'empty') continue;
    if (shape !== 'text') return false;
    filled++;
  }
  const cells = record.cells.length;
  if (cells >= effectiveWidth) return filled >= Math.max(effectiveWidth - 1, Math.min(effectiveWidth, 2));
  return effectiveWidth >= 4 && cells === effectiveWidth - 1 && filled === cells;
}

interface TableLocation {
  /** Index of the header record; null when the file has none. */
  headerIndex: number | null;
  /** Index of the first data record. */
  dataStart: number;
}

function locateTable(records: RawRecord[], width: number, headerLine: number | null | undefined): TableLocation {
  if (typeof headerLine === 'number') {
    // The caller named the line. A blank line or the inside of a quoted cell means the next record down.
    const index = records.findIndex((record) => record.line >= headerLine);
    if (index !== -1) return { headerIndex: index, dataStart: index + 1 };
  }

  const fullWidth = records.filter((record) => record.cells.length === width);
  // Lines of words only (titles, the header itself) say nothing about what the columns hold.
  const profile = profileColumns(sampleCells(fullWidth.filter((record) => hasTypedCell(record.cells))), width);
  let effectiveWidth = width;
  while (effectiveWidth > 1 && profile.shapes[effectiveWidth - 1] === 'empty') effectiveWidth--;

  // The first line whose dates and numbers sit where the rest of the file has them.
  let anchor = -1;
  if (profile.typed.length > 0) {
    anchor = records.findIndex((record) => record.cells.length === width && typedHits(record.cells, profile) > 0);
  }

  const firstFullWidth = Math.max(0, records.findIndex((record) => record.cells.length === width));
  // A full-width line right above the data that has a date or a number is data too (a first row with one unreadable cell).
  const isDataAbove = (index: number) => records[index].cells.length === width && hasTypedCell(records[index].cells);

  if (headerLine === null) {
    // The caller says there is no header: a line of names above the data is a row like any other.
    let dataStart = anchor === -1 ? firstFullWidth : anchor;
    while (dataStart > 0 && (isDataAbove(dataStart - 1) || isLabelRow(records[dataStart - 1], effectiveWidth))) dataStart--;
    return { headerIndex: null, dataStart };
  }
  if (anchor === -1) {
    // Nothing tells data from labels (no dates or numbers anywhere): take the first full line as the header.
    return { headerIndex: firstFullWidth, dataStart: firstFullWidth + 1 };
  }

  let dataStart = anchor;
  while (dataStart > 0 && isDataAbove(dataStart - 1)) dataStart--;
  const above = dataStart - 1;
  if (above >= 0 && isLabelRow(records[above], effectiveWidth)) return { headerIndex: above, dataStart };
  return { headerIndex: null, dataStart };
}

function upperMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

interface DataShape {
  profile: ColumnProfile;
  /** How many cells a normal row has filled in. */
  typicalFilled: number;
}

function shapeOfData(data: RawRecord[], width: number): DataShape {
  const sample = sampleCells(data.filter((record) => record.cells.length === width));
  return { profile: profileColumns(sample, width), typicalFilled: upperMedian(sample.map(filledCount)) };
}

/**
 * The last line when the file stops in the middle of it: no line break after
 * it, fewer cells than any other row, and the cells it does have are the
 * start of a normal row. (A file that ends inside a quoted cell is cut off
 * by definition.)
 */
function isCutOff(last: RawRecord, others: RawRecord[], width: number, profile: ColumnProfile, terminated: boolean): boolean {
  if (last.openQuote) return true;
  if (terminated) return false;
  const count = last.cells.length;
  if (count >= width || count < 2) return false;
  if (others.some((record) => record.cells.length === count)) return false;
  // The cell the file ends in may be half a value: judge the complete ones.
  return typedHits(last.cells, profile, count - 1) > 0;
}

/**
 * A line below the data that is not a transaction: totals, closing balances,
 * "End of report", disclaimers. It has no date where the rows have theirs,
 * and either nothing that fits the columns at all or far fewer cells filled
 * in than a row. A full row with a bad date is left for the analysis to
 * report; only what is clearly not a row is taken here.
 */
function isTrailerLine(record: RawRecord, width: number, { profile, typicalFilled }: DataShape): boolean {
  const { cells } = record;
  if (profile.typed.length === 0) return cells.length < width && filledCount(cells) <= 2;
  if (profile.dateColumns.some((column) => shapeOf(cells[column]) === 'date')) return false;

  const sparse = filledCount(cells) <= Math.max(2, typicalFilled - 2);
  if (!hasTypedHit(cells, profile)) return profile.dateColumns.length > 0 || sparse || cells.length !== width;
  return profile.dateColumns.length > 0 && sparse;
}

function nameColumns(header: string[] | null, count: number): { columns: StatementColumn[]; duplicates: string[] } {
  const columns: StatementColumn[] = [];
  const taken = new Set<string>();
  const duplicates: string[] = [];
  const keyOf = (name: string) => name.normalize('NFKC').toLowerCase();

  for (let index = 0; index < count; index++) {
    const printed = (header?.[index] ?? '').replace(/\s+/g, ' ').trim();
    if (printed === '') {
      columns.push({ index, name: `Column ${index + 1}`, synthetic: true });
      continue;
    }
    columns.push({ index, name: printed });
  }
  // Made-up names give way to printed ones, so number the printed duplicates first.
  for (const column of columns) {
    if (column.synthetic) continue;
    let name = column.name;
    if (taken.has(keyOf(name))) {
      if (!duplicates.includes(column.name)) duplicates.push(column.name);
      for (let copy = 2; taken.has(keyOf(name)); copy++) name = `${column.name} (${copy})`;
      column.name = name;
    }
    taken.add(keyOf(name));
  }
  for (const column of columns) {
    if (!column.synthetic) continue;
    let name = column.name;
    for (let copy = 2; taken.has(keyOf(name)); copy++) name = `${column.name} (${copy})`;
    column.name = name;
    taken.add(keyOf(name));
  }
  return { columns, duplicates };
}

export function readDelimited(file: SourceFile, decoded: DecodedText, options: ReadOptions): ReadResult {
  const { text } = decoded;
  const directive = SEPARATOR_DIRECTIVE.exec(text);
  const delimiter = options.delimiter || directive?.[1] || detectDelimiter(text);
  // No separator splits any line into cells: prose, not a table (or nothing but separators).
  if (!delimiter) return /[^\s,;|"]/.test(text) ? unsupported('text') : unreadable('emptyFile');

  const tokenized = tokenizeDelimited(text, delimiter);
  const lineText = (record: RawRecord): string => {
    let line = text.slice(record.start, record.end).trim();
    while (line.endsWith(delimiter)) line = line.slice(0, -delimiter.length).trimEnd();
    return line;
  };
  const records =
    directive && tokenized.records.length > 0 && SEPARATOR_LINE.test(text.slice(tokenized.records[0].start, tokenized.records[0].end))
      ? tokenized.records.slice(1)
      : tokenized.records;
  if (records.length === 0) return unreadable('emptyFile');

  const width = tableWidth(records);
  const { headerIndex, dataStart } = locateTable(records, width, options.headerLine);
  const header = headerIndex === null ? null : records[headerIndex];
  const preamble = records.slice(0, headerIndex ?? dataStart);
  let data = records.slice(dataStart);

  // Below the data: a line the file was cut off in, then totals and notes.
  const shape = shapeOfData(data, width);
  let cutOff: RawRecord | null = null;
  if (data.length > 0) {
    const last = data[data.length - 1];
    if (isCutOff(last, data.slice(0, -1), width, shape.profile, tokenized.lastRecordTerminated)) {
      cutOff = last;
      data = data.slice(0, -1);
    }
  }
  let trailerAt = data.length;
  while (trailerAt > 0 && isTrailerLine(data[trailerAt - 1], width, shape)) trailerAt--;
  const trailer = data.slice(trailerAt);
  data = data.slice(0, trailerAt);
  if (data.length === 0) return unreadable('noDataRows');

  // How many columns: the header's, unless most rows carry values beyond it.
  const hasValueBeyond = (record: RawRecord, count: number) => record.cells.slice(count).some((cell) => !isBlankCell(cell));
  let columnCount = header ? header.cells.length : width;
  if (header && width > columnCount && data.filter((record) => hasValueBeyond(record, columnCount)).length > data.length / 2) {
    columnCount = width;
  }
  // A trailing delimiter on every line makes an empty, unnamed last column: drop it.
  while (
    columnCount > 1 &&
    isBlankCell(header?.cells[columnCount - 1]) &&
    data.every((record) => isBlankCell(record.cells[columnCount - 1]))
  ) {
    columnCount--;
  }
  const { columns, duplicates } = nameColumns(header?.cells ?? null, columnCount);

  // Every row exactly as wide as the header: short rows padded, extra cells dropped.
  const rows: string[][] = new Array(data.length);
  const sourceLines: number[] = new Array(data.length);
  const ragged: number[] = [];
  for (let index = 0; index < data.length; index++) {
    const { cells, line } = data[index];
    sourceLines[index] = line;
    if (cells.length === columnCount) {
      rows[index] = cells;
    } else if (cells.length < columnCount) {
      ragged.push(index);
      rows[index] = [...cells, ...new Array<string>(columnCount - cells.length).fill('')];
    } else {
      // Extra empty cells (a trailing delimiter) are not worth a warning; extra values are.
      if (hasValueBeyond(data[index], columnCount)) ragged.push(index);
      rows[index] = cells.slice(0, columnCount);
    }
  }

  const notes: ImportIssue[] = [];
  if (decoded.guessed) notes.push(readerIssue('encodingGuessed', { params: { encoding: decoded.encoding } }));
  if (preamble.length > 0) notes.push(readerIssue('preambleSkipped', { params: { count: preamble.length } }));
  if (!header) notes.push(readerIssue('headerMissing', { params: { columns: columnCount } }));
  if (duplicates.length > 0) {
    notes.push(readerIssue('duplicateHeaderNames', { params: { names: duplicates.join(', '), count: duplicates.length } }));
  }
  if (ragged.length > 0) notes.push(readerIssue('raggedRows', { rows: ragged, params: { count: ragged.length } }));
  if (trailer.length > 0) notes.push(readerIssue('trailerSkipped', { params: { count: trailer.length } }));
  if (cutOff) notes.push(readerIssue('truncatedFile', { params: { line: cutOff.line } }));

  const table: StatementTable = {
    format: 'delimited',
    fingerprint: fingerprintOfColumns(columns),
    columns,
    rows,
    sourceLines,
    meta: {
      fileName: file.name,
      encoding: decoded.encoding,
      delimiter,
      headerLine: header ? header.line : null,
      preamble: preamble.map(lineText),
      trailer: [...trailer, ...(cutOff ? [cutOff] : [])].map(lineText),
      accountHints: collectAccountHints(
        preamble.map((record) => record.cells),
        file.name
      ),
    },
    notes,
  };
  return { tables: [table], issues: [] };
}
