import type { DatabaseWorkerTransport } from './databaseService';
import type { AppMetadataService } from './databaseServiceAppMetadata';
import { CLASSIFICATION_QUERIES } from './sqlQueriesClassification';
import {
  classifyTransactions,
  countClassificationRuleMatches,
  dayGap,
  DEFAULT_TRANSFER_WINDOW_DAYS,
  REFUND_LOOKBACK_DAYS,
} from './transactionClassifier';
import { normalizeDescription } from './merchantMatchingService';
import { addDaysISO } from './dateOnly';
import { logger } from './logging';
import type {
  ClassificationRule,
  ClassificationRuleInput,
  MerchantRuleMatchType,
  TransactionType,
} from '../types/database';
import type {
  ClassifiableTransaction,
  ClassificationScanSummary,
  ImportClassificationPreview,
  TransferCandidate,
  TransferLegSummary,
  TransferPairPreview,
  TypeDecision,
} from '../types/classification';

type ClassificationTransport = Pick<DatabaseWorkerTransport, 'query' | 'batchQueryReturning'>;

/** app_metadata key: set once the one-time scan of pre-v4 data has run. */
export const INITIAL_SCAN_METADATA_KEY = 'classification.initial_scan_version';
export const INITIAL_SCAN_VERSION = '1';

const log = logger.child({ component: 'ClassificationService' });

export function mapToClassificationRule(row: any): ClassificationRule {
  return {
    id: Number(row.id),
    rule_key: String(row.rule_key),
    source: row.source === 'community' ? 'community' : 'user',
    pattern: String(row.pattern),
    match_type: row.match_type as MerchantRuleMatchType,
    priority: Number(row.priority ?? 100),
    type: row.type as TransactionType,
    account_id: row.account_id == null ? null : Number(row.account_id),
    counterpart_account_id: row.counterpart_account_id == null ? null : Number(row.counterpart_account_id),
    enabled: Number(row.enabled ?? 1),
    notes: row.notes ?? null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
    account_name: row.account_name ?? null,
    counterpart_account_name: row.counterpart_account_name ?? null,
  };
}

/** `tx:<id>` for stored rows, `tmp:<id>` for staged import rows. */
export const storedKey = (id: number) => `tx:${id}`;
export const stagedKey = (tempId: number) => `tmp:${tempId}`;

export function parseDecisionKey(key: string): { kind: 'tx' | 'tmp'; id: number } {
  const [kind, id] = key.split(':');
  if ((kind !== 'tx' && kind !== 'tmp') || !/^\d+$/.test(id ?? '')) {
    throw new Error(`Invalid classification key: ${key}`);
  }
  return { kind, id: Number(id) };
}

function mapStoredRow(row: any): ClassifiableTransaction {
  return {
    key: storedKey(Number(row.id)),
    id: Number(row.id),
    tempId: null,
    account_id: Number(row.account_id),
    account_type: row.account_type,
    date: String(row.date),
    amount: Number(row.amount),
    description: String(row.description ?? ''),
    type: row.type,
    type_locked: Number(row.type_locked ?? 0) === 1,
    type_source: row.type_source ?? 'sign',
    transfer_group_id: row.transfer_group_id ?? null,
  };
}

function mapStagedRow(row: any): ClassifiableTransaction {
  return {
    key: stagedKey(Number(row.id)),
    id: null,
    tempId: Number(row.id),
    account_id: Number(row.account_id),
    account_type: row.account_type,
    date: String(row.date),
    amount: Number(row.amount),
    description: String(row.description ?? ''),
    type: row.type,
    type_locked: false,
    type_source: row.type_source ?? 'sign',
    transfer_group_id: row.transfer_group_id ?? null,
  };
}

function newGroupId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Transaction classification (schema v4): description rules, transfer
 * pairing and refund inference, applied to a staged CSV import before it
 * lands or to the stored rows on demand. Decisions never override a type the
 * user chose (type_locked); confirming or re-typing a row locks it.
 */
