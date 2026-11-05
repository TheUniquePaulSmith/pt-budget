/**
 * database-key-slots.js
 *
 * Envelope encryption for the live database: a random 256-bit ROOT KEY
 * encrypts everything (through two HKDF-derived subkeys), and every way of
 * unlocking the database is a KEY SLOT that wraps that root key under its
 * own key-encryption key (KEK). Plain ES module — no bundler, no TypeScript.
 *
 *   slot secret ─► IKM ─► HKDF(salt, "budget-tracker/kek/v1/<type>") ─► KEK
 *   KEK ─► AES-256-GCM(iv, aad = "budget-tracker/slot/v1:<slotId>:<type>") wraps ROOT
 *   ROOT ─► HKDF("budget-tracker/pages/v1")   ─► page key    (encrypting VFS)
 *   ROOT ─► HKDF("budget-tracker/archive/v1") ─► archive key (exports / cloud copies)
 *
 * Slot types and their input keying material (IKM):
 *   password  PBKDF2-HMAC-SHA256 of the NFKC-normalised password (slot-specific salt + iterations)
 *   recovery  the 16 entropy bytes behind a 12-word BIP39 phrase (decoded and checksum-verified by the page)
 *   passkey   the 32-byte WebAuthn PRF output for the slot's prfSalt
 *   cloud     a 32-byte share stored in the user's cloud app folder ‖ a 32-byte share stored only on this device
 *
 * Exactly one `password` or `recovery` slot (the MASTER slot) exists per
 * database; passkey and cloud slots are convenience slots that can never be
 * the only way in. A failed AES-GCM unwrap *is* the wrong-secret signal, so no
 * separate verifier is stored. The wrap AAD is container-independent on
 * purpose: the master slot record is copied verbatim into every exported
 * archive so a new device can open it from the master secret alone.
 *
 * See docs/Encryption.md for the full design and threat model.
 */

import { EncryptionError, bytesToHex, hexToBytes, zeroize, constantTimeEqual, IV_BYTE_LENGTH } from './database-encryption.js';

export { EncryptionError, bytesToHex, hexToBytes, zeroize, constantTimeEqual };

export const HEADER_FORMAT_V2 = 'budget-tracker-page-encryption-header-v2';
export const LEGACY_HEADER_FORMAT_V1 = 'budget-tracker-page-encryption-header-v1';

export const SLOT_TYPES = ['password', 'recovery', 'passkey', 'cloud'];
export const MASTER_SLOT_TYPES = ['password', 'recovery'];
export const CONVENIENCE_SLOT_TYPES = ['passkey', 'cloud'];

export const ROOT_KEY_BYTES = 32;
export const KEY_ID_BYTES = 16;
export const SLOT_ID_BYTES = 8;
export const SALT_BYTES = 32;
export const RECOVERY_ENTROPY_BYTES = 16;
export const PRF_OUTPUT_BYTES = 32;
export const CLOUD_SHARE_BYTES = 32;
export const WRAPPED_ROOT_KEY_BYTES = ROOT_KEY_BYTES + 16; // + GCM tag

export const PBKDF2_ITERATIONS = 600_000;

export const KEK_INFO_PREFIX = 'budget-tracker/kek/v1/';
export const SLOT_AAD_PREFIX = 'budget-tracker/slot/v1:';
export const PAGE_KEY_INFO = 'budget-tracker/pages/v1';
export const ARCHIVE_KEY_INFO = 'budget-tracker/archive/v1';

const utf8 = new TextEncoder();

/**
 * @typedef {object} SlotWrap
 * @property {'A256GCM'} alg
 * @property {string} iv          hex, 12 bytes
 * @property {string} ciphertext  hex, 48 bytes (32-byte root key + GCM tag)
 */

/**
 * @typedef {object} SlotRecord
 * @property {string} slotId      hex, 8 bytes
 * @property {'password'|'recovery'|'passkey'|'cloud'} type
 * @property {string} label
 * @property {string} createdAt   ISO 8601
 * @property {string|null} lastUsedAt
 * @property {string} hkdfSalt    hex, 32 bytes
 * @property {SlotWrap} wrap
 * @property {Record<string, any> & { name: string }} kdf  type-specific public KDF parameters
 */

/**
 * @typedef {object} HeaderRecord
 * @property {'default'} id
 * @property {string} format
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {number} blockSize
 * @property {string} keyId       hex, 16 bytes; public id of the root key
 * @property {SlotRecord[]} slots
 */

