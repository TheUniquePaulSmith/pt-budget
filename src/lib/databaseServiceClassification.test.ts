import { describe, expect, it, vi } from 'vitest';

import type { AppMetadataService } from './databaseServiceAppMetadata';
import {
  ClassificationService,
  INITIAL_SCAN_METADATA_KEY,
  INITIAL_SCAN_VERSION,
  mapToClassificationRule,
  parseDecisionKey,
  stagedKey,
  storedKey,
} from './databaseServiceClassification';
import { CLASSIFICATION_QUERIES } from './sqlQueriesClassification';
import type { TypeDecision } from '../types/classification';

type Rows = Record<string, unknown[] | ((params?: unknown[]) => unknown[])>;

function createWorker(rowsBySql: Rows = {}) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    const entry = rowsBySql[sql];
    if (typeof entry === 'function') return entry(params);
    return entry ?? [];
  });
  const batchQueryReturning = vi.fn(async (_sql: string, _parameterSets?: unknown[][], _options?: unknown) => [] as unknown[]);
  return { query, batchQueryReturning };
}

function createMetadata(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  } as unknown as AppMetadataService;
}

const ruleRow = {
  id: 5,
  rule_key: 'user:abc',
  source: 'user',
  pattern: 'PYMT BY FUNDS TRANSFER',
  match_type: 'contains',
  priority: 100,
  type: 'transfer',
  account_id: 1,
  counterpart_account_id: 3,
  enabled: 1,
  notes: null,
  created_at: 'now',
  updated_at: 'now',
  account_name: 'Household Checking',
  counterpart_account_name: 'Rewards Visa',
};

const classifiable = (overrides: Record<string, unknown>) => ({
  id: 1,
  account_id: 1,
  account_type: 'checking',
  date: '2026-03-10',
  amount: -500,
  description: 'ROW',
  type: 'expense',
  type_locked: 0,
  type_source: 'sign',
  transfer_group_id: null,
  ...overrides,
});

describe('ClassificationService keys and mapping', () => {
  it('maps rule rows and parses decision keys', () => {
    expect(mapToClassificationRule(ruleRow)).toMatchObject({
      id: 5,
      type: 'transfer',
      account_id: 1,
      counterpart_account_id: 3,
      account_name: 'Household Checking',
      counterpart_account_name: 'Rewards Visa',
    });
    expect(mapToClassificationRule({ ...ruleRow, account_id: null, counterpart_account_id: null, source: 'community' })).toMatchObject({
      source: 'community',
      account_id: null,
      counterpart_account_id: null,
    });
    expect(parseDecisionKey(storedKey(12))).toEqual({ kind: 'tx', id: 12 });
    expect(parseDecisionKey(stagedKey(7))).toEqual({ kind: 'tmp', id: 7 });
    expect(() => parseDecisionKey('nope:1')).toThrow(/Invalid classification key/);
    expect(() => parseDecisionKey('tx:abc')).toThrow(/Invalid classification key/);
  });
});

