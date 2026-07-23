import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BLOCK_SIZE,
  OVERHEAD,
  decryptBlock,
  encryptBlock,
  formatFilename,
  physicalBlockSize,
  planBlocks,
} from '../../public/database-encrypted-vfs.js';

async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

describe('physicalBlockSize', () => {
  it('adds the nonce+tag overhead to the logical block size', () => {
    expect(physicalBlockSize(4096)).toBe(4096 + OVERHEAD);
    expect(physicalBlockSize(DEFAULT_BLOCK_SIZE)).toBe(DEFAULT_BLOCK_SIZE + 28);
  });
});

describe('formatFilename', () => {
  it('matches IDBBatchAtomicVFS.getFilename()\'s "IDB(name):path" format', () => {
    expect(formatFilename('ptbudgetapp-v2-encrypted', '/budget-app.db')).toBe(
      'IDB(ptbudgetapp-v2-encrypted):/budget-app.db'
    );
  });
});

describe('planBlocks', () => {
  const blockSize = 4096;

  it('returns nothing for a zero-length range', () => {
    expect(planBlocks(0, 0, blockSize)).toEqual([]);
  });

  it('plans a single whole-page-aligned write as one full block', () => {
    const plan = planBlocks(4096, 4096, blockSize);
    expect(plan).toEqual([
      { blockIndex: 1, destStart: 0, destEnd: 4096, srcStart: 0, srcEnd: 4096, isFullBlock: true },
    ]);
  });

  it('plans the very first small header-sniff read (100 bytes at offset 0) as a partial first block', () => {
    const plan = planBlocks(0, 100, blockSize);
    expect(plan).toEqual([
      { blockIndex: 0, destStart: 0, destEnd: 100, srcStart: 0, srcEnd: 100, isFullBlock: false },
    ]);
  });

  it('plans a partial write in the middle of a block as not-full', () => {
    const plan = planBlocks(4096 + 50, 20, blockSize);
    expect(plan).toEqual([
      { blockIndex: 1, destStart: 0, destEnd: 20, srcStart: 50, srcEnd: 70, isFullBlock: false },
    ]);
  });

  it('splits a range spanning multiple blocks, with only the edges partial', () => {
    // Read 100 bytes ending 4096+50, i.e. [4096-50, 4096+50) — spans block 0 (partial tail) and block 1 (partial head).
    const plan = planBlocks(4096 - 50, 100, blockSize);
    expect(plan).toEqual([
      { blockIndex: 0, destStart: 0, destEnd: 50, srcStart: 4046, srcEnd: 4096, isFullBlock: false },
      { blockIndex: 1, destStart: 50, destEnd: 100, srcStart: 0, srcEnd: 50, isFullBlock: false },
    ]);
  });

  it('marks every block full when a write spans several whole blocks', () => {
    const plan = planBlocks(0, blockSize * 3, blockSize);
    expect(plan.every((b) => b.isFullBlock)).toBe(true);
    expect(plan.map((b) => b.blockIndex)).toEqual([0, 1, 2]);
  });
});

describe('encryptBlock / decryptBlock', () => {
  it('round-trips: decrypting an encrypted block returns the original plaintext', async () => {
    const key = await generateKey();
    const plaintext = crypto.getRandomValues(new Uint8Array(DEFAULT_BLOCK_SIZE));

    const physical = await encryptBlock(key, '/budget-app.db', 0, plaintext);
    expect(physical.byteLength).toBe(DEFAULT_BLOCK_SIZE + OVERHEAD);

    const decrypted = await decryptBlock(key, '/budget-app.db', 0, physical);
    expect(decrypted).toEqual(plaintext);
  });

  it('uses a fresh random nonce on every call, so identical plaintext never produces identical ciphertext', async () => {
    const key = await generateKey();
    const plaintext = new Uint8Array(DEFAULT_BLOCK_SIZE).fill(7);

    const first = await encryptBlock(key, '/budget-app.db', 0, plaintext);
    const second = await encryptBlock(key, '/budget-app.db', 0, plaintext);
    expect(first).not.toEqual(second);
  });

  it('rejects decryption with the wrong key', async () => {
    const key = await generateKey();
    const wrongKey = await generateKey();
    const plaintext = crypto.getRandomValues(new Uint8Array(DEFAULT_BLOCK_SIZE));

    const physical = await encryptBlock(key, '/budget-app.db', 0, plaintext);
    await expect(decryptBlock(wrongKey, '/budget-app.db', 0, physical)).rejects.toThrow();
  });

  it('rejects tampered ciphertext', async () => {
    const key = await generateKey();
    const plaintext = crypto.getRandomValues(new Uint8Array(DEFAULT_BLOCK_SIZE));

    const physical = await encryptBlock(key, '/budget-app.db', 0, plaintext);
    const tampered = physical.slice();
    tampered[tampered.length - 1] ^= 0xff; // flip a bit in the auth tag

    await expect(decryptBlock(key, '/budget-app.db', 0, tampered)).rejects.toThrow();
  });

  it('rejects a block moved to a different offset (swap/replay protection via AAD)', async () => {
    const key = await generateKey();
    const plaintext = crypto.getRandomValues(new Uint8Array(DEFAULT_BLOCK_SIZE));

    const physical = await encryptBlock(key, '/budget-app.db', 0, plaintext);
    // Same ciphertext bytes, but decrypted as if it belonged to a different block index.
    await expect(decryptBlock(key, '/budget-app.db', 1, physical)).rejects.toThrow();
  });

  it('rejects a block copied onto a different file path (swap/replay protection via AAD)', async () => {
    const key = await generateKey();
    const plaintext = crypto.getRandomValues(new Uint8Array(DEFAULT_BLOCK_SIZE));

    const physical = await encryptBlock(key, '/budget-app.db', 0, plaintext);
    await expect(decryptBlock(key, '/budget-app-journal.db', 0, physical)).rejects.toThrow();
  });
});