export class ClassificationService {
  constructor(
    private readonly worker: ClassificationTransport,
    private readonly appMetadata: AppMetadataService
  ) {}

  // --- rules ---

  async listRules(): Promise<ClassificationRule[]> {
    const rows = await this.worker.query(CLASSIFICATION_QUERIES.GET_ALL_RULES);
    return rows.map(mapToClassificationRule);
  }

  async addRule(input: ClassificationRuleInput): Promise<number> {
    const pattern = normalizeDescription(input.pattern);
    if (!pattern) throw new Error('A rule needs a description pattern');
    const rows = await this.worker.query(CLASSIFICATION_QUERIES.CREATE_RULE, [
      `user:${newGroupId()}`,
      pattern,
      input.match_type,
      input.priority ?? 100,
      input.type,
      input.account_id ?? null,
      input.type === 'transfer' ? (input.counterpart_account_id ?? null) : null,
      input.enabled === undefined ? 1 : Number(Boolean(input.enabled)),
      input.notes ?? null,
    ]);
    return Number(rows[0].id);
  }

  async updateRule(id: number, input: ClassificationRuleInput): Promise<void> {
    const pattern = normalizeDescription(input.pattern);
    if (!pattern) throw new Error('A rule needs a description pattern');
    await this.worker.query(CLASSIFICATION_QUERIES.UPDATE_RULE, [
      pattern,
      input.match_type,
      input.priority ?? 100,
      input.type,
      input.account_id ?? null,
      input.type === 'transfer' ? (input.counterpart_account_id ?? null) : null,
      input.enabled === undefined ? 1 : Number(Boolean(input.enabled)),
      input.notes ?? null,
      id,
    ]);
  }

  async deleteRule(id: number): Promise<void> {
    await this.worker.query(CLASSIFICATION_QUERIES.DELETE_RULE, [id]);
  }

  /** Dry-run for the rule editor: how many stored rows the rule would type. */
  async previewRuleMatches(rule: {
    pattern: string;
    match_type: MerchantRuleMatchType;
    type: TransactionType;
    account_id?: number | null;
  }): Promise<number> {
    const pattern = normalizeDescription(rule.pattern);
    if (!pattern) return 0;
    const rows = await this.worker.query(CLASSIFICATION_QUERIES.GET_RULE_PREVIEW_ROWS);
    return countClassificationRuleMatches(
      { ...rule, pattern },
      rows.map((row: any) => ({
        account_id: Number(row.account_id),
        amount: Number(row.amount),
        description: String(row.description ?? ''),
      }))
    );
  }

  private async enabledRules(): Promise<ClassificationRule[]> {
    const rows = await this.worker.query(CLASSIFICATION_QUERIES.GET_ENABLED_RULES);
    return rows.map(mapToClassificationRule);
  }

  // --- CSV import ---

