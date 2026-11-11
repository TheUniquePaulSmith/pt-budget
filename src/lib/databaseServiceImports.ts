/**
 * Statement import (schema v7): the database side of the Import Wizard.
 *
 *   saved layouts        import_profiles: how to read one bank's file shape
 *   account identifiers  account_identifiers: what a file calls an account
 *   resolveAccounts      file value → account (cards, then identifiers, then the layout's account)
 *   stageRows / commit   temp_import_transactions → transactions, one import_batches row per file
 *   history / undo       import_batches
 *
 * The pure pipeline that produces the rows (readers, layout, analysis) is in
 * src/lib/statementImport; this class only talks to SQLite.
 *
 * A commit and an undo are each one BEGIN … COMMIT: a failure leaves the
 * database as it was (no empty batch row, no half-removed import). Inside
 * them every write is this class's own statement (the classification
 * service's writes open transactions of their own, which cannot nest), so the
 * type decisions are written here with the classification SQL.
 */

import type { Account, AccountIdentifier, AccountIdentifierInput, ImportBatch } from '../types/database';
import type { TypeDecision } from '../types/classification';
import type { DatabaseWorkerTransport } from './databaseService';
import { parseDecisionKey } from './databaseServiceClassification';
import { logger } from './logging';
import { CLASSIFICATION_QUERIES, IMPORT_BATCH_QUERIES, TRANSACTION_QUERIES } from './sqlQueries';
import { IMPORT_QUERIES } from './sqlQueriesImports';
import { extractDigitsValue, extractLastFourValue, findTextHintedAccounts } from './statementImport/shared/accountText';
import { isPlaceholderReference } from './statementImport/shared/references';
import type {
  AccountCoverage,
  AccountMatchBasis,
  AccountResolution,
  CommitInput,
  CommitResult,
  ImportBatchImpact,
  ImportProfileConfig,
  ImportProfileInput,
  SavedImportProfile,
  StageResult,
  StagedRowInput,
} from './statementImport/types';
import { computeTransactionHash } from './transactionHash';

type ImportsTransport = Pick<DatabaseWorkerTransport, 'query' | 'batchQueryReturning'>;

/** Thrown by getBatchImpact / undoBatch for an id that is not an import batch. */
export const IMPORT_BATCH_NOT_FOUND = 'IMPORT_BATCH_NOT_FOUND';

const log = logger.child({ component: 'ImportsService' });

const EMPTY_CONFIG: ImportProfileConfig = {
  version: 1,
  layout: { roles: { date: null, description: [] }, dateOrder: 'MDY', decimal: '.', amountSign: 'asIs' },
};

export function mapToSavedImportProfile(row: any): SavedImportProfile {
  let config = EMPTY_CONFIG;
  try {
    const parsed = JSON.parse(String(row.config_json ?? ''));
    if (parsed && typeof parsed === 'object' && parsed.layout) config = parsed as ImportProfileConfig;
  } catch {
    // An unreadable layout behaves like no layout: the wizard detects again.
  }
  return {
    id: Number(row.id),
    name: String(row.name ?? ''),
    format: row.format === 'ofx' ? 'ofx' : 'delimited',
    fingerprint: String(row.fingerprint ?? ''),
    institution: row.institution ?? null,
    account_id: row.account_id == null ? null : Number(row.account_id),
    use_count: Number(row.use_count ?? 0),
    last_used_at: row.last_used_at ?? null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
    account_name: row.account_name ?? null,
    config,
  };
}

export function mapToAccountIdentifier(row: any): AccountIdentifier {
  return {
    id: Number(row.id),
    account_id: Number(row.account_id),
    kind: row.kind === 'label' ? 'label' : 'number',
    value: String(row.value ?? ''),
    last_four: row.last_four ?? null,
    source: row.source === 'manual' ? 'manual' : 'import',
    created_at: String(row.created_at ?? ''),
    ...(row.account_name == null ? {} : { account_name: String(row.account_name) }),
  };
}

