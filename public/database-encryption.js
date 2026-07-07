/**
 * database-encryption.js
 *
 * Worker-side database encryption / decryption utilities.
 * Plain ES module — no bundler, no TypeScript.
 *
 * Encrypted archive binary envelope format:
 *   [4 bytes: header JSON length, little-endian uint32]
 *   [N bytes: EncryptedArchiveMeta JSON (UTF-8, unencrypted)]
 *   [remaining bytes: AES-GCM encrypted payload]
 *
 * Key derivation: PBKDF2-HMAC-SHA256, 600 000 iterations, 256-bit key.
 */

export const ENCRYPTED_ARCHIVE_FORMAT = 'budget-tracker-encrypted-v1';

export const PBKDF2_ITERATIONS = 600_000;
export const SALT_BYTE_LENGTH = 32;
export const IV_BYTE_LENGTH = 12;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

async function importPasswordKey(password) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
}

export async function deriveKey(password, salt) {
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

export function isEncryptedArchive(bytes) {
  if (bytes.byteLength < 8) return false;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(0, true);

  if (headerLength > 65_536 || 4 + headerLength > bytes.byteLength) return false;

  try {
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

export function readEncryptedArchiveMeta(bytes) {
  if (bytes.byteLength < 8) {
    throw new Error('Invalid encrypted archive: file is too short');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(0, true);

  if (headerLength > 65_536 || 4 + headerLength > bytes.byteLength) {
    throw new Error('Invalid encrypted archive: header length out of bounds');
  }

  const headerText = new TextDecoder().decode(bytes.slice(4, 4 + headerLength));

  let meta;
  try {
    meta = JSON.parse(headerText);
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
 * Encrypts `plainArchiveBytes` using a freshly-derived key from `password`
 * and returns the outer encrypted envelope bytes.
 *
 * @param {Uint8Array} plainArchiveBytes  Inner ZIP bytes to encrypt.
 * @param {string}    password            User-supplied password.
 * @param {string}    lastSaveTimestamp   ISO 8601 timestamp stored unencrypted.
 * @returns {Promise<Uint8Array>}
 */
export async function encryptArchive(plainArchiveBytes, password, lastSaveTimestamp) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTE_LENGTH));
  const iv   = crypto.getRandomValues(new Uint8Array(IV_BYTE_LENGTH));

  const key = await deriveKey(password, salt);

  const encryptedPayloadBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plainArchiveBytes
  );

  const meta = {
    format: ENCRYPTED_ARCHIVE_FORMAT,
    lastSaveTimestamp,
    salt: bytesToHex(salt),
    iv:   bytesToHex(iv),
    pbkdf2Iterations: PBKDF2_ITERATIONS,
    algorithm: 'AES-GCM',
    keyLength: 256,
  };

  const headerBytes      = new TextEncoder().encode(JSON.stringify(meta));
  const headerLengthView = new Uint8Array(4);
  new DataView(headerLengthView.buffer).setUint32(0, headerBytes.byteLength, true);

  const encryptedPayloadBytes = new Uint8Array(encryptedPayloadBuffer);
  const result = new Uint8Array(
    4 + headerBytes.byteLength + encryptedPayloadBytes.byteLength
  );
  result.set(headerLengthView, 0);
  result.set(headerBytes, 4);
  result.set(encryptedPayloadBytes, 4 + headerBytes.byteLength);

  return result;
}

// ---------------------------------------------------------------------------
// Decryption
// ---------------------------------------------------------------------------

/**
 * Decrypts an encrypted archive envelope and returns the inner ZIP bytes.
 * Throws if the password is wrong or the archive is corrupted.
 *
 * @param {Uint8Array} encryptedBytes  Encrypted envelope bytes.
 * @param {string}     password        User-supplied password.
 * @returns {Promise<Uint8Array>}
 */
export async function decryptArchive(encryptedBytes, password) {
  const meta = readEncryptedArchiveMeta(encryptedBytes);

  const salt = hexToBytes(meta.salt);
  const iv   = hexToBytes(meta.iv);

  const view = new DataView(
    encryptedBytes.buffer,
    encryptedBytes.byteOffset,
    encryptedBytes.byteLength
  );
  const headerLength    = view.getUint32(0, true);
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
