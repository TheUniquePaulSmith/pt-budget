// Currency preferences (schema v6): the manual exchange-rate table. Owned by
// the preferences feature; re-exported from the sqlQueries.ts hub. The default
// currency itself lives in app_metadata (DEFAULT_CURRENCY_KEY).

export const EXCHANGE_RATE_QUERIES = {
  GET_ALL: `SELECT currency, rate, updated_at FROM exchange_rates ORDER BY currency`,
  GET: `SELECT currency, rate, updated_at FROM exchange_rates WHERE currency = ?`,
  UPSERT: `
    INSERT INTO exchange_rates (currency, rate, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(currency) DO UPDATE SET rate = excluded.rate, updated_at = CURRENT_TIMESTAMP
  `,
  DELETE: `DELETE FROM exchange_rates WHERE currency = ?`,
  /** Re-expresses every known rate in a new default currency: rate / (new default's old rate). */
  REBASE: `UPDATE exchange_rates SET rate = rate / ?, updated_at = CURRENT_TIMESTAMP WHERE rate IS NOT NULL`,
  /** Forgets every rate (the new default had no known rate, so nothing can be rebased). */
  SET_ALL_UNKNOWN: `UPDATE exchange_rates SET rate = NULL, updated_at = CURRENT_TIMESTAMP WHERE rate IS NOT NULL`,
  /** Currencies in use by active accounts. */
  ACCOUNT_CURRENCIES: `SELECT DISTINCT currency FROM accounts WHERE is_active = 1 ORDER BY currency`,
};
