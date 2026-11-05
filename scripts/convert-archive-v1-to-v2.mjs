#!/usr/bin/env node
/**
 * Re-wraps an archive-format-v1 export (PBKDF2 straight from the password)
 * as a format-v2 envelope (random root key + password key slot + HKDF
 * archive key), keeping the inner ZIP and `lastSaveTimestamp` byte-for-byte.
 *
 * Used for the schema-upgrade e2e fixtures (tests/e2e/fixtures/*.zip), which
 * were captured from old schema builds that only knew archive v1 and cannot
 * be re-exported from a current build. Also a handy check that the worker's
 * key-slot module runs under plain Node.
 *
 *   node scripts/convert-archive-v1-to-v2.mjs <in.zip> <out.zip> --password <pw> [--iterations <n>]
 *
 * The output slot uses the same password; `--iterations` only changes the
 * PBKDF2 cost recorded in the new slot (the default is the production value).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const args = process.argv.slice(2);
const positional = args.filter((arg) => !arg.startsWith('--'));
const flag = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

const [inputPath, outputPath] = positional;
const password = flag('password');
const iterations = flag('iterations') ? Number(flag('iterations')) : undefined;

if (!inputPath || !outputPath || !password) {
  console.error('usage: node scripts/convert-archive-v1-to-v2.mjs <in.zip> <out.zip> --password <pw> [--iterations <n>]');
  process.exit(2);
}

const publicDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'public');
const enc = await import(pathToFileURL(path.join(publicDir, 'database-encryption.js')).href);
const ks = await import(pathToFileURL(path.join(publicDir, 'database-key-slots.js')).href);

const LEGACY_FORMAT = 'budget-tracker-encrypted-v1';

function readLegacyMeta(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(0, true);
  const meta = JSON.parse(new TextDecoder().decode(bytes.slice(4, 4 + headerLength)));
  if (meta.format !== LEGACY_FORMAT) {
    throw new Error(`Expected a ${LEGACY_FORMAT} archive, got "${meta.format}"`);
  }
  return { meta, payload: bytes.slice(4 + headerLength) };
}

async function decryptLegacy(bytes, pw) {
  const { meta, payload } = readLegacyMeta(bytes);
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.hexToBytes(meta.salt), iterations: meta.pbkdf2Iterations ?? 600_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: enc.hexToBytes(meta.iv) }, key, payload);
  return { plain: new Uint8Array(plain), lastSaveTimestamp: meta.lastSaveTimestamp };
}

const input = new Uint8Array(readFileSync(inputPath));
const { plain, lastSaveTimestamp } = await decryptLegacy(input, password);

const rootKey = ks.generateRootKey();
const masterSlot = await ks.createSlot({ type: 'password', secret: password, kdf: iterations ? { iterations } : undefined }, rootKey);
const archiveKey = await ks.deriveArchiveKey(rootKey);
const output = await enc.encryptArchive(plain, { archiveKey, keyId: ks.generateKeyId(), masterSlot }, lastSaveTimestamp);

// Round-trip check before anything is written.
const check = await enc.decryptArchive(output, await ks.deriveArchiveKey(await ks.openSlot(enc.readEncryptedArchiveMeta(output).masterSlot, password)));
if (check.byteLength !== plain.byteLength || !check.every((b, i) => b === plain[i])) {
  throw new Error('Round-trip verification failed');
}

writeFileSync(outputPath, output);
console.log(`Wrote ${outputPath} (${output.byteLength} bytes; inner ZIP ${plain.byteLength} bytes; lastSaveTimestamp ${lastSaveTimestamp})`);
