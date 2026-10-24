import type { DatabaseWorkerTransport } from './databaseService';
import { BUDGET_FUND_QUERIES } from './sqlQueriesBudgetFunds';
import type { BudgetFundLink } from '../types/database';

type BudgetFundsTransport = Pick<DatabaseWorkerTransport, 'query'>;

/**
 * Savings funds: projects and trips linked to a budget category with a
 * monthly contribution (schema v3). The foundation ships the reads; the
 * budgets feature adds the fund balance math on top.
 */
export class BudgetFundsService {
  constructor(private readonly worker: BudgetFundsTransport) {}

  /** Every project and trip that has a linked budget category, in one list. */
  async listLinkedFunds(): Promise<BudgetFundLink[]> {
    const [projectRows, tripRows] = await Promise.all([
      this.worker.query(BUDGET_FUND_QUERIES.LINKED_PROJECTS),
      this.worker.query(BUDGET_FUND_QUERIES.LINKED_TRIPS),
    ]);
    return [
      ...projectRows.map((row: any) => mapToBudgetFundLink(row, 'project')),
      ...tripRows.map((row: any) => mapToBudgetFundLink(row, 'trip')),
    ];
  }

  /** Spend attributed to one fund's entity since a month ('YYYY-MM'). Refunds net out. */
  async getSpendSince(entityType: BudgetFundLink['entity_type'], entityId: number, month: string): Promise<number> {
    const sql = entityType === 'project' ? BUDGET_FUND_QUERIES.PROJECT_SPEND_SINCE : BUDGET_FUND_QUERIES.TRIP_SPEND_SINCE;
    const rows = await this.worker.query(sql, [entityId, `${month}-01`]);
    return rows.length > 0 ? Number(rows[0].total) || 0 : 0;
  }
}

export function mapToBudgetFundLink(row: any, entityType: BudgetFundLink['entity_type']): BudgetFundLink {
  return {
    entity_type: entityType,
    entity_id: Number(row.id),
    name: String(row.name),
    status: String(row.status),
    start_date: row.start_date ?? null,
    end_date: row.end_date ?? null,
    estimated_cost: row.estimated_cost != null ? Number(row.estimated_cost) : null,
    budget_category_id: Number(row.budget_category_id),
    category_name: row.category_name ?? undefined,
    category_color: row.category_color ?? undefined,
    monthly_contribution: row.monthly_contribution != null ? Number(row.monthly_contribution) : null,
    contribution_start_month: row.contribution_start_month ?? null,
  };
}
