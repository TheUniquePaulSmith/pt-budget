'use client';

// Page-facing slices for currency preferences (schema v6). Re-exported from
// useDatabaseSlices.ts (the hub).

import { useMemo } from 'react';

import { accountCurrencies, missingRateCurrencies } from '@/lib/currencies';

import { useDatabaseCollections, useDatabasePreferences } from './DatabaseContext';

/** Settings → Preferences tab, the setup Preferences step and the dashboard's missing-rate notice. */
export function useCurrencyPreferencesSlice() {
  const collections = useDatabaseCollections();
  const preferences = useDatabasePreferences();
  const { defaultCurrency, exchangeRates } = collections.currencyPreferences;
  const { accounts } = collections;

  const derived = useMemo(
    () => ({
      accountCurrencies: accountCurrencies(accounts),
      missingRateCurrencies: missingRateCurrencies(accounts, defaultCurrency, exchangeRates),
    }),
    [accounts, defaultCurrency, exchangeRates]
  );

  return {
    defaultCurrency,
    exchangeRates,
    accountCurrencies: derived.accountCurrencies,
    missingRateCurrencies: derived.missingRateCurrencies,
    setDefaultCurrency: preferences.setDefaultCurrency,
    setExchangeRate: preferences.setExchangeRate,
    deleteExchangeRate: preferences.deleteExchangeRate,
  };
}
