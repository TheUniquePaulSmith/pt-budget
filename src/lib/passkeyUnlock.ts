/**
 * Passkeys as a convenience unlock method (docs/Encryption.md §6).
 *
 * A passkey slot's key material is the 32-byte output of the WebAuthn PRF
 * extension (CTAP2 `hmac-secret`) for the slot's random `prfSalt`: the same
 * bytes every time, released by the authenticator only after user
 * verification. The page runs the WebAuthn ceremony (there is no WebAuthn in
 * a SharedWorker), hands the output to the worker — transferred, then zeroed
 * there — and the worker unwraps the root key with it. Nothing here is logged
 * beyond operation names and error codes; the PRF bytes never reach the
 * logger.
 *
 * User verification is always `required`: `hmac-secret` yields different
 * outputs with and without UV, so a mixed policy would make unlock fail
 * silently.
 */

import { logger } from '@/lib/logging';
import { hexToBytes } from './databaseEncryption';

const log = logger.child({ component: 'passkeyUnlock' });

export const PASSKEY_RP_NAME = 'Budget Tracker';
/** Random salt per passkey slot; the PRF input (stored in the slot's public kdf block). */
export const PRF_SALT_BYTES = 32;
/** `hmac-secret` output length; the passkey slot's IKM. */
export const PRF_OUTPUT_BYTES = 32;

export type PasskeyErrorCode = 'PASSKEY_CANCELLED' | 'PASSKEY_PRF_UNSUPPORTED' | 'PASSKEY_FAILED';

/** A failed WebAuthn step, with a stable code the UI maps through `describeEncryptionError`. */
export class PasskeyError extends Error {
  readonly code: PasskeyErrorCode;

  constructor(code: PasskeyErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PasskeyError';
    this.code = code;
  }
}

/** What `registerPasskey` needs: the database's root-key id becomes the credential's user handle. */
export interface RegisterPasskeyOptions {
  /** The header's keyId (hex, 16 bytes); every passkey of one database shares this user handle. */
  keyId: string;
  /** Shown by the OS passkey picker as the account name. */
  userName: string;
  /** base64url credential ids already registered for this database, so the authenticator refuses a duplicate. */
  existingCredentialIds: string[];
  /** Shown by the passkey picker as the display name; defaults to `userName`. */
  label?: string;
}

/** Everything the worker's `add_slot` needs for a passkey slot. */
export interface RegisteredPasskey {
  /** base64url `rawId`; also the key of `prf.evalByCredential` at unlock. */
  credentialId: string;
  /** base64url, PRF_SALT_BYTES long. */
  prfSalt: string;
  /** The 32-byte PRF output for `prfSalt`. The caller owns it (transfer it to the worker, which zeroes it). */
  prfOutput: Uint8Array;
  rpId: string;
  transports: string[];
  /** base64url of the keyId bytes. */
  userHandle: string;
}

/** The public part of a passkey slot, as the lock screen reads it from `SlotSummary.passkey`. */
export interface PasskeySlotRef {
  slotId: string;
  credentialId: string;
  prfSalt: string;
  transports?: string[];
}

export interface PrfOutput {
  /** The slot whose credential the user picked. */
  slotId: string;
  /** The 32-byte PRF output; hand it to the worker's `unlock_database`. */
  secret: Uint8Array;
}

// ---------------------------------------------------------------------------
// base64url
// ---------------------------------------------------------------------------

export function toBase64Url(input: Uint8Array | ArrayBuffer): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

/**
 * Whether this page can register and use passkeys for unlocking: a secure
 * context with WebAuthn, a user-verifying platform authenticator (Windows
 * Hello, Touch ID, Android screen lock…) and no explicit "PRF unsupported"
 * from the browser's client capabilities. A `false` hides every passkey
 * control; PRF support of the authenticator itself is only known at
 * registration.
 */
