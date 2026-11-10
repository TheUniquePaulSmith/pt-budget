/**
 * One date order per file, decided from the whole date column.
 *
 * A first part above 12 can only be a day, a second part above 12 only a
 * month ("23/04/2026" vs "04/23/2026"); dotted dates are day first. When a
 * file has both kinds it cannot be read with one order (`dateOrderMixed`).
 * When it has neither, the rows' own sequence is the next best evidence (a
 * statement is sorted by date), and only then the caller's fallback.
 */

import type { Assumption, AssumptionBasis, DateOrder } from '../types';

import type { DateReader } from './cells';

export interface DateOrderEvidence {
  /** Cells that are dates at all. */
  dates: number;
  dayFirstOnly: number;
  monthFirstOnly: number;
  /** Cells that work both ways with different results. */
  either: number;
  /** First cell of each kind: the text and its index in the list that was passed in. */
  dayFirstExample: { text: string; at: number } | null;
  monthFirstExample: { text: string; at: number } | null;
  eitherExample: { text: string; at: number } | null;
  fixedExample: { text: string; at: number } | null;
}

export function collectDateOrderEvidence(cells: Iterable<string>, reader: DateReader): DateOrderEvidence {
  const evidence: DateOrderEvidence = {
    dates: 0,
    dayFirstOnly: 0,
    monthFirstOnly: 0,
    either: 0,
    dayFirstExample: null,
    monthFirstExample: null,
    eitherExample: null,
    fixedExample: null,
  };
  let at = -1;
  for (const text of cells) {
    at += 1;
    const kind = reader.read(text).evidence;
    if (kind === 'none') continue;
    evidence.dates += 1;
    if (kind === 'dayFirst') {
      evidence.dayFirstOnly += 1;
      evidence.dayFirstExample ??= { text: text.trim(), at };
    } else if (kind === 'monthFirst') {
      evidence.monthFirstOnly += 1;
      evidence.monthFirstExample ??= { text: text.trim(), at };
    } else if (kind === 'either') {
      evidence.either += 1;
      evidence.eitherExample ??= { text: text.trim(), at };
    } else {
      evidence.fixedExample ??= { text: text.trim(), at };
    }
  }
  return evidence;
}

/** How many neighbouring pairs go against the overall direction (0 = the dates are in order). */
function outOfOrderPairs(dates: string[]): number {
  let rising = 0;
  let falling = 0;
  for (let i = 1; i < dates.length; i += 1) {
    if (dates[i] > dates[i - 1]) rising += 1;
    else if (dates[i] < dates[i - 1]) falling += 1;
  }
  return Math.min(rising, falling);
}

export interface DateOrderInference {
  order: DateOrder;
  confidence: number;
  /** Null when the column has no dates: there is nothing to assume. */
  assumption: Assumption | null;
  /** Some dates only work day first and others only month first. */
  mixed: boolean;
}

export interface DateOrderFallback {
  order?: DateOrder;
  basis?: AssumptionBasis;
}

/**
 * @param cells       every cell of the date column(s), in file order
 * @param lineOf      1-based file line of the cell at an index, for the "because line 14 is 23/04/2026" text
 * @param fallback    the caller's default for a file with no evidence (the UI language, or the AI's answer)
 */
export function inferDateOrder(
  cells: string[],
  reader: DateReader,
  lineOf: (at: number) => number,
  fallback: DateOrderFallback = {}
): DateOrderInference {
  const evidence = collectDateOrderEvidence(cells, reader);
  const fallbackOrder = fallback.order ?? 'MDY';
  // A year-first language still reads an ambiguous "04/06/2026" day first.
  const fallbackDayFirst = fallbackOrder !== 'MDY';
  const fallbackBasis: AssumptionBasis = fallback.basis ?? (fallback.order ? 'language' : 'default');

  if (evidence.dates === 0) {
    return { order: fallbackOrder, confidence: 1, assumption: null, mixed: false };
  }

  const { dayFirstOnly, monthFirstOnly } = evidence;
  if (dayFirstOnly > 0 && monthFirstOnly > 0) {
    const dayFirst = dayFirstOnly >= monthFirstOnly;
    return {
      order: dayFirst ? 'DMY' : 'MDY',
      confidence: 0.3,
      mixed: true,
      assumption: {
        subject: 'dateOrder',
        code: dayFirst ? 'dayFirstByMajority' : 'monthFirstByMajority',
        basis: 'file',
        confidence: 0.3,
        params: { count: Math.max(dayFirstOnly, monthFirstOnly), otherCount: Math.min(dayFirstOnly, monthFirstOnly) },
      },
    };
  }

  if (dayFirstOnly > 0 || monthFirstOnly > 0) {
    const dayFirst = dayFirstOnly > 0;
    const example = (dayFirst ? evidence.dayFirstExample : evidence.monthFirstExample) as { text: string; at: number };
    return {
      order: dayFirst ? 'DMY' : 'MDY',
      confidence: 0.98,
      mixed: false,
      assumption: {
        subject: 'dateOrder',
        code: dayFirst ? 'dayFirstFromFile' : 'monthFirstFromFile',
        basis: 'file',
        confidence: 0.98,
        params: { example: example.text, line: lineOf(example.at) },
      },
    };
  }

  if (evidence.either === 0) {
    // Every date reads the same either way (ISO, year first, month names).
    const example = evidence.fixedExample as { text: string; at: number };
    const yearFirst = /^\d{4}/.test(example.text);
    return {
      order: yearFirst ? 'YMD' : fallbackOrder,
      confidence: 1,
      mixed: false,
      assumption: {
        subject: 'dateOrder',
        code: 'datesUnambiguous',
        basis: 'file',
        confidence: 1,
        params: { example: example.text },
      },
    };
  }

  // Nothing settles it. A statement is sorted by date, so the reading that
  // keeps the rows in order is the likely one.
  const example = (evidence.eitherExample as { text: string; at: number }).text;
  const asDayFirst: string[] = [];
  const asMonthFirst: string[] = [];
  for (const text of cells) {
    const reading = reader.read(text);
    if (reading.dayFirst && reading.monthFirst) {
      asDayFirst.push(reading.dayFirst);
      asMonthFirst.push(reading.monthFirst);
    }
  }
  if (asDayFirst.length >= 3) {
    const dayFirstDisorder = outOfOrderPairs(asDayFirst);
    const monthFirstDisorder = outOfOrderPairs(asMonthFirst);
    if ((dayFirstDisorder === 0) !== (monthFirstDisorder === 0)) {
      const dayFirst = dayFirstDisorder === 0;
      return {
        order: dayFirst ? 'DMY' : 'MDY',
        confidence: 0.75,
        mixed: false,
        assumption: {
          subject: 'dateOrder',
          code: dayFirst ? 'dayFirstBySequence' : 'monthFirstBySequence',
          basis: 'file',
          confidence: 0.75,
          params: { example },
        },
      };
    }
  }

  const confidence = fallbackBasis === 'default' ? 0.4 : 0.5;
  return {
    order: fallbackDayFirst ? 'DMY' : 'MDY',
    confidence,
    mixed: false,
    assumption: {
      subject: 'dateOrder',
      code: fallbackDayFirst ? 'dayFirstAssumed' : 'monthFirstAssumed',
      basis: fallbackBasis,
      confidence,
      params: { example },
    },
  };
}