export function mapToImportBatch(row: any): ImportBatch {
  return {
    id: Number(row.id),
    imported_at: String(row.imported_at),
    source: row.source,
    file_name: row.file_name ?? null,
    account_ids_json: row.account_ids_json ?? null,
    total_rows: Number(row.total_rows ?? 0),
    inserted_count: Number(row.inserted_count ?? 0),
    duplicate_count: Number(row.duplicate_count ?? 0),
    skipped_count: Number(row.skipped_count ?? 0),
    rejected_count: Number(row.rejected_count ?? 0),
    min_date: row.min_date ?? null,
    max_date: row.max_date ?? null,
    profile_id: row.profile_id == null ? null : Number(row.profile_id),
    file_format: row.file_format ?? null,
    issues_json: row.issues_json ?? null,
    ...(row.profile_name === undefined ? {} : { profile_name: row.profile_name ?? null }),
  };
}

/**
 * How an identifier is stored: a number keeps its digits only (masking
 * characters and separators dropped), a label is trimmed and lower-cased.
 */
export function normalizeIdentifierValue(kind: AccountIdentifier['kind'], value: string): string {
  return kind === 'number' ? extractDigitsValue(value) : value.trim().toLowerCase();
}

const distinct = (ids: number[]): number[] => [...new Set(ids)];

const decisionParams = (decision: TypeDecision, id: number): unknown[] => [
  decision.type,
  decision.transferGroupId,
  decision.source,
  decision.confidence,
  id,
];

/** Parameter sets for the staged rows' decisions (`tmp:` keys). A malformed key throws. */
export function stagedDecisionParams(decisions: TypeDecision[]): unknown[][] {
  return decisions
    .map((decision) => ({ decision, key: parseDecisionKey(decision.key) }))
    .filter(({ key }) => key.kind === 'tmp')
    .map(({ decision, key }) => decisionParams(decision, key.id));
}

/**
 * Parameter sets for the stored rows' decisions (`tx:` keys): unlocked rows
 * take the whole decision, a locked transfer only gains the transfer group
 * (the same two writes as ClassificationService.applyDecisions).
 */
export function storedDecisionParams(decisions: TypeDecision[]): { full: unknown[][]; lockedTransfers: unknown[][] } {
  const stored = decisions
    .map((decision) => ({ decision, key: parseDecisionKey(decision.key) }))
    .filter(({ key }) => key.kind === 'tx');
  return {
    full: stored.map(({ decision, key }) => decisionParams(decision, key.id)),
    lockedTransfers: stored
      .filter(({ decision }) => decision.type === 'transfer' && decision.transferGroupId)
      .map(({ decision, key }) => [decision.transferGroupId, key.id]),
  };
}

export class ImportsService {
  constructor(private readonly worker: ImportsTransport) {}

  /**
   * Runs `work` between BEGIN and COMMIT, rolling back when it throws. The
   * writes inside must not open a transaction of their own (`runEach`).
   */
  private async inTransaction<T>(work: () => Promise<T>): Promise<T> {
    await this.worker.query('BEGIN TRANSACTION');
    try {
      const result = await work();
      await this.worker.query('COMMIT');
      return result;
    } catch (error) {
      await this.worker.query('ROLLBACK').catch((rollbackError) => {
        log.warn('Rollback failed', { operation: 'inTransaction', error: rollbackError });
      });
      throw error;
    }
  }

  /** One statement per parameter set, inside the transaction the caller opened. */
  private async runEach(sql: string, parameterSets: unknown[][]): Promise<void> {
    if (parameterSets.length === 0) return;
    await this.worker.batchQueryReturning(sql, parameterSets as any[][], { useTransaction: false });
  }

  // --- saved layouts ---

  async listProfiles(): Promise<SavedImportProfile[]> {
    return (await this.worker.query(IMPORT_QUERIES.LIST_PROFILES)).map(mapToSavedImportProfile);
  }

  /** Layouts saved for this file shape, most recently used first. */
  async findProfilesByFingerprint(fingerprint: string): Promise<SavedImportProfile[]> {
    if (!fingerprint) return [];
    return (await this.worker.query(IMPORT_QUERIES.FIND_PROFILES_BY_FINGERPRINT, [fingerprint])).map(mapToSavedImportProfile);
  }

