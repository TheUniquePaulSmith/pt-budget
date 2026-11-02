"use client";

import { useCallback, useMemo } from 'react';

import type { DatabaseService } from '../lib/databaseService';

/**
 * Provider-domain slice for currency preferences (schema v6): the default
 * currency and the manual exchange rates. Mutations refresh the cached
 * `currencyPreferences` collection; a default-currency change also bumps
 * transactionVersion because every cross-account total is re-expressed.
 */
export interface DatabasePreferencesSlice {
  /** Changes the default currency, rebasing every known rate in one transaction. */
  setDefaultCurrency: (currency: string) => Promise<void>;
  /** 1 `currency` = `rate` default-currency units; null marks the rate unknown. */
  setExchangeRate: (currency: string, rate: number | null) => Promise<void>;
  deleteExchangeRate: (currency: string) => Promise<void>;
  /** Distinct currencies of the active accounts (straight from the database). */
  listAccountCurrencies: () => Promise<string[]>;
}

type PreferencesDatabaseService = Pick<DatabaseService, 'preferences'>;

interface UseDatabasePreferencesSliceOptions {
  databaseService: PreferencesDatabaseService | null;
  refreshCurrencyPreferences: () => Promise<void>;
  refreshTransactions: () => Promise<void>;
  refreshBudgets: () => Promise<void>;
}

export function useDatabasePreferencesSlice({
  databaseService,
  refreshCurrencyPreferences,
  refreshTransactions,
  refreshBudgets,
}: UseDatabasePreferencesSliceOptions): DatabasePreferencesSlice {
  const requireService = useCallback(() => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }
    return databaseService.preferences;
  }, [databaseService]);

  const setDefaultCurrency = useCallback(
    async (currency: string) => {
      await requireService().setDefaultCurrency(currency);
      await refreshCurrencyPreferences();
      await Promise.all([refreshTransactions(), refreshBudgets()]);
    },
    [requireService, refreshCurrencyPreferences, refreshTransactions, refreshBudgets]
  );

  const setExchangeRate = useCallback(
    async (currency: string, rate: number | null) => {
      await requireService().setExchangeRate(currency, rate);
      await refreshCurrencyPreferences();
      await Promise.all([refreshTransactions(), refreshBudgets()]);
    },
    [requireService, refreshCurrencyPreferences, refreshTransactions, refreshBudgets]
  );

  const deleteExchangeRate = useCallback(
    async (currency: string) => {
      await requireService().deleteExchangeRate(currency);
      await refreshCurrencyPreferences();
      await Promise.all([refreshTransactions(), refreshBudgets()]);
    },
    [requireService, refreshCurrencyPreferences, refreshTransactions, refreshBudgets]
  );

  const listAccountCurrencies = useCallback(async () => requireService().listAccountCurrencies(), [requireService]);

  return useMemo(
    () => ({ setDefaultCurrency, setExchangeRate, deleteExchangeRate, listAccountCurrencies }),
    [setDefaultCurrency, setExchangeRate, deleteExchangeRate, listAccountCurrencies]
  );
}
