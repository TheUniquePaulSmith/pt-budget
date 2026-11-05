/**
 * Tests for the worker-side envelope-encryption module
 * (public/database-key-slots.js): key slots wrapping a random root key,
 * HKDF subkeys, header invariants and the cross-device master adoption rule.
 */

import { describe, expect, it } from 'vitest';

import * as workerEncryption from '../../public/database-encryption.js';
import * as ks from '../../public/database-key-slots.js';

const FAST_PBKDF2 = { iterations: 1000 };

async function passwordHeader(password = 'hunter22!') {
  const rootKey = ks.generateRootKey();
  const masterSlot = await ks.createSlot({ type: 'password', secret: password, kdf: FAST_PBKDF2 }, rootKey);
  const header = ks.createHeader({ keyId: ks.generateKeyId(), blockSize: 8192, masterSlot });
  return { rootKey, masterSlot, header };
}

async function encryptProbe(key: CryptoKey): Promise<string> {
  // Fixed IV so two keys can be compared by their ciphertext (test only).
  const iv = new Uint8Array(12);
  const out = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new Uint8Array([1, 2, 3]));
  return ks.bytesToHex(new Uint8Array(out));
}

describe('key slots: wrap / unwrap per type', () => {
  it('password slot: the password recovers the exact root key; a wrong one is INVALID_SECRET', async () => {
    const { rootKey, masterSlot } = await passwordHeader();
    expect(masterSlot.type).toBe('password');
    expect(masterSlot.kdf).toMatchObject({ name: 'PBKDF2-HMAC-SHA256', iterations: 1000, normalization: 'NFKC' });
    expect(masterSlot.wrap.ciphertext).toHaveLength(ks.WRAPPED_ROOT_KEY_BYTES * 2);

    const opened = await ks.openSlot(masterSlot, 'hunter22!');
    expect(ks.constantTimeEqual(opened, rootKey)).toBe(true);

    await expect(ks.openSlot(masterSlot, 'hunter23!')).rejects.toMatchObject({ code: 'INVALID_SECRET' });
    expect(await ks.verifySlotSecret(masterSlot, 'hunter22!')).toBe(true);
    expect(await ks.verifySlotSecret(masterSlot, 'nope')).toBe(false);
  });

  it('password slot honours the per-slot PBKDF2 iteration count', async () => {
    const rootKey = ks.generateRootKey();
    const slot = await ks.createSlot({ type: 'password', secret: 'pw', kdf: { iterations: 2000 } }, rootKey);
    expect(slot.kdf.iterations).toBe(2000);
    await expect(ks.openSlot(slot, 'pw')).resolves.toBeInstanceOf(Uint8Array);
    // Same password through a different iteration count is a different KEK.
    await expect(ks.openSlot({ ...slot, kdf: { ...slot.kdf, iterations: 1000 } }, 'pw')).rejects.toMatchObject({ code: 'INVALID_SECRET' });
  });

  it('password slot: NFKC normalisation makes composed and decomposed input equivalent', async () => {
    const rootKey = ks.generateRootKey();
    const composed = 'café-secret'; // é precomposed
    const decomposed = 'café-secret'; // e + combining acute
    const slot = await ks.createSlot({ type: 'password', secret: composed, kdf: FAST_PBKDF2 }, rootKey);
    await expect(ks.openSlot(slot, decomposed)).resolves.toBeInstanceOf(Uint8Array);
    expect(() => ks.normalizePassword('')).toThrow();
  });

  it('recovery slot takes the 16 entropy bytes and rejects other lengths', async () => {
    const rootKey = ks.generateRootKey();
    const entropy = crypto.getRandomValues(new Uint8Array(16));
    const slot = await ks.createSlot({ type: 'recovery', secret: entropy }, rootKey);
    expect(slot.kdf).toEqual({ name: 'bip39-entropy', wordlist: 'english', wordCount: 12 });
    expect(slot.label).toBe('Recovery phrase');

    expect(ks.constantTimeEqual(await ks.openSlot(slot, entropy), rootKey)).toBe(true);
    const other = crypto.getRandomValues(new Uint8Array(16));
    await expect(ks.openSlot(slot, other)).rejects.toMatchObject({ code: 'INVALID_SECRET' });
    await expect(ks.openSlot(slot, new Uint8Array(32))).rejects.toMatchObject({ code: 'INVALID_SECRET' });
  });

  it('passkey slot wraps under a 32-byte PRF output and keeps the public credential data', async () => {
    const rootKey = ks.generateRootKey();
    const prf = crypto.getRandomValues(new Uint8Array(32));
    const slot = await ks.createSlot(
      { type: 'passkey', secret: prf, label: 'Laptop', kdf: { credentialId: 'Y3JlZA', prfSalt: 'ab'.repeat(32), rpId: 'localhost', transports: ['internal', 7 as never], userHandle: 'dXNlcg' } },
      rootKey
    );
    expect(slot.kdf).toEqual({ name: 'webauthn-prf', credentialId: 'Y3JlZA', prfSalt: 'ab'.repeat(32), rpId: 'localhost', transports: ['internal'], userHandle: 'dXNlcg' });
    expect(ks.constantTimeEqual(await ks.openSlot(slot, prf), rootKey)).toBe(true);
    await expect(ks.openSlot(slot, crypto.getRandomValues(new Uint8Array(32)))).rejects.toMatchObject({ code: 'INVALID_SECRET' });
    await expect(ks.createSlot({ type: 'passkey', secret: prf, kdf: {} }, rootKey)).rejects.toMatchObject({ code: 'INVALID_SLOT_TYPE' });
  });

  it('cloud slot needs both the cloud share and the device share', async () => {
    const rootKey = ks.generateRootKey();
    const cloudShare = crypto.getRandomValues(new Uint8Array(32));
    const slot = await ks.createSlot({ type: 'cloud', secret: cloudShare, kdf: { provider: 'gdrive', shareFileName: 'key-share.json' } }, rootKey);
    expect(slot.kdf.name).toBe('cloud-split');
    expect(slot.kdf.deviceSecret).toHaveLength(64);

    expect(ks.constantTimeEqual(await ks.openSlot(slot, cloudShare), rootKey)).toBe(true);
    // Same cloud share, different device share → different KEK.
    const otherDevice = { ...slot, kdf: { ...slot.kdf, deviceSecret: 'ff'.repeat(32) } };
    await expect(ks.openSlot(otherDevice, cloudShare)).rejects.toMatchObject({ code: 'INVALID_SECRET' });
  });

  it('rejects unknown slot types', async () => {
    await expect(ks.createSlot({ type: 'magic', secret: 'x' } as never, ks.generateRootKey())).rejects.toMatchObject({ code: 'INVALID_SLOT_TYPE' });
  });
});

