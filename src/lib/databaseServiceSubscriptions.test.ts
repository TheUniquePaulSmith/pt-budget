import { afterEach, describe, expect, it, vi } from 'vitest';

import { DatabaseService, type DatabaseWorkerTransport } from './databaseService';
import { COMPANY_QUERIES, SUBSCRIPTION_QUERIES } from './sqlQueries';
import { SEED_VERSION_METADATA_KEY } from './merchantRulesSeedService';
import type { MerchantRule } from '../types/database';

interface FakeTransactionRow {
  id: number;
  date: string;
  amount: number;
  description: string;
  type: 'income' | 'expense';
  company_id: number | null;
  account_id?: number;
  card_id?: number | null;
}

/**
 * In-memory SQL router covering exactly the statements the subscription
 * feature issues, so the full scan pipeline can be exercised end-to-end
 * without a real SQLite instance.
 */
class FakeSubscriptionDb {
  rules: any[] = [];
  series: any[] = [];
  links: any[] = [];
  companies: Array<{ id: number; name: string }> = [];
  cards: Array<{ id: number; last_four: string; nickname: string | null }> = [];
  transactions: FakeTransactionRow[] = [];
  metadata = new Map<string, string>();

  private nextRuleId = 1;
  private nextSeriesId = 1;
  private nextLinkId = 1;
  private nextCompanyId = 1;
  private nextCardId = 1;

  addCard(card: { last_four: string; nickname?: string | null }): { id: number; last_four: string; nickname: string | null } {
    const row = { id: this.nextCardId++, last_four: card.last_four, nickname: card.nickname ?? null };
    this.cards.push(row);
    return row;
  }

  addRule(rule: Partial<MerchantRule>): any {
    const row = {
      id: this.nextRuleId++,
      rule_key: `test:${this.nextRuleId}`,
      source: 'community',
      pattern: '',
      match_type: 'prefix',
      priority: 100,
      merchant_name: '',
      service_name: null,
      default_kind: 'purchase',
      enabled: 1,
      user_modified: 0,
      notes: null,
      created_at: 'now',
      updated_at: 'now',
      ...rule,
    };
    this.rules.push(row);
    return row;
  }

  addTransaction(row: Omit<FakeTransactionRow, 'account_id'>): void {
    this.transactions.push({ ...row, account_id: 1 });
  }

