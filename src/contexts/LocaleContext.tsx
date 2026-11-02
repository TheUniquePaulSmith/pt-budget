'use client';

/**
 * LocaleProvider: the device language preference and everything derived from
 * it (Intl locale tag, date-fns locale, MUI locale packs). Sits above
 * CustomThemeProvider in src/app/layout.tsx so the theme can pick up the MUI
 * packs, and above DatabaseProvider so the setup and unlock screens are
 * translated before a database exists.
 *
 * The provider starts at English and reads localStorage after mount (the main
 * page is client-only, so there is no hydration mismatch to worry about).
 */

import type { Locale as DateFnsLocale } from 'date-fns';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  type LanguageCode,
  type LanguageDefinition,
  changeLanguage,
  getLanguageDefinition,
  initI18n,
  isLanguageCode,
  readStoredLanguage,
  storeLanguage,
} from '@/lib/i18n';
import { type MuiLocalePacks, muiLocalePacksFor } from '@/theme/muiLocales';

export interface LocaleContextValue {
  language: LanguageCode;
  definition: LanguageDefinition;
  /** BCP 47 tag for Intl ("en-US", "pt-BR"). */
  locale: string;
  setLanguage: (language: LanguageCode) => void;
  /** Resolved lazily; undefined until the bundle loads (date-fns falls back to English). */
  dateFnsLocale: DateFnsLocale | undefined;
  muiLocales: MuiLocalePacks;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

const DATE_FNS_LOADERS: Record<LanguageCode, () => Promise<DateFnsLocale>> = {
  'en-US': () => import('date-fns/locale/en-US').then((m) => m.enUS),
  es: () => import('date-fns/locale/es').then((m) => m.es),
  fr: () => import('date-fns/locale/fr').then((m) => m.fr),
  de: () => import('date-fns/locale/de').then((m) => m.de),
  zh: () => import('date-fns/locale/zh-CN').then((m) => m.zhCN),
  ja: () => import('date-fns/locale/ja').then((m) => m.ja),
  ko: () => import('date-fns/locale/ko').then((m) => m.ko),
  pt: () => import('date-fns/locale/pt-BR').then((m) => m.ptBR),
  it: () => import('date-fns/locale/it').then((m) => m.it),
};

initI18n();

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>(DEFAULT_LANGUAGE);
  const [dateFnsLocale, setDateFnsLocale] = useState<DateFnsLocale | undefined>(undefined);

  // Pick up the stored preference after mount (never the browser language).
  useEffect(() => {
    const stored = readStoredLanguage();
    setLanguageState((current) => (current === stored ? current : stored));
  }, []);

  // Apply the language: i18next bundles, <html lang>, date-fns locale, storage.
  useEffect(() => {
    let cancelled = false;
    void changeLanguage(language);
    const definition = getLanguageDefinition(language);
    if (typeof document !== 'undefined') {
      document.documentElement.lang = definition.intlLocale;
    }
    storeLanguage(language);
    DATE_FNS_LOADERS[language]()
      .then((loaded) => {
        if (!cancelled) setDateFnsLocale(loaded);
      })
      .catch(() => {
        if (!cancelled) setDateFnsLocale(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [language]);

  // Follow a change made in another tab.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== LANGUAGE_STORAGE_KEY) return;
      const next = isLanguageCode(event.newValue) ? event.newValue : DEFAULT_LANGUAGE;
      setLanguageState((current) => (current === next ? current : next));
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const setLanguage = useCallback((next: LanguageCode) => {
    if (!isLanguageCode(next)) return;
    setLanguageState(next);
  }, []);

  const value = useMemo<LocaleContextValue>(() => {
    const definition = getLanguageDefinition(language);
    return {
      language,
      definition,
      locale: definition.intlLocale,
      setLanguage,
      dateFnsLocale,
      muiLocales: muiLocalePacksFor(language),
    };
  }, [language, setLanguage, dateFnsLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error('useLocale must be used within LocaleProvider');
  }
  return context;
}

/** Null outside the provider (bare component tests, storybook-style renders). */
export function useOptionalLocale(): LocaleContextValue | null {
  return useContext(LocaleContext);
}