  /**
   * Classifies the rows staged in temp_import_transactions against each other
   * and against stored rows around the file's date range. Nothing is written;
   * the import applies the user's choice with applyStagedDecisions /
   * applyDecisions.
   */
  async previewImport(): Promise<ImportClassificationPreview> {
    const stagedRows = (await this.worker.query(CLASSIFICATION_QUERIES.GET_STAGED_CLASSIFIABLE)).map(mapStagedRow);
    const empty: ImportClassificationPreview = {
      pairs: [],
      rowDecisions: [],
      existingDecisions: [],
      summary: {
        stagedRows: 0,
        ruleMatches: 0,
        refundsInferred: 0,
        transfersDetected: 0,
        transfersWithExisting: 0,
        possibleTransfers: 0,
      },
    };
    if (stagedRows.length === 0) return empty;

    const range = (await this.worker.query(CLASSIFICATION_QUERIES.STAGED_DATE_RANGE))[0];
    const existingRows = (
      await this.worker.query(CLASSIFICATION_QUERIES.GET_CLASSIFIABLE_IN_RANGE, [
        addDaysISO(String(range.min_date), -Math.max(REFUND_LOOKBACK_DAYS, DEFAULT_TRANSFER_WINDOW_DAYS)),
        addDaysISO(String(range.max_date), DEFAULT_TRANSFER_WINDOW_DAYS),
      ])
    ).map(mapStoredRow);
    const [rules, accountNames] = await Promise.all([this.enabledRules(), this.accountNames()]);

    const newKeys = new Set(stagedRows.map((row) => row.key));
    const result = classifyTransactions({
      rules,
      rows: [...existingRows, ...stagedRows],
      mode: 'import',
      newKeys,
      newGroupId,
    });

    const rowsByKey = new Map<string, ClassifiableTransaction>();
    for (const row of [...existingRows, ...stagedRows]) rowsByKey.set(row.key, row);
    const leg = (key: string): TransferLegSummary => {
      const row = rowsByKey.get(key)!;
      return {
        key,
        id: row.id,
        tempId: row.tempId,
        account_id: row.account_id,
        account_name: accountNames.get(row.account_id) ?? `Account ${row.account_id}`,
        date: row.date,
        amount: row.amount,
        description: row.description,
        isNew: newKeys.has(key),
      };
    };
    const toPreview = (suggestion: (typeof result.pairs)[number], recommended: boolean): TransferPairPreview => ({
      ...suggestion,
      pairId: `${suggestion.outKey}|${suggestion.inKey}`,
      out: leg(suggestion.outKey),
      in: leg(suggestion.inKey),
      involvesExisting: !newKeys.has(suggestion.outKey) || !newKeys.has(suggestion.inKey),
      recommended,
    });
    const pairs = [
      ...result.pairs.map((pair) => toPreview(pair, true)),
      ...result.possiblePairs.map((pair) => toPreview(pair, false)),
    ];

    const pairedKeys = new Set(result.pairs.flatMap((pair) => [pair.outKey, pair.inKey]));
    const rowDecisions = result.decisions.filter((decision) => newKeys.has(decision.key) && !pairedKeys.has(decision.key));
    const existingDecisions = result.decisions.filter((decision) => !newKeys.has(decision.key));
    // Decisions for paired rows are rebuilt from the pairs the user keeps, so
    // they are not part of rowDecisions; see decisionsForPairs().

    return {
      pairs,
      rowDecisions,
      existingDecisions,
      summary: {
        stagedRows: stagedRows.length,
        ruleMatches: rowDecisions.filter((decision) => decision.source === 'rule').length,
        refundsInferred: rowDecisions.filter((decision) => decision.source === 'inferred').length,
        transfersDetected: result.pairs.length,
        transfersWithExisting: result.pairs.filter(
          (pair) => !newKeys.has(pair.outKey) || !newKeys.has(pair.inKey)
        ).length,
        possibleTransfers: result.possiblePairs.length,
      },
    };
  }

  /** Decisions for the pairs the user kept in the import review (one per leg). */
  decisionsForPairs(pairs: TransferPairPreview[]): TypeDecision[] {
    const decisions: TypeDecision[] = [];
    for (const pair of pairs) {
      const groupId = newGroupId();
      for (const [key, otherKey] of [
        [pair.outKey, pair.inKey],
        [pair.inKey, pair.outKey],
      ] as const) {
        decisions.push({
          key,
          type: 'transfer',
          source: 'pair',
          confidence: pair.confidence,
          transferGroupId: groupId,
          ruleId: null,
          pairedWithKey: otherKey,
          reasons: pair.reasons,
        });
      }
    }
    return decisions;
  }