// ---------------------------------------------------------------------------
// Random material
// ---------------------------------------------------------------------------

export function generateRootKey() {
  return crypto.getRandomValues(new Uint8Array(ROOT_KEY_BYTES));
}

export function generateKeyId() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(KEY_ID_BYTES)));
}

export function generateSlotId() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(SLOT_ID_BYTES)));
}

function randomHex(byteLength) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(byteLength)));
}

// ---------------------------------------------------------------------------
// Input keying material per slot type
// ---------------------------------------------------------------------------

/**
 * Unicode normalisation so the "same" password typed on different platforms
 * (precomposed vs. decomposed accents, full-width digits…) derives the same key.
 */
export function normalizePassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new EncryptionError('INVALID_SECRET', 'Password must be a non-empty string');
  }
  return password.normalize('NFKC');
}

async function pbkdf2(password, saltBytes, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    utf8.encode(normalizePassword(password)),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return new Uint8Array(bits);
}

function requireBytes(value, length, what) {
  const bytes = value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : null;
  if (!bytes || bytes.byteLength !== length) {
    throw new EncryptionError('INVALID_SECRET', `${what} must be ${length} bytes`);
  }
  return bytes;
}

/**
 * Turns a slot's secret into HKDF input keying material.
 * @param {object} slot      SlotRecord (its `kdf` block says how)
 * @param {string|Uint8Array} secret  password string, recovery entropy, PRF output or cloud share
 * @returns {Promise<Uint8Array>}
 */
export async function deriveIkm(slot, secret) {
  switch (slot.type) {
    case 'password': {
      const { kdf } = slot;
      if (!kdf || kdf.name !== 'PBKDF2-HMAC-SHA256' || typeof kdf.salt !== 'string' || !Number.isInteger(kdf.iterations)) {
        throw new EncryptionError('HEADER_INVALID', 'Password slot has an invalid KDF block');
      }
      return pbkdf2(secret, hexToBytes(kdf.salt), kdf.iterations);
    }
    case 'recovery':
      return requireBytes(secret, RECOVERY_ENTROPY_BYTES, 'Recovery phrase entropy').slice();
    case 'passkey':
      return requireBytes(secret, PRF_OUTPUT_BYTES, 'Passkey PRF output').slice();
    case 'cloud': {
      const cloudShare = requireBytes(secret, CLOUD_SHARE_BYTES, 'Cloud key share');
      if (typeof slot.kdf?.deviceSecret !== 'string') {
        throw new EncryptionError('HEADER_INVALID', 'Cloud slot is missing its device share');
      }
      const deviceShare = hexToBytes(slot.kdf.deviceSecret);
      const ikm = new Uint8Array(cloudShare.byteLength + deviceShare.byteLength);
      ikm.set(cloudShare, 0);
      ikm.set(deviceShare, cloudShare.byteLength);
      zeroize(deviceShare);
      return ikm;
    }
    default:
      throw new EncryptionError('INVALID_SLOT_TYPE', `Unknown key slot type "${slot.type}"`);
  }
}

// ---------------------------------------------------------------------------
// HKDF
// ---------------------------------------------------------------------------

async function hkdfAesKey(ikmBytes, saltBytes, info, usages) {
  const ikmKey = await crypto.subtle.importKey('raw', ikmBytes, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info: utf8.encode(info) },
    ikmKey,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable
    usages
  );
}

/** Derives a slot's key-encryption key. The IKM is zeroed afterwards. */
export async function deriveKek(ikmBytes, hkdfSaltBytes, type) {
  try {
    return await hkdfAesKey(ikmBytes, hkdfSaltBytes, KEK_INFO_PREFIX + type, ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt']);
  } finally {
    zeroize(ikmBytes);
  }
}

/** Derives one of the root key's subkeys (page key or archive key). */
export function deriveSubKey(rootKey, info) {
  return hkdfAesKey(rootKey, new Uint8Array(0), info, ['encrypt', 'decrypt']);
}

export function derivePageKey(rootKey) {
  return deriveSubKey(rootKey, PAGE_KEY_INFO);
}

export function deriveArchiveKey(rootKey) {
  return deriveSubKey(rootKey, ARCHIVE_KEY_INFO);
}

// ---------------------------------------------------------------------------
// Wrapping the root key
// ---------------------------------------------------------------------------

function slotAad(slotId, type) {
  return utf8.encode(`${SLOT_AAD_PREFIX}${slotId}:${type}`);
}

/** Encrypts the root key under `kek`; returns the slot's `wrap` block. */
export async function wrapRootKey(rootKey, { slotId, type }, kek) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTE_LENGTH));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: slotAad(slotId, type) },
    kek,
    rootKey
  );
  return { alg: 'A256GCM', iv: bytesToHex(iv), ciphertext: bytesToHex(new Uint8Array(ciphertext)) };
}