  query = async (sql: string, params: any[] = []): Promise<any[]> => {
    if (sql.includes('WHERE t.id IN')) {
      return this.transactions
        .filter((txn) => params.includes(txn.id))
        .map((txn) => ({
          ...txn,
          category_id: null,
          project_id: null,
          trip_id: null,
          created_at: 'now',
          updated_at: 'now',
          company_name: null,
          account_name: 'Checking',
        }))
        .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    }

    switch (sql) {
      case 'BEGIN TRANSACTION':
      case 'COMMIT':
      case 'ROLLBACK':
        return [];

      case SUBSCRIPTION_QUERIES.GET_ALL_RULES:
      case SUBSCRIPTION_QUERIES.GET_ENABLED_RULES: {
        const rows = sql === SUBSCRIPTION_QUERIES.GET_ENABLED_RULES
          ? this.rules.filter((rule) => rule.enabled === 1)
          : this.rules;
        return rows.map((rule) => ({ ...rule }));
      }

      case SUBSCRIPTION_QUERIES.GET_RULE_BY_ID:
        return this.rules.filter((rule) => rule.id === params[0]).map((rule) => ({ ...rule }));

      case SUBSCRIPTION_QUERIES.CREATE_RULE: {
        const row = this.addRule({
          rule_key: params[0],
          source: params[1],
          pattern: params[2],
          match_type: params[3],
          priority: params[4],
          merchant_name: params[5],
          service_name: params[6],
          default_kind: params[7],
          enabled: params[8],
          user_modified: params[9],
          notes: params[10],
        });
        return [{ id: row.id }];
      }

      case SUBSCRIPTION_QUERIES.UPDATE_RULE: {
        const rule = this.rules.find((candidate) => candidate.id === params[8]);
        if (rule) {
          Object.assign(rule, {
            pattern: params[0],
            match_type: params[1],
            priority: params[2],
            merchant_name: params[3],
            service_name: params[4],
            default_kind: params[5],
            enabled: params[6],
            notes: params[7],
            user_modified: rule.source === 'community' ? 1 : rule.user_modified,
          });
        }
        return [];
      }

      case SUBSCRIPTION_QUERIES.DELETE_RULE:
        this.rules = this.rules.filter(
          (rule) => !(rule.id === params[0] && rule.source === 'user')
        );
        return [];

      case SUBSCRIPTION_QUERIES.DISABLE_RULE: {
        const rule = this.rules.find((candidate) => candidate.id === params[0]);
        if (rule) {
          rule.enabled = 0;
          rule.user_modified = 1;
        }
        return [];
      }

      case SUBSCRIPTION_QUERIES.UPSERT_COMMUNITY_RULE: {
        const existing = this.rules.find((rule) => rule.rule_key === params[0]);
        if (!existing) {
          this.addRule({
            rule_key: params[0],
            source: 'community',
            pattern: params[1],
            match_type: params[2],
            priority: params[3],
            merchant_name: params[4],
            service_name: params[5],
            default_kind: params[6],
            enabled: 1,
          });
        } else if (existing.user_modified === 0) {
          Object.assign(existing, {
            pattern: params[1],
            match_type: params[2],
            priority: params[3],
            merchant_name: params[4],
            service_name: params[5],
            default_kind: params[6],
          });
        }
        return [];
      }

      case SUBSCRIPTION_QUERIES.COUNT_RULES_BY_SOURCE: {
        const counts = new Map<string, number>();
        for (const rule of this.rules) {
          counts.set(rule.source, (counts.get(rule.source) ?? 0) + 1);
        }
        return Array.from(counts.entries()).map(([source, count]) => ({ source, count }));
      }

      case SUBSCRIPTION_QUERIES.GET_METADATA: {
        const value = this.metadata.get(params[0]);
        return value === undefined ? [] : [{ value }];
      }

      case SUBSCRIPTION_QUERIES.SET_METADATA:
        this.metadata.set(params[0], params[1]);
        return [];

      case SUBSCRIPTION_QUERIES.GET_UNMATCHED_TRANSACTIONS:
        return this.transactions
          .filter((txn) => txn.company_id === null)
          .map((txn) => ({ id: txn.id, description: txn.description }));

      case SUBSCRIPTION_QUERIES.GET_EXPENSE_TRANSACTIONS_FOR_SCAN:
        return this.transactions
          .filter((txn) => txn.type === 'expense')
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((txn) => ({ ...txn }));

      case SUBSCRIPTION_QUERIES.UPDATE_TRANSACTION_COMPANY: {
        const txn = this.transactions.find((candidate) => candidate.id === params[1]);
        if (txn && txn.company_id === null) {
          txn.company_id = params[0];
        }
        return [];
      }

      case SUBSCRIPTION_QUERIES.GET_SERIES_BY_MATCH_KEY:
        return this.series
          .filter((series) => series.match_key === params[0])
          .map((series) => ({ ...series }));

      case SUBSCRIPTION_QUERIES.CREATE_SERIES: {
        const row = {
          id: this.nextSeriesId++,
          name: params[0],
          company_id: params[1],
          rule_id: params[2],
          kind: params[3],
          cadence: params[4],
          expected_amount: params[5],
          amount_is_variable: params[6],
          status: params[7],
          match_key: params[8],
          last_seen_date: params[9],
          next_expected_date: params[10],
          notes: params[11],
          created_at: 'now',
          updated_at: 'now',
        };
        this.series.push(row);
        return [{ id: row.id }];
      }

      case SUBSCRIPTION_QUERIES.UPDATE_SERIES_DETECTION: {
        const series = this.series.find((candidate) => candidate.id === params[5]);
        if (series) {
          Object.assign(series, {
            cadence: params[0],
            expected_amount: params[1],
            amount_is_variable: params[2],
            last_seen_date: params[3],
            next_expected_date: params[4],
          });
        }
        return [];
      }

      case SUBSCRIPTION_QUERIES.UPDATE_SERIES: {
        const series = this.series.find((candidate) => candidate.id === params[6]);
        if (series) {
          Object.assign(series, {
            name: params[0],
            kind: params[1],
            cadence: params[2],
            expected_amount: params[3],
            status: params[4],
            notes: params[5],
          });
        }
        return [];
      }

      case SUBSCRIPTION_QUERIES.UPDATE_SERIES_STATUS: {
        const series = this.series.find((candidate) => candidate.id === params[1]);
        if (series) series.status = params[0];
        return [];
      }

      case SUBSCRIPTION_QUERIES.UPDATE_SERIES_COMPANY: {
        const series = this.series.find((candidate) => candidate.id === params[1]);
        if (series) series.company_id = params[0];
        return [];
      }

      case SUBSCRIPTION_QUERIES.DELETE_SERIES:
        this.series = this.series.filter((series) => series.id !== params[0]);
        return [];

      case SUBSCRIPTION_QUERIES.LINK_TRANSACTION: {
        if (!this.links.some((link) => link.transaction_id === params[0])) {
          this.links.push({
            id: this.nextLinkId++,
            transaction_id: params[0],
            series_id: params[1],
            match_source: params[2],
            created_at: 'now',
          });
        }
        return [];
      }

      case SUBSCRIPTION_QUERIES.DELETE_LINKS_FOR_SERIES:
        this.links = this.links.filter((link) => link.series_id !== params[0]);
        return [];

      case SUBSCRIPTION_QUERIES.DELETE_LINK_FOR_TRANSACTION:
        this.links = this.links.filter((link) => link.transaction_id !== params[0]);
        return [];

      case SUBSCRIPTION_QUERIES.GET_ALL_LINKED_TRANSACTION_IDS:
        return this.links.map((link) => ({
          transaction_id: link.transaction_id,
          series_id: link.series_id,
        }));

      case SUBSCRIPTION_QUERIES.GET_SERIES_TRANSACTIONS:
        return this.links
          .filter((link) => link.series_id === params[0])
          .map((link) => {
            const txn = this.transactions.find(
              (candidate) => candidate.id === link.transaction_id
            )!;
            return {
              ...txn,
              category_id: null,
              project_id: null,
              trip_id: null,
              created_at: 'now',
              updated_at: 'now',
              company_name: null,
              account_name: 'Checking',
            };
          })
          .sort((a, b) => b.date.localeCompare(a.date));

      case SUBSCRIPTION_QUERIES.GET_SERIES_WITH_STATS:
        return this.series.map((series) => {
          const seriesLinks = this.links.filter((link) => link.series_id === series.id);
          const startDate = params[0] as string | null;
          const endDate = params[2] as string | null;
          const linkedTransactions = seriesLinks
            .map((link) => this.transactions.find((candidate) => candidate.id === link.transaction_id))
            .filter((txn): txn is FakeTransactionRow => Boolean(txn))
            .filter((txn) => (!startDate || txn.date >= startDate) && (!endDate || txn.date <= endDate));
          const totalSpent = seriesLinks.reduce((total, link) => {
            const txn = this.transactions.find(
              (candidate) => candidate.id === link.transaction_id
            );
            if (!txn) return total;
            if (startDate && txn.date < startDate) return total;
            if (endDate && txn.date > endDate) return total;
            return total + Math.abs(txn.amount);
          }, 0);
          const company = this.companies.find((candidate) => candidate.id === series.company_id);
          const latestCardTxn = seriesLinks
            .map((link) => this.transactions.find((candidate) => candidate.id === link.transaction_id))
            .filter((txn): txn is FakeTransactionRow => txn != null && txn.card_id != null)
            .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)[0];
          const latestCard = latestCardTxn
            ? this.cards.find((card) => card.id === latestCardTxn.card_id) ?? null
            : null;
          return {
            ...series,
            company_name: company?.name ?? null,
            transaction_count: linkedTransactions.length,
            total_spent: totalSpent,
            card_last_four: latestCard?.last_four ?? null,
            card_nickname: latestCard?.nickname ?? null,
          };
        });

      case COMPANY_QUERIES.FIND_BY_NAME: {
        const name = String(params[0]).toLowerCase();
        return this.companies
          .filter((company) => company.name.toLowerCase() === name)
          .map((company) => ({
            ...company,
            created_at: 'now',
            updated_at: 'now',
          }));
      }

      case COMPANY_QUERIES.CREATE: {
        const company = { id: this.nextCompanyId++, name: params[0] };
        this.companies.push(company);
        return [{ id: company.id }];
      }

      case 'SELECT description FROM transactions':
        return this.transactions.map((txn) => ({ description: txn.description }));

      case `SELECT COUNT(*) as count FROM merchant_rules WHERE source = 'community'`:
        return [{ count: this.rules.filter((rule) => rule.source === 'community').length }];

      default:
        throw new Error(`FakeSubscriptionDb has no handler for SQL: ${sql}`);
    }
  };
}