  /** Writes decisions for staged rows (`tmp:` keys) before the bulk insert copies them over. */
  async applyStagedDecisions(decisions: TypeDecision[]): Promise<number> {
    const parameterSets = decisions
      .filter((decision) => parseDecisionKey(decision.key).kind === 'tmp')
      .map((decision) => [
        decision.type,
        decision.transferGroupId,
        decision.source,
        decision.confidence,
        parseDecisionKey(decision.key).id,
      ]);
    if (parameterSets.length === 0) return 0;
    await this.worker.batchQueryReturning(CLASSIFICATION_QUERIES.UPDATE_STAGED_CLASSIFICATION, parameterSets, {
      useTransaction: true,
    });
    return parameterSets.length;
  }

  /**
   * Writes decisions for stored rows (`tx:` keys). Unlocked rows take the
   * whole decision; a locked transfer only gains the transfer group.
   */
  async applyDecisions(decisions: TypeDecision[]): Promise<number> {
    const stored = decisions.filter((decision) => parseDecisionKey(decision.key).kind === 'tx');
    if (stored.length === 0) return 0;
    const full = stored.map((decision) => [
      decision.type,
      decision.transferGroupId,
      decision.source,
      decision.confidence,
      parseDecisionKey(decision.key).id,
    ]);
    const lockedTransfers = stored
      .filter((decision) => decision.type === 'transfer' && decision.transferGroupId)
      .map((decision) => [decision.transferGroupId, parseDecisionKey(decision.key).id]);
    await this.worker.batchQueryReturning(CLASSIFICATION_QUERIES.APPLY_CLASSIFICATION, full, { useTransaction: true });
    if (lockedTransfers.length > 0) {
      await this.worker.batchQueryReturning(
        CLASSIFICATION_QUERIES.SET_TRANSFER_GROUP_ON_LOCKED_TRANSFER,
        lockedTransfers,
        { useTransaction: true }
      );
    }
    return stored.length;
  }

  // --- on-demand scan ---

  /** Re-classifies every unlocked stored row (rules, pairing, refund inference). */
  async runScan(): Promise<ClassificationScanSummary> {
    const [rows, rules] = await Promise.all([
      this.worker.query(CLASSIFICATION_QUERIES.GET_ALL_CLASSIFIABLE).then((data) => data.map(mapStoredRow)),
      this.enabledRules(),
    ]);
    const result = classifyTransactions({ rules, rows, mode: 'scan', newGroupId });
    await this.applyDecisions(result.decisions);

    const summary: ClassificationScanSummary = {
      scanned: rows.length,
      rulesApplied: result.decisions.filter((decision) => decision.source === 'rule').length,
      transfersPaired: result.pairs.length,
      refundsInferred: result.decisions.filter((decision) => decision.source === 'inferred').length,
      reverted: result.decisions.filter((decision) => decision.source === 'sign').length,
    };
    log.info('Classification scan finished', { operation: 'runScan', ...summary });
    return summary;
  }

  /**
   * Runs the scan once per database so rows that predate schema v4 (or were
   * imported before the detector existed) get typed. Later opens are no-ops.
   */
  async runInitialScanIfNeeded(): Promise<ClassificationScanSummary | null> {
    if ((await this.appMetadata.get(INITIAL_SCAN_METADATA_KEY)) === INITIAL_SCAN_VERSION) return null;
    const summary = await this.runScan();
    await this.appMetadata.set(INITIAL_SCAN_METADATA_KEY, INITIAL_SCAN_VERSION);
    return summary;
  }

  // --- manual decisions ---

  async countNeedsReview(): Promise<number> {
    const rows = await this.worker.query(CLASSIFICATION_QUERIES.COUNT_NEEDS_REVIEW);
    return Number(rows[0]?.count ?? 0);
  }

  /** Keeps the automatic type and marks it as the user's decision. */
  async confirmType(id: number): Promise<void> {
    await this.worker.query(CLASSIFICATION_QUERIES.CONFIRM_TYPE, [id]);
  }

