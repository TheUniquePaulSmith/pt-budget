/**
 * Database Encryption / Decryption utilities.
 *
 * Encrypted archive binary envelope format:
 *   [4 bytes: header JSON length, little-endian uint32]
 *   [N bytes: EncryptedArchiveMeta JSON (UTF-8, unencrypted)]
 *   [remaining bytes: AES-GCM encrypted payload]
 *
 * The payload is the encrypted bytes of the inner ZIP archive
 * (the existing database.vfs.json + dbstatus.json archive).
 *
 * Key derivation: PBKDF2-HMAC-SHA256, 600 000 iterations, 256-bit key.
 * The salt and IV are stored in the unencrypted header so archives can be
 * decrypted independently given the correct password.
 *
 * AES-GCM's built-in authentication tag means a wrong password produces an
 * explicit decryption error rather than garbled output.
 */

export const ENCRYPTED_ARCHIVE_FORMAT = 'budget-tracker-encrypted-v1' as const;

export const PBKDF2_ITERATIONS = 600_000;
export const SALT_BYTE_LENGTH = 32;
export const IV_BYTE_LENGTH = 12; // AES-GCM standard IV length

export interface EncryptedArchiveMeta {
  format: typeof ENCRYPTED_ARCHIVE_FORMAT;
  /** ISO 8601 timestamp of the last write — readable without decryption. */
  lastSaveTimestamp: string;
  /** Hex-encoded 32-byte PBKDF2 salt. */
  salt: string;
  /** Hex-encoded 12-byte AES-GCM IV. */
  iv: string;
  pbkdf2Iterations: number;
  algorithm: 'AES-GCM';
  keyLength: 256;
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
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex string length');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

async function importPasswordKey(password: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
}

export async function deriveKey(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const keyMaterial = await importPasswordKey(password);
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable
    ['encrypt', 'decrypt']
  );
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

/**
 * Returns `true` if the bytes appear to be an encrypted archive produced by
 * this module. Only reads the first ~100 bytes; does not decrypt anything.
 */
export function isEncryptedArchive(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 8) return false;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(0, true);

  // Sanity bounds: header must fit inside the buffer and be reasonable in size.
  if (headerLength > 65_536 || 4 + headerLength > bytes.byteLength) return false;

  try {
    // Only decode the first 100 bytes of the header for a quick check.
    const peekEnd = Math.min(4 + 100, 4 + headerLength);
    const peek = new TextDecoder().decode(bytes.slice(4, peekEnd));
    return peek.includes(ENCRYPTED_ARCHIVE_FORMAT);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Metadata reading (no decryption)
// ---------------------------------------------------------------------------

/**
 * Reads and returns the unencrypted metadata header from an encrypted archive.
 * This does NOT decrypt the payload, so no password is required.
 */
export function readEncryptedArchiveMeta(bytes: Uint8Array): EncryptedArchiveMeta {
  if (bytes.byteLength < 8) {
    throw new Error('Invalid encrypted archive: file is too short');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(0, true);

  if (headerLength > 65_536 || 4 + headerLength > bytes.byteLength) {
    throw new Error('Invalid encrypted archive: header length out of bounds');
  }

  const headerText = new TextDecoder().decode(bytes.slice(4, 4 + headerLength));

  let meta: EncryptedArchiveMeta;
  try {
    meta = JSON.parse(headerText) as EncryptedArchiveMeta;
  } catch {
    throw new Error('Invalid encrypted archive: header is not valid JSON');
  }

  if (meta.format !== ENCRYPTED_ARCHIVE_FORMAT) {
    throw new Error(
      `Invalid encrypted archive: unsupported format "${meta.format}"`
    );
  }

  return meta;
}

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

/**
 * Wraps `plainArchiveBytes` (the inner ZIP produced by `createDatabaseArchive`)
 * in the encrypted envelope format and returns the outer bytes.
 */
export async function encryptArchive(
  plainArchiveBytes: Uint8Array,
  password: string,
  lastSaveTimestamp: string
): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTE_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTE_LENGTH));

  const key = await deriveKey(password, salt);

