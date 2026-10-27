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
// Lives in its own module (re-exported from sqlQueries.ts) so feature query
// files can import it without a circular dependency on the query hub.
// ---------------------------------------------------------------------------
export const spendExpr = (alias = 't') =>
  `CASE WHEN ${alias}.type IN ('expense', 'refund') AND ${alias}.is_excluded = 0 THEN -${alias}.amount ELSE 0 END`;

export const incomeExpr = (alias = 't') =>
  `CASE WHEN ${alias}.type = 'income' AND ${alias}.is_excluded = 0 THEN ${alias}.amount ELSE 0 END`;

/** WHERE fragment selecting the rows that count as spending. */
export const spendingRowsPredicate = (alias = 't') =>
  `${alias}.type IN ('expense', 'refund') AND ${alias}.is_excluded = 0`;
