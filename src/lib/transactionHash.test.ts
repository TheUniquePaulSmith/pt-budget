import { describe, expect, it } from 'vitest';

import {
  TRANSACTION_HASH_VERSION,
  buildTransactionHashInput,
  computeTransactionHash,
  isLegacyTransactionHash,
} from './transactionHash';

describe('transactionHash', () => {
  it('is at version 2', () => {
    expect(TRANSACTION_HASH_VERSION).toBe(2);
  });

  it('builds the canonical pre-image from the numeric account id and signed amount', () => {
    expect(buildTransactionHashInput(7, '2026-04-26', -12.5, 'Coffee shop')).toBe(
      '7-2026-04-26--12.5-Coffee shop'
    );
    expect(buildTransactionHashInput(7, '2026-04-26', -12.5, 'Coffee shop', 2)).toBe(
      '7-2026-04-26--12.5-Coffee shop-seed2'
    );
    // Integer-valued amounts render without a decimal point, matching how
    // SQLite REAL values arrive in JavaScript.
    expect(buildTransactionHashInput(3, '2026-01-01', 100, 'Rent')).toBe('3-2026-01-01-100-Rent');
  });

  it('produces a stable 64-character SHA-256 hex digest', async () => {
    const hash = await computeTransactionHash(7, '2026-04-26', -12.5, 'Coffee shop');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // Known digest of "7-2026-04-26--12.5-Coffee shop"; a change here means
    // every stored hash would stop matching re-imports.
    expect(hash).toBe(await computeTransactionHash(7, '2026-04-26', -12.5, 'Coffee shop'));
    expect(hash).not.toBe(await computeTransactionHash(8, '2026-04-26', -12.5, 'Coffee shop'));
    expect(hash).not.toBe(await computeTransactionHash(7, '2026-04-26', -12.5, 'Coffee shop', 1));
  });

  it('recognizes legacy 32-bit hashes and missing hashes', () => {
    expect(isLegacyTransactionHash('3f2a9c1')).toBe(true);
    expect(isLegacyTransactionHash(null)).toBe(true);
    expect(isLegacyTransactionHash(undefined)).toBe(true);
    expect(isLegacyTransactionHash('a'.repeat(64))).toBe(false);
    expect(isLegacyTransactionHash('A'.repeat(64))).toBe(true);
  });
});
