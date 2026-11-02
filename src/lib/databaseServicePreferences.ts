/**
 * Currency preferences (schema v6): the default currency (app_metadata
 * `preferences.defaultCurrency`) and the manual exchange rates into it.
 * Exposed as `databaseService.preferences`.
 *
 * Rates are "units of the default currency per 1 unit of X"; the default
 * currency never has a row (its rate is 1 by definition in the SQL money
 * expressions). Changing the default re-expresses every known rate in the new
 * currency inside one transaction.
 */

import type { DatabaseWorkerTransport } from './databaseService';
import type { AppMetadataService } from './databaseServiceAppMetadata';
import { DEFAULT_CURRENCY, normalizeCurrencyCode } from './currencies';
import { logger } from './logging';
import { DEFAULT_CURRENCY_KEY } from './sqlMoneyExpressions';
import { EXCHANGE_RATE_QUERIES } from './sqlQueriesPreferences';
import type { CurrencyPreferences, ExchangeRate } from '@/types/database';

const log = logger.child({ component: 'PreferencesService' });

type PreferencesTransport = Pick<DatabaseWorkerTransport, 'query'>;
type MetadataAccess = Pick<AppMetadataService, 'get' | 'set'>;

export const PREFERENCE_KEYS = {
  defaultCurrency: DEFAULT_CURRENCY_KEY,
} as const;

function mapToExchangeRate(row: any): ExchangeRate {
  const rate = row.rate === null || row.rate === undefined ? null : Number(row.rate);
  return {
    currency: String(row.currency),
    rate: rate !== null && Number.isFinite(rate) && rate > 0 ? rate : null,
    updated_at: String(row.updated_at ?? ''),
  };
}

export class PreferencesService {
  constructor(
    private readonly worker: PreferencesTransport,
    private readonly appMetadata: MetadataAccess
  ) {}

  async getDefaultCurrency(): Promise<string> {
    const stored = await this.appMetadata.get(PREFERENCE_KEYS.defaultCurrency);
    return normalizeCurrencyCode(stored, DEFAULT_CURRENCY);
  }

  async listExchangeRates(): Promise<ExchangeRate[]> {
    const rows = await this.worker.query(EXCHANGE_RATE_QUERIES.GET_ALL);
    return rows.map(mapToExchangeRate);
  }

  async getExchangeRate(currency: string): Promise<ExchangeRate | null> {
    const rows = await this.worker.query(EXCHANGE_RATE_QUERIES.GET, [normalizeCurrencyCode(currency)]);
    return rows.length > 0 ? mapToExchangeRate(rows[0]) : null;
  }

  /** Distinct currencies of the active accounts. */
  async listAccountCurrencies(): Promise<string[]> {
    const rows = await this.worker.query(EXCHANGE_RATE_QUERIES.ACCOUNT_CURRENCIES);
    return rows.map((row: any) => normalizeCurrencyCode(row.currency));
  }

  async getCurrencyPreferences(): Promise<CurrencyPreferences> {
    const [defaultCurrency, exchangeRates] = await Promise.all([
      this.getDefaultCurrency(),
      this.listExchangeRates(),
    ]);
    return { defaultCurrency, exchangeRates };
  }

  /**
   * Records 1 `currency` = `rate` default-currency units; `null` marks the rate
   * unknown (the row stays so the Settings editor keeps listing it). A rate for
   * the default currency itself is meaningless and removes any stale row.
   */
  async setExchangeRate(currency: string, rate: number | null): Promise<void> {
    const code = normalizeCurrencyCode(currency);
    if (rate !== null && (!Number.isFinite(rate) || rate <= 0)) {
      throw new Error('Exchange rate must be a positive number');
    }
    const defaultCurrency = await this.getDefaultCurrency();
    if (code === defaultCurrency) {
      await this.worker.query(EXCHANGE_RATE_QUERIES.DELETE, [code]);
      return;
    }
    await this.worker.query(EXCHANGE_RATE_QUERIES.UPSERT, [code, rate]);
  }

  async deleteExchangeRate(currency: string): Promise<void> {
    await this.worker.query(EXCHANGE_RATE_QUERIES.DELETE, [normalizeCurrencyCode(currency)]);
  }

  /**
   * Changes the default currency and rebases the rate table in one transaction:
   * when the new default's rate r is known, every rate becomes rate / r and the
   * old default gets 1 / r; otherwise every rate is forgotten (NULL) and the
   * old default is listed as unknown. The new default's own row is removed.
   */
  async setDefaultCurrency(next: string): Promise<void> {
    const nextCode = normalizeCurrencyCode(next);
    const current = await this.getDefaultCurrency();
    if (nextCode === current) return;

    const nextRate = await this.getExchangeRate(nextCode);
    const knownRate = nextRate?.rate ?? null;

    await this.worker.query('BEGIN TRANSACTION');
    try {
      if (knownRate !== null) {
        await this.worker.query(EXCHANGE_RATE_QUERIES.REBASE, [knownRate]);
        await this.worker.query(EXCHANGE_RATE_QUERIES.UPSERT, [current, 1 / knownRate]);
      } else {
        await this.worker.query(EXCHANGE_RATE_QUERIES.SET_ALL_UNKNOWN);
        await this.worker.query(EXCHANGE_RATE_QUERIES.UPSERT, [current, null]);
      }
      await this.worker.query(EXCHANGE_RATE_QUERIES.DELETE, [nextCode]);
      await this.appMetadata.set(PREFERENCE_KEYS.defaultCurrency, nextCode);
      await this.worker.query('COMMIT');
      log.info('Default currency changed', { operation: 'setDefaultCurrency', from: current, to: nextCode, rebased: knownRate !== null });
    } catch (error) {
      await this.worker.query('ROLLBACK');
      log.error('Failed to change the default currency', { operation: 'setDefaultCurrency', error });
      throw error;
    }
  }
}