  /** Creates a layout, or replaces the one with `id`. Resolves with its id. */
  async saveProfile(input: ImportProfileInput, id?: number): Promise<number> {
    const name = input.name.trim();
    if (!name) throw new Error('IMPORT_PROFILE_NAME_REQUIRED');
    if (!input.fingerprint) throw new Error('IMPORT_PROFILE_FINGERPRINT_REQUIRED');
    const params = [
      name,
      input.format,
      input.fingerprint,
      input.institution?.trim() || null,
      input.account_id ?? null,
      JSON.stringify(input.config),
    ];
    if (id != null) {
      await this.worker.query(IMPORT_QUERIES.UPDATE_PROFILE, [...params, id]);
      return id;
    }
    const rows = await this.worker.query(IMPORT_QUERIES.CREATE_PROFILE, params);
    const createdId = Number(rows[0].id);
    log.withOperation('saveProfile').info('Saved import layout', { id: createdId, format: input.format });
    return createdId;
  }

  /** Counts a use and remembers the account the file went into (null = several). */
  async recordProfileUse(id: number, accountId: number | null): Promise<void> {
    await this.worker.query(IMPORT_QUERIES.RECORD_PROFILE_USE, [accountId, id]);
  }

  /**
   * Deletes a saved layout. The import runs that used it stay in the history
   * without it; that link is cleared here because a reopened database does
   * not enforce the foreign key's ON DELETE SET NULL.
   */
  async deleteProfile(id: number): Promise<void> {
    await this.inTransaction(async () => {
      await this.worker.query(IMPORT_QUERIES.CLEAR_PROFILE_ON_BATCHES, [id]);
      await this.worker.query(IMPORT_QUERIES.DELETE_PROFILE, [id]);
    });
  }

  // --- account identifiers ---

  async listAccountIdentifiers(accountId?: number): Promise<AccountIdentifier[]> {
    const rows =
      accountId == null
        ? await this.worker.query(IMPORT_QUERIES.LIST_IDENTIFIERS)
        : await this.worker.query(IMPORT_QUERIES.LIST_IDENTIFIERS_FOR_ACCOUNT, [accountId]);
    return rows.map(mapToAccountIdentifier);
  }

  /** Remembers what a file calls an account. Adding the same one twice returns the existing row. */
  async addAccountIdentifier(input: AccountIdentifierInput): Promise<number> {
    const value = normalizeIdentifierValue(input.kind, input.value);
    if (!value) throw new Error('ACCOUNT_IDENTIFIER_VALUE_REQUIRED');
    const rows = await this.worker.query(IMPORT_QUERIES.ADD_IDENTIFIER, [
      input.account_id,
      input.kind,
      value,
      input.kind === 'number' && value.length >= 4 ? value.slice(-4) : null,
      input.source ?? 'import',
    ]);
    return Number(rows[0].id);
  }

  async removeAccountIdentifier(id: number): Promise<void> {
    await this.worker.query(IMPORT_QUERIES.DELETE_IDENTIFIER, [id]);
  }

  /**
   * Ties each value a file uses for an account to one of the user's accounts.
   * `''` stands for a file that names no account. Order: full number (cards,
   * then identifiers) → last four → label → the saved layout's account. Only
   * a full-number match is `recognised`; the rest are `assumed` and shown to
   * the user for confirmation. Several matches are `ambiguous`, unless the
   * saved layout's account is one of them: then it is `assumed` on the
   * layout's word (basis `profile`). A value that matches nothing is
   * `unknown`, with the accounts whose name or institution resembles it as
   * candidates.
   */
  async resolveAccounts(
    values: string[],
    options: { profileAccountId?: number | null } = {}
  ): Promise<AccountResolution[]> {
    // Read once per call, and only when some value matched nothing.
    let accounts: Promise<Account[]> | null = null;
    const loadAccounts = () =>
      (accounts ??= this.worker.query(IMPORT_QUERIES.LIST_ACCOUNTS_FOR_HINTS).then((rows) =>
        rows.map(
          (row) => ({ id: Number(row.id), name: String(row.name ?? ''), institution: row.institution ?? null }) as Account
        )
      ));

    const resolutions: AccountResolution[] = [];
    for (const value of distinctValues(values)) {
      resolutions.push(await this.resolveAccount(value, options.profileAccountId ?? null, loadAccounts));
    }
    return resolutions;
  }

