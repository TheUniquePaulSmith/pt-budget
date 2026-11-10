/**
 * i18n core: the supported languages, the i18next instance and the device
 * language preference (localStorage, like the theme — the welcome and unlock
 * screens render before any database exists, so the language cannot live in
 * app_metadata).
 *
 * English is bundled statically and is always the fallback; the other
 * languages are code-split and loaded on demand from src/locales/<lang>/.
 * The browser language is deliberately NOT consulted: `en-US` is the default
 * until the user picks something, which keeps the e2e suite deterministic.
 */

import i18next, { type i18n as I18nInstance } from 'i18next';
import resourcesToBackend from 'i18next-resources-to-backend';
import { initReactI18next } from 'react-i18next';

import enAccounts from '@/locales/en-US/accounts.json';
import enAi from '@/locales/en-US/ai.json';
import enBudget from '@/locales/en-US/budget.json';
import enCommon from '@/locales/en-US/common.json';
import enDashboard from '@/locales/en-US/dashboard.json';
import enDataManagement from '@/locales/en-US/dataManagement.json';
import enDeveloper from '@/locales/en-US/developer.json';
import enImportIssues from '@/locales/en-US/importIssues.json';
import enImportManage from '@/locales/en-US/importManage.json';
import enImportWizard from '@/locales/en-US/importWizard.json';
import enLoans from '@/locales/en-US/loans.json';
import enNotFound from '@/locales/en-US/notFound.json';
import enNotifications from '@/locales/en-US/notifications.json';
import enProjects from '@/locales/en-US/projects.json';
import enSettings from '@/locales/en-US/settings.json';
import enSetup from '@/locales/en-US/setup.json';
import enShell from '@/locales/en-US/shell.json';
import enSqlQuery from '@/locales/en-US/sqlQuery.json';
import enSubscriptions from '@/locales/en-US/subscriptions.json';
import enTransactions from '@/locales/en-US/transactions.json';
import enTrips from '@/locales/en-US/trips.json';

export type LanguageCode = 'en-US' | 'es' | 'fr' | 'de' | 'zh' | 'ja' | 'ko' | 'pt' | 'it';

export type CsvDateOrder = 'MDY' | 'DMY' | 'YMD';

export interface LanguageDefinition {
  code: LanguageCode;
  /** The language's own name, shown in pickers regardless of the active language. */
  nativeLabel: string;
  /** BCP 47 tag handed to Intl (pt → pt-BR, zh → zh-CN). */
  intlLocale: string;
  /** Default day/month order when a CSV date is ambiguous. */
  csvDateOrder: CsvDateOrder;
  /** Decimal separator the locale writes, for CSV amount parsing. */
  decimalSeparator: '.' | ',';
}

export const DEFAULT_LANGUAGE: LanguageCode = 'en-US';
export const LANGUAGE_STORAGE_KEY = 'budgetTracker_language';

export const SUPPORTED_LANGUAGES: readonly LanguageDefinition[] = [
  { code: 'en-US', nativeLabel: 'English (US)', intlLocale: 'en-US', csvDateOrder: 'MDY', decimalSeparator: '.' },
  { code: 'es', nativeLabel: 'Español', intlLocale: 'es-ES', csvDateOrder: 'DMY', decimalSeparator: ',' },
  { code: 'fr', nativeLabel: 'Français', intlLocale: 'fr-FR', csvDateOrder: 'DMY', decimalSeparator: ',' },
  { code: 'de', nativeLabel: 'Deutsch', intlLocale: 'de-DE', csvDateOrder: 'DMY', decimalSeparator: ',' },
  { code: 'zh', nativeLabel: '中文（简体）', intlLocale: 'zh-CN', csvDateOrder: 'YMD', decimalSeparator: '.' },
  { code: 'ja', nativeLabel: '日本語', intlLocale: 'ja-JP', csvDateOrder: 'YMD', decimalSeparator: '.' },
  { code: 'ko', nativeLabel: '한국어', intlLocale: 'ko-KR', csvDateOrder: 'YMD', decimalSeparator: '.' },
  { code: 'pt', nativeLabel: 'Português (Brasil)', intlLocale: 'pt-BR', csvDateOrder: 'DMY', decimalSeparator: ',' },
  { code: 'it', nativeLabel: 'Italiano', intlLocale: 'it-IT', csvDateOrder: 'DMY', decimalSeparator: ',' },
];

