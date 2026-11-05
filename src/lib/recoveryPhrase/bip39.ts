/**
 * Recovery phrase: 12 English words encoding 128 bits of entropy plus a
 * 4-bit checksum, following the BIP-0039 mnemonic scheme (wordlist + checksum
 * only — no seeds, no derivation paths).
 *
 * The phrase is generated, shown and decoded on the page. The worker only
 * ever receives the 16 entropy bytes, which become the recovery slot's HKDF
 * input (see public/database-key-slots.js). A typo is caught here by the
 * checksum before the worker is asked anything.
 *
 * Layout for 12 words: 128 entropy bits ‖ 4 checksum bits (first 4 bits of
 * SHA-256(entropy)) = 132 bits = 12 × 11-bit word indexes.
 */

import { BIP39_ENGLISH_WORDLIST } from './wordlist';

export const RECOVERY_PHRASE_WORD_COUNT = 12;
export const RECOVERY_ENTROPY_BYTES = 16;
const ENTROPY_BITS = RECOVERY_ENTROPY_BYTES * 8;
const CHECKSUM_BITS = ENTROPY_BITS / 32;
const BITS_PER_WORD = 11;

export type RecoveryPhraseErrorCode = 'INVALID_RECOVERY_PHRASE_LENGTH' | 'INVALID_RECOVERY_PHRASE_WORD' | 'INVALID_RECOVERY_PHRASE';

export class RecoveryPhraseError extends Error {
  readonly code: RecoveryPhraseErrorCode;
  /** Zero-based positions of words not in the wordlist (for INVALID_RECOVERY_PHRASE_WORD). */
  readonly invalidPositions: number[];

  constructor(code: RecoveryPhraseErrorCode, message: string, invalidPositions: number[] = []) {
    super(message);
    this.name = 'RecoveryPhraseError';
    this.code = code;
    this.invalidPositions = invalidPositions;
  }
}

const wordIndex = new Map<string, number>(BIP39_ENGLISH_WORDLIST.map((word, index) => [word, index]));

/** Lowercases, NFKD-normalises and splits on any whitespace. Never throws. */
export function normalizeMnemonic(input: string | readonly string[]): string[] {
  const text = Array.isArray(input) ? (input as readonly string[]).join(' ') : String(input);
  return text
    .normalize('NFKD')
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
}

export function isWordInList(word: string): boolean {
  return wordIndex.has(word);
}

/** Words starting with `prefix` (already normalised), for an autocomplete hint. */
export function suggestWords(prefix: string, limit = 5): string[] {
  const needle = normalizeMnemonic(prefix)[0] ?? '';
  if (!needle) return [];
  const out: string[] = [];
  for (const word of BIP39_ENGLISH_WORDLIST) {
    if (word.startsWith(needle)) {
      out.push(word);
      if (out.length >= limit) break;
    }
  }
  return out;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

function bytesToBits(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(2).padStart(8, '0')).join('');
}

/** Encodes 16 entropy bytes as 12 words. */
export async function entropyToMnemonic(entropy: Uint8Array): Promise<string[]> {
  if (entropy.byteLength !== RECOVERY_ENTROPY_BYTES) {
    throw new RecoveryPhraseError('INVALID_RECOVERY_PHRASE', `Entropy must be ${RECOVERY_ENTROPY_BYTES} bytes`);
  }
  const hash = await sha256(entropy);
  const bits = bytesToBits(entropy) + bytesToBits(hash).slice(0, CHECKSUM_BITS);
  const words: string[] = [];
  for (let i = 0; i < bits.length; i += BITS_PER_WORD) {
    words.push(BIP39_ENGLISH_WORDLIST[parseInt(bits.slice(i, i + BITS_PER_WORD), 2)]);
  }
  return words;
}

/**
 * Decodes 12 words back to their 16 entropy bytes, verifying the checksum.
 * Throws RecoveryPhraseError on the wrong word count, an unknown word, or a
 * checksum mismatch (a typo that happens to be a real word).
 */
export async function mnemonicToEntropy(input: string | readonly string[]): Promise<Uint8Array> {
  const words = normalizeMnemonic(input);
  if (words.length !== RECOVERY_PHRASE_WORD_COUNT) {
    throw new RecoveryPhraseError(
      'INVALID_RECOVERY_PHRASE_LENGTH',
      `A recovery phrase has ${RECOVERY_PHRASE_WORD_COUNT} words (got ${words.length})`
    );
  }
  const invalidPositions = words.map((word, i) => (wordIndex.has(word) ? -1 : i)).filter((i) => i >= 0);
  if (invalidPositions.length > 0) {
    throw new RecoveryPhraseError('INVALID_RECOVERY_PHRASE_WORD', 'The recovery phrase contains a word that is not in the wordlist', invalidPositions);
  }

  const bits = words.map((word) => wordIndex.get(word)!.toString(2).padStart(BITS_PER_WORD, '0')).join('');
  const entropyBits = bits.slice(0, ENTROPY_BITS);
  const checksumBits = bits.slice(ENTROPY_BITS);
  const entropy = new Uint8Array(RECOVERY_ENTROPY_BYTES);
  for (let i = 0; i < RECOVERY_ENTROPY_BYTES; i += 1) {
    entropy[i] = parseInt(entropyBits.slice(i * 8, i * 8 + 8), 2);
  }
  const hash = await sha256(entropy);
  if (bytesToBits(hash).slice(0, CHECKSUM_BITS) !== checksumBits) {
    entropy.fill(0);
    throw new RecoveryPhraseError('INVALID_RECOVERY_PHRASE', 'The recovery phrase checksum does not match — check the words again');
  }
  return entropy;
}

/** Generates a fresh 12-word phrase from 128 bits of `crypto.getRandomValues`. */
export async function generateRecoveryPhrase(): Promise<string[]> {
  const entropy = crypto.getRandomValues(new Uint8Array(RECOVERY_ENTROPY_BYTES));
  try {
    return await entropyToMnemonic(entropy);
  } finally {
    entropy.fill(0);
  }
}

export interface RecoveryPhraseValidation {
  ok: boolean;
  code?: RecoveryPhraseErrorCode;
  wordCount: number;
  /** Zero-based positions of words not in the wordlist. */
  invalidPositions: number[];
}

/** Non-throwing validation for live UI feedback. */
export async function validateRecoveryPhrase(input: string | readonly string[]): Promise<RecoveryPhraseValidation> {
  const words = normalizeMnemonic(input);
  const invalidPositions = words.map((word, i) => (wordIndex.has(word) ? -1 : i)).filter((i) => i >= 0);
  try {
    const entropy = await mnemonicToEntropy(words);
    entropy.fill(0);
    return { ok: true, wordCount: words.length, invalidPositions };
  } catch (error) {
    const code = error instanceof RecoveryPhraseError ? error.code : 'INVALID_RECOVERY_PHRASE';
    return { ok: false, code, wordCount: words.length, invalidPositions };
  }
}
