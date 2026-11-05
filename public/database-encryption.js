/**
 * database-encryption.js
 *
 * Worker-side encrypted-archive envelope (format v2) and the shared byte
 * helpers / error class used by database-key-slots.js.
 * Plain ES module — no bundler, no TypeScript.
 *
 * Encrypted archive binary envelope format:
 *   [4 bytes: header JSON length, little-endian uint32]
 *   [N bytes: EncryptedArchiveMeta JSON (UTF-8, unencrypted)]
 *   [remaining bytes: AES-GCM encrypted payload]
 *
 * The payload is encrypted with the ARCHIVE KEY, which is derived from the
 * database's random root key (see database-key-slots.js). The header carries
 * a verbatim copy of the database's master key slot, so an archive can be
 * opened on a brand-new device from the master secret alone, and the root
 * key's public `keyId` so a device that already holds the same root key can
 * decrypt the archive without asking for the master secret at all.
 *
 * Archive format v1 (`budget-tracker-encrypted-v1`, PBKDF2 straight from the
 * password) is recognised but no longer supported.
 */

export const ENCRYPTED_ARCHIVE_FORMAT = 'budget-tracker-encrypted-v2';
export const LEGACY_ENCRYPTED_ARCHIVE_FORMAT = 'budget-tracker-encrypted-v1';
/** Common prefix of every archive format this app has ever written. */
const ENCRYPTED_ARCHIVE_FORMAT_PREFIX = 'budget-tracker-encrypted-v';

export const IV_BYTE_LENGTH = 12;
const MAX_HEADER_BYTES = 65_536;

// ---------------------------------------------------------------------------
// Error class shared by the encryption modules
// ---------------------------------------------------------------------------

/**
 * Error with a stable machine-readable `code` (see ENCRYPTION_ERROR_CODES in
 * src/lib/encryptionTypes.ts). The page maps codes to translated messages;
 * `message` is the English fallback.
 */
export class EncryptionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EncryptionError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

export function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
    throw new EncryptionError('HEADER_INVALID', 'Invalid hex string');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/** Overwrites `bytes` with zeros. Best effort: JS cannot pin memory, but it shortens the window. */
export function zeroize(bytes) {
  if (bytes && typeof bytes.fill === 'function') {
    bytes.fill(0);
  }
}