describe('ClassificationService rules', () => {
  it('lists, creates (normalizing the pattern), updates and deletes rules', async () => {
    const worker = createWorker({
      [CLASSIFICATION_QUERIES.GET_ALL_RULES]: [ruleRow],
      [CLASSIFICATION_QUERIES.CREATE_RULE]: [{ id: 9 }],
    });
    const service = new ClassificationService(worker, createMetadata());

    expect(await service.listRules()).toEqual([mapToClassificationRule(ruleRow)]);

    const id = await service.addRule({
      pattern: 'pymt by funds transfer #4421',
      match_type: 'prefix',
      type: 'transfer',
      account_id: 1,
      counterpart_account_id: 3,
    });
    expect(id).toBe(9);
    const createCall = worker.query.mock.calls.find((call) => call[0] === CLASSIFICATION_QUERIES.CREATE_RULE)!;
    expect(createCall[1]?.[0]).toMatch(/^user:/);
    expect(createCall[1]?.slice(1)).toEqual(['PYMT BY FUNDS TRANSFER', 'prefix', 100, 'transfer', 1, 3, 1, null]);

    // A counterpart only makes sense for transfers; enabled false is stored as 0.
    await service.updateRule(9, {
      pattern: 'Amazon refund',
      match_type: 'contains',
      type: 'refund',
      counterpart_account_id: 3,
      enabled: false,
      priority: 20,
      notes: 'returns',
    });
    expect(worker.query).toHaveBeenCalledWith(CLASSIFICATION_QUERIES.UPDATE_RULE, [
      'AMAZON REFUND',
      'contains',
      20,
      'refund',
      null,
      null,
      0,
      'returns',
      9,
    ]);

    await service.deleteRule(9);
    expect(worker.query).toHaveBeenCalledWith(CLASSIFICATION_QUERIES.DELETE_RULE, [9]);

    await expect(service.addRule({ pattern: '***', match_type: 'contains', type: 'transfer' })).rejects.toThrow(/description pattern/);
    await expect(service.updateRule(1, { pattern: '', match_type: 'contains', type: 'transfer' })).rejects.toThrow(/description pattern/);
  });

  it('previews rule matches against stored rows with scope and sign', async () => {
    const worker = createWorker({
      [CLASSIFICATION_QUERIES.GET_RULE_PREVIEW_ROWS]: [
        { account_id: 1, amount: -500, description: 'PYMT BY FUNDS TRANSFER 1' },
        { account_id: 3, amount: 500, description: 'PYMT BY FUNDS TRANSFER 2' },
        { account_id: 1, amount: -20, description: 'KROGER' },
      ],
    });
    const service = new ClassificationService(worker, createMetadata());

    expect(await service.previewRuleMatches({ pattern: 'pymt by funds', match_type: 'prefix', type: 'transfer' })).toBe(2);
    expect(await service.previewRuleMatches({ pattern: 'pymt by funds', match_type: 'prefix', type: 'transfer', account_id: 3 })).toBe(1);
    expect(await service.previewRuleMatches({ pattern: '   ', match_type: 'prefix', type: 'transfer' })).toBe(0);
  });
});

