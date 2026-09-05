// Transaction content hash shared by the page (src/lib/transactionHash.ts) and
// the SharedWorker (public/database-worker.js, schema migration v2 rehash).
//
// Plain ES module served as a static asset: the worker loads it with
// `await import('/database-hash.js')`, the page bundles it via a relative
// import, and Vitest imports it directly. Keep it dependency-free.
//
// The hash identifies a transaction by content so overlapping bank exports
// dedupe: same account, same calendar date, same signed amount, same raw
// description. `variationSeed` > 0 marks a deliberately kept duplicate (two
// identical purchases on one day); the seed is stored alongside the hash.
//
// Version history:
//   1 (legacy) — 32-bit Java-style string hash, hex; CSV path keyed on the raw
//                CSV account string. Recognizable by length !== 64.
//   2          — SHA-256 hex, keyed on the numeric account id on every path.

const encoder = new TextEncoder();

export const TRANSACTION_HASH_VERSION = 2;

/**
 * Builds the canonical pre-image. Amount is rendered with JS number
 * formatting (`-12.5`, `100`), which is also how SQLite REAL values arrive in
 * JS, so a stored row and a freshly parsed row hash identically.
 * @param {number|string} accountId
 * @param {string} date yyyy-MM-dd
 * @param {number} amount signed
 * @param {string} description raw, untrimmed
 * @param {number} [variationSeed]
 * @returns {string}
 */
export function buildTransactionHashInput(accountId, date, amount, description, variationSeed = 0) {
  const base = `${accountId}-${date}-${amount}-${description}`;
  return variationSeed > 0 ? `${base}-seed${variationSeed}` : base;
}

/**
 * SHA-256 of the canonical pre-image, lower-case hex (64 chars).
 * @param {number|string} accountId
 * @param {string} date
 * @param {number} amount
 * @param {string} description
 * @param {number} [variationSeed]
 * @returns {Promise<string>}
 */
export async function computeTransactionHash(accountId, date, amount, description, variationSeed = 0) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) {
    throw new Error('SubtleCrypto is not available; cannot hash transactions');
  }
  const input = buildTransactionHashInput(accountId, date, amount, description, variationSeed);
  const digest = await subtle.digest('SHA-256', encoder.encode(input));
  return toHex(new Uint8Array(digest));
}

/**
 * True for hashes written before version 2 (or missing), which the v2
 * migration must recompute.
 * @param {unknown} hash
 * @returns {boolean}
 */
export function isLegacyTransactionHash(hash) {
  return typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash);
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function toHex(bytes) {
  let out = '';
  for (let index = 0; index < bytes.length; index += 1) {
    out += bytes[index].toString(16).padStart(2, '0');
  }
  return out;
}