  private async resolveAccount(
    value: string,
    profileAccountId: number | null,
    loadAccounts: () => Promise<Account[]>
  ): Promise<AccountResolution> {
    const trimmed = value.trim();
    const digits = extractDigitsValue(trimmed);
    const lastFour = extractLastFourValue(trimmed) || (digits.length >= 4 ? digits.slice(-4) : '');

    const fromMatches = (
      basis: AccountMatchBasis,
      cards: any[],
      identifiers: any[]
    ): AccountResolution | null => {
      const accountIds = distinct([...cards, ...identifiers].map((row) => Number(row.account_id)));
      if (accountIds.length === 0) return null;
      const cardOf = (accountId: number) => {
        const card = cards.find((row) => Number(row.account_id) === accountId);
        return card ? Number(card.card_id) : null;
      };
      if (accountIds.length > 1) {
        // The layout remembers which of them this file shape went into last time.
        if (profileAccountId != null && accountIds.includes(profileAccountId)) {
          return {
            value,
            status: 'assumed',
            basis: 'profile',
            accountId: profileAccountId,
            cardId: cardOf(profileAccountId),
            candidateAccountIds: accountIds,
          };
        }
        return { value, status: 'ambiguous', basis, accountId: null, cardId: null, candidateAccountIds: accountIds };
      }
      return {
        value,
        status: basis === 'fullNumber' ? 'recognised' : 'assumed',
        basis,
        accountId: accountIds[0],
        cardId: cardOf(accountIds[0]),
        candidateAccountIds: accountIds,
      };
    };

    if (digits.length > 4) {
      const match = fromMatches(
        'fullNumber',
        await this.worker.query(IMPORT_QUERIES.FIND_CARDS_BY_FULL_NUMBER, [digits]),
        await this.worker.query(IMPORT_QUERIES.FIND_IDENTIFIERS_BY_VALUE, ['number', digits])
      );
      if (match) return match;
    }
    if (lastFour) {
      const match = fromMatches(
        'lastFour',
        await this.worker.query(IMPORT_QUERIES.FIND_CARDS_BY_LAST_FOUR, [lastFour]),
        await this.worker.query(IMPORT_QUERIES.FIND_IDENTIFIERS_BY_LAST_FOUR, [lastFour])
      );
      if (match) return match;
    }
    if (trimmed) {
      const match = fromMatches(
        'label',
        [],
        await this.worker.query(IMPORT_QUERIES.FIND_IDENTIFIERS_BY_VALUE, ['label', trimmed.toLowerCase()])
      );
      if (match) return match;
    }
    if (profileAccountId != null) {
      return {
        value,
        status: 'assumed',
        basis: 'profile',
        accountId: profileAccountId,
        cardId: null,
        candidateAccountIds: [profileAccountId],
      };
    }
    // Text is too weak to pick an account, but it narrows the list the user chooses from.
    const hinted = trimmed ? findTextHintedAccounts(trimmed, await loadAccounts()) : [];
    return {
      value,
      status: 'unknown',
      basis: null,
      accountId: null,
      cardId: null,
      candidateAccountIds: hinted.map((account) => account.id),
    };
  }

  // --- staging and commit ---

