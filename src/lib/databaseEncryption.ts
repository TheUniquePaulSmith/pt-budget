/**
 * Page-side reader for the encrypted-archive envelope (format v2).
 *
 * Encrypted archive binary envelope format (written by the worker, see
 * public/database-encryption.js — the two implementations are kept in step by
 * databaseEncryption.parity.test.ts):
 *   [4 bytes: header JSON length, little-endian uint32]
 *   [N bytes: ArchiveMetaV2 JSON (UTF-8, unencrypted)]
 *   [remaining bytes: AES-GCM encrypted payload]
 *
 * The page never decrypts anything: all key material lives in the
 * SharedWorker. This module only recognises the envelope and reads its
 * plaintext header (timestamp, root-key id, master slot type) so the UI can
 * decide what to ask the user for.
 */

import type { ArchiveMetaV2 } from './encryptionTypes';

export const ENCRYPTED_ARCHIVE_FORMAT = 'budget-tracker-encrypted-v2' as const;
export const LEGACY_ENCRYPTED_ARCHIVE_FORMAT = 'budget-tracker-encrypted-v1' as const;
const ENCRYPTED_ARCHIVE_FORMAT_PREFIX = 'budget-tracker-encrypted-v';
const MAX_HEADER_BYTES = 65_536;

export const IV_BYTE_LENGTH = 12;

export class ArchiveFormatError extends Error {
  readonly code: 'UNSUPPORTED_ARCHIVE_FORMAT' | 'ARCHIVE_CORRUPT';

  constructor(code: 'UNSUPPORTED_ARCHIVE_FORMAT' | 'ARCHIVE_CORRUPT', message: string) {
    super(message);
    this.name = 'ArchiveFormatError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
    throw new Error('Invalid hex string');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function readHeaderLength(bytes: Uint8Array): number {
  if (bytes.byteLength < 8) {
    throw new ArchiveFormatError('ARCHIVE_CORRUPT', 'Invalid encrypted archive: file is too short');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(0, true);
  if (headerLength > MAX_HEADER_BYTES || 4 + headerLength > bytes.byteLength) {
    throw new ArchiveFormatError('ARCHIVE_CORRUPT', 'Invalid encrypted archive: header length out of bounds');
  }
  return headerLength;
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

/**
 * Returns `true` if the bytes look like an encrypted archive written by any
 * version of this app (v1 included, so callers can report "unsupported
 * format" rather than "not an archive"). Reads only the first ~100 bytes.
 */
export function isEncryptedArchive(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 8) return false;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(0, true);
  if (headerLength > MAX_HEADER_BYTES || 4 + headerLength > bytes.byteLength) return false;

  try {
    const peekEnd = Math.min(4 + 100, 4 + headerLength);
    const peek = new TextDecoder().decode(bytes.slice(4, peekEnd));
    return peek.includes(ENCRYPTED_ARCHIVE_FORMAT_PREFIX);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Metadata reading (no decryption)
// ---------------------------------------------------------------------------

/**
 * Reads and validates the unencrypted v2 metadata header. Throws
 * `UNSUPPORTED_ARCHIVE_FORMAT` for a v1 archive and `ARCHIVE_CORRUPT` for
 * anything else that is not a well-formed v2 header.
 */
export function readEncryptedArchiveMeta(bytes: Uint8Array): ArchiveMetaV2 {
  const headerLength = readHeaderLength(bytes);
  const headerText = new TextDecoder().decode(bytes.slice(4, 4 + headerLength));

  let meta: Partial<Omit<ArchiveMetaV2, 'format'>> & { format?: string };
  try {
    meta = JSON.parse(headerText) as Partial<Omit<ArchiveMetaV2, 'format'>> & { format?: string };
  } catch {
    throw new ArchiveFormatError('ARCHIVE_CORRUPT', 'Invalid encrypted archive: header is not valid JSON');
  }

  if (meta.format === LEGACY_ENCRYPTED_ARCHIVE_FORMAT) {
    throw new ArchiveFormatError(
      'UNSUPPORTED_ARCHIVE_FORMAT',
      'This backup was created by an older version of the app and can no longer be opened. Export a new backup from a current version.'
    );
  }
  if (meta.format !== ENCRYPTED_ARCHIVE_FORMAT) {
    throw new ArchiveFormatError(
      'UNSUPPORTED_ARCHIVE_FORMAT',
      `Invalid encrypted archive: unsupported format "${meta.format}"`
    );
  }
  if (typeof meta.keyId !== 'string' || typeof meta.iv !== 'string' || !meta.masterSlot || typeof meta.masterSlot !== 'object') {
    throw new ArchiveFormatError('ARCHIVE_CORRUPT', 'Invalid encrypted archive: header is incomplete');
  }

  return meta as ArchiveMetaV2;
}