describe('ClassificationService import preview and decisions', () => {
  it('returns an empty preview when nothing is staged', async () => {
    const service = new ClassificationService(createWorker(), createMetadata());
    const preview = await service.previewImport();
    expect(preview.pairs).toEqual([]);
    expect(preview.summary.stagedRows).toBe(0);
  });

  it('pairs staged rows with existing rows, names the accounts and summarizes', async () => {
    const worker = createWorker({
      [CLASSIFICATION_QUERIES.GET_STAGED_CLASSIFIABLE]: [
        classifiable({ id: 101, account_id: 3, account_type: 'credit', amount: 500, type: 'income', date: '2026-03-11', description: 'PAYMENT - THANK YOU' }),
        classifiable({ id: 102, account_id: 3, account_type: 'credit', amount: 25, type: 'income', date: '2026-03-12', description: 'STORE CREDIT' }),
        classifiable({ id: 103, account_id: 3, account_type: 'credit', amount: -60, type: 'expense', date: '2026-03-12', description: 'KROGER' }),
      ],
      [CLASSIFICATION_QUERIES.STAGED_DATE_RANGE]: [{ min_date: '2026-03-11', max_date: '2026-03-12' }],
      [CLASSIFICATION_QUERIES.GET_CLASSIFIABLE_IN_RANGE]: (params) => {
        // 90 days of history before the file and a week after it.
        expect(params).toEqual(['2025-12-11', '2026-03-19']);
        return [classifiable({ id: 7, account_id: 1, amount: -500, date: '2026-03-10', description: 'PYMT BY FUNDS TRANSFER' })];
      },
      [CLASSIFICATION_QUERIES.GET_ENABLED_RULES]: [],
      [CLASSIFICATION_QUERIES.GET_ACCOUNT_NAMES]: [
        { id: 1, name: 'Household Checking' },
        { id: 3, name: 'Rewards Visa' },
      ],
    });
    const service = new ClassificationService(worker, createMetadata());

    const preview = await service.previewImport();

    expect(preview.pairs).toHaveLength(1);
    expect(preview.pairs[0]).toMatchObject({
      outKey: 'tx:7',
      inKey: 'tmp:101',
      pairId: 'tx:7|tmp:101',
      involvesExisting: true,
      recommended: true,
      out: { id: 7, tempId: null, account_name: 'Household Checking', isNew: false },
      in: { id: null, tempId: 101, account_name: 'Rewards Visa', isNew: true },
    });
    // Paired rows are not in rowDecisions; the refund inference for the staged credit is.
    expect(preview.rowDecisions.map((d) => d.key)).toEqual(['tmp:102']);
    expect(preview.rowDecisions[0]).toMatchObject({ type: 'refund', source: 'inferred' });
    expect(preview.existingDecisions.map((d) => d.key)).toEqual(['tx:7']);
    expect(preview.summary).toEqual({
      stagedRows: 3,
      ruleMatches: 0,
      refundsInferred: 1,
      transfersDetected: 1,
      transfersWithExisting: 1,
      possibleTransfers: 0,
    });

    // The import rebuilds pair decisions from the pairs the user kept.
    const decisions = service.decisionsForPairs(preview.pairs);
    expect(decisions).toHaveLength(2);
    expect(decisions[0].transferGroupId).toBe(decisions[1].transferGroupId);
    expect(decisions.map((d) => d.key).sort()).toEqual(['tmp:101', 'tx:7']);
    expect(decisions.every((d) => d.type === 'transfer' && d.source === 'pair')).toBe(true);
  });

  it('writes staged decisions to the staging table and stored decisions to transactions', async () => {
    const worker = createWorker();
    const service = new ClassificationService(worker, createMetadata());
    const decisions: TypeDecision[] = [
      { key: 'tmp:4', type: 'transfer', source: 'pair', confidence: 0.9, transferGroupId: 'g1', ruleId: null, pairedWithKey: 'tx:9', reasons: [] },
      { key: 'tx:9', type: 'transfer', source: 'pair', confidence: 0.9, transferGroupId: 'g1', ruleId: null, pairedWithKey: 'tmp:4', reasons: [] },
      { key: 'tmp:5', type: 'refund', source: 'inferred', confidence: 0.65, transferGroupId: null, ruleId: null, pairedWithKey: null, reasons: [] },
      { key: 'tx:10', type: 'income', source: 'sign', confidence: null, transferGroupId: null, ruleId: null, pairedWithKey: null, reasons: [] },
    ];

    expect(await service.applyStagedDecisions(decisions)).toBe(2);
    expect(worker.batchQueryReturning).toHaveBeenCalledWith(
      CLASSIFICATION_QUERIES.UPDATE_STAGED_CLASSIFICATION,
      [
        ['transfer', 'g1', 'pair', 0.9, 4],
        ['refund', null, 'inferred', 0.65, 5],
      ],
      { useTransaction: true }
    );

    expect(await service.applyDecisions(decisions)).toBe(2);
    expect(worker.batchQueryReturning).toHaveBeenCalledWith(
      CLASSIFICATION_QUERIES.APPLY_CLASSIFICATION,
      [
        ['transfer', 'g1', 'pair', 0.9, 9],
        ['income', null, 'sign', null, 10],
      ],
      { useTransaction: true }
    );
    // Only transfer decisions with a group reach the locked-transfer statement.
    expect(worker.batchQueryReturning).toHaveBeenCalledWith(
      CLASSIFICATION_QUERIES.SET_TRANSFER_GROUP_ON_LOCKED_TRANSFER,
      [['g1', 9]],
      { useTransaction: true }
    );

    expect(await service.applyStagedDecisions([decisions[1]])).toBe(0);
    expect(await service.applyDecisions([decisions[0]])).toBe(0);
  });
});

