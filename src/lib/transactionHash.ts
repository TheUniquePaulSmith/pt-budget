/**
 * Typed entry point for the transaction content hash. The implementation lives
 * in public/database-hash.js so the SharedWorker (which cannot import
 * TypeScript) and the page share one algorithm; this module only adds types.
 */

import {
  TRANSACTION_HASH_VERSION as HASH_VERSION,
  buildTransactionHashInput as buildInput,
  computeTransactionHash as computeHash,
  isLegacyTransactionHash as isLegacy,
} from '../../public/database-hash.js';

export const TRANSACTION_HASH_VERSION: number = HASH_VERSION;

export function buildTransactionHashInput(
  accountId: number | string,
  date: string,
  amount: number,
  description: string,
  variationSeed = 0
): string {
  return buildInput(accountId, date, amount, description, variationSeed);
}

/** SHA-256 hex over account id, date, signed amount, raw description, optional variation seed. */
export function computeTransactionHash(
  accountId: number | string,
  date: string,
  amount: number,
  description: string,
  variationSeed = 0
): Promise<string> {
  return computeHash(accountId, date, amount, description, variationSeed);
}

/** True for pre-v2 (32-bit) or missing hashes. */
export function isLegacyTransactionHash(hash: unknown): boolean {
  return isLegacy(hash);
}
