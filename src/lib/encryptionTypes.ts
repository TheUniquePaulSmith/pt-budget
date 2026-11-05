/**
 * Shared page-side contracts for the envelope-encryption design
 * (public/database-key-slots.js, public/database-encryption.js).
 *
 * A database has one random root key. Every way of unlocking it is a KEY
 * SLOT that wraps that root key: exactly one MASTER slot (a password or a
 * 12-word recovery phrase) plus optional convenience slots (passkeys, a cloud
 * account share). See docs/Encryption.md.
 */

export type MasterSlotType = 'password' | 'recovery';
export type ConvenienceSlotType = 'passkey' | 'cloud';
export type SlotType = MasterSlotType | ConvenienceSlotType;

export const MASTER_SLOT_TYPES: readonly MasterSlotType[] = ['password', 'recovery'];

/** The secret that opens the master slot, as typed by the user. */
export type MasterSecret =
  | { type: 'password'; secret: string }
  /** The 16 entropy bytes behind the 12 words (decoded and checksum-verified on the page). */
  | { type: 'recovery'; secret: Uint8Array };

/** Any way of unlocking: the master secret, or a convenience slot's key material. */
export type UnlockMethod =
  | MasterSecret
  /** 32-byte WebAuthn PRF output for the slot's prfSalt. */
  | { type: 'passkey'; slotId: string; secret: Uint8Array }
  /** 32-byte share fetched from the user's cloud app folder. */
  | { type: 'cloud'; slotId: string; secret: Uint8Array };

/** Public view of a slot (no key material), as returned by get_unlock_methods. */
export interface SlotSummary {
  slotId: string;
  type: SlotType;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  isMaster: boolean;
  passkey?: {
    credentialId: string;
    prfSalt: string;
    rpId: string;
    transports: string[];
  };
  cloud?: {
    provider: string;
    shareFileName: string;
  };
}

/** What the lock screen can learn before anything is unlocked. */
export interface UnlockMethods {
  /** A header (of any version) exists on this device. */
  exists: boolean;
  /** The header is the pre-key-slot v1 format and cannot be opened by this version. */
  legacyHeader: boolean;
  keyId: string | null;
  blockSize: number | null;
  /** The worker already holds the key (another tab unlocked it). */
  isUnlocked: boolean;
  methods: SlotSummary[];
}

/** Convenience slot registration request (add_slot). */
export interface NewConvenienceSlot {
  type: ConvenienceSlotType;
  /** PRF output (passkey) or cloud share (cloud); 32 bytes. Zeroed by the worker after use. */
  secret: Uint8Array;
  label?: string;
  /** Type-specific public parameters; see database-key-slots.js buildKdfBlock. */
  kdf:
    | { credentialId: string; prfSalt: string; rpId: string; transports?: string[]; userHandle?: string }
    | { provider: string; shareFileName: string };
}

/** The unencrypted header of an encrypted archive (format v2). */
export interface ArchiveMetaV2 {
  format: 'budget-tracker-encrypted-v2';
  lastSaveTimestamp: string;
  /** Identifies the root key the archive was written under; matches the local header's keyId for this device's own backups. */
  keyId: string;
  iv: string;
  algorithm: 'AES-GCM';
  keyLength: 256;
  kdf: { name: 'HKDF-SHA256'; info: string };
  /** Verbatim copy of the writing database's master slot record. */
  masterSlot: {
    slotId: string;
    type: MasterSlotType;
    label: string;
    createdAt: string;
    lastUsedAt: string | null;
    hkdfSalt: string;
    wrap: { alg: 'A256GCM'; iv: string; ciphertext: string };
    kdf: Record<string, unknown> & { name: string };
  };
}

/** What a restore needs from an archive header to adopt its root key (create_new_database restoreFrom). */
export type ArchiveRestoreSource = Pick<ArchiveMetaV2, 'keyId' | 'masterSlot'>;

export const ENCRYPTION_ERROR_CODES = [
  'INVALID_SECRET',
  'INVALID_RECOVERY_PHRASE',
  'LEGACY_HEADER',
  'HEADER_INVALID',
  'NO_DATABASE',
  'DATABASE_EXISTS',
  'ALREADY_UNLOCKED',
  'LOCKED',
  'CANNOT_REMOVE_MASTER',
  'SLOT_NOT_FOUND',
  'INVALID_SLOT_TYPE',
  'UNSUPPORTED_ARCHIVE_FORMAT',
  'ARCHIVE_CORRUPT',
  'ARCHIVE_KEY_MISMATCH',
  'PASSKEY_PRF_UNSUPPORTED',
  'PASSKEY_CANCELLED',
  'CLOUD_SHARE_MISSING',
] as const;

export type EncryptionErrorCode = (typeof ENCRYPTION_ERROR_CODES)[number];

export function isEncryptionErrorCode(value: unknown): value is EncryptionErrorCode {
  return typeof value === 'string' && (ENCRYPTION_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * A failed worker request. `code` is the worker's stable machine-readable id
 * when it sent one (see EncryptionError in public/database-encryption.js);
 * `message` is the English fallback text.
 */
export class DatabaseWorkerError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'DatabaseWorkerError';
    this.code = code;
  }
}

/** The error's `code` when it is a worker error with one, else undefined. */
export function getErrorCode(error: unknown): string | undefined {
  if (error instanceof DatabaseWorkerError) return error.code;
  if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code;
  }
  return undefined;
}