  /**
   * Marks two rows as the legs of one transfer. Both must sit in different
   * accounts and move money in opposite directions; the amounts may differ
   * (fees). Any earlier pairing of either row is undone first.
   */
  async linkTransfer(firstId: number, secondId: number): Promise<void> {
    if (firstId === secondId) throw new Error('A transfer needs two different transactions');
    const [first, second] = await Promise.all([this.linkRow(firstId), this.linkRow(secondId)]);
    if (first.account_id === second.account_id) {
      throw new Error('Both legs of a transfer must be in different accounts');
    }
    if (!(first.amount < 0 && second.amount > 0) && !(first.amount > 0 && second.amount < 0)) {
      throw new Error('One leg must be money out and the other money in');
    }
    const groupId = newGroupId();
    await this.worker.query('BEGIN TRANSACTION');
    try {
      for (const row of [first, second]) {
        if (row.transfer_group_id) {
          await this.worker.query(CLASSIFICATION_QUERIES.CLEAR_TRANSFER_GROUP, [row.transfer_group_id]);
        }
      }
      await this.worker.query(CLASSIFICATION_QUERIES.LINK_TRANSFER_LEG, [groupId, firstId]);
      await this.worker.query(CLASSIFICATION_QUERIES.LINK_TRANSFER_LEG, [groupId, secondId]);
      await this.worker.query('COMMIT');
    } catch (error) {
      await this.worker.query('ROLLBACK');
      log.error('Failed to link transfer', { operation: 'linkTransfer', error });
      throw error;
    }
  }

  /** Separates a row from its counterpart; both keep their current type. */
  async unlinkTransfer(id: number): Promise<void> {
    const row = await this.linkRow(id);
    if (!row.transfer_group_id) return;
    await this.worker.query(CLASSIFICATION_QUERIES.CLEAR_TRANSFER_GROUP, [row.transfer_group_id]);
  }

  /** Opposite-direction rows in other accounts near the row's date, exact amount first. */
  async getTransferCandidates(id: number): Promise<TransferCandidate[]> {
    const row = await this.linkRow(id);
    const rows = await this.worker.query(CLASSIFICATION_QUERIES.GET_TRANSFER_CANDIDATES, [
      row.account_id,
      row.amount,
      row.amount,
      row.date,
      row.date,
      Math.abs(row.amount),
      row.date,
    ]);
    return rows.map((candidate: any) => ({
      id: Number(candidate.id),
      account_id: Number(candidate.account_id),
      account_name: String(candidate.account_name ?? ''),
      date: String(candidate.date),
      amount: Number(candidate.amount),
      description: String(candidate.description ?? ''),
      type: candidate.type as TransactionType,
      type_locked: Number(candidate.type_locked ?? 0),
      transfer_group_id: candidate.transfer_group_id ?? null,
      dateGapDays: dayGap(row.date, String(candidate.date)),
      amountMatches: Math.round(Math.abs(Number(candidate.amount)) * 100) === Math.round(Math.abs(row.amount) * 100),
    }));
  }

  private async linkRow(id: number): Promise<{
    id: number;
    account_id: number;
    amount: number;
    date: string;
    type: TransactionType;
    type_locked: number;
    transfer_group_id: string | null;
  }> {
    const rows = await this.worker.query(CLASSIFICATION_QUERIES.GET_LINK_ROW, [id]);
    const row = rows[0];
    if (!row) throw new Error(`Transaction ${id} was not found`);
    return {
      id: Number(row.id),
      account_id: Number(row.account_id),
      amount: Number(row.amount),
      date: String(row.date),
      type: row.type,
      type_locked: Number(row.type_locked ?? 0),
      transfer_group_id: row.transfer_group_id ?? null,
    };
  }

  private async accountNames(): Promise<Map<number, string>> {
    const rows = await this.worker.query(CLASSIFICATION_QUERIES.GET_ACCOUNT_NAMES);
    return new Map(rows.map((row: any) => [Number(row.id), String(row.name)]));
  }
}