  /**
   * Replaces the staging table with these rows and reports which of them are
   * already stored and which repeat inside the file. Identical rows in one
   * file are all kept by default: the n-th copy carries variation seed n, so
   * it never collides on the unique hash and a later overlapping import
   * matches each stored copy by its seed.
   */
  async stageRows(rows: StagedRowInput[]): Promise<StageResult> {
    await this.discardStaged();
    if (rows.length === 0) return { tempIds: [], alreadyImported: [], duplicateGroups: [] };

    // A reference that repeats within one account in the file does not
    // identify a transaction, so none of those rows carries it.
    const referenceKey = (row: StagedRowInput) => `${row.accountId}\u0000${row.reference}`;
    const referenceCounts = new Map<string, number>();
    const usableReference = (row: StagedRowInput) =>
      row.reference && !isPlaceholderReference(row.reference) ? row.reference : null;
    for (const row of rows) {
      if (usableReference(row)) referenceCounts.set(referenceKey(row), (referenceCounts.get(referenceKey(row)) ?? 0) + 1);
    }

    const seedsByContentHash = new Map<string, number>();
    const rowIndexesByContentHash = new Map<string, number[]>();
    const rowIndexByStagedHash = new Map<string, number>();
    const parameterSets: unknown[][] = [];

    for (const row of rows) {
      const contentHash = await computeTransactionHash(row.accountId, row.date, row.amount, row.description);
      const seed = seedsByContentHash.get(contentHash) ?? 0;
      seedsByContentHash.set(contentHash, seed + 1);
      rowIndexesByContentHash.set(contentHash, [...(rowIndexesByContentHash.get(contentHash) ?? []), row.rowIndex]);
      const stagedHash =
        seed === 0
          ? contentHash
          : await computeTransactionHash(row.accountId, row.date, row.amount, row.description, seed);
      rowIndexByStagedHash.set(stagedHash, row.rowIndex);

      const reference = usableReference(row);
      parameterSets.push([
        row.date,
        row.amount,
        row.description,
        null,
        row.accountId,
        row.cardId,
        null,
        null,
        null,
        null,
        // Refund and transfer typing is the classifier's job; staging only knows the direction.
        row.amount > 0 ? 'income' : 'expense',
        stagedHash,
        reference && (referenceCounts.get(referenceKey(row)) ?? 0) < 2 ? reference : null,
        seed,
      ]);
    }

    const inserted = await this.worker.batchQueryReturning(
      TRANSACTION_QUERIES.INSERT_TEMP_TRANSACTION_RETURNING_ID,
      parameterSets
    );
    const duplicates = await this.worker.query(TRANSACTION_QUERIES.CHECK_DUPLICATES_IN_TEMP);

    return {
      tempIds: inserted.map((row) => Number(row.id)),
      alreadyImported: duplicates
        .map((row) => rowIndexByStagedHash.get(String(row.transaction_hash)))
        .filter((rowIndex): rowIndex is number => rowIndex !== undefined),
      duplicateGroups: [...rowIndexesByContentHash.values()]
        .filter((rowIndexes) => rowIndexes.length > 1)
        .map((rowIndexes) => ({ rowIndexes })),
    };
  }

  /** Empties the staging table (a cancelled wizard, or before the next file). */
  async discardStaged(): Promise<void> {
    await this.worker.query(TRANSACTION_QUERIES.TRUNCATE_IMPORT_TABLE);
  }