/** Decrypts a slot's wrapped root key under `kek`. Throws INVALID_SECRET on a GCM failure. */
export async function unwrapRootKey(slot, kek) {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: hexToBytes(slot.wrap.iv), additionalData: slotAad(slot.slotId, slot.type) },
      kek,
      hexToBytes(slot.wrap.ciphertext)
    );
    const rootKey = new Uint8Array(plain);
    if (rootKey.byteLength !== ROOT_KEY_BYTES) {
      zeroize(rootKey);
      throw new EncryptionError('HEADER_INVALID', 'Wrapped root key has an unexpected length');
    }
    return rootKey;
  } catch (error) {
    if (error instanceof EncryptionError) throw error;
    throw new EncryptionError('INVALID_SECRET', 'Incorrect password');
  }
}

// ---------------------------------------------------------------------------
// Slot records
// ---------------------------------------------------------------------------

const DEFAULT_LABELS = {
  password: 'Password',
  recovery: 'Recovery phrase',
  passkey: 'Passkey',
  cloud: 'Cloud account',
};

/**
 * Builds the slot's `kdf` block. Secrets never land in it except the
 * cloud slot's device share, which exists only in this device's header.
 */
function buildKdfBlock(type, kdfOptions = {}) {
  switch (type) {
    case 'password':
      return {
        name: 'PBKDF2-HMAC-SHA256',
        salt: randomHex(SALT_BYTES),
        iterations: Number.isInteger(kdfOptions.iterations) && kdfOptions.iterations > 0 ? kdfOptions.iterations : PBKDF2_ITERATIONS,
        normalization: 'NFKC',
      };
    case 'recovery':
      return { name: 'bip39-entropy', wordlist: 'english', wordCount: 12 };
    case 'passkey': {
      const { credentialId, prfSalt, rpId, transports, userHandle } = kdfOptions;
      if (typeof credentialId !== 'string' || typeof prfSalt !== 'string' || typeof rpId !== 'string') {
        throw new EncryptionError('INVALID_SLOT_TYPE', 'Passkey slot needs credentialId, prfSalt and rpId');
      }
      return {
        name: 'webauthn-prf',
        credentialId,
        prfSalt,
        rpId,
        transports: Array.isArray(transports) ? transports.filter((t) => typeof t === 'string') : [],
        userHandle: typeof userHandle === 'string' ? userHandle : null,
      };
    }
    case 'cloud': {
      const { provider, shareFileName } = kdfOptions;
      if (typeof provider !== 'string' || typeof shareFileName !== 'string') {
        throw new EncryptionError('INVALID_SLOT_TYPE', 'Cloud slot needs provider and shareFileName');
      }
      return { name: 'cloud-split', provider, shareFileName, deviceSecret: randomHex(CLOUD_SHARE_BYTES) };
    }
    default:
      throw new EncryptionError('INVALID_SLOT_TYPE', `Unknown key slot type "${type}"`);
  }
}

/**
 * Creates a slot record that wraps `rootKey` under a KEK derived from `secret`.
 *
 * @param {{ type: string, secret: string|Uint8Array, label?: string, kdf?: object }} input
 *   `kdf` carries type-specific public parameters (passkey credential data, cloud provider…).
 * @param {Uint8Array} rootKey
 * @returns {Promise<SlotRecord>}
 */
export async function createSlot({ type, secret, label, kdf }, rootKey) {
  if (!SLOT_TYPES.includes(type)) {
    throw new EncryptionError('INVALID_SLOT_TYPE', `Unknown key slot type "${type}"`);
  }
  requireBytes(rootKey, ROOT_KEY_BYTES, 'Root key');

  const now = new Date().toISOString();
  /** @type {SlotRecord} */
  const slot = {
    slotId: generateSlotId(),
    type,
    label: typeof label === 'string' && label.trim() ? label.trim() : DEFAULT_LABELS[type],
    createdAt: now,
    lastUsedAt: null,
    hkdfSalt: randomHex(SALT_BYTES),
    kdf: buildKdfBlock(type, kdf),
    wrap: /** @type {SlotWrap} */ (/** @type {unknown} */ (null)),
  };

  const ikm = await deriveIkm(slot, secret);
  const kek = await deriveKek(ikm, hexToBytes(slot.hkdfSalt), type);
  slot.wrap = await wrapRootKey(rootKey, slot, kek);
  return slot;
}