describe('key slots: AAD binding and KEK separation', () => {
  it('a wrapped key moved to another slot id or type fails to unwrap', async () => {
    const { masterSlot } = await passwordHeader();
    await expect(ks.openSlot({ ...masterSlot, slotId: 'ff'.repeat(8) }, 'hunter22!')).rejects.toMatchObject({ code: 'INVALID_SECRET' });
    // Different type string in the AAD (and info) even with the same secret bytes.
    const rootKey = ks.generateRootKey();
    const entropy = crypto.getRandomValues(new Uint8Array(16));
    const recovery = await ks.createSlot({ type: 'recovery', secret: entropy }, rootKey);
    await expect(ks.openSlot({ ...recovery, type: 'passkey', kdf: { name: 'webauthn-prf' } }, new Uint8Array(32))).rejects.toMatchObject({ code: 'INVALID_SECRET' });
  });

  it('the same IKM yields different KEKs for different slot types and salts', async () => {
    const ikm = () => new Uint8Array(32).fill(7);
    const salt = new Uint8Array(32).fill(1);
    const a = await encryptProbe(await ks.deriveKek(ikm(), salt, 'passkey'));
    const b = await encryptProbe(await ks.deriveKek(ikm(), salt, 'cloud'));
    const c = await encryptProbe(await ks.deriveKek(ikm(), new Uint8Array(32).fill(2), 'passkey'));
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it('deriveKek zeroes the input keying material', async () => {
    const ikm = new Uint8Array(32).fill(9);
    await ks.deriveKek(ikm, new Uint8Array(32), 'passkey');
    expect(ikm.every((b) => b === 0)).toBe(true);
  });
});

describe('root key subkeys', () => {
  it('page and archive keys are deterministic per root key and distinct from each other', async () => {
    const rootKey = ks.generateRootKey();
    const page1 = await encryptProbe(await ks.derivePageKey(rootKey));
    const page2 = await encryptProbe(await ks.derivePageKey(rootKey.slice()));
    const archive = await encryptProbe(await ks.deriveArchiveKey(rootKey));
    expect(page1).toBe(page2);
    expect(page1).not.toBe(archive);
    expect(await encryptProbe(await ks.derivePageKey(ks.generateRootKey()))).not.toBe(page1);
  });

  it('a fixed root key derives the documented test vector', async () => {
    // Vector recorded in docs/Encryption.md; any change here is a format change.
    const rootKey = ks.hexToBytes('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
    const pageProbe = await encryptProbe(await ks.derivePageKey(rootKey));
    const archiveProbe = await encryptProbe(await ks.deriveArchiveKey(rootKey));
    expect(pageProbe).toMatchInlineSnapshot(`"0437465a125a42a93b960a79763e376fa80de1"`);
    expect(archiveProbe).toMatchInlineSnapshot(`"ff0dd1f7f70a73653e727df34453c60bfedbc5"`);
  });
});

describe('header records', () => {
  it('createHeader produces a valid v2 header around the master slot', async () => {
    const { header, masterSlot } = await passwordHeader();
    expect(header.format).toBe(ks.HEADER_FORMAT_V2);
    expect(header.slots).toEqual([masterSlot]);
    expect(ks.findMasterSlot(header)).toBe(masterSlot);
    expect(ks.isLegacyHeader(header)).toBe(false);
    expect(ks.isLegacyHeader({ format: ks.LEGACY_HEADER_FORMAT_V1 })).toBe(true);
  });

  it('assertHeaderInvariants rejects zero or two master slots, duplicate ids and bad shapes', async () => {
    const { header, masterSlot, rootKey } = await passwordHeader();
    const second = await ks.createSlot({ type: 'recovery', secret: new Uint8Array(16) }, rootKey);
    expect(() => ks.withSlots(header, [])).toThrow(/no key slots/);
    expect(() => ks.withSlots(header, [masterSlot, second])).toThrow(/exactly one master/);
    expect(() => ks.withSlots(header, [masterSlot, masterSlot])).toThrow(/duplicate/);
    expect(() => ks.assertHeaderInvariants({ ...header, format: 'nope' })).toThrow(/unsupported format/);
    expect(() => ks.assertHeaderInvariants({ ...header, keyId: 'short' })).toThrow(/key id/);
    expect(() => ks.withSlots(header, [{ ...masterSlot, wrap: { ...masterSlot.wrap, ciphertext: 'ab' } }])).toThrow(/wrapped key/);
    expect(() => ks.withSlots(header, [{ ...masterSlot, kdf: { name: 'bip39-entropy' } }])).toThrow(/KDF/);
    const passkey = await ks.createSlot({ type: 'passkey', secret: new Uint8Array(32), kdf: { credentialId: 'a', prfSalt: 'b', rpId: 'localhost' } }, rootKey);
    expect(ks.withSlots(header, [masterSlot, passkey]).slots).toHaveLength(2);
  });

  it('summarizeSlot strips every secret-bearing field and keeps the public passkey / cloud data', async () => {
    const rootKey = ks.generateRootKey();
    const password = await ks.createSlot({ type: 'password', secret: 'pw', kdf: FAST_PBKDF2 }, rootKey);
    const passkey = await ks.createSlot({ type: 'passkey', secret: new Uint8Array(32), kdf: { credentialId: 'cred', prfSalt: 'salt', rpId: 'localhost', transports: ['usb'] } }, rootKey);
    const cloud = await ks.createSlot({ type: 'cloud', secret: new Uint8Array(32), kdf: { provider: 'onedrive', shareFileName: 'k.json' } }, rootKey);

    const summaries = [password, passkey, cloud].map(ks.summarizeSlot);
    for (const summary of summaries) {
      expect(summary).not.toHaveProperty('wrap');
      expect(summary).not.toHaveProperty('hkdfSalt');
      expect(JSON.stringify(summary)).not.toMatch(/deviceSecret|"salt":"/);
    }
    expect(summaries[0]).toMatchObject({ type: 'password', isMaster: true });
    expect(summaries[1]).toMatchObject({ type: 'passkey', isMaster: false, passkey: { credentialId: 'cred', prfSalt: 'salt', rpId: 'localhost', transports: ['usb'] } });
    expect(summaries[2]).toMatchObject({ type: 'cloud', cloud: { provider: 'onedrive', shareFileName: 'k.json' } });
    expect(ks.summarizeHeader(null)).toEqual({ exists: false, legacyHeader: false, keyId: null, blockSize: null, methods: [] });
    expect(ks.summarizeHeader({ format: ks.LEGACY_HEADER_FORMAT_V1, blockSize: 8192 })).toMatchObject({ exists: true, legacyHeader: true });
  });
});

describe('master replacement and cross-device adoption', () => {
  it('replacing the master re-wraps the same root key: old secret fails, new one works', async () => {
    const { header, rootKey } = await passwordHeader('old-pw');
    const newMaster = await ks.createSlot({ type: 'recovery', secret: new Uint8Array(16).fill(3) }, rootKey);
    const replaced = ks.withSlots(header, [newMaster, ...header.slots.filter((slot) => !ks.isMasterSlot(slot))]);

    expect(replaced.keyId).toBe(header.keyId);
    expect(ks.findMasterSlot(replaced)!.type).toBe('recovery');
    expect(ks.constantTimeEqual(await ks.openSlot(ks.findMasterSlot(replaced)!, new Uint8Array(16).fill(3)), rootKey)).toBe(true);
    await expect(ks.openSlot(ks.findMasterSlot(header)!, 'old-pw')).resolves.toBeInstanceOf(Uint8Array);
    expect(replaced.slots.find((slot) => slot.type === 'password')).toBeUndefined();
  });

  it('adoptArchiveMasterSlot swaps in the archive master only for the same key id', async () => {
    const { header, rootKey, masterSlot } = await passwordHeader();
    const passkey = await ks.createSlot({ type: 'passkey', secret: new Uint8Array(32), kdf: { credentialId: 'a', prfSalt: 'b', rpId: 'localhost' } }, rootKey);
    const withPasskey = ks.withSlots(header, [masterSlot, passkey]);
    const newMaster = await ks.createSlot({ type: 'password', secret: 'changed-elsewhere', kdf: FAST_PBKDF2 }, rootKey);

    // Same archive master as local → nothing to do.
    expect(ks.adoptArchiveMasterSlot(withPasskey, { keyId: header.keyId, masterSlot })).toBeNull();
    // Different database → never adopt.
    expect(ks.adoptArchiveMasterSlot(withPasskey, { keyId: ks.generateKeyId(), masterSlot: newMaster })).toBeNull();
    // A convenience slot can never become the master.
    expect(ks.adoptArchiveMasterSlot(withPasskey, { keyId: header.keyId, masterSlot: passkey })).toBeNull();

    const adopted = ks.adoptArchiveMasterSlot(withPasskey, { keyId: header.keyId, masterSlot: newMaster });
    expect(adopted?.slots.map((slot) => slot.slotId)).toEqual([newMaster.slotId, passkey.slotId]);
    expect(ks.constantTimeEqual(await ks.openSlot(ks.findMasterSlot(adopted)!, 'changed-elsewhere'), rootKey)).toBe(true);
  });

  it('round-trips an export: the archive opens from its embedded master slot on another device', async () => {
    const { header, rootKey, masterSlot } = await passwordHeader('backup-pw');
    const archiveKey = await ks.deriveArchiveKey(rootKey);
    const bytes = await workerEncryption.encryptArchive(new TextEncoder().encode('inner zip'), { archiveKey, keyId: header.keyId, masterSlot }, '2026-01-01T00:00:00.000Z');

    const meta = workerEncryption.readEncryptedArchiveMeta(bytes);
    const otherDeviceRoot = await ks.openSlot(meta.masterSlot, 'backup-pw');
    const plain = await workerEncryption.decryptArchive(bytes, await ks.deriveArchiveKey(otherDeviceRoot));
    expect(new TextDecoder().decode(plain)).toBe('inner zip');

    await expect(workerEncryption.decryptArchive(bytes, await ks.deriveArchiveKey(ks.generateRootKey()))).rejects.toMatchObject({ code: 'INVALID_SECRET' });
    await expect(workerEncryption.encryptArchive(new Uint8Array(1), { archiveKey: null, keyId: 'x', masterSlot } as never, 'ts')).rejects.toMatchObject({ code: 'LOCKED' });
  });
});