function createService(db: FakeSubscriptionDb): DatabaseService {
  return new DatabaseService({
    query: db.query,
  } as unknown as DatabaseWorkerTransport);
}

function seedScenario(db: FakeSubscriptionDb): void {
  db.addRule({
    rule_key: 'community:netflix',
    pattern: 'NETFLIX',
    match_type: 'prefix',
    priority: 100,
    merchant_name: 'Netflix',
    service_name: 'Netflix',
    default_kind: 'subscription',
  });
  db.addRule({
    rule_key: 'community:amazon-marketplace',
    pattern: 'AMAZON MKTPL',
    match_type: 'prefix',
    priority: 100,
    merchant_name: 'Amazon',
    service_name: null,
    default_kind: 'purchase',
  });
  db.addRule({
    rule_key: 'community:breezeline',
    pattern: 'BREEZELINE',
    match_type: 'prefix',
    priority: 100,
    merchant_name: 'Breezeline',
    service_name: 'Breezeline Internet',
    default_kind: 'bill',
  });

  // Fixed monthly subscription, 3 occurrences -> rule-backed, auto-active
  db.addTransaction({ id: 1, date: '2026-01-22', amount: -39.57, description: 'NETFLIX.COM', type: 'expense', company_id: null });
  db.addTransaction({ id: 2, date: '2026-02-22', amount: -39.57, description: 'NETFLIX.COM', type: 'expense', company_id: null });
  db.addTransaction({ id: 3, date: '2026-03-22', amount: -39.57, description: 'NETFLIX.COM', type: 'expense', company_id: null });

  // Purchases: merchant-mapped but never a series
  db.addTransaction({ id: 4, date: '2026-01-05', amount: -50.0, description: 'AMAZON MKTPL*B03SZ4DL1', type: 'expense', company_id: null });
  db.addTransaction({ id: 5, date: '2026-01-19', amount: -12.34, description: 'AMAZON MKTPL*QS62Q9G03', type: 'expense', company_id: null });
  db.addTransaction({ id: 6, date: '2026-02-02', amount: -73.99, description: 'AMAZON MKTPL*IK7DM4133', type: 'expense', company_id: null });

  // Rule-backed bill with only 2 occurrences -> candidate
  db.addTransaction({ id: 7, date: '2026-02-25', amount: -162.32, description: 'BREEZELINE', type: 'expense', company_id: null });
  db.addTransaction({ id: 8, date: '2026-03-25', amount: -162.32, description: 'BREEZELINE', type: 'expense', company_id: null });

  // Unmatched, regular, stable -> heuristic candidate
  db.addTransaction({ id: 9, date: '2026-01-10', amount: -53.48, description: 'TST* PELOTON CYCLE STUDIO', type: 'expense', company_id: null });
  db.addTransaction({ id: 10, date: '2026-02-10', amount: -53.48, description: 'TST* PELOTON CYCLE STUDIO', type: 'expense', company_id: null });
  db.addTransaction({ id: 11, date: '2026-03-10', amount: -53.48, description: 'TST* PELOTON CYCLE STUDIO', type: 'expense', company_id: null });

  // Unmatched, irregular -> stays an unmatched cluster
  db.addTransaction({ id: 12, date: '2026-01-01', amount: -30.0, description: 'SQ *BLEND CANDLE CO.', type: 'expense', company_id: null });
  db.addTransaction({ id: 13, date: '2026-01-05', amount: -30.0, description: 'SQ *BLEND CANDLE CO.', type: 'expense', company_id: null });
  db.addTransaction({ id: 14, date: '2026-06-20', amount: -30.0, description: 'SQ *BLEND CANDLE CO.', type: 'expense', company_id: null });

  // Manually classified already -> matching must never overwrite
  db.companies.push({ id: 99, name: 'My Grocery' });
  db.addTransaction({ id: 15, date: '2026-03-01', amount: -84.64, description: 'GIANT EAGLE #6507', type: 'expense', company_id: 99 });
}