  const encryptedPayloadBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plainArchiveBytes
  );

  const meta: EncryptedArchiveMeta = {
    format: ENCRYPTED_ARCHIVE_FORMAT,
    lastSaveTimestamp,
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    pbkdf2Iterations: PBKDF2_ITERATIONS,
    algorithm: 'AES-GCM',
    keyLength: 256,
  };

  const headerBytes = new TextEncoder().encode(JSON.stringify(meta));
  const headerLengthBytes = new Uint8Array(4);
  new DataView(headerLengthBytes.buffer).setUint32(0, headerBytes.byteLength, true);

  const encryptedPayloadBytes = new Uint8Array(encryptedPayloadBuffer);
  const result = new Uint8Array(
    4 + headerBytes.byteLength + encryptedPayloadBytes.byteLength
  );
  result.set(headerLengthBytes, 0);
  result.set(headerBytes, 4);
  result.set(encryptedPayloadBytes, 4 + headerBytes.byteLength);

  return result;
}

// ---------------------------------------------------------------------------
// Decryption
// ---------------------------------------------------------------------------

/**
 * Decrypts an encrypted archive and returns the inner ZIP bytes.
 * Throws if the password is wrong or the archive is corrupted.
 */
export async function decryptArchive(
  encryptedBytes: Uint8Array,
  password: string
): Promise<Uint8Array> {
  const meta = readEncryptedArchiveMeta(encryptedBytes);

  const salt = hexToBytes(meta.salt);
  const iv = hexToBytes(meta.iv);

  const view = new DataView(
    encryptedBytes.buffer,
    encryptedBytes.byteOffset,
    encryptedBytes.byteLength
  );
  const headerLength = view.getUint32(0, true);
  const encryptedPayload = encryptedBytes.slice(4 + headerLength);

  const key = await deriveKey(password, salt);

  try {
    const plainBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encryptedPayload
    );
    return new Uint8Array(plainBuffer);
  } catch {
    throw new Error(
      'Decryption failed: the password is incorrect or the archive is corrupted'
    );
  }
}

// ---------------------------------------------------------------------------
// Page-encryption key (VFS-level at-rest encryption of the live database)
// ---------------------------------------------------------------------------
//
// Uses the same PBKDF2-HMAC-SHA256 -> AES-256-GCM derivation as the archive
// path above, but with its own independently-random salt (persisted in the
// worker's out-of-band encryption header) so the page-encryption key and the
// archive-encryption key are cryptographically independent even though both
// are derived from the same password.

const PAGE_KEY_VERIFIER_PLAINTEXT = 'budget-tracker-page-key-check-v1';

/** Derives the AES-256-GCM key used to encrypt/decrypt live database pages. */
export async function derivePageKey(
  password: string,
  pageSalt: Uint8Array
): Promise<CryptoKey> {
  return deriveKey(password, pageSalt);
}

/**
 * Encrypts a fixed, non-secret constant under `pageKey` so a later unlock
 * attempt can reject a wrong password immediately, without ever touching the
 * VFS-managed blocks.
 */
export async function createPageKeyVerifier(
  pageKey: CryptoKey
): Promise<{ verifierIv: string; verifierCiphertext: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTE_LENGTH));
  const plaintext = new TextEncoder().encode(PAGE_KEY_VERIFIER_PLAINTEXT);
  const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, pageKey, plaintext);
  return {
    verifierIv: bytesToHex(iv),
    verifierCiphertext: bytesToHex(new Uint8Array(cipherBuffer)),
  };
}

/** Returns `true` only if `pageKey` correctly decrypts the stored verifier. */
export async function checkPageKeyVerifier(
  pageKey: CryptoKey,
  verifierIv: string,
  verifierCiphertext: string
): Promise<boolean> {
  try {
    const plainBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: hexToBytes(verifierIv) },
      pageKey,
      hexToBytes(verifierCiphertext)
    );
    return new TextDecoder().decode(plainBuffer) === PAGE_KEY_VERIFIER_PLAINTEXT;
  } catch {
    return false;
  }
}