describe('ClassificationService scans', () => {
  const scanRows = [
    classifiable({ id: 1, account_id: 1, amount: -500, date: '2026-03-10', description: 'PYMT BY FUNDS TRANSFER' }),
    classifiable({ id: 2, account_id: 3, account_type: 'credit', amount: 500, type: 'income', date: '2026-03-11', description: 'PAYMENT THANK YOU' }),
    classifiable({ id: 3, account_id: 3, account_type: 'credit', amount: 20, type: 'income', date: '2026-03-11', description: 'CREDIT' }),
    classifiable({ id: 4, account_id: 1, amount: -30, date: '2026-03-11', description: 'ZELLE TO SELF' }),
    classifiable({ id: 5, account_id: 1, amount: 40, type: 'refund', type_source: 'inferred', date: '2026-03-11', description: 'OLD GUESS' }),
  ];

  it('runs a full scan, applies every decision and summarizes it', async () => {
    const worker = createWorker({
      [CLASSIFICATION_QUERIES.GET_ALL_CLASSIFIABLE]: scanRows,
      [CLASSIFICATION_QUERIES.GET_ENABLED_RULES]: [{ ...ruleRow, pattern: 'ZELLE TO SELF', account_id: null, counterpart_account_id: null }],
    });
    const service = new ClassificationService(worker, createMetadata());

    const summary = await service.runScan();

    expect(summary).toEqual({ scanned: 5, rulesApplied: 1, transfersPaired: 1, refundsInferred: 1, reverted: 1 });
    const applied = worker.batchQueryReturning.mock.calls.find((call) => call[0] === CLASSIFICATION_QUERIES.APPLY_CLASSIFICATION)!;
    const byId = new Map((applied[1] ?? []).map((params) => [params[4], params]));
    expect(byId.get(1)?.slice(0, 3)).toEqual(['transfer', expect.any(String), 'pair']);
    expect(byId.get(2)?.[1]).toBe(byId.get(1)?.[1]);
    expect(byId.get(3)?.slice(0, 3)).toEqual(['refund', null, 'inferred']);
    expect(byId.get(4)?.slice(0, 3)).toEqual(['transfer', null, 'rule']);
    expect(byId.get(5)?.slice(0, 3)).toEqual(['income', null, 'sign']);
  });

  it('runs the initial scan once per database', async () => {
    const worker = createWorker({ [CLASSIFICATION_QUERIES.GET_ALL_CLASSIFIABLE]: [], [CLASSIFICATION_QUERIES.GET_ENABLED_RULES]: [] });
    const metadata = createMetadata();
    const service = new ClassificationService(worker, metadata);

    const first = await service.runInitialScanIfNeeded();
    expect(first).toEqual({ scanned: 0, rulesApplied: 0, transfersPaired: 0, refundsInferred: 0, reverted: 0 });
    expect(metadata.set).toHaveBeenCalledWith(INITIAL_SCAN_METADATA_KEY, INITIAL_SCAN_VERSION);

    expect(await service.runInitialScanIfNeeded()).toBeNull();
    expect(worker.query.mock.calls.filter((call) => call[0] === CLASSIFICATION_QUERIES.GET_ALL_CLASSIFIABLE)).toHaveLength(1);
  });
});

