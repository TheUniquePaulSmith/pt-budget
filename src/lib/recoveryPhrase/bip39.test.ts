import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  RECOVERY_ENTROPY_BYTES,
  RECOVERY_PHRASE_WORD_COUNT,
  RecoveryPhraseError,
  entropyToMnemonic,
  generateRecoveryPhrase,
  isWordInList,
  mnemonicToEntropy,
  normalizeMnemonic,
  suggestWords,
  validateRecoveryPhrase,
} from './bip39';
import { BIP39_ENGLISH_WORDLIST, BIP39_ENGLISH_WORDLIST_SHA256 } from './wordlist';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Official BIP-0039 test vectors (Trezor) for 128-bit entropy.
const VECTORS: Array<[string, string]> = [
  ['00000000000000000000000000000000', 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'],
  ['7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f', 'legal winner thank year wave sausage worth useful legal winner thank yellow'],
  ['80808080808080808080808080808080', 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above'],
  ['ffffffffffffffffffffffffffffffff', 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'],
  ['9e885d952ad362caeb4efe34a8e91bd2', 'ozone drill grab fiber curtain grace pudding thank cruise elder eight picnic'],
];

describe('BIP39 English wordlist', () => {
  it('is the upstream list: 2048 sorted, unique words with the published SHA-256', () => {
    expect(BIP39_ENGLISH_WORDLIST).toHaveLength(2048);
    expect(new Set(BIP39_ENGLISH_WORDLIST).size).toBe(2048);
    expect([...BIP39_ENGLISH_WORDLIST].sort()).toEqual([...BIP39_ENGLISH_WORDLIST]);
    const digest = createHash('sha256').update(BIP39_ENGLISH_WORDLIST.join('\n') + '\n').digest('hex');
    expect(digest).toBe(BIP39_ENGLISH_WORDLIST_SHA256);
    expect(BIP39_ENGLISH_WORDLIST_SHA256).toBe('2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda');
  });
});

describe('entropyToMnemonic / mnemonicToEntropy', () => {
  it.each(VECTORS)('encodes %s to the official phrase and back', async (entropyHex, phrase) => {
    const entropy = Uint8Array.from(Buffer.from(entropyHex, 'hex'));
    expect((await entropyToMnemonic(entropy)).join(' ')).toBe(phrase);
    expect(hex(await mnemonicToEntropy(phrase))).toBe(entropyHex);
  });

  it('round-trips random entropy', async () => {
    for (let i = 0; i < 50; i += 1) {
      const entropy = crypto.getRandomValues(new Uint8Array(RECOVERY_ENTROPY_BYTES));
      const words = await entropyToMnemonic(entropy);
      expect(words).toHaveLength(RECOVERY_PHRASE_WORD_COUNT);
      expect(hex(await mnemonicToEntropy(words))).toBe(hex(entropy));
    }
  });

  it('rejects entropy of the wrong length', async () => {
    await expect(entropyToMnemonic(new Uint8Array(32))).rejects.toBeInstanceOf(RecoveryPhraseError);
  });

  it('detects a checksum mismatch (a typo that is still a real word)', async () => {
    const words = VECTORS[1][1].split(' ');
    words[11] = 'zoo';
    await expect(mnemonicToEntropy(words)).rejects.toMatchObject({ code: 'INVALID_RECOVERY_PHRASE' });
  });

  it('reports unknown words with their positions, and the wrong word count', async () => {
    const words = VECTORS[1][1].split(' ');
    words[2] = 'thanks';
    words[7] = 'useles';
    await expect(mnemonicToEntropy(words)).rejects.toMatchObject({ code: 'INVALID_RECOVERY_PHRASE_WORD', invalidPositions: [2, 7] });
    await expect(mnemonicToEntropy(words.slice(0, 11))).rejects.toMatchObject({ code: 'INVALID_RECOVERY_PHRASE_LENGTH' });
    await expect(mnemonicToEntropy([...words, 'about'])).rejects.toMatchObject({ code: 'INVALID_RECOVERY_PHRASE_LENGTH' });
  });

  it('normalises case, whitespace and Unicode before decoding', async () => {
    const messy = '  LEGAL  winner\tthank\nyear wave SAUSAGE worth useful legal winner thank yellow  ';
    expect(normalizeMnemonic(messy)).toEqual(VECTORS[1][1].split(' '));
    expect(hex(await mnemonicToEntropy(messy))).toBe(VECTORS[1][1 - 1]);
    expect(normalizeMnemonic(['Zoo', ' zoo '])).toEqual(['zoo', 'zoo']);
  });
});

describe('generateRecoveryPhrase / validateRecoveryPhrase', () => {
  it('generates 12 distinct-looking valid phrases', async () => {
    const a = await generateRecoveryPhrase();
    const b = await generateRecoveryPhrase();
    expect(a).toHaveLength(12);
    expect(a.every(isWordInList)).toBe(true);
    expect(a.join(' ')).not.toBe(b.join(' '));
    expect(await validateRecoveryPhrase(a)).toEqual({ ok: true, wordCount: 12, invalidPositions: [] });
  });

  it('validation never throws and names the problem', async () => {
    expect(await validateRecoveryPhrase('')).toMatchObject({ ok: false, code: 'INVALID_RECOVERY_PHRASE_LENGTH', wordCount: 0 });
    expect(await validateRecoveryPhrase('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo')).toMatchObject({ ok: false, code: 'INVALID_RECOVERY_PHRASE' });
    expect(await validateRecoveryPhrase('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo xylophone')).toMatchObject({ ok: false, code: 'INVALID_RECOVERY_PHRASE_WORD', invalidPositions: [11] });
  });

  it('suggests wordlist words by prefix', () => {
    expect(suggestWords('aband')).toEqual(['abandon']);
    expect(suggestWords('ZO', 3)).toEqual(['zone', 'zoo']);
    expect(suggestWords('')).toEqual([]);
    expect(suggestWords('ab', 2)).toHaveLength(2);
  });
});