export const NAMESPACES = [
  'common',
  'shell',
  'setup',
  'settings',
  'dashboard',
  'accounts',
  'transactions',
  'budget',
  'loans',
  'subscriptions',
  'notifications',
  'importWizard',
  'importIssues',
  'importManage',
  'ai',
  'projects',
  'trips',
  'sqlQuery',
  'dataManagement',
  'developer',
  'notFound',
] as const;

export type Namespace = (typeof NAMESPACES)[number];

/** The statically bundled English resources (also the source of the typed keys). */
export const EN_US_RESOURCES = {
  common: enCommon,
  shell: enShell,
  setup: enSetup,
  settings: enSettings,
  dashboard: enDashboard,
  accounts: enAccounts,
  transactions: enTransactions,
  budget: enBudget,
  loans: enLoans,
  subscriptions: enSubscriptions,
  notifications: enNotifications,
  importWizard: enImportWizard,
  importIssues: enImportIssues,
  importManage: enImportManage,
  ai: enAi,
  projects: enProjects,
  trips: enTrips,
  sqlQuery: enSqlQuery,
  dataManagement: enDataManagement,
  developer: enDeveloper,
  notFound: enNotFound,
} as const;

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === 'string' && SUPPORTED_LANGUAGES.some((language) => language.code === value);
}

export function getLanguageDefinition(code: LanguageCode): LanguageDefinition {
  return SUPPORTED_LANGUAGES.find((language) => language.code === code) ?? SUPPORTED_LANGUAGES[0];
}

/** The Intl locale tag for a language code ("pt" → "pt-BR"). */
export function intlLocaleFor(code: LanguageCode): string {
  return getLanguageDefinition(code).intlLocale;
}

export function csvDateOrderFor(code: LanguageCode): CsvDateOrder {
  return getLanguageDefinition(code).csvDateOrder;
}

export function decimalSeparatorFor(code: LanguageCode): '.' | ',' {
  return getLanguageDefinition(code).decimalSeparator;
}

/** The stored device preference, or the default. Never consults `navigator.language`. */
export function readStoredLanguage(): LanguageCode {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE;
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguageCode(stored) ? stored : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export function storeLanguage(code: LanguageCode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
  } catch {
    // Persistence failures must not break language switching.
  }
}

const lazyBackend = resourcesToBackend(
  (language: string, namespace: string) => import(`../locales/${language}/${namespace}.json`)
);

/**
 * Initialises the shared i18next instance once. Safe to call repeatedly (the
 * app's LocaleProvider, the test setup and plain library modules all do).
 * With the English resources inline, initialisation is synchronous.
 */
export function initI18n(): I18nInstance {
  if (i18next.isInitialized) return i18next;
  void i18next
    .use(lazyBackend)
    .use(initReactI18next)
    .init({
      lng: DEFAULT_LANGUAGE,
      fallbackLng: DEFAULT_LANGUAGE,
      supportedLngs: SUPPORTED_LANGUAGES.map((language) => language.code),
      load: 'currentOnly',
      ns: [...NAMESPACES],
      defaultNS: 'common',
      resources: { [DEFAULT_LANGUAGE]: EN_US_RESOURCES },
      partialBundledLanguages: true,
      initAsync: false,
      returnNull: false,
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });
  return i18next;
}

/** Loads a language's bundles (if needed) and makes it active. */
export async function changeLanguage(code: LanguageCode): Promise<void> {
  initI18n();
  await i18next.changeLanguage(code);
}

export const i18n = initI18n();

export default i18n;