async function scannedService() {
  const db = new FakeSubscriptionDb();
  seedScenario(db);
  const service = createService(db);
  await service.runSubscriptionScan();
  return { db, service };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DatabaseService merchant rules CRUD', () => {
  it('creates user rules with normalized patterns and user defaults', async () => {
    const db = new FakeSubscriptionDb();
    const service = createService(db);

    const id = await service.addMerchantRule({
      pattern: 'tst* high bank distill',
      match_type: 'prefix',
      merchant_name: 'High Bank Distillery',
      service_name: null,
      default_kind: 'purchase',
    });

    const rule = db.rules.find((candidate) => candidate.id === id);
    expect(rule.pattern).toBe('HIGH BANK DISTILL');
    expect(rule.source).toBe('user');
    expect(rule.rule_key.startsWith('user:')).toBe(true);
    expect(rule.priority).toBe(50);
    expect(rule.user_modified).toBe(1);
  });

  it('rejects rules whose pattern normalizes to nothing', async () => {
    const service = createService(new FakeSubscriptionDb());
    await expect(
      service.addMerchantRule({
        pattern: '   ',
        match_type: 'prefix',
        merchant_name: 'X',
        default_kind: 'purchase',
      })
    ).rejects.toThrow(/pattern/i);
  });

  it('updates rules and marks community rules as user_modified', async () => {
    const db = new FakeSubscriptionDb();
    const rule = db.addRule({
      rule_key: 'community:netflix',
      pattern: 'NETFLIX',
      merchant_name: 'Netflix',
      default_kind: 'subscription',
    });
    const service = createService(db);

    await service.updateMerchantRule(rule.id, {
      pattern: 'NETFLIX',
      match_type: 'prefix',
      priority: 90,
      merchant_name: 'Netflix Inc',
      service_name: 'Netflix',
      default_kind: 'subscription',
      enabled: true,
    });

    expect(rule.merchant_name).toBe('Netflix Inc');
    expect(rule.user_modified).toBe(1);
  });

  it('deletes user rules but only disables community rules', async () => {
    const db = new FakeSubscriptionDb();
    const communityRule = db.addRule({ rule_key: 'community:a', source: 'community', pattern: 'A', merchant_name: 'A' });
    const userRule = db.addRule({ rule_key: 'user:b', source: 'user', pattern: 'B', merchant_name: 'B' });
    const service = createService(db);

    await service.deleteMerchantRule(userRule.id);
    await service.deleteMerchantRule(communityRule.id);
    await service.deleteMerchantRule(9999); // unknown id is a no-op

    expect(db.rules.some((rule) => rule.rule_key === 'user:b')).toBe(false);
    expect(communityRule.enabled).toBe(0);
    expect(communityRule.user_modified).toBe(1);
  });

  it('reads rules, counts, and metadata', async () => {
    const db = new FakeSubscriptionDb();
    db.addRule({ rule_key: 'community:a', source: 'community', pattern: 'A', merchant_name: 'A' });
    db.addRule({ rule_key: 'user:b', source: 'user', pattern: 'B', merchant_name: 'B' });
    const service = createService(db);

    const rules = await service.getMerchantRules();
    expect(rules).toHaveLength(2);
    expect(rules[0].pattern).toBeDefined();

    expect(await service.getMerchantRuleCounts()).toEqual({ community: 1, user: 1 });

    expect(await service.getAppMetadata('missing')).toBeNull();
    await service.setAppMetadata('k', 'v');
    expect(await service.getAppMetadata('k')).toBe('v');

    expect(await service.getMerchantRulesSeedVersion()).toBe(0);
    await service.setAppMetadata(SEED_VERSION_METADATA_KEY, '3');
    expect(await service.getMerchantRulesSeedVersion()).toBe(3);
  });

  it('seeds community rules through the bundled JSON fetch', async () => {
    const db = new FakeSubscriptionDb();
    const service = createService(db);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        table: 'merchant_rules',
        version: 1,
        data: [
          {
            rule_key: 'community:netflix',
            pattern: 'NETFLIX',
            match_type: 'prefix',
            priority: 100,
            merchant_name: 'Netflix',
            service_name: 'Netflix',
            default_kind: 'subscription',
          },
        ],
      }),
    }));

    const result = await service.seedCommunityMerchantRules();
    expect(result.rulesProcessed).toBe(1);
    expect(db.rules).toHaveLength(1);
    expect(await service.getMerchantRulesSeedVersion()).toBe(1);

    // Second call is version-gated
    const second = await service.seedCommunityMerchantRules();
    expect(second.skipped).toBe(true);

    // Forced reseed bypasses the gate
    const forced = await service.seedCommunityMerchantRules(true);
    expect(forced.skipped).toBe(false);
  });
});