  /**
   * Moves the staged rows into `transactions` as one import batch and empties
   * the staging table. Rows already stored are skipped and counted.
   *
   * One transaction: the batch row and its details, the staged type
   * decisions, the insert, the decisions for the existing legs and the totals
   * all land, or none of them does. The staging table is emptied either way.
   */
  async commitStaged(input: CommitInput): Promise<CommitResult> {
    const operation = log.withOperation('commitStaged');
    try {
      // Everything that can be refused or worked out without writing comes first.
      const excluded = distinct(input.excludedTempIds.filter((id) => Number.isInteger(id)));
      const stagedDecisions = stagedDecisionParams(input.stagedDecisions);
      const existingDecisions = storedDecisionParams(input.existingDecisions);
      const reseeds = excluded.length > 0 ? await this.reseedsAfterExclusion(new Set(excluded)) : [];

      const result = await this.inTransaction(async () => {
        if (excluded.length > 0) {
          await this.worker.query(
            TRANSACTION_QUERIES.DELETE_TEMP_TRANSACTIONS_BY_IDS.replace('__IDS__', excluded.join(','))
          );
        }
        await this.runEach(IMPORT_QUERIES.RESEED_STAGED_ROW, reseeds);
        const duplicates = (await this.worker.query(TRANSACTION_QUERIES.CHECK_DUPLICATES_IN_TEMP)).length;

        const batchRows = await this.worker.query(IMPORT_BATCH_QUERIES.CREATE, [
          'csv',
          input.fileName,
          JSON.stringify(input.accountIds),
          input.totalRows,
        ]);
        const batchId = Number(batchRows[0].id);
        await this.worker.query(IMPORT_QUERIES.SET_BATCH_DETAILS, [
          input.profileId,
          input.format,
          JSON.stringify(input.issues),
          batchId,
        ]);

        // The classification decided before the import travels with the staged rows.
        await this.runEach(CLASSIFICATION_QUERIES.UPDATE_STAGED_CLASSIFICATION, stagedDecisions);
        await this.worker.query(TRANSACTION_QUERIES.BULK_INSERT_FROM_TEMP, [batchId]);
        const inserted = Number(
          (await this.worker.query(IMPORT_QUERIES.COUNT_BATCH_TRANSACTIONS, [batchId]))[0]?.count ?? 0
        );
        // The stored leg of a kept transfer pair: an unlocked row takes the whole
        // decision, a locked transfer only gains the group.
        await this.runEach(CLASSIFICATION_QUERIES.APPLY_CLASSIFICATION, existingDecisions.full);
        await this.runEach(
          CLASSIFICATION_QUERIES.SET_TRANSFER_GROUP_ON_LOCKED_TRANSFER,
          existingDecisions.lockedTransfers
        );

        await this.worker.query(IMPORT_BATCH_QUERIES.FINALIZE, [
          inserted,
          duplicates,
          input.skippedRows,
          input.rejectedRows,
          batchId,
        ]);
        return { batchId, inserted, duplicates };
      });
      operation.info('Imported statement file', { ...result, format: input.format });
      return result;
    } catch (error) {
      operation.error('Failed to import statement file', { error });
      throw error;
    } finally {
      await this.discardStaged().catch(() => undefined);
    }
  }

  /**
   * The copies of identical rows that stay after the user left some out take
   * seeds 0, 1, 2… in file order, so a later overlapping import matches each
   * stored copy by its seed. Rows arrive seeded by occurrence, so only a copy
   * whose position among the kept ones changed (an earlier copy was left out)
   * needs a new hash. Returns RESEED_STAGED_ROW parameter sets; writes nothing.
   */
  private async reseedsAfterExclusion(excluded: Set<number>): Promise<unknown[][]> {
    const nextSeedByContentHash = new Map<string, number>();
    const reseeds: unknown[][] = [];
    for (const row of await this.worker.query(IMPORT_QUERIES.GET_STAGED_ROWS)) {
      const id = Number(row.id);
      if (excluded.has(id)) continue;
      const seed = Number(row.hash_variation_seed ?? 0);
      const hashWithSeed = (variationSeed: number) =>
        computeTransactionHash(row.account_id, String(row.date), Number(row.amount), String(row.description), variationSeed);
      // A first copy is staged under the content hash itself.
      const contentHash = seed === 0 ? String(row.transaction_hash) : await hashWithSeed(0);
      const keptPosition = nextSeedByContentHash.get(contentHash) ?? 0;
      nextSeedByContentHash.set(contentHash, keptPosition + 1);
      if (seed === keptPosition) continue;
      reseeds.push([keptPosition === 0 ? contentHash : await hashWithSeed(keptPosition), keptPosition, id]);
    }
    return reseeds;
  }

  // --- history ---

  /** Import runs, newest first, with the name of the layout each was read with. */
  async listImportBatches(limit = 50): Promise<ImportBatch[]> {
    return (await this.worker.query(IMPORT_QUERIES.LIST_BATCHES, [limit])).map(mapToImportBatch);
  }