/**
 * Recovers the root key from `slot` with `secret`. Throws INVALID_SECRET when
 * they do not match. The caller owns (and must zeroize) the returned bytes.
 * @param {SlotRecord} slot
 * @param {string|Uint8Array} secret
 * @returns {Promise<Uint8Array>}
 */
export async function openSlot(slot, secret) {
  assertSlotShape(slot);
  const ikm = await deriveIkm(slot, secret);
  const kek = await deriveKek(ikm, hexToBytes(slot.hkdfSalt), slot.type);
  return unwrapRootKey(slot, kek);
}

/** Returns `true` when `secret` opens `slot`, never throwing. Zeroizes the unwrapped key. */
export async function verifySlotSecret(slot, secret) {
  try {
    const rootKey = await openSlot(slot, secret);
    zeroize(rootKey);
    return true;
  } catch {
    return false;
  }
}

export function isMasterSlot(slot) {
  return MASTER_SLOT_TYPES.includes(slot?.type);
}

/** @param {HeaderRecord|null|undefined} header @returns {SlotRecord|null} */
export function findMasterSlot(header) {
  return header?.slots?.find(isMasterSlot) ?? null;
}

/** @param {HeaderRecord|null|undefined} header @param {string} slotId @returns {SlotRecord|null} */
export function findSlot(header, slotId) {
  return header?.slots?.find((slot) => slot.slotId === slotId) ?? null;
}

/**
 * The slot without any of its secret-bearing fields, for the page / lock
 * screen. Public passkey and cloud parameters stay: the locked page needs the
 * credential id and PRF salt to run the WebAuthn ceremony, and the provider
 * and share file name to fetch the cloud share.
 */
