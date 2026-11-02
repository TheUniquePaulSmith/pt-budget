// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  NAMESPACES,
  SUPPORTED_LANGUAGES,
  csvDateOrderFor,
  decimalSeparatorFor,
  getLanguageDefinition,
  i18n,
  initI18n,
  intlLocaleFor,
  isLanguageCode,
  readStoredLanguage,
  storeLanguage,
} from './i18n';

describe('i18n core', () => {
  afterEach(() => {
    window.localStorage.clear();
    void i18n.changeLanguage(DEFAULT_LANGUAGE);
  });

  it('is initialised synchronously with the English bundles', () => {
    expect(initI18n()).toBe(i18n);
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.language).toBe('en-US');
    expect(i18n.t('common:actions.save')).toBe('Save');
    expect(i18n.t('shell:nav.sql-query')).toBe('SQL Query');
    for (const namespace of NAMESPACES) {
      expect(i18n.hasResourceBundle('en-US', namespace)).toBe(true);
    }
  });

  it('lists nine languages with Intl locales, pt → pt-BR and zh → zh-CN', () => {
    expect(SUPPORTED_LANGUAGES.map((language) => language.code)).toEqual([
      'en-US', 'es', 'fr', 'de', 'zh', 'ja', 'ko', 'pt', 'it',
    ]);
    expect(intlLocaleFor('pt')).toBe('pt-BR');
    expect(intlLocaleFor('zh')).toBe('zh-CN');
    expect(getLanguageDefinition('fr').nativeLabel).toBe('Français');
    expect(csvDateOrderFor('en-US')).toBe('MDY');
    expect(csvDateOrderFor('de')).toBe('DMY');
    expect(csvDateOrderFor('ja')).toBe('YMD');
    expect(decimalSeparatorFor('en-US')).toBe('.');
    expect(decimalSeparatorFor('es')).toBe(',');
  });

  it('reads the stored device preference and never the browser language', () => {
    expect(readStoredLanguage()).toBe('en-US');
    Object.defineProperty(window.navigator, 'language', { value: 'de-DE', configurable: true });
    expect(readStoredLanguage()).toBe('en-US');
    storeLanguage('es');
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('es');
    expect(readStoredLanguage()).toBe('es');
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'tlh');
    expect(readStoredLanguage()).toBe('en-US');
    expect(isLanguageCode('ko')).toBe(true);
    expect(isLanguageCode('en')).toBe(false);
  });

  it('pluralises with count and interpolates', () => {
    expect(i18n.t('common:plurals.days', { count: 1 })).toBe('1 day');
    expect(i18n.t('common:plurals.days', { count: 3 })).toBe('3 days');
    expect(i18n.t('common:errors.required', { field: 'Amount' })).toBe('Amount is required');
  });
});
