/**
 * The household's currency preferences (default currency + manual exchange
 * rates), provided by DatabaseProvider from the cached collections state and
 * read by `useFormatters()` and the dashboard.
 *
 * Lives in its own tiny module so the setup screens (rendered by
 * DatabaseContext itself) and `useFormatters` can read it without importing
 * DatabaseContext — that import would be circular.
 */

import { createContext, useContext } from 'react';

import { DEFAULT_CURRENCY } from '@/lib/currencies';
import type { CurrencyPreferences } from '@/types/database';

export const EMPTY_CURRENCY_PREFERENCES: CurrencyPreferences = {
  defaultCurrency: DEFAULT_CURRENCY,
  exchangeRates: [],
};

export const CurrencyPreferencesContext = createContext<CurrencyPreferences | null>(null);

/** Never throws: USD / no rates outside the database provider. */
export function useOptionalCurrencyPreferences(): CurrencyPreferences {
  return useContext(CurrencyPreferencesContext) ?? EMPTY_CURRENCY_PREFERENCES;
}

/** The default currency, or USD outside the database provider. */
export function useOptionalDefaultCurrency(): string {
  return useOptionalCurrencyPreferences().defaultCurrency;
}