describe('DatabaseService.applyMerchantMatching', () => {
  it('assigns merchants only to unmatched transactions', async () => {
    const db = new FakeSubscriptionDb();
    seedScenario(db);
    const service = createService(db);

    const result = await service.applyMerchantMatching();

    // Netflix x3, Amazon x3, Breezeline x2 = 8 matched; clusters unmatched
    expect(result.matched).toBe(8);
    expect(db.companies.map((company) => company.name)).toEqual(
      expect.arrayContaining(['Netflix', 'Amazon', 'Breezeline'])
    );

    const netflixCompany = db.companies.find((company) => company.name === 'Netflix')!;
    expect(db.transactions.find((txn) => txn.id === 1)!.company_id).toBe(netflixCompany.id);

    // Pre-classified transaction untouched
    expect(db.transactions.find((txn) => txn.id === 15)!.company_id).toBe(99);

    // Each merchant resolved to exactly one company
    expect(db.companies.filter((company) => company.name === 'Amazon')).toHaveLength(1);
  });

  it('is a no-op without rules or unmatched transactions', async () => {
    const db = new FakeSubscriptionDb();
    const service = createService(db);
    expect(await service.applyMerchantMatching()).toEqual({ scanned: 0, matched: 0 });
  });
});

describe('DatabaseService.runSubscriptionScan', () => {
  it('creates series for recurring rule groups and heuristic clusters, never purchases', async () => {
    const db = new FakeSubscriptionDb();
    seedScenario(db);
    const service = createService(db);

    const summary = await service.runSubscriptionScan();

    // Netflix (active) + Breezeline (candidate) + heuristic cluster (candidate)
    expect(summary.seriesCreated).toBe(3);
    expect(summary.merchantsMatched).toBe(8);

    const netflix = db.series.find((series) => series.match_key === 'rule:community:netflix')!;
    expect(netflix.status).toBe('active');
    expect(netflix.kind).toBe('subscription');
    expect(netflix.cadence).toBe('monthly');
    expect(netflix.name).toBe('Netflix');

    const breezeline = db.series.find((series) => series.match_key === 'rule:community:breezeline')!;
    expect(breezeline.status).toBe('candidate');
    expect(breezeline.kind).toBe('bill');

    const heuristic = db.series.find((series) => series.match_key === 'desc:PELOTON CYCLE STUDIO')!;
    expect(heuristic.status).toBe('candidate');
    expect(heuristic.name).toBe('Peloton Cycle Studio');

    // No series for Amazon purchases or the irregular candle cluster
    expect(db.series).toHaveLength(3);
    expect(db.links.some((link) => [4, 5, 6].includes(link.transaction_id))).toBe(false);

    // Links: 3 Netflix + 2 Breezeline + 3 heuristic
    expect(summary.transactionsLinked).toBe(8);
  });

  it('is idempotent: a second scan creates nothing new and preserves user status', async () => {
    const db = new FakeSubscriptionDb();
    seedScenario(db);
    const service = createService(db);

    await service.runSubscriptionScan();
    const netflix = db.series.find((series) => series.match_key === 'rule:community:netflix')!;
    netflix.status = 'ignored'; // user decision

    const second = await service.runSubscriptionScan();

    expect(second.seriesCreated).toBe(0);
    expect(second.seriesUpdated).toBe(3);
    expect(second.transactionsLinked).toBe(0);
    expect(second.merchantsMatched).toBe(0);
    expect(netflix.status).toBe('ignored'); // scan never flips user-set status
  });
});