export function summarizeSlot(slot) {
  const summary = {
    slotId: slot.slotId,
    type: slot.type,
    label: slot.label,
    createdAt: slot.createdAt,
    lastUsedAt: slot.lastUsedAt ?? null,
    isMaster: isMasterSlot(slot),
  };
  if (slot.type === 'passkey') {
    summary.passkey = {
      credentialId: slot.kdf.credentialId,
      prfSalt: slot.kdf.prfSalt,
      rpId: slot.kdf.rpId,
      transports: slot.kdf.transports ?? [],
    };
  } else if (slot.type === 'cloud') {
    summary.cloud = { provider: slot.kdf.provider, shareFileName: slot.kdf.shareFileName };
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Header records
// ---------------------------------------------------------------------------

function isHex(value, byteLength) {
  return typeof value === 'string' && value.length === byteLength * 2 && /^[0-9a-f]+$/i.test(value);
}

function assertSlotShape(slot) {
  if (!slot || typeof slot !== 'object') {
    throw new EncryptionError('HEADER_INVALID', 'Key slot is missing');
  }
  if (!SLOT_TYPES.includes(slot.type)) {
    throw new EncryptionError('INVALID_SLOT_TYPE', `Unknown key slot type "${slot.type}"`);
  }
  if (!isHex(slot.slotId, SLOT_ID_BYTES)) {
    throw new EncryptionError('HEADER_INVALID', 'Key slot has an invalid id');
  }
  if (!isHex(slot.hkdfSalt, SALT_BYTES)) {
    throw new EncryptionError('HEADER_INVALID', 'Key slot has an invalid HKDF salt');
  }
  if (!slot.wrap || slot.wrap.alg !== 'A256GCM' || !isHex(slot.wrap.iv, IV_BYTE_LENGTH) || !isHex(slot.wrap.ciphertext, WRAPPED_ROOT_KEY_BYTES)) {
    throw new EncryptionError('HEADER_INVALID', 'Key slot has an invalid wrapped key');
  }
  const expectedKdf = { password: 'PBKDF2-HMAC-SHA256', recovery: 'bip39-entropy', passkey: 'webauthn-prf', cloud: 'cloud-split' }[slot.type];
  if (!slot.kdf || slot.kdf.name !== expectedKdf) {
    throw new EncryptionError('HEADER_INVALID', `Key slot of type "${slot.type}" has KDF "${slot.kdf?.name}"`);
  }
}

/**
 * Throws HEADER_INVALID unless `header` is a well-formed v2 header: exactly
 * one master slot, unique slot ids, and every slot well-formed.
 * @param {any} header
 * @returns {HeaderRecord}
 */
export function assertHeaderInvariants(header) {
  if (!header || header.format !== HEADER_FORMAT_V2) {
    throw new EncryptionError('HEADER_INVALID', 'Encryption header has an unsupported format');
  }
  if (!isHex(header.keyId, KEY_ID_BYTES)) {
    throw new EncryptionError('HEADER_INVALID', 'Encryption header has an invalid key id');
  }
  if (!Number.isInteger(header.blockSize) || header.blockSize <= 0) {
    throw new EncryptionError('HEADER_INVALID', 'Encryption header has an invalid block size');
  }
  if (!Array.isArray(header.slots) || header.slots.length === 0) {
    throw new EncryptionError('HEADER_INVALID', 'Encryption header has no key slots');
  }
  const ids = new Set();
  let masterCount = 0;
  for (const slot of header.slots) {
    assertSlotShape(slot);
    if (ids.has(slot.slotId)) {
      throw new EncryptionError('HEADER_INVALID', 'Encryption header has duplicate slot ids');
    }
    ids.add(slot.slotId);
    if (isMasterSlot(slot)) masterCount += 1;
  }
  if (masterCount !== 1) {
    throw new EncryptionError('HEADER_INVALID', `Encryption header must have exactly one master slot (found ${masterCount})`);
  }
  return header;
}

export function isLegacyHeader(header) {
  return Boolean(header) && header.format === LEGACY_HEADER_FORMAT_V1;
}

/**
 * Builds a fresh v2 header around `masterSlot`.
 * @param {{ keyId: string, blockSize: number, masterSlot: SlotRecord, createdAt?: string }} input
 * @returns {HeaderRecord}
 */
export function createHeader({ keyId, blockSize, masterSlot, createdAt }) {
  const now = new Date().toISOString();
  return assertHeaderInvariants({
    id: 'default',
    format: HEADER_FORMAT_V2,
    createdAt: createdAt ?? now,
    updatedAt: now,
    blockSize,
    keyId,
    slots: [masterSlot],
  });
}

/**
 * Returns a copy of `header` with `slots` replaced and `updatedAt` bumped, validated.
 * @param {HeaderRecord} header @param {SlotRecord[]} slots @returns {HeaderRecord}
 */
export function withSlots(header, slots) {
  return assertHeaderInvariants({ ...header, slots, updatedAt: new Date().toISOString() });
}

/**
 * Cross-device master propagation: when a pulled archive was written by the
 * same database (same `keyId`) but its master slot differs from ours — the
 * master was changed on another device — adopt the archive's master slot so
 * this device asks for the new secret from now on. Convenience slots are
 * untouched (they wrap the same root key). Returns the updated header, or
 * null when nothing needs to change.
 * @param {HeaderRecord|null} header
 * @param {{ keyId: string, masterSlot: SlotRecord }|null} archiveMeta
 * @returns {HeaderRecord|null}
 */
export function adoptArchiveMasterSlot(header, archiveMeta) {
  if (!header || !archiveMeta || archiveMeta.keyId !== header.keyId) return null;
  const incoming = archiveMeta.masterSlot;
  if (!incoming || !isMasterSlot(incoming)) return null;
  assertSlotShape(incoming);
  const current = findMasterSlot(header);
  if (current && current.slotId === incoming.slotId && current.wrap.ciphertext === incoming.wrap.ciphertext) return null;
  const slots = header.slots.filter((slot) => !isMasterSlot(slot));
  return withSlots(header, [incoming, ...slots]);
}

/** Summary of every slot plus the header facts the lock screen needs before unlock. */
export function summarizeHeader(header) {
  if (!header) {
    return { exists: false, legacyHeader: false, keyId: null, blockSize: null, methods: [] };
  }
  if (isLegacyHeader(header)) {
    return { exists: true, legacyHeader: true, keyId: null, blockSize: header.blockSize ?? null, methods: [] };
  }
  return {
    exists: true,
    legacyHeader: false,
    keyId: header.keyId,
    blockSize: header.blockSize,
    methods: (header.slots ?? []).map(summarizeSlot),
  };
}
