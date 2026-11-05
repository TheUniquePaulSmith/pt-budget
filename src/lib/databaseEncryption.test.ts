import { describe, expect, it } from 'vitest';

import {
  ArchiveFormatError,
  bytesToHex,
  ENCRYPTED_ARCHIVE_FORMAT,
  hexToBytes,
  isEncryptedArchive,
  IV_BYTE_LENGTH,
  LEGACY_ENCRYPTED_ARCHIVE_FORMAT,
  readEncryptedArchiveMeta,
} from './databaseEncryption';
// The worker writes the envelopes this page-side reader parses; the two
// implementations must agree, so the fixtures here come from the real
// worker modules.
import * as workerEncryption from '../../public/database-encryption.js';
import * as keySlots from '../../public/database-key-slots.js';

async function buildEnvelope(plain: Uint8Array, lastSaveTimestamp = '2026-01-01T00:00:00.000Z') {
  const rootKey = keySlots.generateRootKey();
  const masterSlot = await keySlots.createSlot({ type: 'password', secret: 'test-password', kdf: { iterations: 1000 } }, rootKey);
  const keyId = keySlots.generateKeyId();
  const archiveKey = await keySlots.deriveArchiveKey(rootKey);
  const bytes = await workerEncryption.encryptArchive(plain, { archiveKey, keyId, masterSlot }, lastSaveTimestamp);
  return { bytes, rootKey, keyId, masterSlot };
}

