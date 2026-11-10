/**
 * Text normalisation shared by the header aliases and the content profiling.
 * Pure string work: no locale APIs, so a header reads the same on every device.
 */

/** Latin letters with a diacritic, plus the ligatures bank exports use. */
const LATIN_ACCENTED_RE = /[À-ɏ]/g;
const COMBINING_MARKS_RE = /[̀-ͯ]/g;

/**
 * Lower-cases, folds full-width forms (NFKC) and strips diacritics from Latin
 * letters ("Währung" → "wahrung", "Descripción" → "descripcion"). CJK text is
 * left composed, so Hangul syllables still compare as whole syllables.
 */
export function foldText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(LATIN_ACCENTED_RE, (letter) => letter.normalize('NFD').replace(COMBINING_MARKS_RE, ''));
}

/** Punctuation that separates words in a header ("Dr/Cr", "Trans. Date", "Check #", "Date d'opération"). */
const HEADER_PUNCTUATION_RE = /[_\-./\\#:;,()[\]{}"'’`´*?!|<>=+&%$€£]+/g;

/** A header as the alias table spells it: folded, punctuation as spaces, single spaces. */
export function normalizeHeader(name: string): string {
  return foldText(name).replace(HEADER_PUNCTUATION_RE, ' ').replace(/\s+/g, ' ').trim();
}

const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯]/;

/** True when the text has Chinese, Japanese or Korean characters (which are written without spaces). */
export function hasCjk(value: string): boolean {
  return CJK_RE.test(value);
}

/** Letters of any script; digits, punctuation and symbols do not count. */
const LETTER_RE = /\p{L}/gu;

export function countLetters(value: string): number {
  return value.match(LETTER_RE)?.length ?? 0;
}