export async function isPasskeyUnlockAvailable(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.isSecureContext) return false;
  if (typeof PublicKeyCredential === 'undefined' || typeof navigator.credentials?.create !== 'function') return false;

  const capabilities = (PublicKeyCredential as { getClientCapabilities?: () => Promise<Record<string, boolean>> }).getClientCapabilities;
  if (typeof capabilities === 'function') {
    try {
      const caps = await capabilities.call(PublicKeyCredential);
      if (caps['extension:prf'] === false) return false;
    } catch (error) {
      log.debug('getClientCapabilities failed; continuing without it', { operation: 'isPasskeyUnlockAvailable', error });
    }
  }

  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch (error) {
    log.debug('isUserVerifyingPlatformAuthenticatorAvailable failed', { operation: 'isPasskeyUnlockAvailable', error });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

function getRpId(): string {
  return window.location.hostname;
}

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** Maps a DOMException from the WebAuthn API to a `PasskeyError`; passes `PasskeyError`s through. */
export function toPasskeyError(error: unknown, step: 'create' | 'get'): PasskeyError {
  if (error instanceof PasskeyError) return error;
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error && error.message ? error.message : `Passkey ${step} failed`;
  if (name === 'NotAllowedError' || name === 'AbortError') {
    return new PasskeyError('PASSKEY_CANCELLED', 'The passkey request was cancelled or timed out', { cause: error });
  }
  if (name === 'InvalidStateError' && step === 'create') {
    return new PasskeyError('PASSKEY_FAILED', 'This authenticator already holds a passkey for this database', { cause: error });
  }
  if (name === 'NotSupportedError') {
    return new PasskeyError('PASSKEY_PRF_UNSUPPORTED', message, { cause: error });
  }
  return new PasskeyError('PASSKEY_FAILED', message, { cause: error });
}

function readPrfResults(credential: PublicKeyCredential): AuthenticationExtensionsPRFOutputs | undefined {
  const results = credential.getClientExtensionResults();
  return results.prf;
}

function readTransports(credential: PublicKeyCredential): string[] {
  const response = credential.response as AuthenticatorAttestationResponse;
  if (typeof response.getTransports !== 'function') return [];
  try {
    return response.getTransports().filter((transport) => typeof transport === 'string');
  } catch {
    return [];
  }
}

function toOutputBytes(value: BufferSource | undefined): Uint8Array | null {
  if (!value) return null;
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value.slice(0)) : new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  return bytes.length === PRF_OUTPUT_BYTES ? bytes : null;
}

/**
 * Creates a discoverable passkey for this database and evaluates the PRF for
 * a fresh salt. Throws `PASSKEY_PRF_UNSUPPORTED` when the authenticator or
 * browser cannot do PRF (the credential is then useless for unlocking; the
 * caller registers no slot), `PASSKEY_CANCELLED` when the user dismissed the
 * prompt, `PASSKEY_FAILED` otherwise.
 */