function frame(header: object | string, payloadLength = 1): Uint8Array {
  const headerBytes = new TextEncoder().encode(typeof header === 'string' ? header : JSON.stringify(header));
  const buf = new Uint8Array(4 + headerBytes.length + payloadLength);
  new DataView(buf.buffer).setUint32(0, headerBytes.length, true);
  buf.set(headerBytes, 4);
  return buf;
}

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

  it('rejects odd-length or non-hex input', () => {
    expect(() => hexToBytes('abc')).toThrow('Invalid hex');
    expect(() => hexToBytes('zz')).toThrow('Invalid hex');
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
    new DataView(buf.buffer).setUint32(0, 9999, true);
    expect(isEncryptedArchive(buf)).toBe(false);
  });

  it('returns true for a v2 archive produced by the worker', async () => {
    const { bytes } = await buildEnvelope(new Uint8Array([1, 2, 3, 4, 5]));
    expect(isEncryptedArchive(bytes)).toBe(true);
  });

  it('recognises a v1 archive as an (unsupported) encrypted archive', () => {
    expect(isEncryptedArchive(frame({ format: LEGACY_ENCRYPTED_ARCHIVE_FORMAT, salt: '00', iv: '00' }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// readEncryptedArchiveMeta
// ---------------------------------------------------------------------------

describe('readEncryptedArchiveMeta', () => {
  it('throws ARCHIVE_CORRUPT on a buffer that is too short', () => {
    expect(() => readEncryptedArchiveMeta(new Uint8Array(4))).toThrow('too short');
    try {
      readEncryptedArchiveMeta(new Uint8Array(4));
    } catch (error) {
      expect(error).toBeInstanceOf(ArchiveFormatError);
      expect((error as ArchiveFormatError).code).toBe('ARCHIVE_CORRUPT');
    }
  });

  it('throws when header length is out of bounds', () => {
    const buf = new Uint8Array(16);
    new DataView(buf.buffer).setUint32(0, 9999, true);
    expect(() => readEncryptedArchiveMeta(buf)).toThrow('out of bounds');
  });

  it('throws when the header JSON is not valid', () => {
    expect(() => readEncryptedArchiveMeta(frame('NOT JSON'))).toThrow('not valid JSON');
  });

  it('throws UNSUPPORTED_ARCHIVE_FORMAT for a v1 archive', () => {
    const v1 = frame({ format: LEGACY_ENCRYPTED_ARCHIVE_FORMAT, salt: '00', iv: '00', pbkdf2Iterations: 600000 });
    expect(() => readEncryptedArchiveMeta(v1)).toThrow(ArchiveFormatError);
    try {
      readEncryptedArchiveMeta(v1);
    } catch (error) {
      expect((error as ArchiveFormatError).code).toBe('UNSUPPORTED_ARCHIVE_FORMAT');
      expect((error as Error).message).toMatch(/older version/);
    }
  });

  it('throws when the format field is unrecognised', () => {
    expect(() => readEncryptedArchiveMeta(frame({ format: 'unknown-format-v1' }))).toThrow('unsupported format');
  });

  it('throws ARCHIVE_CORRUPT when a v2 header is missing its master slot', () => {
    expect(() => readEncryptedArchiveMeta(frame({ format: ENCRYPTED_ARCHIVE_FORMAT, keyId: 'ab', iv: '00' }))).toThrow('incomplete');
  });

  it('returns valid metadata from a real encrypted archive', async () => {
    const timestamp = '2025-06-15T12:00:00.000Z';
    const { bytes, keyId, masterSlot } = await buildEnvelope(new Uint8Array([10, 20, 30]), timestamp);

    const meta = readEncryptedArchiveMeta(bytes);

    expect(meta.format).toBe(ENCRYPTED_ARCHIVE_FORMAT);
    expect(meta.lastSaveTimestamp).toBe(timestamp);
    expect(meta.algorithm).toBe('AES-GCM');
    expect(meta.keyLength).toBe(256);
    expect(meta.keyId).toBe(keyId);
    expect(meta.iv).toHaveLength(IV_BYTE_LENGTH * 2);
    expect(meta.kdf).toEqual({ name: 'HKDF-SHA256', info: 'budget-tracker/archive/v1' });
    // The master slot travels verbatim, so a new device can open the archive from the master secret alone.
    expect(meta.masterSlot).toEqual(masterSlot);
  });
});

// ---------------------------------------------------------------------------
// Parity with the worker implementation
// ---------------------------------------------------------------------------

describe('parity with public/database-encryption.js', () => {
  it('agrees on format detection and header parsing for a real envelope', async () => {
    const { bytes } = await buildEnvelope(new Uint8Array(64));
    expect(isEncryptedArchive(bytes)).toBe(workerEncryption.isEncryptedArchive(bytes));
    expect(readEncryptedArchiveMeta(bytes)).toEqual(workerEncryption.readEncryptedArchiveMeta(bytes));
  });

  it('agrees on rejecting a truncated buffer and a v1 archive', () => {
    const truncated = new Uint8Array(6);
    expect(isEncryptedArchive(truncated)).toBe(workerEncryption.isEncryptedArchive(truncated));
    expect(() => readEncryptedArchiveMeta(truncated)).toThrow();
    expect(() => workerEncryption.readEncryptedArchiveMeta(truncated)).toThrow();

    const v1 = frame({ format: LEGACY_ENCRYPTED_ARCHIVE_FORMAT, salt: '00', iv: '00' });
    const pageError = (() => {
      try {
        readEncryptedArchiveMeta(v1);
        return null;
      } catch (error) {
        return error as ArchiveFormatError;
      }
    })();
    const workerError = (() => {
      try {
        workerEncryption.readEncryptedArchiveMeta(v1);
        return null;
      } catch (error) {
        return error as { code?: string };
      }
    })();
    expect(pageError?.code).toBe('UNSUPPORTED_ARCHIVE_FORMAT');
    expect(workerError?.code).toBe('UNSUPPORTED_ARCHIVE_FORMAT');
  });

  it('shares the format constants', () => {
    expect(ENCRYPTED_ARCHIVE_FORMAT).toBe(workerEncryption.ENCRYPTED_ARCHIVE_FORMAT);
    expect(LEGACY_ENCRYPTED_ARCHIVE_FORMAT).toBe(workerEncryption.LEGACY_ENCRYPTED_ARCHIVE_FORMAT);
    expect(IV_BYTE_LENGTH).toBe(workerEncryption.IV_BYTE_LENGTH);
  });
});