describe('DatabaseService recurring series operations', () => {
  it('returns series with stats and maps rows', async () => {
    const { service } = await scannedService();
    const series = await service.getRecurringSeriesWithStats();

    expect(series).toHaveLength(3);
    const netflix = series.find((item) => item.match_key === 'rule:community:netflix')!;
    expect(netflix.company_name).toBe('Netflix');
    expect(netflix.transaction_count).toBe(3);
    expect(netflix.total_spent).toBeCloseTo(118.71, 2);
  });

  it('surfaces the card from the most recently dated linked transaction', async () => {
    const { db, service } = await scannedService();
    const netflix = db.series.find((series) => series.match_key === 'rule:community:netflix')!;

    const oldCard = db.addCard({ last_four: '1111', nickname: 'Old Visa' });
    const newCard = db.addCard({ last_four: '2222', nickname: null });
    // Transaction 1 (2026-01-22) on the old card, transaction 3 (2026-03-22, latest) on the new one.
    db.transactions.find((txn) => txn.id === 1)!.card_id = oldCard.id;
    db.transactions.find((txn) => txn.id === 3)!.card_id = newCard.id;

    const series = await service.getRecurringSeriesWithStats();
    const netflixWithStats = series.find((item) => item.id === netflix.id)!;

    expect(netflixWithStats.card_last_four).toBe('2222');
    expect(netflixWithStats.card_nickname).toBeNull();
  });

  it('omits the card when no linked transaction has one', async () => {
    const { service } = await scannedService();
    const series = await service.getRecurringSeriesWithStats();
    const netflix = series.find((item) => item.match_key === 'rule:community:netflix')!;

    expect(netflix.card_last_four).toBeUndefined();
    expect(netflix.card_nickname).toBeNull();
  });

  it('filters recurring series stats by transaction date range', async () => {
    const { service } = await scannedService();
    const series = await service.getRecurringSeriesWithStats({
      startDate: '2026-02-01',
      endDate: '2026-02-28',
    });

    const netflix = series.find((item) => item.match_key === 'rule:community:netflix')!;
    expect(netflix.transaction_count).toBe(1);
    expect(netflix.total_spent).toBeCloseTo(39.57, 2);
  });

  it('returns transactions by ids for unmatched clusters', async () => {
    const { service } = await scannedService();

    const transactions = await service.getTransactionsByIds([14, 12]);

    expect(transactions.map((txn) => txn.id)).toEqual([14, 12]);
    expect(transactions[0].account_name).toBe('Checking');
  });

  it('returns linked transactions for a series', async () => {
    const { db, service } = await scannedService();
    const netflix = db.series.find((series) => series.match_key === 'rule:community:netflix')!;

    const transactions = await service.getSeriesTransactions(netflix.id);
    expect(transactions.map((txn) => txn.id)).toEqual([3, 2, 1]);
  });

  it('updates series fields and status', async () => {
    const { db, service } = await scannedService();
    const heuristic = db.series.find((series) => series.match_key === 'desc:PELOTON CYCLE STUDIO')!;

    await service.updateRecurringSeries(heuristic.id, {
      name: 'Cycle Studio Membership',
      kind: 'subscription',
      cadence: 'monthly',
      expected_amount: 53.48,
      status: 'active',
      notes: 'Confirmed with gym',
    });
    expect(heuristic.name).toBe('Cycle Studio Membership');
    expect(heuristic.status).toBe('active');

    await service.updateRecurringSeriesStatus(heuristic.id, 'inactive');
    expect(heuristic.status).toBe('inactive');
  });

  it('deletes a series and its links explicitly', async () => {
    const { db, service } = await scannedService();
    const netflix = db.series.find((series) => series.match_key === 'rule:community:netflix')!;

    await service.deleteRecurringSeries(netflix.id);

    expect(db.series.some((series) => series.id === netflix.id)).toBe(false);
    expect(db.links.some((link) => link.series_id === netflix.id)).toBe(false);
    // Other series' links survive
    expect(db.links.length).toBeGreaterThan(0);
  });
});

