/**
 * Parses a bank-export amount cell. Understands accounting negatives "(12.34)",
 * trailing minus "12.34-", CR/DR markers (CR = money in, DR = money out), and
 * currency symbols / thousands separators. Returns null for anything that is
 * not a number so the row can be reported instead of imported as $0.
 */
export type CsvDecimalSeparator = '.' | ',' | 'auto';

export interface ParseCsvAmountOptions {
  /**
   * Which separator is the decimal point. `'auto'` (default) decides per
   * value: when both `.` and `,` appear, the last one is the decimal; a lone
   * comma followed by one or two digits at the end is a decimal comma
   * ("12,34"), otherwise a thousands separator ("1,234"). Pass `','` for a
   * decimal-comma file so "1.234" reads as one thousand two hundred
   * thirty-four.
   */
  decimal?: CsvDecimalSeparator;
}

/** Normalises a numeric string to a dot-decimal form Number() understands, or null when malformed. */
function normalizeCsvNumber(text: string, decimal: CsvDecimalSeparator): string | null {
  const stripped = text.replace(/[^\d.,-]/g, '');
  if (!/\d/.test(stripped)) return null;
  const hasDot = stripped.includes('.');
  const hasComma = stripped.includes(',');

  let decimalChar: '.' | ',' | null;
  if (hasDot && hasComma) {
    decimalChar = stripped.lastIndexOf('.') > stripped.lastIndexOf(',') ? '.' : ',';
  } else if (hasComma) {
    decimalChar = decimal === '.' ? null : decimal === ',' || /,\d{1,2}$/.test(stripped) ? ',' : null;
  } else if (hasDot) {
    decimalChar = decimal === ',' ? (/\.\d{1,2}$/.test(stripped) && (stripped.match(/\./g) ?? []).length === 1 ? '.' : null) : '.';
    // A decimal-comma locale writing "1.234" means one thousand; "1.5" is still a decimal.
    if (decimal === ',' && decimalChar === '.' && /\.\d{3}$/.test(stripped)) decimalChar = null;
  } else {
    decimalChar = null;
  }

  const groupChar = decimalChar === '.' ? ',' : decimalChar === ',' ? '.' : null;
  let normalized = stripped;
  if (groupChar) normalized = normalized.split(groupChar).join('');
  else normalized = normalized.replace(/[.,]/g, '');
  if (decimalChar === ',') normalized = normalized.replace(',', '.');
  // More than one decimal point left means the value was malformed ("12.34.56").
  if ((normalized.match(/\./g) ?? []).length > 1) return null;
  return normalized;
}

export function parseCsvAmount(raw: unknown, { decimal = 'auto' }: ParseCsvAmountOptions = {}): number | null {
  if (raw == null) return null;
  let text = String(raw).trim();
  if (!text) return null;

  let sign = 1;
  if (/^\(.*\)$/.test(text)) {
    sign = -1;
    text = text.slice(1, -1);
  }

  const marker = text.match(/\b(CR|DR)\b\s*$/i) ?? text.match(/^\s*(CR|DR)\b/i);
  if (marker) {
    if (marker[1].toUpperCase() === 'DR') sign *= -1;
    text = text.replace(marker[0], '');
  }

  if (/-\s*$/.test(text) && !/^\s*-/.test(text)) {
    sign *= -1;
    text = text.replace(/-\s*$/, '');
  }

  const cleaned = normalizeCsvNumber(text, decimal);
  if (cleaned === null) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return value * sign;
}
