// A bank reference/transaction number is a strong dedup key; a header that merely
// contains "id" (Paid, Valid, Card Holder ID) is not, and a wrong pick silently
// breaks duplicate detection on the next overlapping import.
const UNIQUE_ID_STRONG_RE = /reference|\btrans(?:action)?\s*(?:id|number|#|no\.?)\b|\btxn\s*(?:id|number)|\bfitid\b/i;
const UNIQUE_ID_WEAK_RE = /\bid\b/i;
const UNIQUE_ID_EXCLUDE_RE = /holder|customer|member|account|card|user|category|merchant|payee/i;

/**
 * Picks the bank-reference column by header name. With the parsed rows it also
 * checks the values: a column that is mostly placeholders ("0", blank) or
 * repeats a value is not an identifier, whatever its header says.
 */
export function detectUniqueIdentifierColumn(headers: string[], rows?: Array<Record<string, unknown>>): string {
  const usable = (header: string) => !rows || hasUniqueReferenceValues(rows, header);
  const strong = headers.filter((header) => UNIQUE_ID_STRONG_RE.test(header));
  const weak = headers.filter(
    (header) => UNIQUE_ID_WEAK_RE.test(header) && !UNIQUE_ID_EXCLUDE_RE.test(header) && !strong.includes(header)
  );
  return [...strong, ...weak].find(usable) || '';
}

function hasUniqueReferenceValues(rows: Array<Record<string, unknown>>, header: string): boolean {
  const values = rows
    .map((row) => String(row[header] ?? '').trim())
    .filter((value) => !isPlaceholderReference(value));
  // Most rows must carry a real value, and no value may repeat.
  return values.length > 0 && values.length * 2 >= rows.length && new Set(values).size === values.length;
}

/**
 * Blank, all-zero or "N/A"-style cells are what banks print when a row has no
 * reference. As a dedup key they would match every stored row of the same
 * account and amount, silently dropping new transactions (Huntington's
 * "Reference Number" is "0" on most rows).
 */
export function isPlaceholderReference(value: string): boolean {
  return /^[\s0.#-]*$/.test(value) || /^(n\/?a|none|null|undefined)$/i.test(value.trim());
}
