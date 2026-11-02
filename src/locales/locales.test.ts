/**
 * Guards the translation bundles: every language has every namespace file,
 * with exactly the English key set, the same {{placeholders}} per key, no
 * empty strings, and the same plural forms (CJK languages may collapse to
 * `_other` only).
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_LANGUAGE, NAMESPACES, SUPPORTED_LANGUAGES } from '@/lib/i18n';

const LOCALES_DIR = path.resolve(__dirname);
const PLACEHOLDER_RE = /\{\{\s*([\w.]+)\s*\}\}/g;
const PLURAL_SUFFIX_RE = /_(zero|one|two|few|many|other)$/;
/** Languages whose plural rules only have the `other` category. */
const SINGLE_PLURAL_LANGUAGES = new Set(['zh', 'ja', 'ko']);
/** Values that are legitimately identical to English (codes, symbols, brand names). */
const IDENTICAL_ALLOWED_RE = /^[\p{P}\p{S}\d\s]*$|^(OK|SQL|CSV|GGUF|JSON|OPFS|Google Drive|OneDrive|SQLite|API|URL|ID|PDF|\{\{[\w.]+\}\})$/u;

type Bundle = Record<string, unknown>;

function flatten(value: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Bundle)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out[prefix] = String(value);
  }
  return out;
}

function readBundle(language: string, namespace: string): Bundle | null {
  const file = path.join(LOCALES_DIR, language, `${namespace}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Bundle;
}

function placeholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_RE)].map((match) => match[1]).sort();
}

/** Strips a plural suffix so `days_one` / `days_other` compare as `days`. */
function pluralBase(key: string): string {
  return key.replace(PLURAL_SUFFIX_RE, '');
}

const english = Object.fromEntries(
  NAMESPACES.map((namespace) => [namespace, flatten(readBundle(DEFAULT_LANGUAGE, namespace) ?? {})])
) as Record<string, Record<string, string>>;

describe('translation bundles', () => {
  it('has an English file for every namespace with no empty values', () => {
    for (const namespace of NAMESPACES) {
      expect(readBundle(DEFAULT_LANGUAGE, namespace), `${namespace}.json`).not.toBeNull();
      for (const [key, value] of Object.entries(english[namespace])) {
        expect(value.trim(), `en-US ${namespace}:${key}`).not.toBe('');
      }
    }
  });

  const otherLanguages = SUPPORTED_LANGUAGES.map((language) => language.code).filter((code) => code !== DEFAULT_LANGUAGE);

  describe.each(otherLanguages)('%s', (language) => {
    it.each([...NAMESPACES])('%s.json mirrors the English keys, placeholders and plural forms', (namespace) => {
      const bundle = readBundle(language, namespace);
      expect(bundle, `${language}/${namespace}.json is missing`).not.toBeNull();
      const translated = flatten(bundle ?? {});
      const source = english[namespace];

      const sourceKeys = new Set(Object.keys(source));
      const translatedKeys = new Set(Object.keys(translated));
      const singlePlural = SINGLE_PLURAL_LANGUAGES.has(language);

      // Every English key must exist (CJK may collapse plural variants onto `_other`).
      for (const key of sourceKeys) {
        if (translatedKeys.has(key)) continue;
        if (singlePlural && PLURAL_SUFFIX_RE.test(key) && translatedKeys.has(`${pluralBase(key)}_other`)) continue;
        expect.fail(`${language}/${namespace}.json is missing key "${key}"`);
      }
      // No keys that English does not have.
      for (const key of translatedKeys) {
        if (sourceKeys.has(key)) continue;
        expect.fail(`${language}/${namespace}.json has an extra key "${key}"`);
      }

      for (const [key, value] of Object.entries(translated)) {
        expect(value.trim(), `${language} ${namespace}:${key} is empty`).not.toBe('');
        const sourceValue = source[key] ?? source[`${pluralBase(key)}_other`] ?? source[`${pluralBase(key)}_one`];
        if (sourceValue === undefined) continue;
        expect(placeholders(value), `${language} ${namespace}:${key} placeholders`).toEqual(placeholders(sourceValue));
      }
    });

    it('is actually translated (most values differ from English)', () => {
      let total = 0;
      let identical = 0;
      for (const namespace of NAMESPACES) {
        const translated = flatten(readBundle(language, namespace) ?? {});
        for (const [key, value] of Object.entries(translated)) {
          const sourceValue = english[namespace][key];
          if (sourceValue === undefined || IDENTICAL_ALLOWED_RE.test(sourceValue)) continue;
          total += 1;
          if (value === sourceValue) identical += 1;
        }
      }
      expect(total).toBeGreaterThan(50);
      // Proper nouns, abbreviations and short labels can coincide; a bundle that is mostly English has not been translated.
      expect(identical / total, `${language}: ${identical}/${total} values identical to English`).toBeLessThan(0.15);
    });
  });
});