describe('DatabaseService.setRecurringSeriesCompany', () => {
  it('links a series to an existing company by id without creating a new one', async () => {
    const { db, service } = await scannedService();
    const netflix = db.series.find((series) => series.match_key === 'rule:community:netflix')!;
    const otherCompany = { id: 500, name: 'Airtron Llc' };
    db.companies.push(otherCompany);
    const countBefore = db.companies.length;

    await service.setRecurringSeriesCompany(netflix.id, { companyId: otherCompany.id });

    expect(netflix.company_id).toBe(otherCompany.id);
    expect(db.companies).toHaveLength(countBefore);
  });

  it('creates a new company by name, reusing it case-insensitively on a later call', async () => {
    const { db, service } = await scannedService();
    const heuristic = db.series.find((series) => series.match_key === 'desc:PELOTON CYCLE STUDIO')!;
    const breezeline = db.series.find((series) => series.match_key === 'rule:community:breezeline')!;

    await service.setRecurringSeriesCompany(heuristic.id, { companyName: 'Airtron Llc' });
    const created = db.companies.find((company) => company.name === 'Airtron Llc')!;
    expect(heuristic.company_id).toBe(created.id);

    // "Airtron, Inc" typed with different case/punctuation-adjacent text still
    // resolves case-insensitively to the same company rather than duplicating it.
    await service.setRecurringSeriesCompany(breezeline.id, { companyName: 'airtron llc' });

    expect(breezeline.company_id).toBe(created.id);
    expect(db.companies.filter((company) => company.name.toLowerCase() === 'airtron llc')).toHaveLength(1);
  });

  it('clears a series company when given a null id', async () => {
    const { db, service } = await scannedService();
    const netflix = db.series.find((series) => series.match_key === 'rule:community:netflix')!;
    expect(netflix.company_id).not.toBeNull();

    await service.setRecurringSeriesCompany(netflix.id, { companyId: null });

    expect(netflix.company_id).toBeNull();
  });
});

