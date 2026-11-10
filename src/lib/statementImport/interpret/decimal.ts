/**
 * One decimal mark per file, decided from every money column.
 *
 * "12,50" and "1.234,56" can only be decimal commas; "12.50" and "1,234.56"
 * only decimal points. "1,234" on its own could be one thousand two hundred
 * thirty-four or one and a bit. Money is not written with three decimals, so
 * a file whose only separators look like that is read with the mark as a
 * thousands separator; with only a few such values it is still reported as
 * `decimalAmbiguous`. A file that has both "1,234" and "1.234" and nothing
 * else falls back to the caller's default.
 */

import type { Assumption, AssumptionBasis, DecimalSeparator } from '../types';

import { decimalEvidenceOf, isAmountShaped } from './cells';

/** This many "1,234"-style amounts and no other kind: three decimals on every one is not a coincidence. */
export const GROUPING_CERTAIN_CELLS = 5;

export interface DecimalEvidenceCount {
  point: number;
  comma: number;
  ambiguousPoint: number;
  ambiguousComma: number;
  pointExample: string | null;
  commaExample: string | null;
  ambiguousPointExample: string | null;
  ambiguousCommaExample: string | null;
}

export function collectDecimalEvidence(cells: Iterable<string>): DecimalEvidenceCount {
  const count: DecimalEvidenceCount = {
    point: 0,
    comma: 0,
    ambiguousPoint: 0,
    ambiguousComma: 0,
    pointExample: null,
    commaExample: null,
    ambiguousPointExample: null,
    ambiguousCommaExample: null,
  };
  for (const cell of cells) {
    if (!cell || !isAmountShaped(cell)) continue;
    const evidence = decimalEvidenceOf(cell);
    if (evidence === 'none') continue;
    count[evidence] += 1;
    count[`${evidence}Example`] ??= cell.trim();
  }
  return count;
}

export interface DecimalInference {
  decimal: DecimalSeparator;
  confidence: number;
  /** Null when no amount has a separator: there is nothing to assume. */
  assumption: Assumption | null;
}

export interface DecimalFallback {
  decimal?: DecimalSeparator;
  basis?: AssumptionBasis;
}

export function inferDecimal(cells: Iterable<string>, fallback: DecimalFallback = {}): DecimalInference {
  const evidence = collectDecimalEvidence(cells);
  const fallbackDecimal = fallback.decimal ?? '.';
  const fallbackBasis: AssumptionBasis = fallback.basis ?? (fallback.decimal ? 'language' : 'default');

  if (evidence.point > 0 || evidence.comma > 0) {
    const decimal: DecimalSeparator = evidence.comma > evidence.point ? ',' : '.';
    const agreeing = Math.max(evidence.point, evidence.comma);
    const conflicting = Math.min(evidence.point, evidence.comma);
    // A handful of odd cells in a large file is a data problem (they are
    // reported as unreadable); an even split means the mark is unknown.
    const confidence = conflicting === 0 ? 0.98 : Math.round(Math.max(0.3, 0.9 - (conflicting / agreeing) * 0.6) * 100) / 100;
    return {
      decimal,
      confidence,
      assumption: {
        subject: 'decimal',
        code: 'decimalFromFile',
        basis: 'file',
        confidence,
        params: { mark: decimal, example: (decimal === ',' ? evidence.commaExample : evidence.pointExample) as string },
      },
    };
  }

  const grouped = evidence.ambiguousComma + evidence.ambiguousPoint;
  if (grouped === 0) {
    // Whole numbers only: both marks read every amount the same way.
    return { decimal: fallbackDecimal, confidence: 1, assumption: null };
  }

  if (evidence.ambiguousComma === 0 || evidence.ambiguousPoint === 0) {
    // Only "1,234"-style values (or only "1.234"): the mark groups thousands, so the other one is the decimal.
    const decimal: DecimalSeparator = evidence.ambiguousComma > 0 ? '.' : ',';
    const confidence = grouped >= GROUPING_CERTAIN_CELLS ? 0.95 : 0.8;
    return {
      decimal,
      confidence,
      assumption: {
        subject: 'decimal',
        code: 'decimalByGrouping',
        basis: 'file',
        confidence,
        params: {
          mark: decimal,
          group: decimal === '.' ? ',' : '.',
          example: (evidence.ambiguousCommaExample ?? evidence.ambiguousPointExample) as string,
        },
      },
    };
  }

  const confidence = fallbackBasis === 'default' ? 0.4 : 0.5;
  return {
    decimal: fallbackDecimal,
    confidence,
    assumption: {
      subject: 'decimal',
      code: 'decimalAssumed',
      basis: fallbackBasis,
      confidence,
      params: {
        mark: fallbackDecimal,
        example: (fallbackDecimal === '.' ? evidence.ambiguousPointExample : evidence.ambiguousCommaExample) as string,
      },
    },
  };
}
