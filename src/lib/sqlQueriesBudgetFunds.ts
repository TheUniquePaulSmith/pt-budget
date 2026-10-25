import { spendExpr, spendingRowsPredicate } from './sqlMoneyExpressions';

// Savings funds: projects and trips linked to a budget category with a
// monthly contribution (schema v3). Owned by the budgets feature.
//
// A fund's contribution window starts at contribution_start_month, else the
// month of start_date; `fundWindowStart` is that first day as a date string
// so spend before the fund existed is never attributed to it.
const fundWindowStart = (alias: string) =>
  `COALESCE(${alias}.contribution_start_month || '-01', ${alias}.start_date, '0000-01-01')`;

export const BUDGET_FUND_QUERIES = {
  LINKED_PROJECTS: `
    SELECT
      p.id, p.name, p.status, p.start_date, p.end_date, p.estimated_cost,
      p.budget_category_id, p.monthly_contribution, p.contribution_start_month,
      c.name AS category_name, c.color AS category_color
    FROM projects p
    JOIN categories c ON c.id = p.budget_category_id
    WHERE p.budget_category_id IS NOT NULL
    ORDER BY p.name
  `,
  LINKED_TRIPS: `
    SELECT
      t.id, t.name, t.status, t.start_date, t.end_date, t.estimated_cost,
      t.budget_category_id, t.monthly_contribution, t.contribution_start_month,
      c.name AS category_name, c.color AS category_color
    FROM trips t
    JOIN categories c ON c.id = t.budget_category_id
    WHERE t.budget_category_id IS NOT NULL
    ORDER BY t.name
  `,
  // Spend attributed to a project since a month ('YYYY-MM-01'), via the
  // transaction's project link. Never ABS(amount): refunds must net.
  PROJECT_SPEND_SINCE: `
    SELECT COALESCE(SUM(${spendExpr()}), 0) AS total
    FROM transactions t
    WHERE ${spendingRowsPredicate()} AND t.project_id = ? AND t.date >= ?
  `,
  TRIP_SPEND_SINCE: `
    SELECT COALESCE(SUM(${spendExpr()}), 0) AS total
    FROM transactions t
    WHERE ${spendingRowsPredicate()} AND t.trip_id = ? AND t.date >= ?
  `,
  // Same, bounded on both ends ('YYYY-MM-DD' inclusive) so a fund balance
  // can be read as of a past month.
  PROJECT_SPEND_BETWEEN: `
    SELECT COALESCE(SUM(${spendExpr()}), 0) AS total
    FROM transactions t
    WHERE ${spendingRowsPredicate()} AND t.project_id = ? AND t.date BETWEEN ? AND ?
  `,
  TRIP_SPEND_BETWEEN: `
    SELECT COALESCE(SUM(${spendExpr()}), 0) AS total
    FROM transactions t
    WHERE ${spendingRowsPredicate()} AND t.trip_id = ? AND t.date BETWEEN ? AND ?
  `,
  // Spend paid by any linked fund, by month and transaction category, inside
  // a date range. getBudgetStatus subtracts it from category spend (the fund
  // already accounted for it through contributions). Only rows dated inside
  // the owning fund's contribution window count.
  FUND_LINKED_SPEND_BY_MONTH_CATEGORY: `
    SELECT
      strftime('%Y-%m', t.date) AS month,
      t.category_id,
      SUM(${spendExpr()}) AS total
    FROM transactions t
    LEFT JOIN projects p ON p.id = t.project_id AND p.budget_category_id IS NOT NULL
    LEFT JOIN trips tr ON tr.id = t.trip_id AND tr.budget_category_id IS NOT NULL
    WHERE ${spendingRowsPredicate()} AND t.date BETWEEN ? AND ?
      AND (
        (p.id IS NOT NULL AND t.date >= ${fundWindowStart('p')})
        OR (tr.id IS NOT NULL AND t.date >= ${fundWindowStart('tr')})
      )
    GROUP BY strftime('%Y-%m', t.date), t.category_id
  `,
};
