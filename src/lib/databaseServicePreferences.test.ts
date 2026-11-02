import { describe, expect, it, vi } from 'vitest';

import { PreferencesService } from './databaseServicePreferences';
import { DEFAULT_CURRENCY_KEY } from './sqlMoneyExpressions';
import { EXCHANGE_RATE_QUERIES } from './sqlQueriesPreferences';

function createHarness(options: { defaultCurrency?: string | null; rates?: Array<{ currency: string; rate: number | null }> } = {}) {
  const metadata = new Map<string, string>();
  if (options.defaultCurrency) metadata.set(DEFAULT_CURRENCY_KEY, options.defaultCurrency);
  const rates = new Map((options.rates ?? []).map((row) => [row.currency, row.rate]));
  const calls: Array<[string, unknown[] | undefined]> = [];

  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push([sql, params]);
    if (sql === EXCHANGE_RATE_QUERIES.GET_ALL) {
      return [...rates.entries()].sort().map(([currency, rate]) => ({ currency, rate, updated_at: 'now' }));
    }
    if (sql === EXCHANGE_RATE_QUERIES.GET) {
      const code = String(params?.[0]);
      return rates.has(code) ? [{ currency: code, rate: rates.get(code), updated_at: 'now' }] : [];
    }
    if (sql === EXCHANGE_RATE_QUERIES.UPSERT) {
      rates.set(String(params?.[0]), params?.[1] as number | null);
      return [];
    }
    if (sql === EXCHANGE_RATE_QUERIES.DELETE) {
      rates.delete(String(params?.[0]));
      return [];
    }
    if (sql === EXCHANGE_RATE_QUERIES.REBASE) {
      const divisor = Number(params?.[0]);
      for (const [code, rate] of rates) if (rate !== null) rates.set(code, rate / divisor);
      return [];
    }
    if (sql === EXCHANGE_RATE_QUERIES.SET_ALL_UNKNOWN) {
      for (const code of rates.keys()) rates.set(code, null);
      return [];
    }
    if (sql === EXCHANGE_RATE_QUERIES.ACCOUNT_CURRENCIES) {
      return [{ currency: 'EUR' }, { currency: 'USD' }];
    }
    return [];
  });

  const appMetadata = {
    get: vi.fn(async (key: string) => metadata.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      metadata.set(key, value);
    }),
  };

  const service = new PreferencesService({ query }, appMetadata);
  return { service, query, appMetadata, metadata, rates, calls };
}

describe('PreferencesService', () => {
  it('defaults to USD when no preference is stored and normalises stored codes', async () => {
    const { service, metadata } = createHarness();
    await expect(service.getDefaultCurrency()).resolves.toBe('USD');
    metadata.set(DEFAULT_CURRENCY_KEY, ' eur ');
    await expect(service.getDefaultCurrency()).resolves.toBe('EUR');
    metadata.set(DEFAULT_CURRENCY_KEY, 'not-a-code');
    await expect(service.getDefaultCurrency()).resolves.toBe('USD');
  });

  it('lists rates, treating non-positive values as unknown', async () => {
    const { service } = createHarness({ rates: [{ currency: 'EUR', rate: 1.1 }, { currency: 'JPY', rate: 0 }, { currency: 'GBP', rate: null }] });
    const rates = await service.listExchangeRates();
    expect(rates.map((rate) => [rate.currency, rate.rate])).toEqual([['EUR', 1.1], ['GBP', null], ['JPY', null]]);
    await expect(service.listAccountCurrencies()).resolves.toEqual(['EUR', 'USD']);
    await expect(service.getCurrencyPreferences()).resolves.toMatchObject({ defaultCurrency: 'USD' });
  });

  it('upserts a rate, rejects non-positive rates, and removes a row for the default currency', async () => {
    const { service, rates } = createHarness({ rates: [{ currency: 'USD', rate: 1 }] });
    await service.setExchangeRate('gbp', 1.25);
    expect(rates.get('GBP')).toBe(1.25);
    await service.setExchangeRate('GBP', null);
    expect(rates.get('GBP')).toBeNull();
    await expect(service.setExchangeRate('GBP', -2)).rejects.toThrow('positive');
    await expect(service.setExchangeRate('GBP', Number.NaN)).rejects.toThrow('positive');
    await service.setExchangeRate('USD', 3);
    expect(rates.has('USD')).toBe(false);
    await service.deleteExchangeRate('GBP');
    expect(rates.has('GBP')).toBe(false);
  });

  it('rebases every known rate when the new default has a known rate', async () => {
    const { service, rates, metadata, calls } = createHarness({
      rates: [{ currency: 'EUR', rate: 1.25 }, { currency: 'GBP', rate: 1.5 }, { currency: 'JPY', rate: null }],
    });
    await service.setDefaultCurrency('EUR');

    expect(metadata.get(DEFAULT_CURRENCY_KEY)).toBe('EUR');
    expect(rates.has('EUR')).toBe(false);
    expect(rates.get('GBP')).toBeCloseTo(1.5 / 1.25);
    expect(rates.get('USD')).toBeCloseTo(1 / 1.25);
    expect(rates.get('JPY')).toBeNull();
    const sqls = calls.map(([sql]) => sql);
    expect(sqls[sqls.indexOf('BEGIN TRANSACTION') + 1]).toBe(EXCHANGE_RATE_QUERIES.REBASE);
    expect(sqls).toContain('COMMIT');
    expect(sqls).not.toContain('ROLLBACK');
  });

  it('forgets every rate when the new default has no known rate', async () => {
    const { service, rates, metadata } = createHarness({ rates: [{ currency: 'EUR', rate: 1.25 }] });
    await service.setDefaultCurrency('GBP');

    expect(metadata.get(DEFAULT_CURRENCY_KEY)).toBe('GBP');
    expect(rates.get('EUR')).toBeNull();
    expect(rates.get('USD')).toBeNull();
    expect(rates.has('GBP')).toBe(false);
  });

  it('is a no-op when the default does not change and rolls back on failure', async () => {
    const noop = createHarness({ defaultCurrency: 'EUR' });
    await noop.service.setDefaultCurrency('eur');
    expect(noop.calls.map(([sql]) => sql)).not.toContain('BEGIN TRANSACTION');

    const failing = createHarness({ rates: [{ currency: 'EUR', rate: 1.25 }] });
    failing.appMetadata.set.mockRejectedValueOnce(new Error('disk full'));
    await expect(failing.service.setDefaultCurrency('EUR')).rejects.toThrow('disk full');
    expect(failing.calls.map(([sql]) => sql)).toContain('ROLLBACK');
    expect(failing.metadata.has(DEFAULT_CURRENCY_KEY)).toBe(false);
  });
});