describe('ClassificationService manual decisions', () => {
  const linkRows: Record<number, Record<string, unknown>> = {
    1: { id: 1, account_id: 1, amount: -500, date: '2026-03-10', type: 'expense', type_locked: 0, transfer_group_id: 'old-a' },
    2: { id: 2, account_id: 3, amount: 500, date: '2026-03-11', type: 'income', type_locked: 0, transfer_group_id: null },
    3: { id: 3, account_id: 1, amount: 500, date: '2026-03-11', type: 'income', type_locked: 0, transfer_group_id: null },
    4: { id: 4, account_id: 2, amount: -500, date: '2026-03-11', type: 'expense', type_locked: 0, transfer_group_id: null },
  };

  function linkWorker() {
    return createWorker({
      [CLASSIFICATION_QUERIES.GET_LINK_ROW]: (params) => {
        const found = linkRows[Number(params?.[0])];
        return found ? [found] : [];
      },
      [CLASSIFICATION_QUERIES.COUNT_NEEDS_REVIEW]: [{ count: 3 }],
      [CLASSIFICATION_QUERIES.GET_TRANSFER_CANDIDATES]: [
        { id: 2, account_id: 3, account_name: 'Rewards Visa', date: '2026-03-11', amount: 500, description: 'PAYMENT', type: 'income', type_locked: 0, transfer_group_id: null },
        { id: 8, account_id: 2, account_name: 'Savings', date: '2026-03-06', amount: 480, description: 'DEPOSIT', type: 'income', type_locked: 0, transfer_group_id: 'g9' },
      ],
    });
  }

  it('links two legs inside one transaction, undoing earlier pairings first', async () => {
    const worker = linkWorker();
    const service = new ClassificationService(worker, createMetadata());

    await service.linkTransfer(1, 2);

    const issued = worker.query.mock.calls.map((call) => call[0]);
    const begin = issued.indexOf('BEGIN TRANSACTION');
    expect(begin).toBeGreaterThan(-1);
    expect(issued.slice(begin)).toEqual([
      'BEGIN TRANSACTION',
      CLASSIFICATION_QUERIES.CLEAR_TRANSFER_GROUP,
      CLASSIFICATION_QUERIES.LINK_TRANSFER_LEG,
      CLASSIFICATION_QUERIES.LINK_TRANSFER_LEG,
      'COMMIT',
    ]);
    expect(worker.query).toHaveBeenCalledWith(CLASSIFICATION_QUERIES.CLEAR_TRANSFER_GROUP, ['old-a']);
    const legCalls = worker.query.mock.calls.filter((call) => call[0] === CLASSIFICATION_QUERIES.LINK_TRANSFER_LEG);
    expect(legCalls[0][1]?.[0]).toBe(legCalls[1][1]?.[0]);
    expect(legCalls.map((call) => call[1]?.[1])).toEqual([1, 2]);
  });

  it('refuses to link the same row, the same account, or the same direction', async () => {
    const service = new ClassificationService(linkWorker(), createMetadata());
    await expect(service.linkTransfer(1, 1)).rejects.toThrow(/two different transactions/);
    await expect(service.linkTransfer(1, 3)).rejects.toThrow(/different accounts/);
    await expect(service.linkTransfer(1, 4)).rejects.toThrow(/money out and the other money in/);
    await expect(service.linkTransfer(1, 99)).rejects.toThrow(/was not found/);
  });

  it('rolls back when a leg cannot be written', async () => {
    const worker = linkWorker();
    worker.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql === CLASSIFICATION_QUERIES.GET_LINK_ROW) return [linkRows[Number(params?.[0])]];
      if (sql === CLASSIFICATION_QUERIES.LINK_TRANSFER_LEG) throw new Error('locked');
      return [];
    });
    const service = new ClassificationService(worker, createMetadata());
    await expect(service.linkTransfer(2, 4)).rejects.toThrow('locked');
    expect(worker.query.mock.calls.map((call) => call[0])).toContain('ROLLBACK');
  });

  it('unlinks, confirms, counts reviews and lists candidates with gap and amount match', async () => {
    const worker = linkWorker();
    const service = new ClassificationService(worker, createMetadata());

    await service.unlinkTransfer(1);
    expect(worker.query).toHaveBeenCalledWith(CLASSIFICATION_QUERIES.CLEAR_TRANSFER_GROUP, ['old-a']);
    await service.unlinkTransfer(2); // no group: nothing to clear
    expect(worker.query.mock.calls.filter((call) => call[0] === CLASSIFICATION_QUERIES.CLEAR_TRANSFER_GROUP)).toHaveLength(1);

    await service.confirmType(2);
    expect(worker.query).toHaveBeenCalledWith(CLASSIFICATION_QUERIES.CONFIRM_TYPE, [2]);

    expect(await service.countNeedsReview()).toBe(3);

    const candidates = await service.getTransferCandidates(1);
    expect(worker.query).toHaveBeenCalledWith(CLASSIFICATION_QUERIES.GET_TRANSFER_CANDIDATES, [
      1, -500, -500, '2026-03-10', '2026-03-10', 500, '2026-03-10',
    ]);
    expect(candidates).toEqual([
      expect.objectContaining({ id: 2, account_name: 'Rewards Visa', dateGapDays: 1, amountMatches: true }),
      expect.objectContaining({ id: 8, dateGapDays: -4, amountMatches: false, transfer_group_id: 'g9' }),
    ]);
  });
});