describe('DatabaseService.getUnmatchedRecurringClusters', () => {
  it('excludes rule-matched and series-linked transactions', async () => {
    const db = new FakeSubscriptionDb();
    seedScenario(db);
    const service = createService(db);

    const before = await service.getUnmatchedRecurringClusters();
    // Before a scan: candle cluster + cycle-studio cluster (both 3 occurrences)
    expect(before.map((cluster) => cluster.normalized_description).sort()).toEqual([
      'BLEND CANDLE CO',
      'PELOTON CYCLE STUDIO',
    ]);

    await service.runSubscriptionScan();

    const after = await service.getUnmatchedRecurringClusters();
    // Cycle studio is now a linked series; candle cluster remains
    expect(after.map((cluster) => cluster.normalized_description)).toEqual(['BLEND CANDLE CO']);
    expect(after[0].occurrences).toBe(3);
    expect(after[0].average_amount).toBeCloseTo(30, 2);
    expect(after[0].transaction_ids).toEqual([12, 13, 14]);
  });
});

describe('DatabaseService.previewMerchantRuleMatches', () => {
  it('counts transactions a candidate pattern would match', async () => {
    const db = new FakeSubscriptionDb();
    seedScenario(db);
    const service = createService(db);

    expect(
      await service.previewMerchantRuleMatches({ pattern: 'NETFLIX', match_type: 'prefix' })
    ).toBe(3);
    expect(
      await service.previewMerchantRuleMatches({ pattern: 'BLEND CANDLE', match_type: 'prefix' })
    ).toBe(3);
    expect(
      await service.previewMerchantRuleMatches({ pattern: '  ', match_type: 'prefix' })
    ).toBe(0);
  });
});