  /**
   * What is already stored for these accounts, for the coverage findings: one
   * entry per account asked for, in that order. An account with no
   * transactions has null dates and a count of 0.
   */
  async getAccountCoverage(accountIds: number[]): Promise<AccountCoverage[]> {
    const ids = distinct(accountIds.filter((id) => Number.isInteger(id)));
    if (ids.length === 0) return [];
    const rows = await this.worker.query(IMPORT_QUERIES.ACCOUNT_COVERAGE.replace('__IDS__', ids.join(',')));
    const rowByAccount = new Map(rows.map((row) => [Number(row.account_id), row]));
    return ids.map((accountId) => {
      const row = rowByAccount.get(accountId);
      return {
        accountId,
        firstDate: row?.first_date ?? null,
        lastDate: row?.last_date ?? null,
        lastImportThrough: row?.last_import_through ?? null,
        transactionCount: Number(row?.transaction_count ?? 0),
      };
    });
  }

  /**
   * What undoing a batch would remove, for the confirmation: its transactions,
   * how many of them carry something the user added since (a category, a
   * label, a note, a flag, a type they chose), the loan payments linked to
   * them and the transfer pairs they are a leg of.
   */
  async getBatchImpact(batchId: number): Promise<ImportBatchImpact> {
    if (!Number.isInteger(batchId) || (await this.worker.query(IMPORT_QUERIES.GET_BATCH, [batchId])).length === 0) {
      throw new Error(IMPORT_BATCH_NOT_FOUND);
    }
    const row = (await this.worker.query(IMPORT_QUERIES.BATCH_IMPACT, [batchId]))[0] ?? {};
    return {
      batchId,
      transactions: Number(row.transactions ?? 0),
      editedSinceImport: Number(row.edited_since_import ?? 0),
      loanPayments: Number(row.loan_payments ?? 0),
      transferPairs: Number(row.transfer_pairs ?? 0),
    };
  }

  /**
   * The loans that have a payment among the batch's transactions. Ask before
   * `undoBatch`: afterwards each of them needs
   * `databaseService.loans.syncAccountSnapshot`, because the balance written
   * to a linked account still counts the removed payments.
   */
  async getBatchLoanIds(batchId: number): Promise<number[]> {
    if (!Number.isInteger(batchId)) return [];
    return (await this.worker.query(IMPORT_QUERIES.BATCH_LOAN_IDS, [batchId])).map((row) => Number(row.loan_id));
  }

  /**
   * Removes a batch and everything it imported, in one transaction: the
   * series links and loan payments of its transactions, the transactions, and
   * the batch row. The other leg of a transfer it was half of survives
   * unpaired: a leg the pairing had typed goes back to income / expense by
   * its sign, a leg the user typed keeps its type. Resolves with what was
   * removed. The caller refreshes loan balances (`getBatchLoanIds`) and
   * re-runs the subscription scan.
   */
  async undoBatch(batchId: number): Promise<ImportBatchImpact> {
    const operation = log.withOperation('undoBatch');
    try {
      const impact = await this.getBatchImpact(batchId);
      await this.inTransaction(async () => {
        await this.worker.query(IMPORT_QUERIES.DELETE_BATCH_SERIES_LINKS, [batchId]);
        await this.worker.query(IMPORT_QUERIES.DELETE_BATCH_LOAN_PAYMENTS, [batchId]);
        await this.worker.query(IMPORT_QUERIES.REVERT_SURVIVING_PAIRED_LEGS, [batchId, batchId]);
        await this.worker.query(IMPORT_QUERIES.CLEAR_SURVIVING_TRANSFER_GROUPS, [batchId, batchId]);
        await this.worker.query(IMPORT_QUERIES.DELETE_BATCH_TRANSACTIONS, [batchId]);
        await this.worker.query(IMPORT_BATCH_QUERIES.DELETE, [batchId]);
      });
      operation.info('Undid import', { ...impact });
      return impact;
    } catch (error) {
      if (error instanceof Error && error.message === IMPORT_BATCH_NOT_FOUND) {
        // Expected when the import was already undone (another tab, a stale list): the caller tells the user.
        operation.info('Import to undo no longer exists', { batchId });
      } else {
        operation.error('Failed to undo import', { batchId, error });
      }
      throw error;
    }
  }
}

function distinctValues(values: string[]): string[] {
  return [...new Set(values)];
}
