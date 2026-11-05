// @vitest-environment jsdom

/**
 * Page-side WebAuthn PRF plumbing (src/lib/passkeyUnlock.ts) against a mocked
 * `navigator.credentials`: option shapes, PRF-at-create vs. get() fallback,
 * error-code mapping, rawId → slot mapping, and the base64url helpers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PasskeyError,
  PRF_OUTPUT_BYTES,
  fromBase64Url,
  getPrfOutput,
  isPasskeyUnlockAvailable,
  registerPasskey,
  toBase64Url,
  toPasskeyError,
} from './passkeyUnlock';

vi.mock('@/lib/logging', () => ({
  logger: { child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

const KEY_ID = '0123456789abcdef0123456789abcdef';
const RAW_ID = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 250, 251, 252, 253, 254, 255]);
const RAW_ID_B64 = toBase64Url(RAW_ID);
const PRF_OUT = new Uint8Array(PRF_OUTPUT_BYTES).map((_, i) => (i * 7) % 256);

interface FakeCredentialOptions {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
  rawId?: Uint8Array;
  transports?: string[];
}

function fakeCredential({ prf, rawId = RAW_ID, transports = ['internal'] }: FakeCredentialOptions = {}) {
  return {
    rawId: rawId.buffer.slice(rawId.byteOffset, rawId.byteOffset + rawId.byteLength),
    response: { getTransports: () => transports },
    getClientExtensionResults: () => (prf ? { prf } : {}),
  };
}

function domException(name: string, message = name) {
  const error = new Error(message);
  error.name = name;
  return error;
}

let create: ReturnType<typeof vi.fn>;
let get: ReturnType<typeof vi.fn>;

beforeEach(() => {
  create = vi.fn();
  get = vi.fn();
  Object.defineProperty(window.navigator, 'credentials', { value: { create, get }, configurable: true });
  class FakePublicKeyCredential {
    static isUserVerifyingPlatformAuthenticatorAvailable = vi.fn().mockResolvedValue(true);
    static getClientCapabilities = vi.fn().mockResolvedValue({ 'extension:prf': true });
  }
  vi.stubGlobal('PublicKeyCredential', FakePublicKeyCredential);
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('base64url helpers', () => {
  it('round-trips bytes without padding and with URL-safe characters', () => {
    const encoded = toBase64Url(RAW_ID);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(fromBase64Url(encoded)).toEqual(RAW_ID);
    expect(toBase64Url(RAW_ID.buffer.slice(0))).toBe(encoded);
  });

  it('decodes every padding length', () => {
    for (let length = 0; length < 6; length += 1) {
      const bytes = new Uint8Array(length).map((_, i) => i + 100);
      expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    }
  });
});

describe('isPasskeyUnlockAvailable', () => {
  it('is true with WebAuthn, a platform authenticator and PRF capability', async () => {
    await expect(isPasskeyUnlockAvailable()).resolves.toBe(true);
  });

  it('is false outside a secure context', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    await expect(isPasskeyUnlockAvailable()).resolves.toBe(false);
  });

  it('is false without PublicKeyCredential', async () => {
    vi.stubGlobal('PublicKeyCredential', undefined);
    await expect(isPasskeyUnlockAvailable()).resolves.toBe(false);
  });

  it('is false when the browser reports no PRF support', async () => {
    (PublicKeyCredential as unknown as { getClientCapabilities: ReturnType<typeof vi.fn> }).getClientCapabilities.mockResolvedValue({
      'extension:prf': false,
    });
    await expect(isPasskeyUnlockAvailable()).resolves.toBe(false);
  });

  it('is false without a user-verifying platform authenticator', async () => {
    (PublicKeyCredential as unknown as { isUserVerifyingPlatformAuthenticatorAvailable: ReturnType<typeof vi.fn> })
      .isUserVerifyingPlatformAuthenticatorAvailable.mockResolvedValue(false);
    await expect(isPasskeyUnlockAvailable()).resolves.toBe(false);
  });
});

describe('registerPasskey', () => {
  it('creates a discoverable, user-verified credential bound to the keyId and returns the PRF output', async () => {
    create.mockResolvedValue(fakeCredential({ prf: { enabled: true, results: { first: PRF_OUT.buffer.slice(0) } } }));

    const existing = toBase64Url(new Uint8Array([9, 9, 9]));
    const result = await registerPasskey({ keyId: KEY_ID, userName: 'Pat', existingCredentialIds: [existing], label: 'Laptop' });

    expect(create).toHaveBeenCalledTimes(1);
    const { publicKey } = create.mock.calls[0][0] as { publicKey: PublicKeyCredentialCreationOptions };
    expect(publicKey.rp).toEqual({ name: 'Budget Tracker', id: 'localhost' });
    expect(new Uint8Array(publicKey.user.id as ArrayBuffer)).toEqual(
      new Uint8Array([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef])
    );
    expect(publicKey.user.name).toBe('Pat');
    expect(publicKey.user.displayName).toBe('Laptop');
    expect(publicKey.authenticatorSelection).toEqual({ residentKey: 'required', requireResidentKey: true, userVerification: 'required' });
    expect(publicKey.attestation).toBe('none');
    expect(publicKey.excludeCredentials).toHaveLength(1);
    expect(new Uint8Array(publicKey.excludeCredentials![0].id as ArrayBuffer)).toEqual(new Uint8Array([9, 9, 9]));
    const salt = publicKey.extensions!.prf!.eval!.first as Uint8Array;
    expect(salt).toHaveLength(32);

    expect(result.credentialId).toBe(RAW_ID_B64);
    expect(fromBase64Url(result.prfSalt)).toEqual(salt);
    expect(result.prfOutput).toEqual(PRF_OUT);
    expect(result.rpId).toBe('localhost');
    expect(result.transports).toEqual(['internal']);
    expect(fromBase64Url(result.userHandle)).toEqual(new Uint8Array(publicKey.user.id as ArrayBuffer));
    expect(get).not.toHaveBeenCalled();
  });

  it('falls back to an immediate assertion when PRF is enabled but no output was returned at creation', async () => {
    create.mockResolvedValue(fakeCredential({ prf: { enabled: true } }));
    get.mockResolvedValue(fakeCredential({ prf: { results: { first: PRF_OUT.buffer.slice(0) } } }));

    const result = await registerPasskey({ keyId: KEY_ID, userName: 'Pat', existingCredentialIds: [] });

    expect(get).toHaveBeenCalledTimes(1);
    const { publicKey } = get.mock.calls[0][0] as { publicKey: PublicKeyCredentialRequestOptions };
    expect(publicKey.allowCredentials).toHaveLength(1);
    expect(new Uint8Array(publicKey.allowCredentials![0].id as ArrayBuffer)).toEqual(RAW_ID);
    expect(publicKey.userVerification).toBe('required');
    const evalByCredential = publicKey.extensions!.prf!.evalByCredential!;
    expect(Object.keys(evalByCredential)).toEqual([RAW_ID_B64]);
    expect(evalByCredential[RAW_ID_B64].first).toEqual(fromBase64Url(result.prfSalt));
    expect(result.prfOutput).toEqual(PRF_OUT);
  });

  it('rejects with PASSKEY_PRF_UNSUPPORTED when the authenticator did not enable PRF', async () => {
    create.mockResolvedValue(fakeCredential({ prf: { enabled: false } }));
    await expect(registerPasskey({ keyId: KEY_ID, userName: 'Pat', existingCredentialIds: [] })).rejects.toMatchObject({
      code: 'PASSKEY_PRF_UNSUPPORTED',
    });

    create.mockResolvedValue(fakeCredential());
    await expect(registerPasskey({ keyId: KEY_ID, userName: 'Pat', existingCredentialIds: [] })).rejects.toMatchObject({
      code: 'PASSKEY_PRF_UNSUPPORTED',
    });
  });

  it('maps a dismissed prompt to PASSKEY_CANCELLED and other failures to PASSKEY_FAILED', async () => {
    create.mockRejectedValue(domException('NotAllowedError', 'The operation either timed out or was not allowed'));
    await expect(registerPasskey({ keyId: KEY_ID, userName: 'Pat', existingCredentialIds: [] })).rejects.toMatchObject({
      code: 'PASSKEY_CANCELLED',
    });

    create.mockRejectedValue(domException('InvalidStateError'));
    await expect(registerPasskey({ keyId: KEY_ID, userName: 'Pat', existingCredentialIds: [] })).rejects.toMatchObject({
      code: 'PASSKEY_FAILED',
    });

    create.mockResolvedValue(null);
    await expect(registerPasskey({ keyId: KEY_ID, userName: 'Pat', existingCredentialIds: [] })).rejects.toMatchObject({
      code: 'PASSKEY_FAILED',
    });
  });
});

describe('getPrfOutput', () => {
  const slots = [
    { slotId: 'slot-a', credentialId: toBase64Url(new Uint8Array([7, 7, 7])), prfSalt: toBase64Url(new Uint8Array(32).fill(1)), transports: ['usb'] },
    { slotId: 'slot-b', credentialId: RAW_ID_B64, prfSalt: toBase64Url(new Uint8Array(32).fill(2)), transports: ['internal'] },
  ];

  it('offers every slot, evaluates each salt by credential and maps the picked rawId to its slot', async () => {
    get.mockResolvedValue(fakeCredential({ prf: { results: { first: PRF_OUT.buffer.slice(0) } } }));

    const result = await getPrfOutput(slots);

    const { publicKey } = get.mock.calls[0][0] as { publicKey: PublicKeyCredentialRequestOptions };
    expect(publicKey.rpId).toBe('localhost');
    expect(publicKey.userVerification).toBe('required');
    expect(publicKey.allowCredentials!.map((c) => c.transports)).toEqual([['usb'], ['internal']]);
    const evalByCredential = publicKey.extensions!.prf!.evalByCredential!;
    expect(evalByCredential[slots[0].credentialId].first).toEqual(new Uint8Array(32).fill(1));
    expect(evalByCredential[slots[1].credentialId].first).toEqual(new Uint8Array(32).fill(2));

    expect(result.slotId).toBe('slot-b');
    expect(result.secret).toEqual(PRF_OUT);
    expect(result.secret).toHaveLength(PRF_OUTPUT_BYTES);
  });

  it('returns a copy, so transferring the secret cannot detach the extension result', async () => {
    const first = PRF_OUT.buffer.slice(0);
    get.mockResolvedValue(fakeCredential({ prf: { results: { first } } }));
    const result = await getPrfOutput(slots);
    expect(result.secret.buffer).not.toBe(first);
  });

  it('rejects an assertion from an unknown credential, a missing PRF output, an empty slot list and a cancelled prompt', async () => {
    get.mockResolvedValue(fakeCredential({ rawId: new Uint8Array([42]), prf: { results: { first: PRF_OUT.buffer.slice(0) } } }));
    await expect(getPrfOutput(slots)).rejects.toMatchObject({ code: 'PASSKEY_FAILED' });

    get.mockResolvedValue(fakeCredential({ prf: { enabled: true } }));
    await expect(getPrfOutput(slots)).rejects.toMatchObject({ code: 'PASSKEY_PRF_UNSUPPORTED' });

    get.mockResolvedValue(fakeCredential({ prf: { results: { first: new Uint8Array(16).buffer } } }));
    await expect(getPrfOutput(slots)).rejects.toMatchObject({ code: 'PASSKEY_PRF_UNSUPPORTED' });

    await expect(getPrfOutput([])).rejects.toMatchObject({ code: 'PASSKEY_FAILED' });
    expect(get).toHaveBeenCalledTimes(3);

    get.mockRejectedValue(domException('NotAllowedError'));
    await expect(getPrfOutput(slots)).rejects.toMatchObject({ code: 'PASSKEY_CANCELLED' });
  });
});

describe('toPasskeyError', () => {
  it('keeps PasskeyErrors and classifies DOMExceptions by name', () => {
    const own = new PasskeyError('PASSKEY_FAILED', 'x');
    expect(toPasskeyError(own, 'get')).toBe(own);
    expect(toPasskeyError(domException('AbortError'), 'get').code).toBe('PASSKEY_CANCELLED');
    expect(toPasskeyError(domException('NotSupportedError'), 'create').code).toBe('PASSKEY_PRF_UNSUPPORTED');
    expect(toPasskeyError(domException('SecurityError', 'bad origin'), 'create')).toMatchObject({ code: 'PASSKEY_FAILED', message: 'bad origin' });
    expect(toPasskeyError('weird', 'get').code).toBe('PASSKEY_FAILED');
  });
});
