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
 * FOUNDATION STATE (Import Wizard program). Layouts, identifiers, account
 * resolution, staging and commit work end to end. Still to do, by the import
 * data agent: the commit is not yet one transaction, excluding an in-file
 * duplicate does not re-seed the kept copies, unknown values carry no name
 * hints, account coverage is empty, and batch impact / undo throw
 * IMPORTS_NOT_IMPLEMENTED. Method signatures are part of the frozen contract.
 */

import type { AccountIdentifier, AccountIdentifierInput, ImportBatch } from '../types/database';
import type { TypeDecision } from '../types/classification';
import type { DatabaseWorkerTransport } from './databaseService';
import { logger } from './logging';
import { IMPORT_BATCH_QUERIES, TRANSACTION_QUERIES } from './sqlQueries';
import { IMPORT_QUERIES } from './sqlQueriesImports';
import { extractDigitsValue, extractLastFourValue } from './statementImport/shared/accountText';
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

/** The classification writes a commit performs (ClassificationService satisfies it). */
export interface ImportClassificationPort {
  applyStagedDecisions(decisions: TypeDecision[]): Promise<number>;
  applyDecisions(decisions: TypeDecision[]): Promise<number>;
}

export const IMPORTS_NOT_IMPLEMENTED = 'IMPORTS_NOT_IMPLEMENTED';

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

export class ImportsService {
  constructor(
    private readonly worker: ImportsTransport,
    private readonly classification: ImportClassificationPort
  ) {}

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

  async deleteProfile(id: number): Promise<void> {
    await this.worker.query(IMPORT_QUERIES.DELETE_PROFILE, [id]);
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
   * the user for confirmation, and several matches are `ambiguous`.
   */
  async resolveAccounts(
    values: string[],
    options: { profileAccountId?: number | null } = {}
  ): Promise<AccountResolution[]> {
    const resolutions: AccountResolution[] = [];
    for (const value of distinctValues(values)) {
      resolutions.push(await this.resolveAccount(value, options.profileAccountId ?? null));
    }
    return resolutions;
  }

  private async resolveAccount(value: string, profileAccountId: number | null): Promise<AccountResolution> {
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
      if (accountIds.length > 1) {
        return { value, status: 'ambiguous', basis, accountId: null, cardId: null, candidateAccountIds: accountIds };
      }
      const card = cards.find((row) => Number(row.account_id) === accountIds[0]);
      return {
        value,
        status: basis === 'fullNumber' ? 'recognised' : 'assumed',
        basis,
        accountId: accountIds[0],
        cardId: card ? Number(card.card_id) : null,
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
    return { value, status: 'unknown', basis: null, accountId: null, cardId: null, candidateAccountIds: [] };
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
   */
  async commitStaged(input: CommitInput): Promise<CommitResult> {
    const operation = log.withOperation('commitStaged');
    try {
      const excluded = input.excludedTempIds.filter((id) => Number.isInteger(id));
      if (excluded.length > 0) {
        await this.worker.query(
          TRANSACTION_QUERIES.DELETE_TEMP_TRANSACTIONS_BY_IDS.replace('__IDS__', excluded.join(','))
        );
      }
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
      await this.classification.applyStagedDecisions(input.stagedDecisions);
      await this.worker.query(TRANSACTION_QUERIES.BULK_INSERT_FROM_TEMP, [batchId]);
      const inserted = Number((await this.worker.query('SELECT changes() as count'))[0]?.count ?? 0);
      await this.classification.applyDecisions(input.existingDecisions);

      await this.worker.query(IMPORT_BATCH_QUERIES.FINALIZE, [
        inserted,
        duplicates,
        input.skippedRows,
        input.rejectedRows,
        batchId,
      ]);
      operation.info('Imported statement file', { batchId, inserted, duplicates, format: input.format });
      return { batchId, inserted, duplicates };
    } catch (error) {
      operation.error('Failed to import statement file', { error });
      throw error;
    } finally {
      await this.discardStaged().catch(() => undefined);
    }
  }

  // --- history ---

  /** Import runs, newest first, with the name of the layout each was read with. */
  async listImportBatches(limit = 50): Promise<ImportBatch[]> {
    return (await this.worker.query(IMPORT_QUERIES.LIST_BATCHES, [limit])).map(mapToImportBatch);
  }

  /** What is already stored for these accounts, for the coverage findings. Not built yet. */
  async getAccountCoverage(accountIds: number[]): Promise<AccountCoverage[]> {
    void accountIds;
    return [];
  }

  /** What undoing a batch would remove. Not built yet. */
  async getBatchImpact(batchId: number): Promise<ImportBatchImpact> {
    void batchId;
    throw new Error(IMPORTS_NOT_IMPLEMENTED);
  }

  /** Removes a batch and everything it imported. Not built yet. */
  async undoBatch(batchId: number): Promise<ImportBatchImpact> {
    void batchId;
    throw new Error(IMPORTS_NOT_IMPLEMENTED);
  }
}

function distinctValues(values: string[]): string[] {
  return [...new Set(values)];
}