export async function registerPasskey({ keyId, userName, existingCredentialIds, label }: RegisterPasskeyOptions): Promise<RegisteredPasskey> {
  const rpId = getRpId();
  const userHandle = hexToBytes(keyId);
  const prfSalt = randomBytes(PRF_SALT_BYTES);

  const publicKey: PublicKeyCredentialCreationOptions = {
    rp: { name: PASSKEY_RP_NAME, id: rpId },
    user: { id: userHandle, name: userName, displayName: label || userName },
    challenge: randomBytes(32),
    pubKeyCredParams: [
      { type: 'public-key', alg: -8 },
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 },
    ],
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    excludeCredentials: existingCredentialIds.map((id) => ({ type: 'public-key' as const, id: fromBase64Url(id) })),
    attestation: 'none',
    extensions: { prf: { eval: { first: prfSalt } } },
  };

  let credential: PublicKeyCredential;
  try {
    const created = await navigator.credentials.create({ publicKey });
    if (!created || !('rawId' in created)) {
      throw new PasskeyError('PASSKEY_FAILED', 'The browser returned no credential');
    }
    credential = created as PublicKeyCredential;
  } catch (error) {
    const mapped = toPasskeyError(error, 'create');
    log.info('Passkey registration did not complete', { operation: 'registerPasskey', code: mapped.code, errorName: error instanceof Error ? error.name : undefined });
    throw mapped;
  }

  const prf = readPrfResults(credential);
  if (prf?.enabled !== true) {
    log.warn('Authenticator registered a passkey without PRF support', { operation: 'registerPasskey' });
    throw new PasskeyError('PASSKEY_PRF_UNSUPPORTED', 'This passkey cannot derive an encryption key (no PRF support)');
  }

  const credentialId = toBase64Url(credential.rawId);
  const transports = readTransports(credential);
  const prfSaltText = toBase64Url(prfSalt);

  let prfOutput = toOutputBytes(prf.results?.first);
  if (!prfOutput) {
    // Some platforms report `enabled` at creation but only evaluate the PRF
    // on an assertion; one immediate get() supplies the output.
    log.debug('No PRF output at registration; running an assertion', { operation: 'registerPasskey' });
    const asserted = await getPrfOutput([{ slotId: credentialId, credentialId, prfSalt: prfSaltText, transports }]);
    prfOutput = asserted.secret;
  }

  log.info('Passkey registered', { operation: 'registerPasskey', rpId, transports });
  return {
    credentialId,
    prfSalt: prfSaltText,
    prfOutput,
    rpId,
    transports,
    userHandle: toBase64Url(userHandle),
  };
}

// ---------------------------------------------------------------------------
// Assertion (unlock)
// ---------------------------------------------------------------------------

/**
 * Runs one assertion over every passkey slot of this database and returns
 * the PRF output of the credential the user picked, together with its slot.
 * The returned bytes are a fresh copy the caller owns.
 */
export async function getPrfOutput(slots: PasskeySlotRef[]): Promise<PrfOutput> {
  if (slots.length === 0) {
    throw new PasskeyError('PASSKEY_FAILED', 'No passkey is registered for this database on this device');
  }

  const evalByCredential: Record<string, AuthenticationExtensionsPRFValues> = {};
  const allowCredentials: PublicKeyCredentialDescriptor[] = slots.map((slot) => {
    evalByCredential[slot.credentialId] = { first: fromBase64Url(slot.prfSalt) };
    return {
      type: 'public-key',
      id: fromBase64Url(slot.credentialId),
      transports: slot.transports as AuthenticatorTransport[] | undefined,
    };
  });

  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: randomBytes(32),
    rpId: getRpId(),
    allowCredentials,
    userVerification: 'required',
    extensions: { prf: { evalByCredential } },
  };

  let assertion: PublicKeyCredential;
  try {
    const got = await navigator.credentials.get({ publicKey });
    if (!got || !('rawId' in got)) {
      throw new PasskeyError('PASSKEY_FAILED', 'The browser returned no assertion');
    }
    assertion = got as PublicKeyCredential;
  } catch (error) {
    const mapped = toPasskeyError(error, 'get');
    log.info('Passkey assertion did not complete', { operation: 'getPrfOutput', code: mapped.code, errorName: error instanceof Error ? error.name : undefined });
    throw mapped;
  }

  const credentialId = toBase64Url(assertion.rawId);
  const slot = slots.find((candidate) => candidate.credentialId === credentialId);
  if (!slot) {
    throw new PasskeyError('PASSKEY_FAILED', 'The passkey used is not registered for this database');
  }

  const secret = toOutputBytes(readPrfResults(assertion)?.results?.first);
  if (!secret) {
    log.warn('Assertion returned no PRF output', { operation: 'getPrfOutput', slotId: slot.slotId });
    throw new PasskeyError('PASSKEY_PRF_UNSUPPORTED', 'This passkey cannot derive an encryption key (no PRF output)');
  }

  log.debug('PRF output obtained', { operation: 'getPrfOutput', slotId: slot.slotId });
  return { slotId: slot.slotId, secret };
}