/** Compares two byte arrays without short-circuiting on the first difference. */
export function constantTimeEqual(a, b) {
  if (!a || !b || a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Envelope framing
// ---------------------------------------------------------------------------

function readHeaderLength(bytes) {
  if (bytes.byteLength < 8) {
    throw new EncryptionError('ARCHIVE_CORRUPT', 'Invalid encrypted archive: file is too short');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(0, true);
  if (headerLength > MAX_HEADER_BYTES || 4 + headerLength > bytes.byteLength) {
    throw new EncryptionError('ARCHIVE_CORRUPT', 'Invalid encrypted archive: header length out of bounds');
  }
  return headerLength;
}

/**
 * Returns `true` if the bytes look like an encrypted archive written by any
 * version of this app (v1 included, so the caller can report "unsupported
 * format" instead of "not an archive"). Reads only the first ~100 bytes.
 */
export function isEncryptedArchive(bytes) {
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

/**
 * Reads and validates the unencrypted v2 metadata header. Does NOT decrypt
 * anything. Throws `UNSUPPORTED_ARCHIVE_FORMAT` for a v1 archive and
 * `ARCHIVE_CORRUPT` for anything else that is not a well-formed v2 header.
 */
export function readEncryptedArchiveMeta(bytes) {
  const headerLength = readHeaderLength(bytes);
  const headerText = new TextDecoder().decode(bytes.slice(4, 4 + headerLength));

  let meta;
  try {
    meta = JSON.parse(headerText);
  } catch {
    throw new EncryptionError('ARCHIVE_CORRUPT', 'Invalid encrypted archive: header is not valid JSON');
  }

  if (meta.format === LEGACY_ENCRYPTED_ARCHIVE_FORMAT) {
    throw new EncryptionError(
      'UNSUPPORTED_ARCHIVE_FORMAT',
      'This backup was created by an older version of the app and can no longer be opened. Export a new backup from a current version.'
    );
  }
  if (meta.format !== ENCRYPTED_ARCHIVE_FORMAT) {
    throw new EncryptionError(
      'UNSUPPORTED_ARCHIVE_FORMAT',
      `Invalid encrypted archive: unsupported format "${meta.format}"`
    );
  }
  if (typeof meta.keyId !== 'string' || typeof meta.iv !== 'string' || !meta.masterSlot || typeof meta.masterSlot !== 'object') {
    throw new EncryptionError('ARCHIVE_CORRUPT', 'Invalid encrypted archive: header is incomplete');
  }

  return meta;
}

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

/**
 * Wraps `plainArchiveBytes` (the inner ZIP) in the v2 envelope.
 *
 * @param {Uint8Array} plainArchiveBytes
 * @param {{ archiveKey: CryptoKey, keyId: string, masterSlot: object }} keys
 *   `archiveKey` is the HKDF-derived AES-GCM key, `keyId` the root key's public
 *   id and `masterSlot` the header's master slot record, copied verbatim.
 * @param {string} lastSaveTimestamp  ISO 8601, stored unencrypted.
 * @returns {Promise<Uint8Array>}
 */
export async function encryptArchive(plainArchiveBytes, keys, lastSaveTimestamp) {
  const { archiveKey, keyId, masterSlot } = keys;
  if (!archiveKey || typeof keyId !== 'string' || !masterSlot) {
    throw new EncryptionError('LOCKED', 'Database is locked — unlock it before exporting');
  }
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTE_LENGTH));

  const encryptedPayloadBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    archiveKey,
    plainArchiveBytes
  );

  const meta = {
    format: ENCRYPTED_ARCHIVE_FORMAT,
    lastSaveTimestamp,
    keyId,
    iv: bytesToHex(iv),
    algorithm: 'AES-GCM',
    keyLength: 256,
    kdf: { name: 'HKDF-SHA256', info: 'budget-tracker/archive/v1' },
    masterSlot,
  };

  const headerBytes = new TextEncoder().encode(JSON.stringify(meta));
  const headerLengthView = new Uint8Array(4);
  new DataView(headerLengthView.buffer).setUint32(0, headerBytes.byteLength, true);

  const encryptedPayloadBytes = new Uint8Array(encryptedPayloadBuffer);
  const result = new Uint8Array(4 + headerBytes.byteLength + encryptedPayloadBytes.byteLength);
  result.set(headerLengthView, 0);
  result.set(headerBytes, 4);
  result.set(encryptedPayloadBytes, 4 + headerBytes.byteLength);

  return result;
}

// ---------------------------------------------------------------------------
// Decryption
// ---------------------------------------------------------------------------

/**
 * Decrypts a v2 envelope with an already-derived archive key and returns the
 * inner ZIP bytes. Throws `INVALID_SECRET` when the key does not match (the
 * GCM tag fails) — the caller decides whether that means a wrong master
 * secret or a different database.
 *
 * @param {Uint8Array} encryptedBytes
 * @param {CryptoKey} archiveKey
 * @returns {Promise<Uint8Array>}
 */
export async function decryptArchive(encryptedBytes, archiveKey) {
  const meta = readEncryptedArchiveMeta(encryptedBytes);
  const headerLength = readHeaderLength(encryptedBytes);
  const encryptedPayload = encryptedBytes.slice(4 + headerLength);

  try {
    const plainBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: hexToBytes(meta.iv) },
      archiveKey,
      encryptedPayload
    );
    return new Uint8Array(plainBuffer);
  } catch {
    throw new EncryptionError(
      'INVALID_SECRET',
      'Decryption failed: the password or recovery phrase is incorrect, or the archive is corrupted'
    );
  }
}
