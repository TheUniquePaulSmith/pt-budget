// ---------------------------------------------------------------------------
// Money expressions
//
// Every aggregate derives spending and income from these so the dashboard, the
// budget, the transaction report and the recurring-series stats agree:
//   spending = -(expense + refund amounts)   refunds are stored positive and net out
//   income   = income amounts                transfers count toward neither side
//   rows with is_excluded = 1 contribute nothing anywhere
// Never use ABS(amount) in analytics: with refunds positive, ABS would turn a
// refund into extra spend (guarded by databaseService.test.ts "analytics consistency").
//
// Which rows are income, refunds or transfers is decided by transactions.type
// alone. Card payments and merchant credits arriving on a credit account are
// typed transfer / refund by the classifier (rules, transfer pairing, refund
// inference — see transactionClassifier.ts), so no query needs to second-guess
// the type from the account type.
//
// Currency (schema v6): amounts are stored in the account's currency, and every
// cross-account total is expressed in the household's default currency. The
// money rows below are multiplied by `rateExpr`, a correlated subquery that
// resolves the account's rate into the default currency (1 for the default
// currency itself, else the manual rate from exchange_rates). An unknown rate
// is NULL, which makes the row NULL, which SUM skips — so a currency with no
// rate drops out of the totals until the user enters one (the dashboard says
// so). Non-money rows stay 0, never NULL, so wrappers such as
// `SUM(CASE WHEN ... THEN spendExpr ELSE 0 END)` keep their meaning.
//
// Lives in its own module (re-exported from sqlQueries.ts) so feature query
// files can import it without a circular dependency on the query hub.
// ---------------------------------------------------------------------------

/** app_metadata key holding the default currency; shared with the preferences service. */
export const DEFAULT_CURRENCY_KEY = 'preferences.defaultCurrency';

/** The default currency as a SQL expression: the app_metadata value, USD when the key is absent. */
export const DEFAULT_CURRENCY_SQL = `COALESCE((SELECT value FROM app_metadata WHERE key = '${DEFAULT_CURRENCY_KEY}'), 'USD')`;

/**
 * Units of the default currency per 1 unit of the row's account currency;
 * NULL when no rate is known. `alias` is the transactions alias.
 */
export const rateExpr = (alias = 't') =>
  `(SELECT CASE WHEN xa.currency = ${DEFAULT_CURRENCY_SQL} THEN 1.0 ELSE xr.rate END FROM accounts xa LEFT JOIN exchange_rates xr ON xr.currency = xa.currency WHERE xa.id = ${alias}.account_id)`;

export const spendExpr = (alias = 't') =>
  `CASE WHEN ${alias}.type IN ('expense', 'refund') AND ${alias}.is_excluded = 0 THEN -${alias}.amount * ${rateExpr(alias)} ELSE 0 END`;

export const incomeExpr = (alias = 't') =>
  `CASE WHEN ${alias}.type = 'income' AND ${alias}.is_excluded = 0 THEN ${alias}.amount * ${rateExpr(alias)} ELSE 0 END`;

/** WHERE fragment selecting the rows that count as spending. */
export const spendingRowsPredicate = (alias = 't') =>
  `${alias}.type IN ('expense', 'refund') AND ${alias}.is_excluded = 0`;
