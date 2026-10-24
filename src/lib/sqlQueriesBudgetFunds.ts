import { spendExpr, spendingRowsPredicate } from './sqlMoneyExpressions';

// Savings funds: projects and trips linked to a budget category with a
// monthly contribution (schema v3). Owned by the budgets feature; the
// foundation ships the reads needed to list linked funds.
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
};
