import { describe, expect, it } from 'vitest';

import {
  bytesToHex,
  decryptArchive,
  ENCRYPTED_ARCHIVE_FORMAT,
  encryptArchive,
  hexToBytes,
  isEncryptedArchive,
  PBKDF2_ITERATIONS,
  readEncryptedArchiveMeta,
  SALT_BYTE_LENGTH,
  IV_BYTE_LENGTH,
} from './databaseEncryption';

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

describe('bytesToHex / hexToBytes', () => {
  it('converts bytes to hex and back', () => {
    const original = new Uint8Array([0x00, 0x01, 0x0f, 0x10, 0xff, 0xab]);
    const hex = bytesToHex(original);
    expect(hex).toBe('00010f10ffab');
    expect(hexToBytes(hex)).toEqual(original);
  });

  it('round-trips random bytes', () => {
    const original = crypto.getRandomValues(new Uint8Array(32));
    expect(hexToBytes(bytesToHex(original))).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// isEncryptedArchive
// ---------------------------------------------------------------------------

describe('isEncryptedArchive', () => {
  it('returns false for an empty buffer', () => {
    expect(isEncryptedArchive(new Uint8Array(0))).toBe(false);
  });

  it('returns false for a ZIP-like buffer (starts with PK magic)', () => {
    const zipMagic = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
    expect(isEncryptedArchive(zipMagic)).toBe(false);
  });

  it('returns false when header length field points past end of buffer', () => {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setUint32(0, 9999, true); // way past end
    expect(isEncryptedArchive(buf)).toBe(false);
  });

  it('returns true for an archive produced by encryptArchive', async () => {
    const plainBytes = new Uint8Array([1, 2, 3, 4, 5]);
    const encrypted = await encryptArchive(plainBytes, 'test-password', '2025-01-01T00:00:00.000Z');
    expect(isEncryptedArchive(encrypted)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// readEncryptedArchiveMeta
// ---------------------------------------------------------------------------

describe('readEncryptedArchiveMeta', () => {
  it('throws on a buffer that is too short', () => {
    expect(() => readEncryptedArchiveMeta(new Uint8Array(4))).toThrow(
      'too short'
    );
  });

  it('throws when header length is out of bounds', () => {
    const buf = new Uint8Array(16);
    new DataView(buf.buffer).setUint32(0, 9999, true);
    expect(() => readEncryptedArchiveMeta(buf)).toThrow('out of bounds');
  });

  it('throws when the header JSON is not valid', () => {
    const header = new TextEncoder().encode('NOT JSON');
    const buf = new Uint8Array(4 + header.length);
    new DataView(buf.buffer).setUint32(0, header.length, true);
    buf.set(header, 4);
    expect(() => readEncryptedArchiveMeta(buf)).toThrow('not valid JSON');
  });

  it('throws when the format field is unrecognised', () => {
    const header = new TextEncoder().encode(JSON.stringify({ format: 'unknown-format-v1' }));
    const buf = new Uint8Array(4 + header.length + 1); // +1 so payload exists
    new DataView(buf.buffer).setUint32(0, header.length, true);
    buf.set(header, 4);
    expect(() => readEncryptedArchiveMeta(buf)).toThrow('unsupported format');
  });

  it('returns valid metadata from a real encrypted archive', async () => {
    const timestamp = '2025-06-15T12:00:00.000Z';
    const encrypted = await encryptArchive(
      new Uint8Array([10, 20, 30]),
      'my-password',
      timestamp
    );

    const meta = readEncryptedArchiveMeta(encrypted);

    expect(meta.format).toBe(ENCRYPTED_ARCHIVE_FORMAT);
    expect(meta.lastSaveTimestamp).toBe(timestamp);
    expect(meta.algorithm).toBe('AES-GCM');
    expect(meta.keyLength).toBe(256);
    expect(meta.pbkdf2Iterations).toBe(PBKDF2_ITERATIONS);
    expect(meta.salt).toHaveLength(SALT_BYTE_LENGTH * 2); // hex encoding doubles length
    expect(meta.iv).toHaveLength(IV_BYTE_LENGTH * 2);
  });
});

// ---------------------------------------------------------------------------
// encryptArchive
// ---------------------------------------------------------------------------

describe('encryptArchive', () => {
  it('returns a Uint8Array larger than the input', async () => {
    const plain = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const encrypted = await encryptArchive(plain, 'pw', '2025-01-01T00:00:00.000Z');

    expect(encrypted).toBeInstanceOf(Uint8Array);
    expect(encrypted.byteLength).toBeGreaterThan(plain.byteLength);
  });

  it('produces different ciphertext each call (random salt + IV)', async () => {
    const plain = new Uint8Array(64).fill(42);
    const enc1 = await encryptArchive(plain, 'pw', '2025-01-01T00:00:00.000Z');
    const enc2 = await encryptArchive(plain, 'pw', '2025-01-01T00:00:00.000Z');

    // The headers will have different salts / IVs
    expect(bytesToHex(enc1)).not.toBe(bytesToHex(enc2));
  });

  it('stores the timestamp in the unencrypted header', async () => {
    const timestamp = '2025-12-31T23:59:59.000Z';
    const encrypted = await encryptArchive(new Uint8Array(8), 'pw', timestamp);
    const meta = readEncryptedArchiveMeta(encrypted);
    expect(meta.lastSaveTimestamp).toBe(timestamp);
  });
});

// ---------------------------------------------------------------------------
// decryptArchive – round-trip tests
// ---------------------------------------------------------------------------

describe('decryptArchive', () => {
  it('round-trips small plaintext', async () => {
    const original = new Uint8Array([10, 20, 30, 40, 50]);
    const password = 'correct-horse-battery-staple';
    const timestamp = '2025-06-01T00:00:00.000Z';

    const encrypted = await encryptArchive(original, password, timestamp);
    const decrypted = await decryptArchive(encrypted, password);

    expect(decrypted).toEqual(original);
  });

  it('round-trips a 1 KiB binary blob', async () => {
    const original = crypto.getRandomValues(new Uint8Array(1024));
    const password = 'secure-passphrase-1234';
    const timestamp = '2025-06-01T00:00:00.000Z';

    const encrypted = await encryptArchive(original, password, timestamp);
    const decrypted = await decryptArchive(encrypted, password);

    expect(decrypted).toEqual(original);
  });

  it('throws when the password is wrong', async () => {
    const original = new Uint8Array([1, 2, 3]);
    const encrypted = await encryptArchive(original, 'correct-password', '2025-01-01T00:00:00.000Z');

    await expect(decryptArchive(encrypted, 'wrong-password')).rejects.toThrow(
      'Decryption failed'
    );
  });

  it('throws when the encrypted payload is truncated', async () => {
    const original = new Uint8Array(256).fill(7);
    const encrypted = await encryptArchive(original, 'pw', '2025-01-01T00:00:00.000Z');

    // Trim 10 bytes from the end to corrupt the AES-GCM tag
    const corrupted = encrypted.slice(0, encrypted.byteLength - 10);

    await expect(decryptArchive(corrupted, 'pw')).rejects.toThrow(
      'Decryption failed'
    );
  });

  it('throws when the header is missing from a raw buffer', async () => {
    await expect(
      decryptArchive(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]), 'pw')
    ).rejects.toThrow();
  });
});
