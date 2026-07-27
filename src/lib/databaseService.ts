/**
 * Database Service
 *
 * Simplified database service that directly communicates with the worker
 * without unnecessary intermediate layers.
 */

import { databaseWorkerService } from "./databaseWorkerService";
import type { OpenDatabaseOptions, WorkerStatus } from './databaseWorkerService';
//import { dbLogger } from './logger';
import {
  buildDatabaseStatusFile,
  createDatabaseArchive,
  parseDatabaseArchive,
  type DatabaseVfsSnapshot,
} from './databaseArchive';
import {
  isEncryptedArchive,
  readEncryptedArchiveMeta,
} from './databaseEncryption';
import {
  TRANSACTION_QUERIES,
  CATEGORY_QUERIES,
  COMPANY_QUERIES,
  ACCOUNT_QUERIES,
  ACCOUNT_CARD_QUERIES,
  BUDGET_PLAN_QUERIES,
  INCOME_SOURCE_QUERIES,
  PROJECT_QUERIES,
  USER_QUERIES,
  TRIP_QUERIES,
  ANALYTICS_QUERIES,
  SUBSCRIPTION_QUERIES
} from './sqlQueries';
import {
  Transaction,
  Category,
  Company,
  Account,
  AccountCard,
  BudgetPeriod,
  BudgetPlan,
  BudgetPlanCategory,
  BudgetPlanWithCategories,
  BudgetStatus,
  IncomeSource,
  Project,
  User,
  Trip,
  TransactionQueryParams,
  TransactionScopeFilters,
  TransactionsPaginatedResult,
  DashboardSummary,
  ChartData,
  ProjectCosts,
  MerchantRule,
  MerchantRuleKind,
  MerchantRuleMatchType,
  RecurringSeries,
  RecurringSeriesStatus,
  UnmatchedCluster,
  SubscriptionScanSummary,
} from '../types/database';
import {
  normalizeDescription,
  sortRules,
  matchRule,
} from './merchantMatchingService';
import {
  analyzeRecurrence,
  qualifiesAsSeries,
  type RecurrenceInputTransaction,
} from './recurrenceDetectionService';
import {
  seedMerchantRules,
  SEED_VERSION_METADATA_KEY,
  type SeedMerchantRulesResult,
} from './merchantRulesSeedService';
import type {
  ApplyTransactionClassificationInput,
  ApplyTransactionClassificationsResult,
} from '../types/ai';

export interface DatabaseWorkerTransport {
  initialize(): Promise<unknown>;
  createTables(options?: { ensureIndexes?: boolean }): Promise<unknown>;
  ensureIndexes(): Promise<unknown>;
  query(sql: string, parameters?: any[]): Promise<any[]>;
  queryWithTimeout(sql: string, parameters?: any[], timeoutMs?: number): Promise<any[]>;
  batchQueryReturning(sql: string, parameterSets?: any[][], options?: { useTransaction?: boolean }): Promise<any[]>;
  exec(sql: string): Promise<void>;
  exportDatabaseSnapshot(): Promise<DatabaseVfsSnapshot>;
  importDatabaseSnapshot(snapshot: DatabaseVfsSnapshot): Promise<{
    isSuccessful: boolean;
    sqlResponse?: { error?: string };
  }>;
  // Database create / unlock / lock (VFS-level page encryption)
  createNewDatabase(password: string, filename?: string, options?: OpenDatabaseOptions): Promise<unknown>;
  unlockDatabase(password: string, filename?: string): Promise<unknown>;
  lockDatabase(): Promise<void>;
  changePassword(oldPassword: string, newPassword: string): Promise<void>;
  recreateDatabase(options?: OpenDatabaseOptions): Promise<unknown>;
  isEncryptionReady(): Promise<boolean>;
  verifyCurrentPassword(password: string): Promise<boolean>;
  encryptArchive(archiveBytes: Uint8Array, lastSaveTimestamp: string): Promise<Uint8Array>;
  decryptArchive(encryptedBytes: Uint8Array, password?: string): Promise<Uint8Array>;
  onStatusChange(callback: (status: WorkerStatus) => void): () => void;
  destroy?(): void;
}

export interface DatabaseStatusSummary {
  lastWriteTimestamp: string | null;
  tableStats: Record<string, number>;
}

/**
 * Stages exportDatabase() progresses through. A local, minimal type rather
 * than importing the UI's EncryptionProgressStage union, so this file
 * doesn't depend on a component — callers map these onto their own UI stage
 * type (which may have additional stages like 'flushing'/'uploading').
 */
export type DatabaseExportStage = 'exporting' | 'encrypting';

export interface ExportDatabaseOptions {
  onStage?: (stage: DatabaseExportStage) => void;
}

export class DatabaseService {
  private isInitialized = false;
  public dbExistsBeforeInit = false;

  constructor(
    private readonly workerService: DatabaseWorkerTransport = databaseWorkerService
  ) {}

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Before initializing, check if the database already exists
      console.info("[DB Service] Initializing database service...");
      if (await this.databaseAlreadyExists()) {
        this.dbExistsBeforeInit = true;
      }

      await this.workerService.initialize();
      this.isInitialized = true;
      console.info("[DB Service] Database service initialized successfully");
    } catch (error) {
      console.error(
        "[DB Service] Failed to initialize database service:",
        error
      );
      throw error;
    }
  }

  /** Creates a brand-new encrypted database. Fails if one already exists on this device. */
  async createNewDatabase(password: string, options: OpenDatabaseOptions = {}): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      console.debug('Creating new encrypted database...');
      await this.workerService.createNewDatabase(password, undefined, options);
      console.debug('Database created successfully');
    } catch (error) {
      console.error('Failed to create database:', error);
      throw error;
    }
  }

  /** Unlocks the existing encrypted database on this device with `password`. Throws with a clear message on a wrong password. */
  async unlockDatabase(password: string): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      console.debug('Unlocking database...');
      await this.workerService.unlockDatabase(password);
      console.debug('Database unlocked successfully');
    } catch (error) {
      console.error('Failed to unlock database:', error);
      throw error;
    }
  }

  /** Closes the live connection and forgets the key. Nothing is readable again until unlockDatabase succeeds. */
  async lockDatabase(): Promise<void> {
    await this.workerService.lockDatabase();
  }

  /** Re-encrypts every stored block under a newly-derived key. Throws if `oldPassword` is wrong. */
  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    await this.workerService.changePassword(oldPassword, newPassword);
  }

  async loadDatabaseFromFile(file: File): Promise<void> {
    try {
      console.info("Loading database from file through worker...");

      const arrayBuffer = await file.arrayBuffer();
      const fileData = new Uint8Array(arrayBuffer);

      let plainArchiveBytes: Uint8Array;

      if (isEncryptedArchive(fileData)) {
        console.info("Detected encrypted archive — decrypting...");
        plainArchiveBytes = await this.workerService.decryptArchive(fileData);
      } else {
        throw new Error(
          'Unencrypted archives are no longer supported. ' +
          'Re-export the database with encryption enabled.'
        );
      }

      const { snapshot } = await parseDatabaseArchive(plainArchiveBytes);

      const response = await this.workerService.importDatabaseSnapshot(snapshot);

      if (!response.isSuccessful) {
        throw new Error(
          response.sqlResponse?.error || "Failed to import database"
        );
      }

      console.info("Database loaded successfully from file");
    } catch (error) {
      console.error("Failed to load database from file:", error);
      throw error;
    }
  }

  async exportDatabase(options?: ExportDatabaseOptions): Promise<Uint8Array> {
    try {
      console.info("Exporting database through worker...");
      const databaseStatus = await this.getDatabaseStatus();
      const lastWriteTimestamp =
        databaseStatus.lastWriteTimestamp ?? new Date().toISOString();

      options?.onStage?.('exporting');
      const snapshot = await this.workerService.exportDatabaseSnapshot();
      const exportedAt = new Date().toISOString();

      // Build the inner (plain) ZIP archive — the existing format.
      const innerArchiveBytes = await createDatabaseArchive({
        snapshot,
        status: buildDatabaseStatusFile({
          exportedAt,
          lastWriteTimestamp,
          tableStats: databaseStatus.tableStats,
          snapshot,
        }),
      });

      // Wrap in the encrypted envelope using the worker's stored key.
      options?.onStage?.('encrypting');
      const encryptedBytes = await this.workerService.encryptArchive(
        innerArchiveBytes,
        lastWriteTimestamp
      );

      console.info("Database exported and encrypted successfully");
      return encryptedBytes;
    } catch (error) {
      console.error("Failed to export database:", error);
      throw error;
    }
  }

  async importDatabaseArchiveData(archiveBytes: Uint8Array): Promise<void> {
    let plainArchiveBytes: Uint8Array;

    if (isEncryptedArchive(archiveBytes)) {
      console.info("Detected encrypted archive — decrypting...");
      plainArchiveBytes = await this.workerService.decryptArchive(archiveBytes);
    } else {
      throw new Error(
        'Unencrypted archives are no longer supported. ' +
        'Re-export the database with encryption enabled.'
      );
    }

    const { snapshot } = await parseDatabaseArchive(plainArchiveBytes);
    const response = await this.workerService.importDatabaseSnapshot(snapshot);

    if (!response.isSuccessful) {
      throw new Error(
        response.sqlResponse?.error || 'Failed to import database archive'
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Encryption status
  // ---------------------------------------------------------------------------

  /**
   * Returns `true` when the worker currently holds a page-encryption key
   * (i.e. a database is unlocked). Use this to decide whether to show the
   * password prompt.
   */
  async isEncryptionReady(): Promise<boolean> {
    try {
      return await this.workerService.isEncryptionReady();
    } catch {
      return false;
    }
  }

  /**
   * Returns `true` if `password` can decrypt `archiveBytes`, with no side
   * effects on the worker's cached state. Used to verify a password against
   * a standalone archive (a picked file or cloud download) BEFORE
   * establishing a local encryption header under it — a wrong password must
   * never leave behind a header that blocks a clean retry.
   */
  async canDecryptArchive(archiveBytes: Uint8Array, password: string): Promise<boolean> {
    if (!isEncryptedArchive(archiveBytes)) {
      return false;
    }
    try {
      await this.workerService.decryptArchive(archiveBytes, password);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Checks `password` against the encrypted database's stored verifier,
   * without unlocking anything. Used to confirm a "current password" before
   * accepting a password change.
   */
  async verifyCurrentPassword(password: string): Promise<boolean> {
    try {
      return await this.workerService.verifyCurrentPassword(password);
    } catch {
      return false;
    }
  }

  /**
   * Reads the `lastSaveTimestamp` from an encrypted archive header WITHOUT
   * decrypting the payload.  Used for cloud timestamp comparisons.
   */
  getEncryptedArchiveTimestamp(archiveBytes: Uint8Array): string | null {
    if (!isEncryptedArchive(archiveBytes)) return null;
    try {
      return readEncryptedArchiveMeta(archiveBytes).lastSaveTimestamp;
    } catch {
      return null;
    }
  }

  async getDatabaseStatus(): Promise<DatabaseStatusSummary> {
    const tableStats = await this.getTableStats();
    const tableNames = Object.keys(tableStats);
    let lastWriteTimestamp: string | null = null;

    for (const tableName of tableNames) {
      const tableInfo = await this.workerService.query(
        `PRAGMA table_info("${tableName.replace(/"/g, '""')}")`
      );
      if (!Array.isArray(tableInfo)) {
        continue;
      }

      const columnNames = new Set(
        tableInfo.map((column) => String(column.name))
      );
      const timestampColumns = ['updated_at', 'created_at'].filter((column) =>
        columnNames.has(column)
      );

      if (timestampColumns.length === 0) {
        continue;
      }

      const timestampExpressions = timestampColumns.map(
        (column) => `MAX(${column}) AS ${column}`
      );
      const [timestampRow] = await this.workerService.query(
        `SELECT ${timestampExpressions.join(', ')} FROM "${tableName.replace(/"/g, '""')}"`
      );

      for (const column of timestampColumns) {
        const timestampValue = timestampRow?.[column];
        if (
          typeof timestampValue === 'string' &&
          (!lastWriteTimestamp || timestampValue > lastWriteTimestamp)
        ) {
          lastWriteTimestamp = timestampValue;
        }
      }
    }

    return {
      lastWriteTimestamp,
      tableStats,
    };
  }

  async ensureIndexes(): Promise<void> {
    try {
      await this.workerService.ensureIndexes();
      console.info('Database indexes ensured successfully');
    } catch (error) {
      console.error('Failed to ensure database indexes:', error);
      throw error;
    }
  }

  /** Recreates the schema on the already-unlocked current connection (e.g. after an aborted sample-data import). */
  async clearAndRecreateDatabase(): Promise<void> {
    try {
      console.warn("Clearing corrupted database...");
      await this.workerService.recreateDatabase();
      console.info("Database cleared and recreated successfully");
    } catch (error) {
      console.error("Failed to clear and recreate database:", error);
      throw error;
    }
  }

  /**
   * Checks the out-of-band encryption header database directly, bypassing
   * the worker — its presence is what determines whether this device
   * already has an encrypted database to unlock, vs. needing fresh setup.
   */
  async databaseAlreadyExists(): Promise<boolean> {
    console.info("[DB Service] Checking for existing database...");
    try {
      const databases = await indexedDB.databases();
      const exists = databases.some((db) => db.name === "ptbudgetapp-keys");

      if (exists) {
        const request = window.indexedDB.open("ptbudgetapp-keys");
        const actuallyExists = new Promise<boolean>((resolve) => {
          request.onsuccess = (event) => {
            const target = event.target as IDBRequest | null;
            if (!target) {
              console.warn(
                "[DB Service] IndexedDB onsuccess event.target is null"
              );
              resolve(false);
              return;
            }
            const db = target.result as IDBDatabase;
            if (!db.objectStoreNames.contains("header")) {
              resolve(false);
              return;
            }
            const transaction = db.transaction("header", "readonly");
            const header = transaction.objectStore("header").get("default");
            header.onsuccess = () => {
              resolve(header.result != null);
            };
            header.onerror = () => {
              console.warn("[DB Service] Error reading encryption header store");
              resolve(false);
            };
          };
          request.onerror = () => {
            console.warn("[DB Service] Error opening encryption header database");
            resolve(false);
          };
        });
        return (await actuallyExists) || false;
      }
      //Does not exist
      return false;
    } catch (error) {
      console.error("Failed to check for existing database:", error);
      return false;
    }
  }

  getWorkerService() {
    return this.workerService;
  }



  // Transaction operations
  async addTransaction(
    transaction: Omit<Transaction, "id" | "created_at" | "updated_at" | "card_id"> & { card_id?: number | null }
  ): Promise<string> {
    try {
      const hash = this.generateTransactionHash(transaction);

      // Check for duplicate
      const existingCount = await this.workerService.query(
        TRANSACTION_QUERIES.CHECK_HASH_EXISTS,
        [hash]
      );
      if (existingCount[0]?.count > 0) {
        throw new Error("Duplicate transaction detected");
      }

      const result = await this.workerService.query(
        TRANSACTION_QUERIES.CREATE,
        [
          transaction.date,
          transaction.amount,
          transaction.description,
          transaction.comment || null,
          transaction.account_id,
          transaction.card_id || null,
          transaction.category_id || null,
          transaction.company_id || null,
          transaction.project_id || null,
          transaction.trip_id || null,
          transaction.type,
          hash,
        ]
      );

      return result[0].id.toString();
    } catch (error) {
      console.error("Failed to add transaction:", error);
      throw error;
    }
  }

  async getAllTransactionHashes(): Promise<string[]> {
    try {
      const rows = await this.workerService.query(
        TRANSACTION_QUERIES.GET_ALL_HASHES
      );
      return rows.map(row => row.transaction_hash);
    } catch (error) {
      console.error("Failed to get all transaction hashes:", error);
      throw error;
    }
  }

  async truncateImportTable(): Promise<void> {
    try {
      await this.workerService.query(TRANSACTION_QUERIES.TRUNCATE_IMPORT_TABLE);
    } catch (error) {
      console.error("Failed to truncate import table:", error);
      throw error;
    }
  }

  async insertIntoTempTable(
    transactions: Array<Omit<Transaction, "id" | "created_at" | "updated_at" | "card_id"> & { card_id?: number | null }>
  ): Promise<number[]> {
    try {
      if (transactions.length === 0) {
        return [];
      }

      // One transaction, one compiled statement, RETURNING id per row — instead
      // of a per-row INSERT plus a per-row `SELECT last_insert_rowid()`
      // round-trip (each its own implicit transaction = one encrypted IndexedDB
      // flush). The returned ids stay positionally aligned with `transactions`,
      // which csvImportService.buildDuplicateGroups depends on.
      const parameterSets = transactions.map((transaction) => [
        transaction.date,
        transaction.amount,
        transaction.description,
        transaction.comment || null,
        transaction.account_id,
        transaction.card_id || null,
        transaction.category_id || null,
        transaction.company_id || null,
        transaction.project_id || null,
        transaction.trip_id || null,
        transaction.type,
        transaction.transaction_hash || null,
      ]);

      const rows = await this.workerService.batchQueryReturning(
        TRANSACTION_QUERIES.INSERT_TEMP_TRANSACTION_RETURNING_ID,
        parameterSets
      );

      return rows.map((row) => row.id as number);
    } catch (error) {
      console.error("Failed to insert into temp table:", error);
      throw error;
    }
  }

    private async getTableStats(): Promise<Record<string, number>> {
      const tableRows = await this.workerService.query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      );
      const tableStats: Record<string, number> = {};

      for (const row of tableRows) {
        const tableName = String(row.name);
        const escapedTableName = tableName.replace(/"/g, '""');
        const countRows = await this.workerService.query(
          `SELECT COUNT(*) AS count FROM "${escapedTableName}"`
        );

        tableStats[tableName] = Number(countRows[0]?.count ?? 0);
      }

      return tableStats;
    }

  async checkDuplicateTransactions(): Promise<string[]> {
    try {
      // Query for existing hashes using EXISTS against temp table
      const rows = await this.workerService.query(TRANSACTION_QUERIES.CHECK_DUPLICATES_IN_TEMP);
      return rows.map(row => row.transaction_hash);
    } catch (error) {
      console.error("Failed to check duplicate transactions:", error);
      throw error;
    }
  }

  async bulkInsertFromTempTable(): Promise<number> {
    try {
      // Insert all non-duplicate transactions from temp table
      await this.workerService.query(TRANSACTION_QUERIES.BULK_INSERT_FROM_TEMP);
      
      // Return count of inserted rows
      const result = await this.workerService.query(
        `SELECT changes() as count`
      );
      return result[0]?.count || 0;
    } catch (error) {
      console.error("Failed to bulk insert from temp table:", error);
      throw error;
    }
  }

  async deleteFromTempTable(tempIds: number[]): Promise<void> {
    try {
      if (tempIds.length === 0) return;
      
      // Build comma-separated list of IDs
      const idsString = tempIds.join(',');
      const deleteQuery = TRANSACTION_QUERIES.DELETE_TEMP_TRANSACTIONS_BY_IDS.replace('__IDS__', idsString);
      
      await this.workerService.query(deleteQuery);
    } catch (error) {
      console.error("Failed to delete from temp table:", error);
      throw error;
    }
  }

  async dropTempImportTable(): Promise<void> {
    try {
      // Clear the temp import table after import
      await this.workerService.query(TRANSACTION_QUERIES.TRUNCATE_IMPORT_TABLE);
    } catch (error) {
      console.error("Failed to clear temp import table:", error);
      // Don't throw on cleanup failure
    }
  }

  async addTransactionsBatch(
    transactions: Array<Omit<Transaction, "id" | "created_at" | "updated_at" | "card_id"> & { card_id?: number | null }>
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    const result = { success: 0, failed: 0, errors: [] as string[] };

    for (const transaction of transactions) {
      try {
        await this.addTransaction(transaction);
        result.success++;
      } catch (error) {
        result.failed++;
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(errorMsg);
      }
    }

    return result;
  }

  async getTransactions(): Promise<Transaction[]> {
    try {
      const rows = await this.workerService.query(
        TRANSACTION_QUERIES.GET_ALL
      );
      return rows.map(this.mapToTransaction);
    } catch (error) {
      console.error("Failed to get transactions:", error);
      throw error;
    }
  }

  async getRecentTransactions(limit: number, filters?: TransactionScopeFilters): Promise<Transaction[]> {
    try {
      const { where, params } = this.buildTransactionScopeWhereClause(filters);
      const sql = `
        SELECT ${this.TRANSACTION_SELECT}
        FROM transactions t
        ${this.TRANSACTION_JOINS}
        ${where}
        ORDER BY t.date DESC, t.id DESC
        LIMIT ?
      `;
      const rows = await this.workerService.query(
        sql,
        [...params, limit]
      );
      return rows.map(this.mapToTransaction);
    } catch (error) {
      console.error("Failed to get recent transactions:", error);
      throw error;
    }
  }

  private readonly ALLOWED_SORT_COLUMNS: Record<string, string> = {
    date: 't.date',
    amount: 't.amount',
    description: 't.description',
    category_name: 'c.name',
    company_name: 'comp.name',
    account_name: 'a.name',
    effective_user_name: 'effective_user_name',
  };

  private buildTransactionWhereClause(params: TransactionQueryParams): { where: string; params: any[] } {
    const conditions: string[] = [];
    const queryParams: any[] = [];

    if (params.search) {
      conditions.push('(t.description LIKE ? OR c.name LIKE ? OR comp.name LIKE ?)');
      const pattern = `%${params.search}%`;
      queryParams.push(pattern, pattern, pattern);
    }
    if (params.type) {
      conditions.push('t.type = ?');
      queryParams.push(params.type);
    }
    if (params.categoryIds && params.categoryIds.length > 0) {
      conditions.push(`t.category_id IN (${params.categoryIds.map(() => '?').join(',')})`);
      queryParams.push(...params.categoryIds);
    }
    if (params.companyIds && params.companyIds.length > 0) {
      conditions.push(`t.company_id IN (${params.companyIds.map(() => '?').join(',')})`);
      queryParams.push(...params.companyIds);
    }
    if (params.projectIds && params.projectIds.length > 0) {
      conditions.push(`t.project_id IN (${params.projectIds.map(() => '?').join(',')})`);
      queryParams.push(...params.projectIds);
    }
    if (params.accountIds && params.accountIds.length > 0) {
      conditions.push(`t.account_id IN (${params.accountIds.map(() => '?').join(',')})`);
      queryParams.push(...params.accountIds);
    }
    if (params.userIds && params.userIds.length > 0) {
      conditions.push(`COALESCE(card.user_id, a.owner_user_id) IN (${params.userIds.map(() => '?').join(',')})`);
      queryParams.push(...params.userIds);
    }
    if (params.startDate) {
      conditions.push('t.date >= ?');
      queryParams.push(params.startDate);
    }
    if (params.endDate) {
      conditions.push('t.date <= ?');
      queryParams.push(params.endDate);
    }
    if (params.minAmount !== undefined) {
      conditions.push('ABS(t.amount) >= ?');
      queryParams.push(params.minAmount);
    }
    if (params.maxAmount !== undefined) {
      conditions.push('ABS(t.amount) <= ?');
      queryParams.push(params.maxAmount);
    }
    if (params.missingCategory) {
      conditions.push('t.category_id IS NULL');
    }
    if (params.missingCompany) {
      conditions.push('t.company_id IS NULL');
    }
    if (params.missingProject) {
      conditions.push('t.project_id IS NULL');
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return { where, params: queryParams };
  }

  private buildTransactionScopeWhereClause(filters?: TransactionScopeFilters): { where: string; params: any[] } {
    const conditions: string[] = [];
    const queryParams: any[] = [];
    if (filters?.accountIds && filters.accountIds.length > 0) {
      conditions.push(`t.account_id IN (${filters.accountIds.map(() => '?').join(',')})`);
      queryParams.push(...filters.accountIds);
    }
    if (filters?.userIds && filters.userIds.length > 0) {
      conditions.push(`COALESCE(card.user_id, a.owner_user_id) IN (${filters.userIds.map(() => '?').join(',')})`);
      queryParams.push(...filters.userIds);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return { where, params: queryParams };
  }

  private buildAnalyticsFilters(sql: string, filters?: TransactionScopeFilters): { joins: string; where: string; params: any[] } {
    const conditions: string[] = [];
    const queryParams: any[] = [];
    const needsCardJoin = !!(filters?.userIds && filters.userIds.length > 0);
    const joins: string[] = [];

    if (needsCardJoin && !sql.includes('accounts a')) {
      joins.push('LEFT JOIN accounts a ON t.account_id = a.id');
    }
    if (needsCardJoin) {
      joins.push('LEFT JOIN account_cards card ON t.card_id = card.id');
    }

    if (filters?.accountIds && filters.accountIds.length > 0) {
      conditions.push(`t.account_id IN (${filters.accountIds.map(() => '?').join(',')})`);
      queryParams.push(...filters.accountIds);
    }
    if (filters?.userIds && filters.userIds.length > 0) {
      conditions.push(`COALESCE(card.user_id, a.owner_user_id) IN (${filters.userIds.map(() => '?').join(',')})`);
      queryParams.push(...filters.userIds);
    }

    return {
      joins: joins.join('\n'),
      where: conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '',
      params: queryParams,
    };
  }

  private applyAnalyticsFilters(sql: string, filters?: TransactionScopeFilters): { sql: string; params: any[] } {
    const analyticsFilters = this.buildAnalyticsFilters(sql, filters);
    return {
      sql: sql
        .replace('/*__FILTER_JOINS__*/', analyticsFilters.joins)
        .replace('/*__FILTERS__*/', analyticsFilters.where),
      params: analyticsFilters.params,
    };
  }

  private readonly TRANSACTION_JOINS = `
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN companies comp ON t.company_id = comp.id
    LEFT JOIN accounts a ON t.account_id = a.id
    LEFT JOIN account_cards card ON t.card_id = card.id
    LEFT JOIN users card_user ON card.user_id = card_user.id
    LEFT JOIN users owner_user ON a.owner_user_id = owner_user.id
    LEFT JOIN transaction_series_links tsl ON tsl.transaction_id = t.id
    LEFT JOIN recurring_series rs ON rs.id = tsl.series_id
    LEFT JOIN merchant_rules service_rule ON service_rule.id = rs.rule_id
    LEFT JOIN projects p ON t.project_id = p.id
    LEFT JOIN trips tr ON t.trip_id = tr.id
  `;

  private readonly TRANSACTION_SELECT = `
    t.*,
    c.name as category_name,
    c.color as category_color,
    c.type as category_type,
    comp.name as company_name,
    a.name as account_name,
    a.type as account_type,
    card.last_four as card_last_four,
    card.nickname as card_nickname,
    COALESCE(card.user_id, a.owner_user_id) as effective_user_id,
    COALESCE(card_user.display_name, owner_user.display_name) as effective_user_name,
    owner_user.display_name as account_owner_name,
    tsl.series_id as series_id,
    rs.name as series_name,
    COALESCE(service_rule.service_name, rs.name) as service_name,
    p.name as project_name,
    tr.name as trip_name
  `;

  async getTransactionsPaginated(params: TransactionQueryParams): Promise<TransactionsPaginatedResult> {
    try {
      const { where, params: filterParams } = this.buildTransactionWhereClause(params);

      const aggregateSql = `
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END) as total_income,
          SUM(CASE WHEN t.type = 'expense' THEN ABS(t.amount) ELSE 0 END) as total_expenses
        FROM transactions t
        ${this.TRANSACTION_JOINS}
        ${where}
      `;
      const [aggregateResult, incomeSourceRows] = await Promise.all([
        this.workerService.query(aggregateSql, filterParams),
        this.workerService.query(INCOME_SOURCE_QUERIES.GET_ALL),
      ]);
      const total = Number(aggregateResult[0]?.total || 0);
      const actualIncome = Number(aggregateResult[0]?.total_income || 0);
      const totalExpenses = Number(aggregateResult[0]?.total_expenses || 0);
      const range = this.getTransactionParamsDateRange(params);
      const expectedIncome = range
        ? this.expectedIncomeForDateRange(incomeSourceRows.map(this.mapToIncomeSource), range.startDate, range.endDate, params)
        : 0;
      const totalIncome = Math.max(actualIncome, expectedIncome);

      const sortCol = this.ALLOWED_SORT_COLUMNS[params.sortBy] ?? 't.date';
      const sortDir = params.sortOrder === 'asc' ? 'ASC' : 'DESC';
      const offset = params.page * params.pageSize;

      const dataSql = `
        SELECT ${this.TRANSACTION_SELECT}
        FROM transactions t
        ${this.TRANSACTION_JOINS}
        ${where}
        ORDER BY ${sortCol} ${sortDir}, t.id ${sortDir}
        LIMIT ? OFFSET ?
      `;
      const rows = await this.workerService.query(dataSql, [...filterParams, params.pageSize, offset]);

      return { data: rows.map(this.mapToTransaction), total, totalIncome, totalExpenses };
    } catch (error) {
      console.error("Failed to get paginated transactions:", error);
      throw error;
    }
  }

  async getTransactionsForExport(params: Omit<TransactionQueryParams, 'page' | 'pageSize'>): Promise<Transaction[]> {
    const MAX_EXPORT = 100000;
    try {
      const { where, params: filterParams } = this.buildTransactionWhereClause({ ...params, page: 0, pageSize: MAX_EXPORT });
      const sortCol = this.ALLOWED_SORT_COLUMNS[params.sortBy] ?? 't.date';
      const sortDir = params.sortOrder === 'asc' ? 'ASC' : 'DESC';

      const sql = `
        SELECT ${this.TRANSACTION_SELECT}
        FROM transactions t
        ${this.TRANSACTION_JOINS}
        ${where}
        ORDER BY ${sortCol} ${sortDir}, t.id ${sortDir}
        LIMIT ${MAX_EXPORT}
      `;
      const rows = await this.workerService.query(sql, filterParams);
      return rows.map(this.mapToTransaction);
    } catch (error) {
      console.error("Failed to get transactions for export:", error);
      throw error;
    }
  }

  async getDashboardSummary(startDate: string, endDate: string, filters?: TransactionScopeFilters): Promise<DashboardSummary> {
    try {
      const dashboardQuery = this.applyAnalyticsFilters(ANALYTICS_QUERIES.DASHBOARD_SUMMARY, filters);
      const [rows, incomeSourceRows] = await Promise.all([
        this.workerService.query(
          dashboardQuery.sql,
          [startDate, endDate, ...dashboardQuery.params]
        ),
        this.workerService.query(INCOME_SOURCE_QUERIES.GET_ALL),
      ]);
      const row = rows[0] || {};
      const actualIncome = Number(row.total_income || 0);
      const totalExpenses = Number(row.total_expenses || 0);
      const expectedIncome = this.expectedIncomeForDateRange(
        incomeSourceRows.map(this.mapToIncomeSource),
        startDate,
        endDate,
        filters
      );
      const totalIncome = Math.max(actualIncome, expectedIncome);
      return {
        totalIncome,
        totalExpenses,
        netIncome: totalIncome - totalExpenses,
        transactionCount: Number(row.transaction_count || 0),
      };
    } catch (error) {
      console.error("Failed to get dashboard summary:", error);
      throw error;
    }
  }

  async getChartData(startDate: string, endDate: string, filters?: TransactionScopeFilters): Promise<ChartData> {
    try {
      const trendStart = new Date(endDate);
      trendStart.setMonth(trendStart.getMonth() - 6);
      const trendStartStr = trendStart.toISOString().split('T')[0];

      const spendingQuery = this.applyAnalyticsFilters(ANALYTICS_QUERIES.SPENDING_BY_CATEGORY, filters);
      const companySpendingQuery = this.applyAnalyticsFilters(ANALYTICS_QUERIES.SPENDING_BY_COMPANY_SERVICE, filters);
      const recurringSpendingQuery = this.applyAnalyticsFilters(ANALYTICS_QUERIES.SPENDING_BY_RECURRING_SERIES, filters);
      const incomeQuery = this.applyAnalyticsFilters(ANALYTICS_QUERIES.INCOME_BY_SOURCE, filters);
      const trendsQuery = this.applyAnalyticsFilters(ANALYTICS_QUERIES.TRENDS_BY_DATE_RANGE, filters);
      const accountQuery = this.applyAnalyticsFilters(ANALYTICS_QUERIES.ACCOUNT_ANALYSIS, filters);

      const [spendingRows, companySpendingRows, recurringSpendingRows, incomeRows, trendRows, accountRows, incomeSourceRows] = await Promise.all([
        this.workerService.query(spendingQuery.sql, [startDate, endDate, ...spendingQuery.params]),
        this.workerService.query(companySpendingQuery.sql, [startDate, endDate, ...companySpendingQuery.params]),
        this.workerService.query(recurringSpendingQuery.sql, [startDate, endDate, ...recurringSpendingQuery.params]),
        this.workerService.query(incomeQuery.sql, [startDate, endDate, ...incomeQuery.params]),
        this.workerService.query(trendsQuery.sql, [trendStartStr, endDate, ...trendsQuery.params]),
        this.workerService.query(accountQuery.sql, [startDate, endDate, ...accountQuery.params]),
        this.workerService.query(INCOME_SOURCE_QUERIES.GET_ALL),
      ]);
      const incomeSources = incomeSourceRows.map(this.mapToIncomeSource);
      const selectedRangeIncomeSources = this.getIncomeSourceChartRows(incomeSources, startDate, endDate, filters);

      const spendingByCategory = spendingRows.map((r: any) => ({
        id: r.category_id,
        label: r.category_name,
        value: Number(r.total),
        color: r.color || '#999',
      }));

      const spendingByCompany = companySpendingRows.map((r: any, index: number) => ({
        id: `${r.company_id}-${r.service_name || 'company'}`,
        label: r.service_name ? `${r.company_name} - ${r.service_name}` : r.company_name,
        value: Number(r.total),
        color: this.chartColor(index),
      }));

      const spendingByRecurring = recurringSpendingRows.map((r: any, index: number) => ({
        id: r.series_id,
        label: `${r.series_name} (${r.kind === 'bill' ? 'Bill' : 'Subscription'})`,
        value: Number(r.total),
        color: this.chartColor(index + 3),
      }));

      const transactionIncomeBySource = incomeRows.map((r: any) => {
        const label = `${r.user_display_name || 'Unknown'} - ${r.account_name} - ${r.category_name || 'Not Defined'}`;
        return {
          id: `${r.account_id}-${r.category_id || 'undefined'}`,
          label,
          value: Number(r.total),
          color: r.category_color || '#4caf50',
        };
      });
      const transactionIncomeTotal = transactionIncomeBySource.reduce((sum, item) => sum + item.value, 0);
      const expectedIncomeTotal = selectedRangeIncomeSources.reduce((sum, item) => sum + item.value, 0);
      const incomeBySource = expectedIncomeTotal > transactionIncomeTotal
        ? selectedRangeIncomeSources
        : transactionIncomeBySource;

      const expectedIncomeByTrendMonth = this.getExpectedIncomeByMonth(incomeSources, trendStartStr, endDate, filters);

      const trends = {
        months: trendRows.map((r: any) => r.month),
        income: trendRows.map((r: any) => Math.max(Number(r.income || 0), Number(expectedIncomeByTrendMonth.get(r.month) || 0))),
        expenses: trendRows.map((r: any) => Number(r.expense || 0)),
      };

      for (const [month, expectedIncome] of expectedIncomeByTrendMonth.entries()) {
        if (!trends.months.includes(month)) {
          trends.months.push(month);
          trends.income.push(expectedIncome);
          trends.expenses.push(0);
        }
      }
      const sortedTrendIndexes = trends.months.map((month, index) => ({ month, index })).sort((a, b) => a.month.localeCompare(b.month));
      const sortedTrends = {
        months: sortedTrendIndexes.map((entry) => trends.months[entry.index]),
        income: sortedTrendIndexes.map((entry) => trends.income[entry.index]),
        expenses: sortedTrendIndexes.map((entry) => trends.expenses[entry.index]),
      };

      const accountAnalysis = this.mergeIncomeSourcesIntoAccountAnalysis(accountRows, incomeSources, startDate, endDate, filters);

      return { spendingByCategory, spendingByCompany, spendingByRecurring, incomeBySource, trends: sortedTrends, accountAnalysis };
    } catch (error) {
      console.error("Failed to get chart data:", error);
      throw error;
    }
  }

  async getAllProjectCosts(): Promise<ProjectCosts[]> {
    try {
      const rows = await this.workerService.query(PROJECT_QUERIES.GET_ALL_COSTS);
      return rows.map((r: any) => ({
        project_id: r.project_id,
        estimated: Number(r.estimated || 0),
        actual: Number(r.actual || 0),
        transactions_total: Number(r.transactions_total || 0),
      }));
    } catch (error) {
      console.error("Failed to get all project costs:", error);
      throw error;
    }
  }

  async getTransactionsByProjectPaginated(
    projectId: number,
    page: number,
    pageSize: number
  ): Promise<{ data: Transaction[]; total: number }> {
    try {
      const countRows = await this.workerService.query(
        TRANSACTION_QUERIES.GET_COUNT_BY_PROJECT,
        [projectId]
      );
      const total = Number(countRows[0]?.total || 0);

      const sql = `
        SELECT ${this.TRANSACTION_SELECT}
        FROM transactions t
        LEFT JOIN categories c ON t.category_id = c.id
        LEFT JOIN companies comp ON t.company_id = comp.id
        LEFT JOIN accounts a ON t.account_id = a.id
        LEFT JOIN projects p ON t.project_id = p.id
        LEFT JOIN trips tr ON t.trip_id = tr.id
        WHERE t.project_id = ?
        ORDER BY t.date DESC, t.id DESC
        LIMIT ? OFFSET ?
      `;
      const rows = await this.workerService.query(sql, [projectId, pageSize, page * pageSize]);
      return { data: rows.map(this.mapToTransaction), total };
    } catch (error) {
      console.error("Failed to get transactions by project paginated:", error);
      throw error;
    }
  }

  async getTransactionsByTripPaginated(
    tripId: number,
    page: number,
    pageSize: number
  ): Promise<{ data: Transaction[]; total: number }> {
    try {
      const countRows = await this.workerService.query(
        TRANSACTION_QUERIES.GET_COUNT_BY_TRIP,
        [tripId]
      );
      const total = Number(countRows[0]?.total || 0);

      const sql = `
        SELECT ${this.TRANSACTION_SELECT}
        FROM transactions t
        LEFT JOIN categories c ON t.category_id = c.id
        LEFT JOIN companies comp ON t.company_id = comp.id
        LEFT JOIN accounts a ON t.account_id = a.id
        LEFT JOIN projects p ON t.project_id = p.id
        LEFT JOIN trips tr ON t.trip_id = tr.id
        WHERE t.trip_id = ?
        ORDER BY t.date DESC, t.id DESC
        LIMIT ? OFFSET ?
      `;
      const rows = await this.workerService.query(sql, [tripId, pageSize, page * pageSize]);
      return { data: rows.map(this.mapToTransaction), total };
    } catch (error) {
      console.error("Failed to get transactions by trip paginated:", error);
      throw error;
    }
  }

  async getTransactionsByProject(projectId: number): Promise<Transaction[]> {
    try {
      const rows = await this.workerService.query(
        TRANSACTION_QUERIES.GET_BY_PROJECT,
        [projectId]
      );
      return rows.map(this.mapToTransaction);
    } catch (error) {
      console.error("Failed to get transactions by project:", error);
      throw error;
    }
  }

  async getTransactionsByDateRange(
    startDate: string,
    endDate: string,
    type?: "income" | "expense"
  ): Promise<Transaction[]> {
    try {
      let rows;
      if (type) {
        rows = await this.workerService.query(
          TRANSACTION_QUERIES.GET_BY_DATE_RANGE_AND_TYPE,
          [startDate, endDate, type]
        );
      } else {
        rows = await this.workerService.query(
          TRANSACTION_QUERIES.GET_BY_DATE_RANGE,
          [startDate, endDate]
        );
      }
      return rows.map(this.mapToTransaction);
    } catch (error) {
      console.error("Failed to get transactions by date range:", error);
      throw error;
    }
  }

  // Category operations
  async getCategories(): Promise<Category[]> {
    try {
      const rows = await this.workerService.query(CATEGORY_QUERIES.GET_ALL);
      return rows.map(this.mapToCategory);
    } catch (error) {
      console.error("Failed to get categories:", error);
      throw error;
    }
  }

  async addCategory(
    category: Omit<Category, "id" | "created_at" | "updated_at">
  ): Promise<number> {
    try {
      const result = await this.workerService.query(
        CATEGORY_QUERIES.CREATE,
        [category.name, category.color || "#1976d2", category.type || "expense"]
      );
      return result[0].id;
    } catch (error) {
      console.error("Failed to add category:", error);
      throw error;
    }
  }

  async findCategoryByName(name: string): Promise<Category | null> {
    try {
      const rows = await this.workerService.query(
        CATEGORY_QUERIES.FIND_BY_NAME,
        [name]
      );
      return rows.length > 0 ? this.mapToCategory(rows[0]) : null;
    } catch (error) {
      console.error("Failed to find category by name:", error);
      throw error;
    }
  }

  async findOrCreateCategory(
    category: Pick<Category, 'name' | 'type'> & Partial<Pick<Category, 'color'>>
  ): Promise<number> {
    try {
      const existing = await this.findCategoryByName(category.name);
      if (existing) {
        if (existing.type !== category.type) {
          throw new Error(
            `Category "${category.name}" already exists as ${existing.type}, not ${category.type}`
          );
        }
        return existing.id;
      }

      return await this.addCategory({
        name: category.name,
        type: category.type,
        color: category.color || '#1976d2',
      });
    } catch (error) {
      console.error("Failed to find or create category:", error);
      throw error;
    }
  }

  // Company operations
  async getCompanies(): Promise<Company[]> {
    try {
      const rows = await this.workerService.query(COMPANY_QUERIES.GET_ALL);
      return rows.map(this.mapToCompany);
    } catch (error) {
      console.error("Failed to get companies:", error);
      throw error;
    }
  }

  async addCompany(name: string): Promise<number> {
    try {
      const result = await this.workerService.query(COMPANY_QUERIES.CREATE, [
        name,
      ]);
      return result[0].id;
    } catch (error) {
      console.error("Failed to add company:", error);
      throw error;
    }
  }

  async updateCompany(id: number, name: string): Promise<void> {
    try {
      await this.workerService.query(COMPANY_QUERIES.UPDATE, [name.trim(), id]);
    } catch (error) {
      console.error("Failed to update company:", error);
      throw error;
    }
  }

  async findCompanyByName(name: string): Promise<Company | null> {
    try {
      const rows = await this.workerService.query(
        COMPANY_QUERIES.FIND_BY_NAME,
        [name]
      );
      return rows.length > 0 ? this.mapToCompany(rows[0]) : null;
    } catch (error) {
      console.error("Failed to find company by name:", error);
      throw error;
    }
  }

  async findOrCreateCompany(name: string): Promise<number> {
    try {
      const existing = await this.findCompanyByName(name);
      if (existing) {
        return existing.id;
      }
      return await this.addCompany(name);
    } catch (error) {
      console.error("Failed to find or create company:", error);
      throw error;
    }
  }

  // Account operations
  async getAccounts(): Promise<Account[]> {
    try {
      const rows = await this.workerService.query(ACCOUNT_QUERIES.GET_ALL);
      return rows.map(this.mapToAccount);
    } catch (error) {
      console.error("Failed to get accounts:", error);
      throw error;
    }
  }

  async addAccountWithCard(
    account: Omit<Account, "id" | "created_at" | "updated_at" | "owner_user_id">,
    ownerUserId: number,
    card: Omit<AccountCard, 'id' | 'created_at' | 'updated_at' | 'account_id'>
  ): Promise<{ accountId: number; cardId: number }> {
    await this.workerService.query('BEGIN TRANSACTION');
    try {
      const accountResult = await this.workerService.query(ACCOUNT_QUERIES.CREATE, [
        account.name,
        account.type,
        ownerUserId,
      ]);
      const accountId = Number(accountResult[0].id);
      const cardResult = await this.workerService.query(ACCOUNT_CARD_QUERIES.CREATE, [
        accountId,
        card.last_four,
        card.nickname || null,
        card.user_id || null,
      ]);
      const cardId = Number(cardResult[0].id);
      await this.workerService.query('COMMIT');
      return { accountId, cardId };
    } catch (error) {
      await this.workerService.query('ROLLBACK');
      if (error instanceof Error && /UNIQUE|constraint/i.test(error.message)) {
        throw new Error('A card with that last four already exists.');
      }
      console.error("Failed to add account with card:", error);
      throw error;
    }
  }

  async deleteAccount(id: number): Promise<void> {
    try {
      await this.workerService.query(ACCOUNT_QUERIES.DELETE, [id]);
    } catch (error) {
      console.error("Failed to delete account:", error);
      throw error;
    }
  }

  // Account-User relationship removed; ownership via owner_user_id

  // Account Card operations
  async getAccountCards(accountId: number): Promise<AccountCard[]> {
    try {
      const rows = await this.workerService.query(
        ACCOUNT_CARD_QUERIES.GET_BY_ACCOUNT_ID,
        [accountId]
      );
      return rows.map(this.mapToAccountCard);
    } catch (error) {
      console.error("Failed to get account cards:", error);
      throw error;
    }
  }

  async addAccountCard(card: Omit<AccountCard, 'id' | 'created_at' | 'updated_at'>): Promise<number> {
    try {
      const result = await this.workerService.query(ACCOUNT_CARD_QUERIES.CREATE, [
        card.account_id,
        card.last_four,
        card.nickname || null,
        card.user_id || null,
      ]);
      return result[0].id;
    } catch (error) {
      if (error instanceof Error && /UNIQUE|constraint/i.test(error.message)) {
        throw new Error('A card with that last four already exists.');
      }
      console.error("Failed to add account card:", error);
      throw error;
    }
  }

  async deleteAccountCard(id: number): Promise<void> {
    await this.workerService.query('BEGIN TRANSACTION');
    try {
      const cardRows = await this.workerService.query('SELECT account_id FROM account_cards WHERE id = ?', [id]);
      const accountId = cardRows[0]?.account_id;
      if (accountId != null) {
        const countRows = await this.workerService.query('SELECT COUNT(*) as count FROM account_cards WHERE account_id = ?', [accountId]);
        if (Number(countRows[0]?.count || 0) <= 1) {
          throw new Error('An account must keep at least one card');
        }
      }
      await this.workerService.query(ACCOUNT_CARD_QUERIES.DELETE, [id]);
      await this.workerService.query('COMMIT');
    } catch (error) {
      await this.workerService.query('ROLLBACK');
      console.error("Failed to delete account card:", error);
      throw error;
    }
  }

  async updateAccountCard(id: number, updates: Partial<Pick<AccountCard, 'last_four' | 'nickname' | 'user_id'>>): Promise<void> {
    try {
      await this.workerService.query(ACCOUNT_CARD_QUERIES.UPDATE, [
        updates.last_four,
        updates.nickname,
        updates.user_id,
        id,
      ]);
    } catch (error) {
      console.error("Failed to update account card:", error);
      throw error;
    }
  }

  async findAccountsByLastFour(lastFour: string): Promise<Account[]> {
    try {
      const rows = await this.workerService.query(
        ACCOUNT_CARD_QUERIES.FIND_ACCOUNT_BY_LAST_FOUR,
        [lastFour]
      );
      return rows.map(this.mapToAccount);
    } catch (error) {
      console.error("Failed to find accounts by last four:", error);
      throw error;
    }
  }

  async setTransactionCategory(txId: number, categoryId: number | null): Promise<void> {
    try {
      if (categoryId != null) {
        const [transactionRows, categoryRows] = await Promise.all([
          this.workerService.query('SELECT type FROM transactions WHERE id = ?', [txId]),
          this.workerService.query(CATEGORY_QUERIES.GET_BY_ID, [categoryId]),
        ]);
        const transactionType = transactionRows[0]?.type;
        const categoryType = categoryRows[0]?.type;
        if (transactionType && categoryType && transactionType !== categoryType) {
          throw new Error(`Category type ${categoryType} does not match transaction type ${transactionType}`);
        }
      }
      await this.workerService.query(TRANSACTION_QUERIES.SET_CATEGORY, [categoryId, txId]);
    } catch (error) {
      console.error("Failed to set transaction category:", error);
      throw error;
    }
  }

  async setTransactionCompany(
    txId: number,
    input: { companyId?: number | null; companyName?: string | null }
  ): Promise<void> {
    try {
      let companyId = input.companyId ?? null;
      const companyName = input.companyName?.trim();
      if (companyName) {
        companyId = await this.findOrCreateCompany(companyName);
      }
      await this.workerService.query(TRANSACTION_QUERIES.SET_COMPANY, [companyId, txId]);
    } catch (error) {
      console.error("Failed to set transaction company:", error);
      throw error;
    }
  }

  async setTransactionComment(txId: number, comment: string): Promise<void> {
    try {
      const trimmedComment = comment.trim();
      await this.workerService.query(TRANSACTION_QUERIES.SET_COMMENT, [trimmedComment || null, txId]);
    } catch (error) {
      console.error('Failed to set transaction comment:', error);
      throw error;
    }
  }

  async linkTransactionToSeries(txId: number, seriesId: number): Promise<void> {
    try {
      await this.workerService.query(SUBSCRIPTION_QUERIES.LINK_TRANSACTION_MANUAL, [txId, seriesId]);
    } catch (error) {
      console.error('Failed to link transaction to series:', error);
      throw error;
    }
  }

  async unlinkTransactionFromSeries(txId: number): Promise<void> {
    try {
      await this.workerService.query(SUBSCRIPTION_QUERIES.DELETE_LINK_FOR_TRANSACTION, [txId]);
    } catch (error) {
      console.error('Failed to unlink transaction from series:', error);
      throw error;
    }
  }

  async bulkLinkTransactionsToSeries(transactionIds: number[], seriesId: number): Promise<{ appliedCount: number }> {
    if (transactionIds.length === 0) {
      return { appliedCount: 0 };
    }

    await this.workerService.query('BEGIN TRANSACTION');
    try {
      for (const txId of transactionIds) {
        await this.workerService.query(SUBSCRIPTION_QUERIES.LINK_TRANSACTION_MANUAL, [txId, seriesId]);
      }
      await this.workerService.query('COMMIT');
      return { appliedCount: transactionIds.length };
    } catch (error) {
      await this.workerService.query('ROLLBACK');
      console.error('Failed to bulk link transactions to series:', error);
      throw error;
    }
  }

  async getBudgetPlans(): Promise<BudgetPlanWithCategories[]> {
    try {
      const [planRows, categoryRows] = await Promise.all([
        this.workerService.query(BUDGET_PLAN_QUERIES.GET_ALL_PLANS),
        this.workerService.query(BUDGET_PLAN_QUERIES.GET_ALL_PLAN_CATEGORIES),
      ]);
      return this.stitchBudgetPlans(planRows.map(this.mapToBudgetPlan), categoryRows.map(this.mapToBudgetPlanCategory));
    } catch (error) {
      console.error('Failed to get budget plans:', error);
      throw error;
    }
  }

  async saveBudgetPlan(input: {
    effectiveMonth: string;
    totalAmount?: number | null;
    notes?: string | null;
    categories: Array<{ category_id: number; amount: number }>;
  }): Promise<number> {
    await this.workerService.query('BEGIN TRANSACTION');
    try {
      const result = await this.workerService.query(BUDGET_PLAN_QUERIES.UPSERT_PLAN, [
        input.effectiveMonth,
        input.totalAmount ?? null,
        input.notes ?? null,
      ]);
      const planId = Number(result[0].id);
      await this.workerService.query(BUDGET_PLAN_QUERIES.DELETE_PLAN_CATEGORIES, [planId]);
      for (const category of input.categories) {
        await this.workerService.query(BUDGET_PLAN_QUERIES.INSERT_PLAN_CATEGORY, [
          planId,
          category.category_id,
          category.amount,
        ]);
      }
      await this.workerService.query('COMMIT');
      return planId;
    } catch (error) {
      await this.workerService.query('ROLLBACK');
      console.error('Failed to save budget plan:', error);
      throw error;
    }
  }

  async deleteBudgetPlan(id: number): Promise<void> {
    try {
      await this.workerService.query(BUDGET_PLAN_QUERIES.DELETE_PLAN, [id]);
    } catch (error) {
      console.error('Failed to delete budget plan:', error);
      throw error;
    }
  }

  async getEffectiveBudgetPlan(month: string): Promise<BudgetPlanWithCategories | null> {
    try {
      const planRows = await this.workerService.query(BUDGET_PLAN_QUERIES.GET_EFFECTIVE_PLAN_FOR_MONTH, [month]);
      if (planRows.length === 0) return null;
      const categoryRows = await this.workerService.query(BUDGET_PLAN_QUERIES.GET_ALL_PLAN_CATEGORIES);
      return this.stitchBudgetPlans(planRows.map(this.mapToBudgetPlan), categoryRows.map(this.mapToBudgetPlanCategory))[0] ?? null;
    } catch (error) {
      console.error('Failed to get effective budget plan:', error);
      throw error;
    }
  }

  async getBudgetStatus(period: BudgetPeriod): Promise<BudgetStatus> {
    try {
      const months = this.expandBudgetPeriod(period);
      const startDate = `${months[0]}-01`;
      const endDate = this.endOfMonth(months[months.length - 1]);
      const [planRows, categoryRows, expenseRows, linkedIncomeRows, incomeSourceRows] = await Promise.all([
        this.workerService.query(BUDGET_PLAN_QUERIES.GET_ALL_PLANS),
        this.workerService.query(BUDGET_PLAN_QUERIES.GET_ALL_PLAN_CATEGORIES),
        this.workerService.query(BUDGET_PLAN_QUERIES.ACTUAL_EXPENSES_BY_MONTH_CATEGORY, [startDate, endDate]),
        this.workerService.query(BUDGET_PLAN_QUERIES.ACTUAL_INCOME_LINKED_BY_MONTH, [startDate, endDate]),
        this.workerService.query(INCOME_SOURCE_QUERIES.GET_ALL),
      ]);
      const plans = this.stitchBudgetPlans(planRows.map(this.mapToBudgetPlan), categoryRows.map(this.mapToBudgetPlanCategory))
        .sort((a, b) => a.effective_month.localeCompare(b.effective_month));
      const planForMonth = new Map<string, BudgetPlanWithCategories>();
      for (const month of months) {
        const effectivePlan = [...plans].reverse().find((plan) => plan.effective_month <= month);
        if (effectivePlan) planForMonth.set(month, effectivePlan);
      }

      const monthsWithPlan = months.filter((month) => planForMonth.has(month));
      const expensesByMonthCategory = new Map<string, number>();
      let actualExpenses = 0;
      for (const row of expenseRows) {
        const key = `${row.month}:${row.category_id ?? 'uncategorized'}`;
        const total = Number(row.total || 0);
        expensesByMonthCategory.set(key, total);
        actualExpenses += total;
      }

      const categoryStatuses = new Map<number, BudgetStatus['categories'][number]>();
      let budgetedTotal = 0;
      let unbudgetedSpend = 0;
      for (const month of months) {
        const plan = planForMonth.get(month);
        if (!plan) continue;
        const categoryIds = new Set<number>();
        const planCategoryTotal = plan.categories.reduce((sum, category) => sum + Number(category.amount || 0), 0);
        budgetedTotal += Number(plan.total_amount ?? planCategoryTotal);
        for (const category of plan.categories) {
          categoryIds.add(category.category_id);
          const actual = Number(expensesByMonthCategory.get(`${month}:${category.category_id}`) || 0);
          const existing = categoryStatuses.get(category.category_id) ?? {
            category_id: category.category_id,
            category_name: category.category_name,
            category_color: category.category_color,
            budgetedAmount: 0,
            actualExpenses: 0,
            remaining: 0,
            isOverBudget: false,
          };
          existing.budgetedAmount += Number(category.amount || 0);
          existing.actualExpenses += actual;
          existing.remaining = existing.budgetedAmount - existing.actualExpenses;
          existing.isOverBudget = existing.remaining < 0;
          categoryStatuses.set(category.category_id, existing);
        }

        for (const row of expenseRows) {
          if (row.month !== month) continue;
          const categoryId = row.category_id == null ? null : Number(row.category_id);
          if (categoryId == null || !categoryIds.has(categoryId)) {
            unbudgetedSpend += Number(row.total || 0);
          }
        }
      }

      const linkedIncomeByMonth = new Map<string, number>();
      for (const row of linkedIncomeRows) {
        linkedIncomeByMonth.set(row.month, Number(row.total || 0));
      }
      const incomeSources = incomeSourceRows.map(this.mapToIncomeSource);
      const expectedIncome = months.reduce((sum, month) => (
        sum + incomeSources.reduce((monthSum, source) => monthSum + this.expectedMonthlyIncome(source, month), 0)
      ), 0);
      const actualLinkedIncome = months.reduce((sum, month) => sum + Number(linkedIncomeByMonth.get(month) || 0), 0);
      const hasPlan = monthsWithPlan.length > 0;
      const totalBudget = hasPlan ? budgetedTotal : null;
      const remaining = totalBudget == null ? null : totalBudget - actualExpenses;

      return {
        period,
        months,
        budgetedTotal: totalBudget,
        actualExpenses,
        remaining,
        isOverBudget: remaining != null ? remaining < 0 : false,
        categories: Array.from(categoryStatuses.values()),
        unbudgetedSpend,
        expectedIncome,
        actualLinkedIncome,
        monthsWithPlan,
      };
    } catch (error) {
      console.error('Failed to get budget status:', error);
      throw error;
    }
  }

  async getIncomeSources(): Promise<IncomeSource[]> {
    try {
      const rows = await this.workerService.query(INCOME_SOURCE_QUERIES.GET_ALL);
      return rows.map(this.mapToIncomeSource);
    } catch (error) {
      console.error('Failed to get income sources:', error);
      throw error;
    }
  }

  async addIncomeSource(input: Omit<IncomeSource, 'id' | 'created_at' | 'updated_at' | 'account_name'>): Promise<number> {
    this.validateIncomeSource(input);
    try {
      const result = await this.workerService.query(INCOME_SOURCE_QUERIES.CREATE, [
        input.name,
        input.kind,
        input.user_id ?? null,
        input.account_id ?? null,
        input.amount ?? null,
        input.frequency ?? null,
        input.start_date ?? null,
        input.end_date ?? null,
        input.is_active ?? 1,
        input.notes ?? null,
      ]);
      return Number(result[0].id);
    } catch (error) {
      console.error('Failed to add income source:', error);
      throw error;
    }
  }

  async updateIncomeSource(id: number, input: Omit<IncomeSource, 'id' | 'created_at' | 'updated_at' | 'account_name'>): Promise<void> {
    this.validateIncomeSource(input);
    try {
      await this.workerService.query(INCOME_SOURCE_QUERIES.UPDATE, [
        input.name,
        input.kind,
        input.user_id ?? null,
        input.account_id ?? null,
        input.amount ?? null,
        input.frequency ?? null,
        input.start_date ?? null,
        input.end_date ?? null,
        input.is_active ?? 1,
        input.notes ?? null,
        id,
      ]);
    } catch (error) {
      console.error('Failed to update income source:', error);
      throw error;
    }
  }

  async deleteIncomeSource(id: number): Promise<void> {
    try {
      await this.workerService.query(INCOME_SOURCE_QUERIES.DELETE, [id]);
    } catch (error) {
      console.error('Failed to delete income source:', error);
      throw error;
    }
  }

  // Project operations
  async getProjects(): Promise<Project[]> {
    try {
      const rows = await this.workerService.query(PROJECT_QUERIES.GET_ALL);
      return rows.map(this.mapToProject);
    } catch (error) {
      console.error("Failed to get projects:", error);
      throw error;
    }
  }

  async addProject(
    project: Omit<Project, "id" | "created_at" | "updated_at">
  ): Promise<number> {
    try {
      const result = await this.workerService.query(PROJECT_QUERIES.CREATE, [
        project.name,
        project.company_name,
        project.contact_details,
        project.project_category || "other",
        project.status || "planning",
        project.start_date || null,
        project.end_date || null,
        project.estimated_cost || 0,
        project.actual_cost || 0,
        project.notes || null,
      ]);
      return result[0].id;
    } catch (error) {
      console.error("Failed to add project:", error);
      throw error;
    }
  }

  async getProjectById(id: number): Promise<Project | null> {
    try {
      const rows = await this.workerService.query(
        PROJECT_QUERIES.GET_BY_ID,
        [id]
      );
      return rows.length > 0 ? this.mapToProject(rows[0]) : null;
    } catch (error) {
      console.error("Failed to get project by id:", error);
      throw error;
    }
  }

  async updateProject(
    id: number,
    updates: Partial<Omit<Project, "id" | "created_at" | "updated_at">>
  ): Promise<void> {
    try {
      const existing = await this.getProjectById(id);
      if (!existing) {
        throw new Error("Project not found");
      }

      await this.workerService.query(PROJECT_QUERIES.UPDATE, [
        updates.name ?? existing.name,
        updates.company_name ?? existing.company_name,
        updates.contact_details ?? existing.contact_details,
        updates.project_category ?? existing.project_category,
        updates.status ?? existing.status,
        updates.start_date ?? existing.start_date,
        updates.end_date ?? existing.end_date,
        updates.estimated_cost ?? existing.estimated_cost,
        updates.actual_cost ?? existing.actual_cost,
        updates.notes ?? existing.notes,
        id,
      ]);
    } catch (error) {
      console.error("Failed to update project:", error);
      throw error;
    }
  }

  async deleteProject(id: number): Promise<void> {
    try {
      await this.workerService.query(PROJECT_QUERIES.DELETE, [id]);
    } catch (error) {
      console.error("Failed to delete project:", error);
      throw error;
    }
  }

  async getProjectCosts(
    projectId: number
  ): Promise<{
    estimated: number;
    actual: number;
    transactions_total: number;
  }> {
    try {
      const rows = await this.workerService.query(
        PROJECT_QUERIES.GET_COSTS,
        [projectId]
      );
      const result = rows[0] || {
        estimated_cost: 0,
        actual_cost: 0,
        transactions_total: 0,
      };
      return {
        estimated: result.estimated_cost || 0,
        actual: result.actual_cost || 0,
        transactions_total: result.transactions_total || 0,
      };
    } catch (error) {
      console.error("Failed to get project costs:", error);
      throw error;
    }
  }

  // Trip operations
  async getTrips(): Promise<Trip[]> {
    const result = await this.workerService.query(TRIP_QUERIES.GET_ALL);
    return result.map((row: any) => this.mapToTrip(row));
  }

  async addTrip(
    trip: Omit<Trip, "id" | "created_at" | "updated_at">
  ): Promise<number> {
    const result = await this.workerService.query(TRIP_QUERIES.CREATE, [
      trip.name,
      trip.destination || null,
      trip.purpose || null,
      trip.trip_category,
      trip.status,
      trip.start_date || null,
      trip.end_date || null,
      trip.estimated_cost || null,
      trip.actual_cost || null,
      trip.notes || null,
    ]);
    return (result[0].id);
  }

  async getTripById(id: number): Promise<Trip | null> {
    const result = await this.workerService.query(TRIP_QUERIES.GET_BY_ID, [id]);
    return result.length > 0 ? this.mapToTrip(result[0]) : null;
  }

  async updateTrip(
    id: number,
    updates: Partial<Omit<Trip, "id" | "created_at" | "updated_at">>
  ): Promise<void> {
    const trip = await this.getTripById(id);
    if (!trip) throw new Error('Trip not found');

    await this.workerService.query(TRIP_QUERIES.UPDATE, [
      updates.name !== undefined ? updates.name : trip.name,
      updates.destination !== undefined ? updates.destination : trip.destination,
      updates.purpose !== undefined ? updates.purpose : trip.purpose,
      updates.trip_category !== undefined ? updates.trip_category : trip.trip_category,
      updates.status !== undefined ? updates.status : trip.status,
      updates.start_date !== undefined ? updates.start_date : trip.start_date,
      updates.end_date !== undefined ? updates.end_date : trip.end_date,
      updates.estimated_cost !== undefined ? updates.estimated_cost : trip.estimated_cost,
      updates.actual_cost !== undefined ? updates.actual_cost : trip.actual_cost,
      updates.notes !== undefined ? updates.notes : trip.notes,
      id,
    ]);
  }

  async deleteTrip(id: number): Promise<void> {
    await this.workerService.query(TRIP_QUERIES.DELETE, [id]);
  }

  async getTripCosts(
    tripId: number
  ): Promise<{
    estimated: number;
    actual: number;
    transactions_total: number;
  }> {
    const result = await this.workerService.query(TRIP_QUERIES.GET_COSTS, [tripId]);
    return result.length > 0 ? {
      estimated: Number(result[0].estimated) || 0,
      actual: Number(result[0].actual) || 0,
      transactions_total: Number(result[0].transactions_total) || 0,
    } : { estimated: 0, actual: 0, transactions_total: 0 };
  }

  async getTransactionsByTrip(tripId: number): Promise<Transaction[]> {
    const result = await this.workerService.query(TRANSACTION_QUERIES.GET_BY_TRIP, [tripId]);
    return result.map((row: any) => this.mapToTransaction(row));
  }

  // User operations
  async getUsers(): Promise<User[]> {
    try {
      const rows = await this.workerService.query(USER_QUERIES.GET_ALL);
      return rows.map(this.mapToUser);
    } catch (error) {
      console.error("Failed to get users:", error);
      throw error;
    }
  }

  async getUserById(id: number): Promise<User | null> {
    try {
      const rows = await this.workerService.query(USER_QUERIES.GET_BY_ID, [
        id,
      ]);
      return rows.length > 0 ? this.mapToUser(rows[0]) : null;
    } catch (error) {
      console.error("Failed to get user by id:", error);
      throw error;
    }
  }

  async addUser(
    user: Omit<User, "id" | "created_at" | "updated_at" | "is_primary"> & Partial<Pick<User, "is_primary">>
  ): Promise<number> {
    try {
      const result = await this.workerService.query(USER_QUERIES.CREATE, [
        user.display_name,
        user.is_primary || 0,
      ]);
      return result[0].id;
    } catch (error) {
      console.error("Failed to add user:", error);
      throw error;
    }
  }

  async ensurePrimaryUser(displayName: string): Promise<number> {
    const trimmedName = displayName.trim() || 'Primary User';
    await this.workerService.query('BEGIN TRANSACTION');
    try {
      const existingRows = await this.workerService.query(USER_QUERIES.GET_PRIMARY);
      if (existingRows.length > 0) {
        await this.workerService.query(USER_QUERIES.RENAME_PRIMARY, [trimmedName]);
        await this.workerService.query('COMMIT');
        return Number(existingRows[0].id);
      }

      const result = await this.workerService.query(USER_QUERIES.CREATE, [trimmedName, 1]);
      await this.workerService.query('COMMIT');
      return Number(result[0].id);
    } catch (error) {
      await this.workerService.query('ROLLBACK');
      console.error("Failed to ensure primary user:", error);
      throw error;
    }
  }

  async updateUser(
    id: number,
    updates: Partial<Omit<User, "id" | "created_at" | "updated_at">>
  ): Promise<void> {
    try {
      await this.workerService.query(USER_QUERIES.UPDATE, [
        updates.display_name,
        id,
      ]);
    } catch (error) {
      console.error("Failed to update user:", error);
      throw error;
    }
  }

  async deleteUser(id: number): Promise<void> {
    try {
      const rows = await this.workerService.query(USER_QUERIES.GET_BY_ID, [id]);
      if (Number(rows[0]?.is_primary || 0) === 1) {
        throw new Error('The primary user cannot be deleted');
      }
      await this.workerService.query(USER_QUERIES.DELETE, [id]);
    } catch (error) {
      console.error("Failed to delete user:", error);
      throw error;
    }
  }

  async getAccountsByUserId(userId: number): Promise<Account[]> {
    try {
      const rows = await this.workerService.query(
        ACCOUNT_QUERIES.GET_BY_USER_ID,
        [userId]
      );
      return rows.map(this.mapToAccount);
    } catch (error) {
      console.error("Failed to get accounts by user id:", error);
      throw error;
    }
  }

  // Analytics operations
  async getSpendingByCategory(
    startDate: string,
    endDate: string
  ): Promise<
    {
      category_id: string;
      category_name: string;
      total: number;
      color: string;
    }[]
  > {
    try {
      const rows = await this.workerService.query(
        ANALYTICS_QUERIES.SPENDING_BY_CATEGORY,
        [startDate, endDate]
      );
      return rows.map((row) => ({
        category_id: row.category_id.toString(),
        category_name: row.category_name,
        total: row.total,
        color: row.color,
      }));
    } catch (error) {
      console.error("Failed to get spending by category:", error);
      throw error;
    }
  }

  async getIncomeByCategory(
    startDate: string,
    endDate: string
  ): Promise<
    {
      category_id: string;
      category_name: string;
      total: number;
      color: string;
    }[]
  > {
    try {
      const rows = await this.workerService.query(
        ANALYTICS_QUERIES.INCOME_BY_CATEGORY,
        [startDate, endDate]
      );
      return rows.map((row) => ({
        category_id: row.category_id.toString(),
        category_name: row.category_name,
        total: row.total,
        color: row.color,
      }));
    } catch (error) {
      console.error("Failed to get income by category:", error);
      throw error;
    }
  }

  async getMonthlyTrends(
    months: number = 12
  ): Promise<{ month: string; income: number; expense: number }[]> {
    try {
      const rows = await this.workerService.query(
        ANALYTICS_QUERIES.MONTHLY_TRENDS,
        [months]
      );
      return rows.map((row) => ({
        month: row.month,
        income: row.income || 0,
        expense: row.expense || 0,
      }));
    } catch (error) {
      console.error("Failed to get monthly trends:", error);
      throw error;
    }
  }

  async checkTransactionHashExists(hash: string): Promise<boolean> {
    try {
      const rows = await this.workerService.query(
        TRANSACTION_QUERIES.CHECK_HASH_EXISTS,
        [hash]
      );
      return Number(rows[0]?.count || 0) > 0;
    } catch (error) {
      console.error("Failed to check transaction hash:", error);
      throw error;
    }
  }

  // Custom SQL query execution
  async executeCustomQuery(sql: string): Promise<any[]> {
    try {
      console.debug("Executing custom query:", sql);
      return await this.workerService.query(sql);
    } catch (error) {
      console.error("Failed to execute custom query:", error);
      throw error;
    }
  }

  async executeCustomQueryWithTimeout(sql: string, timeoutMs: number): Promise<any[]> {
    try {
      console.debug("Executing custom query with timeout:", sql, timeoutMs);
      return await this.workerService.queryWithTimeout(sql, [], timeoutMs);
    } catch (error) {
      console.error("Failed to execute custom query:", error);
      throw error;
    }
  }

  // Utility methods for mapping database rows to TypeScript objects
  private mapToTransaction(row: any): Transaction {
    return {
      id: row.id,
      date: row.date,
      amount: row.amount,
      description: row.description,
      comment: row.comment ?? null,
      account_id: row.account_id,
      card_id: row.card_id ?? null,
      category_id: row.category_id || null,
      company_id: row.company_id || null,
      project_id: row.project_id || null,
      type: row.type,
      transaction_hash: row.transaction_hash || undefined,
      created_at: row.created_at,
      updated_at: row.updated_at,
      // Joined fields from SQL queries
      category_name: row.category_name || undefined,
      category_color: row.category_color || undefined,
      category_type: row.category_type || undefined,
      company_name: row.company_name || undefined,
      account_name: row.account_name || undefined,
      account_type: row.account_type || undefined,
      card_last_four: row.card_last_four || undefined,
      card_nickname: row.card_nickname ?? null,
      effective_user_id: row.effective_user_id ?? null,
      effective_user_name: row.effective_user_name || undefined,
      account_owner_name: row.account_owner_name || undefined,
      series_id: row.series_id ?? null,
      series_name: row.series_name || undefined,
      service_name: row.service_name || undefined,
      project_name: row.project_name || undefined,
      trip_name: row.trip_name || undefined,
      trip_id: row.trip_id ? row.trip_id : null,
    };
  }

  private mapToCategory(row: any): Category {
    return {
      id: row.id,
      name: row.name,
      color: row.color,
      type: row.type,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private mapToCompany(row: any): Company {
    return {
      id: row.id,
      name: row.name,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private mapToAccount(row: any): Account {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      owner_user_id: row.owner_user_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      owner_display_name: row.owner_display_name,
    };
  }

  private mapToAccountCard(row: any): AccountCard {
    return {
      id: row.id,
      account_id: row.account_id,
      last_four: row.last_four,
      nickname: row.nickname,
      user_id: row.user_id,
      created_at: row.created_at,
      user_display_name: row.user_display_name,
      account_name: row.account_name,
    };
  }

  private mapToBudgetPlan(row: any): BudgetPlan {
    return {
      id: row.id,
      effective_month: row.effective_month,
      total_amount: row.total_amount == null ? null : Number(row.total_amount),
      notes: row.notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private mapToBudgetPlanCategory(row: any): BudgetPlanCategory {
    return {
      id: row.id,
      plan_id: row.plan_id,
      category_id: row.category_id,
      amount: Number(row.amount || 0),
      created_at: row.created_at,
      updated_at: row.updated_at,
      category_name: row.category_name,
      category_color: row.category_color,
    };
  }

  private mapToIncomeSource(row: any): IncomeSource {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      user_id: row.user_id ?? null,
      account_id: row.account_id ?? null,
      amount: row.amount == null ? null : Number(row.amount),
      frequency: row.frequency ?? null,
      start_date: row.start_date ?? null,
      end_date: row.end_date ?? null,
      is_active: Number(row.is_active ?? 1),
      notes: row.notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
      account_name: row.account_name,
      user_display_name: row.user_display_name,
      owner_display_name: row.owner_display_name,
    };
  }

  private stitchBudgetPlans(plans: BudgetPlan[], categories: BudgetPlanCategory[]): BudgetPlanWithCategories[] {
    const categoriesByPlan = new Map<number, BudgetPlanCategory[]>();
    for (const category of categories) {
      const list = categoriesByPlan.get(category.plan_id) ?? [];
      list.push(category);
      categoriesByPlan.set(category.plan_id, list);
    }
    return plans.map((plan) => ({ ...plan, categories: categoriesByPlan.get(plan.id) ?? [] }));
  }

  private expandBudgetPeriod(period: BudgetPeriod): string[] {
    if (period.type === 'month') return [period.key];
    if (period.type === 'quarter') {
      const match = period.key.match(/^(\d{4})-Q([1-4])$/);
      if (!match) throw new Error(`Invalid budget quarter key: ${period.key}`);
      const year = Number(match[1]);
      const startMonth = (Number(match[2]) - 1) * 3 + 1;
      return [0, 1, 2].map((offset) => `${year}-${String(startMonth + offset).padStart(2, '0')}`);
    }
    const year = Number(period.key);
    if (!Number.isInteger(year)) throw new Error(`Invalid budget year key: ${period.key}`);
    return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`);
  }

  private endOfMonth(month: string): string {
    const [year, monthNumber] = month.split('-').map(Number);
    const date = new Date(Date.UTC(year, monthNumber, 0));
    return `${month}-${String(date.getUTCDate()).padStart(2, '0')}`;
  }

  private monthsForDateRange(startDate: string, endDate: string): string[] {
    const [startYear, startMonth] = startDate.slice(0, 7).split('-').map(Number);
    const [endYear, endMonth] = endDate.slice(0, 7).split('-').map(Number);
    const months: string[] = [];
    let year = startYear;
    let month = startMonth;

    while (year < endYear || (year === endYear && month <= endMonth)) {
      months.push(`${year}-${String(month).padStart(2, '0')}`);
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }

    return months;
  }

  private expectedIncomeForDateRange(
    incomeSources: IncomeSource[],
    startDate: string,
    endDate: string,
    filters?: TransactionScopeFilters
  ): number {
    const accountFilter = filters?.accountIds && filters.accountIds.length > 0
      ? new Set(filters.accountIds)
      : null;
    const filteredSources = incomeSources.filter((source) => (
      !accountFilter || source.kind !== 'linked_account' || (source.account_id != null && accountFilter.has(source.account_id))
    ));

    return filteredSources.reduce((sum, source) => (
      sum + this.expectedIncomeOccurrencesForDateRange(source, startDate, endDate)
    ), 0);
  }

  private getTransactionParamsDateRange(params: Partial<TransactionQueryParams>): { startDate: string; endDate: string } | null {
    if (!params.startDate && !params.endDate) return null;

    const today = new Date().toISOString().split('T')[0];
    return {
      startDate: params.startDate ?? `${today.slice(0, 7)}-01`,
      endDate: params.endDate ?? today,
    };
  }

  private filterIncomeSourcesForAnalytics(
    incomeSources: IncomeSource[],
    filters?: TransactionScopeFilters
  ): IncomeSource[] {
    const accountFilter = filters?.accountIds && filters.accountIds.length > 0
      ? new Set(filters.accountIds)
      : null;
    const userFilter = filters?.userIds && filters.userIds.length > 0
      ? new Set(filters.userIds)
      : null;

    return incomeSources.filter((source) => (
      (!accountFilter || source.kind !== 'linked_account' || (source.account_id != null && accountFilter.has(source.account_id))) &&
      (!userFilter || (source.user_id != null && userFilter.has(source.user_id)))
    ));
  }

  private incomeSourceUserLabel(source: IncomeSource): string {
    return source.user_display_name || source.owner_display_name || source.name;
  }

  private chartColor(index: number): string {
    const colors = ['#1976d2', '#2e7d32', '#ed6c02', '#9c27b0', '#d32f2f', '#0288d1', '#795548', '#607d8b'];
    return colors[index % colors.length];
  }

  private getIncomeSourceChartRows(
    incomeSources: IncomeSource[],
    startDate: string,
    endDate: string,
    filters?: TransactionScopeFilters
  ): ChartData['incomeBySource'] {
    return this.filterIncomeSourcesForAnalytics(incomeSources, filters)
      .map((source, index) => ({
        id: `income-source-${source.id}`,
        label: source.kind === 'linked_account'
          ? `${source.account_name || 'Linked account'} - ${source.name}`
          : source.name,
        value: this.expectedIncomeOccurrencesForDateRange(source, startDate, endDate),
        color: this.chartColor(index + 1),
      }))
      .filter((row) => row.value > 0)
      .sort((a, b) => b.value - a.value);
  }

  private getExpectedIncomeByMonth(
    incomeSources: IncomeSource[],
    startDate: string,
    endDate: string,
    filters?: TransactionScopeFilters
  ): Map<string, number> {
    const monthlyIncome = new Map<string, number>();
    const months = this.monthsForDateRange(startDate, endDate);

    for (const month of months) {
      const monthStart = `${month}-01`;
      const monthEnd = this.endOfMonth(month);
      const effectiveStart = month === startDate.slice(0, 7) && startDate > monthStart ? startDate : monthStart;
      const effectiveEnd = month === endDate.slice(0, 7) && endDate < monthEnd ? endDate : monthEnd;
      const total = this.filterIncomeSourcesForAnalytics(incomeSources, filters).reduce(
        (sum, source) => sum + this.expectedIncomeOccurrencesForDateRange(source, effectiveStart, effectiveEnd),
        0
      );
      if (total > 0) {
        monthlyIncome.set(month, total);
      }
    }

    return monthlyIncome;
  }

  private mergeIncomeSourcesIntoAccountAnalysis(
    accountRows: any[],
    incomeSources: IncomeSource[],
    startDate: string,
    endDate: string,
    filters?: TransactionScopeFilters
  ): ChartData['accountAnalysis'] {
    const userMap = new Map<string, { label: string; income: number; expenses: number }>();

    for (const row of accountRows) {
      const label = row.user_display_name || 'Unknown User';
      const key = String(label);
      const existing = userMap.get(key) ?? { label, income: 0, expenses: 0 };
      existing.income += Number(row.income || 0);
      existing.expenses += Number(row.expenses || 0);
      userMap.set(key, existing);
    }

    for (const source of this.filterIncomeSourcesForAnalytics(incomeSources, filters)) {
      const expectedIncome = this.expectedIncomeOccurrencesForDateRange(source, startDate, endDate);
      if (expectedIncome <= 0) continue;

      const label = this.incomeSourceUserLabel(source);
      const key = String(label);
      const existing = userMap.get(key) ?? { label, income: 0, expenses: 0 };
      existing.income = Math.max(existing.income, expectedIncome);
      userMap.set(key, existing);
    }

    const rows = Array.from(userMap.values()).sort((a, b) => (b.income + b.expenses) - (a.income + a.expenses));
    return {
      accountNames: rows.map((row) => row.label),
      income: rows.map((row) => row.income),
      expenses: rows.map((row) => row.expenses),
    };
  }

  private expectedIncomeOccurrencesForDateRange(source: IncomeSource, startDate: string, endDate: string): number {
    if (source.is_active !== 1 || source.amount == null) return 0;
    const frequency = source.frequency ?? 'monthly';
    const rangeStart = this.parseDateOnly(startDate);
    const rangeEnd = this.parseDateOnly(endDate);
    const sourceStart = this.parseDateOnly(source.start_date || startDate);
    const sourceEnd = source.end_date ? this.parseDateOnly(source.end_date) : null;
    const effectiveStart = sourceStart > rangeStart ? sourceStart : rangeStart;
    const effectiveEnd = sourceEnd && sourceEnd < rangeEnd ? sourceEnd : rangeEnd;
    if (effectiveStart > effectiveEnd) return 0;

    const amount = Number(source.amount || 0);
    if (frequency === 'semi_monthly') {
      return this.countSemiMonthlyOccurrences(sourceStart, effectiveStart, effectiveEnd) * amount;
    }
    if (frequency === 'monthly') {
      return this.countMonthlyOccurrences(sourceStart, effectiveStart, effectiveEnd) * amount;
    }

    const intervalDays = frequency === 'weekly' ? 7 : 14;
    return this.countFixedIntervalOccurrences(sourceStart, effectiveStart, effectiveEnd, intervalDays) * amount;
  }

  private parseDateOnly(value: string): Date {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  private addUtcDays(date: Date, days: number): Date {
    const next = new Date(date.getTime());
    next.setUTCDate(next.getUTCDate() + days);
    return next;
  }

  private addUtcMonths(date: Date, months: number): Date {
    const next = new Date(date.getTime());
    const day = next.getUTCDate();
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(day, lastDay));
    return next;
  }

  private countFixedIntervalOccurrences(sourceStart: Date, rangeStart: Date, rangeEnd: Date, intervalDays: number): number {
    let current = new Date(sourceStart.getTime());
    while (current < rangeStart) {
      current = this.addUtcDays(current, intervalDays);
    }

    let count = 0;
    while (current <= rangeEnd) {
      count += 1;
      current = this.addUtcDays(current, intervalDays);
    }
    return count;
  }

  private countMonthlyOccurrences(sourceStart: Date, rangeStart: Date, rangeEnd: Date): number {
    let current = new Date(sourceStart.getTime());
    while (current < rangeStart) {
      current = this.addUtcMonths(current, 1);
    }

    let count = 0;
    while (current <= rangeEnd) {
      count += 1;
      current = this.addUtcMonths(current, 1);
    }
    return count;
  }

  private countSemiMonthlyOccurrences(sourceStart: Date, rangeStart: Date, rangeEnd: Date): number {
    const firstDay = sourceStart.getUTCDate();
    const secondDay = firstDay <= 15 ? Math.min(firstDay + 15, 28) : Math.max(firstDay - 15, 1);
    let count = 0;
    let year = rangeStart.getUTCFullYear();
    let month = rangeStart.getUTCMonth();

    while (year < rangeEnd.getUTCFullYear() || (year === rangeEnd.getUTCFullYear() && month <= rangeEnd.getUTCMonth())) {
      for (const day of [firstDay, secondDay]) {
        const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        const occurrence = new Date(Date.UTC(year, month, Math.min(day, lastDay)));
        if (occurrence >= sourceStart && occurrence >= rangeStart && occurrence <= rangeEnd) {
          count += 1;
        }
      }
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
    }

    return count;
  }

  private expectedMonthlyIncome(source: IncomeSource, month: string): number {
    if (source.is_active !== 1) return 0;
    const startMonth = source.start_date ? source.start_date.slice(0, 7) : null;
    const endMonth = source.end_date ? source.end_date.slice(0, 7) : null;
    if (startMonth && month < startMonth) return 0;
    if (endMonth && month > endMonth) return 0;
    const amount = Number(source.amount || 0);
    if (source.kind === 'linked_account') {
      return source.frequency ? this.normalizeIncomeAmount(amount, source.frequency) : amount;
    }

    return this.normalizeIncomeAmount(amount, source.frequency);
  }

  private normalizeIncomeAmount(amount: number, frequency: IncomeSource['frequency']): number {
    switch (frequency) {
      case 'weekly':
        return amount * 52 / 12;
      case 'biweekly':
        return amount * 26 / 12;
      case 'semi_monthly':
        return amount * 2;
      case 'monthly':
        return amount;
      default:
        return 0;
    }
  }

  private validateIncomeSource(input: Pick<IncomeSource, 'kind' | 'account_id' | 'amount' | 'frequency'>): void {
    if (input.kind === 'linked_account' && input.account_id == null) {
      throw new Error('Linked account income sources require an account');
    }
    if (input.kind === 'recurring_salary' && (input.amount == null || !input.frequency)) {
      throw new Error('Recurring salary income sources require an amount and frequency');
    }
  }

  private mapToProject(row: any): Project {
    return {
      id: row.id,
      name: row.name,
      company_name: row.company_name,
      contact_details: row.contact_details,
      project_category: row.project_category,
      status: row.status,
      start_date: row.start_date,
      end_date: row.end_date,
      estimated_cost: row.estimated_cost,
      actual_cost: row.actual_cost,
      notes: row.notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private mapToUser(row: any): User {
    return {
      id: row.id,
      display_name: row.display_name,
      is_primary: Number(row.is_primary || 0),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private mapToTrip(row: any): Trip {
    return {
      id: row.id,
      name: row.name,
      destination: row.destination,
      purpose: row.purpose,
      trip_category: row.trip_category,
      status: row.status,
      start_date: row.start_date,
      end_date: row.end_date,
      estimated_cost: row.estimated_cost ? Number(row.estimated_cost) : null,
      actual_cost: row.actual_cost ? Number(row.actual_cost) : null,
      notes: row.notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private generateTransactionHash(
    transaction: Pick<Transaction, "account_id" | "date" | "amount" | "description">
  ): string {
    const hashInput = `${transaction.account_id || "null"}-${
      transaction.date
    }-${transaction.amount}-${transaction.description}`;

    // Use a simple hash for browser compatibility
    let hash = 0;
    for (let i = 0; i < hashInput.length; i++) {
      const char = hashInput.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }

    return Math.abs(hash).toString(16);
  }

  // Static method for generating transaction hash from CSV import
  static generateTransactionHashFromFields(
    accountId: string,
    date: string,
    amount: number,
    description: string,
    uniqueIdentifier?: string,
    variationSeed?: number
  ): string {
    const baseHashInput = uniqueIdentifier
      ? `${accountId}-${date}-${amount}-${description}-${uniqueIdentifier}`
      : `${accountId}-${date}-${amount}-${description}`;
    
    // Append variation seed to hash input if provided and non-zero
    const hashInput = variationSeed && variationSeed > 0
      ? `${baseHashInput}-seed${variationSeed}`
      : baseHashInput;

    let hash = 0;
    for (let i = 0; i < hashInput.length; i++) {
      const char = hashInput.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }

    return Math.abs(hash).toString(16);
  }

  async updateTransactionLabels(id: number, projectId: number | null, tripId: number | null): Promise<void> {
    await this.workerService.query(TRANSACTION_QUERIES.UPDATE_PROJECT_TRIP, [
      projectId,
      tripId,
      id,
    ]);
  }

  async applyTransactionClassifications(
    classifications: ApplyTransactionClassificationInput[]
  ): Promise<ApplyTransactionClassificationsResult> {
    if (classifications.length === 0) {
      return { appliedCount: 0, transactionIds: [] };
    }

    await this.workerService.query('BEGIN TRANSACTION');

    try {
      const transactionIds: number[] = [];

      for (const classification of classifications) {
        const rows = await this.workerService.query(
          'SELECT id, type, category_id, company_id, project_id, trip_id FROM transactions WHERE id = ? LIMIT 1',
          [classification.transactionId]
        );

        if (rows.length === 0) {
          throw new Error(`Transaction ${classification.transactionId} was not found`);
        }

        const transaction = rows[0] as {
          id: number;
          type: Category['type'];
          category_id: number | null;
          company_id: number | null;
          project_id: number | null;
          trip_id: number | null;
        };

        const categoryId = await this.resolveClassificationCategoryId(
          classification,
          transaction
        );
        const companyId = await this.resolveClassificationCompanyId(
          classification,
          transaction.company_id
        );
        const { projectId, tripId } = this.resolveClassificationLabels(
          classification,
          transaction.project_id,
          transaction.trip_id
        );

        await this.workerService.query(TRANSACTION_QUERIES.UPDATE_CLASSIFICATION, [
          categoryId,
          companyId,
          projectId,
          tripId,
          classification.transactionId,
        ]);
        transactionIds.push(classification.transactionId);
      }

      await this.workerService.query('COMMIT');

      return {
        appliedCount: transactionIds.length,
        transactionIds,
      };
    } catch (error) {
      await this.workerService.query('ROLLBACK');
      console.error('Failed to apply transaction classifications:', error);
      throw error;
    }
  }

  private async resolveClassificationCategoryId(
    classification: ApplyTransactionClassificationInput,
    transaction: { type: Category['type']; category_id: number | null }
  ): Promise<number | null> {
    if (classification.categoryId === null || classification.categoryName === null) {
      return null;
    }

    if (typeof classification.categoryId === 'number') {
      const rows = await this.workerService.query(CATEGORY_QUERIES.GET_BY_ID, [
        classification.categoryId,
      ]);
      if (rows.length === 0) {
        throw new Error(`Category ${classification.categoryId} was not found`);
      }

      const category = this.mapToCategory(rows[0]);
      if (category.type !== transaction.type) {
        throw new Error(
          `Category "${category.name}" is ${category.type}, but transaction is ${transaction.type}`
        );
      }
      return category.id;
    }

    if (typeof classification.categoryName === 'string' && classification.categoryName.trim()) {
      return this.findOrCreateCategory({
        name: classification.categoryName.trim(),
        type: classification.categoryType || transaction.type,
      });
    }

    return transaction.category_id;
  }

  private async resolveClassificationCompanyId(
    classification: ApplyTransactionClassificationInput,
    currentCompanyId: number | null
  ): Promise<number | null> {
    if (classification.companyId === null || classification.companyName === null) {
      return null;
    }

    if (typeof classification.companyId === 'number') {
      const rows = await this.workerService.query(COMPANY_QUERIES.GET_BY_ID, [
        classification.companyId,
      ]);
      if (rows.length === 0) {
        throw new Error(`Company ${classification.companyId} was not found`);
      }
      return classification.companyId;
    }

    if (typeof classification.companyName === 'string' && classification.companyName.trim()) {
      return this.findOrCreateCompany(classification.companyName.trim());
    }

    return currentCompanyId;
  }

  private resolveClassificationLabels(
    classification: ApplyTransactionClassificationInput,
    currentProjectId: number | null,
    currentTripId: number | null
  ): { projectId: number | null; tripId: number | null } {
    const hasProjectUpdate = classification.projectId !== undefined;
    const hasTripUpdate = classification.tripId !== undefined;

    if (
      hasProjectUpdate &&
      hasTripUpdate &&
      classification.projectId !== null &&
      classification.tripId !== null
    ) {
      throw new Error('A transaction can be labeled with a project or a trip, not both');
    }

    if (hasProjectUpdate && classification.projectId !== null) {
      return { projectId: classification.projectId ?? null, tripId: null };
    }

    if (hasTripUpdate && classification.tripId !== null) {
      return { projectId: null, tripId: classification.tripId ?? null };
    }

    return {
      projectId: hasProjectUpdate ? null : currentProjectId,
      tripId: hasTripUpdate ? null : currentTripId,
    };
  }

  async updateTempTransactionHashes(updates: Array<{ tempId: number; newHash: string; variationSeed: number }>): Promise<void> {
    // Execute each update individually since SQLite doesn't support bulk updates easily
    for (const update of updates) {
      await this.workerService.query(
        'UPDATE temp_import_transactions SET transaction_hash = ?, hash_variation_seed = ? WHERE id = ?',
        [update.newHash, update.variationSeed, update.tempId]
      );
    }
  }

  // ===========================================================================
  // Merchant rules and recurring subscriptions
  // ===========================================================================

  // --- App metadata (key/value) ---

  async getAppMetadata(key: string): Promise<string | null> {
    const rows = await this.workerService.query(SUBSCRIPTION_QUERIES.GET_METADATA, [key]);
    return rows.length > 0 ? String(rows[0].value) : null;
  }

  async setAppMetadata(key: string, value: string): Promise<void> {
    await this.workerService.query(SUBSCRIPTION_QUERIES.SET_METADATA, [key, value]);
  }

  // --- Merchant rules ---

  async getMerchantRules(): Promise<MerchantRule[]> {
    try {
      const rows = await this.workerService.query(SUBSCRIPTION_QUERIES.GET_ALL_RULES);
      return rows.map(this.mapToMerchantRule);
    } catch (error) {
      console.error('Failed to get merchant rules:', error);
      throw error;
    }
  }

  async addMerchantRule(rule: {
    pattern: string;
    match_type: MerchantRuleMatchType;
    merchant_name: string;
    service_name?: string | null;
    default_kind: MerchantRuleKind;
    priority?: number;
    notes?: string | null;
  }): Promise<number> {
    const pattern = normalizeDescription(rule.pattern);
    if (!pattern) {
      throw new Error('Merchant rule pattern cannot be empty after normalization');
    }
    try {
      const result = await this.workerService.query(SUBSCRIPTION_QUERIES.CREATE_RULE, [
        this.generateUserRuleKey(),
        'user',
        pattern,
        rule.match_type,
        rule.priority ?? 50, // user rules beat community rules by default
        rule.merchant_name.trim(),
        rule.service_name?.trim() || null,
        rule.default_kind,
        1,
        1,
        rule.notes ?? null,
      ]);
      return result[0].id;
    } catch (error) {
      console.error('Failed to add merchant rule:', error);
      throw error;
    }
  }

  async updateMerchantRule(
    id: number,
    updates: {
      pattern: string;
      match_type: MerchantRuleMatchType;
      priority: number;
      merchant_name: string;
      service_name?: string | null;
      default_kind: MerchantRuleKind;
      enabled: boolean;
      notes?: string | null;
    }
  ): Promise<void> {
    const pattern = normalizeDescription(updates.pattern);
    if (!pattern) {
      throw new Error('Merchant rule pattern cannot be empty after normalization');
    }
    try {
      await this.workerService.query(SUBSCRIPTION_QUERIES.UPDATE_RULE, [
        pattern,
        updates.match_type,
        updates.priority,
        updates.merchant_name.trim(),
        updates.service_name?.trim() || null,
        updates.default_kind,
        updates.enabled ? 1 : 0,
        updates.notes ?? null,
        id,
      ]);
    } catch (error) {
      console.error('Failed to update merchant rule:', error);
      throw error;
    }
  }

  // User rules are deleted; community rules are disabled instead so a
  // reseed cannot resurrect them (user_modified guard).
  async deleteMerchantRule(id: number): Promise<void> {
    try {
      const rows = await this.workerService.query(SUBSCRIPTION_QUERIES.GET_RULE_BY_ID, [id]);
      if (rows.length === 0) return;
      if (rows[0].source === 'user') {
        await this.workerService.query(SUBSCRIPTION_QUERIES.DELETE_RULE, [id]);
      } else {
        await this.workerService.query(SUBSCRIPTION_QUERIES.DISABLE_RULE, [id]);
      }
    } catch (error) {
      console.error('Failed to delete merchant rule:', error);
      throw error;
    }
  }

  async seedCommunityMerchantRules(force = false): Promise<SeedMerchantRulesResult> {
    return seedMerchantRules(
      { query: (sql, parameters) => this.workerService.query(sql, parameters as any[]) },
      { force }
    );
  }

  async getMerchantRuleCounts(): Promise<{ community: number; user: number }> {
    const rows = await this.workerService.query(SUBSCRIPTION_QUERIES.COUNT_RULES_BY_SOURCE);
    const counts = { community: 0, user: 0 };
    for (const row of rows) {
      if (row.source === 'community') counts.community = Number(row.count) || 0;
      if (row.source === 'user') counts.user = Number(row.count) || 0;
    }
    return counts;
  }

  async getMerchantRulesSeedVersion(): Promise<number> {
    const value = await this.getAppMetadata(SEED_VERSION_METADATA_KEY);
    return Number(value) || 0;
  }

  // --- Matching + scan pipeline ---

  /**
   * Assigns companies (merchants) to transactions that have none, using the
   * enabled merchant rules. Never overwrites an existing company assignment.
   */
  async applyMerchantMatching(): Promise<{ scanned: number; matched: number }> {
    const rules = await this.getEnabledSortedRules();
    const rows = await this.workerService.query(SUBSCRIPTION_QUERIES.GET_UNMATCHED_TRANSACTIONS);
    if (rows.length === 0 || rules.length === 0) {
      return { scanned: rows.length, matched: 0 };
    }

    // Group hits by merchant so each company is resolved once
    const hitsByMerchant = new Map<string, number[]>();
    for (const row of rows) {
      const rule = matchRule(normalizeDescription(row.description), rules);
      if (!rule) continue;
      const ids = hitsByMerchant.get(rule.merchant_name) ?? [];
      ids.push(row.id);
      hitsByMerchant.set(rule.merchant_name, ids);
    }

    let matched = 0;
    await this.workerService.query('BEGIN TRANSACTION');
    try {
      for (const [merchantName, transactionIds] of hitsByMerchant) {
        const companyId = await this.findOrCreateCompany(merchantName);
        for (const transactionId of transactionIds) {
          await this.workerService.query(SUBSCRIPTION_QUERIES.UPDATE_TRANSACTION_COMPANY, [
            companyId,
            transactionId,
          ]);
          matched++;
        }
      }
      await this.workerService.query('COMMIT');
    } catch (error) {
      await this.workerService.query('ROLLBACK');
      console.error('Failed to apply merchant matching:', error);
      throw error;
    }

    return { scanned: rows.length, matched };
  }

  /**
   * Full subscription scan: merchant matching, then recurrence detection over
   * rule-backed groups (subscription/bill rules) and unmatched-description
   * clusters, upserting recurring_series (by match_key) and transaction links.
   * Idempotent: re-running against unchanged data creates nothing new.
   * Never changes a series' user-owned fields (name, kind, status, notes).
   */
  async runSubscriptionScan(): Promise<SubscriptionScanSummary> {
    const matching = await this.applyMerchantMatching();

    const rules = await this.getEnabledSortedRules();
    const ruleByKey = new Map(rules.map((rule) => [rule.rule_key, rule]));
    const expenseRows = await this.workerService.query(
      SUBSCRIPTION_QUERIES.GET_EXPENSE_TRANSACTIONS_FOR_SCAN
    );

    // Group expenses: recurring-kind rule hits by rule, unmatched by
    // normalized description. 'purchase'/'unknown' rule hits are never
    // analyzed (that is what keeps Amazon Marketplace off the page).
    const groups = new Map<string, RecurrenceInputTransaction[]>();
    for (const row of expenseRows) {
      const normalized = normalizeDescription(row.description);
      if (!normalized) continue;
      const rule = matchRule(normalized, rules);

      let key: string | null = null;
      if (rule && (rule.default_kind === 'subscription' || rule.default_kind === 'bill')) {
        key = `rule:${rule.rule_key}`;
      } else if (!rule) {
        key = `desc:${normalized}`;
      }
      if (!key) continue;

      const group = groups.get(key) ?? [];
      group.push({ id: row.id, date: row.date, amount: row.amount });
      groups.set(key, group);
    }

    const linkedRows = await this.workerService.query(
      SUBSCRIPTION_QUERIES.GET_ALL_LINKED_TRANSACTION_IDS
    );
    const alreadyLinked = new Set<number>(linkedRows.map((row: any) => Number(row.transaction_id)));

    let seriesCreated = 0;
    let seriesUpdated = 0;
    let transactionsLinked = 0;

    await this.workerService.query('BEGIN TRANSACTION');
    try {
      for (const [matchKey, groupTxns] of groups) {
        const ruleBacked = matchKey.startsWith('rule:');
        const rule = ruleBacked ? ruleByKey.get(matchKey.slice('rule:'.length)) : undefined;

        const analysis = analyzeRecurrence(groupTxns);
        const verdict = qualifiesAsSeries(analysis, { ruleBacked });
        if (!analysis || !verdict.qualifies) continue;

        const existingRows = await this.workerService.query(
          SUBSCRIPTION_QUERIES.GET_SERIES_BY_MATCH_KEY,
          [matchKey]
        );

        let seriesId: number;
        if (existingRows.length > 0) {
          seriesId = existingRows[0].id;
          await this.workerService.query(SUBSCRIPTION_QUERIES.UPDATE_SERIES_DETECTION, [
            analysis.cadence,
            analysis.expectedAmount,
            analysis.amountIsVariable ? 1 : 0,
            analysis.lastSeenDate,
            analysis.nextExpectedDate,
            seriesId,
          ]);
          seriesUpdated++;
        } else {
          const name = rule
            ? rule.service_name || rule.merchant_name
            : this.titleCaseWords(matchKey.slice('desc:'.length));
          const companyId = rule ? await this.findOrCreateCompany(rule.merchant_name) : null;
          const kind =
            rule && (rule.default_kind === 'subscription' || rule.default_kind === 'bill')
              ? rule.default_kind
              : analysis.amountIsVariable
                ? 'bill'
                : 'subscription';

          const created = await this.workerService.query(SUBSCRIPTION_QUERIES.CREATE_SERIES, [
            name,
            companyId,
            rule?.id ?? null,
            kind,
            analysis.cadence,
            analysis.expectedAmount,
            analysis.amountIsVariable ? 1 : 0,
            verdict.status,
            matchKey,
            analysis.lastSeenDate,
            analysis.nextExpectedDate,
            null,
          ]);
          seriesId = created[0].id;
          seriesCreated++;
        }

        const matchSource = ruleBacked ? 'rule' : 'heuristic';
        for (const txn of groupTxns) {
          if (alreadyLinked.has(txn.id)) continue;
          await this.workerService.query(SUBSCRIPTION_QUERIES.LINK_TRANSACTION, [
            txn.id,
            seriesId,
            matchSource,
          ]);
          alreadyLinked.add(txn.id);
          transactionsLinked++;
        }
      }
      await this.workerService.query('COMMIT');
    } catch (error) {
      await this.workerService.query('ROLLBACK');
      console.error('Failed to run subscription scan:', error);
      throw error;
    }

    return {
      scannedTransactions: expenseRows.length,
      merchantsMatched: matching.matched,
      seriesCreated,
      seriesUpdated,
      transactionsLinked,
    };
  }

  // --- Recurring series ---

  async getRecurringSeriesWithStats(range?: {
    startDate?: string;
    endDate?: string;
  }): Promise<RecurringSeries[]> {
    try {
      const startDate = range?.startDate ?? null;
      const endDate = range?.endDate ?? null;
      const rows = await this.workerService.query(SUBSCRIPTION_QUERIES.GET_SERIES_WITH_STATS, [
        startDate,
        startDate,
        endDate,
        endDate,
      ]);
      return rows.map(this.mapToRecurringSeries);
    } catch (error) {
      console.error('Failed to get recurring series:', error);
      throw error;
    }
  }

  async getTransactionsByIds(ids: number[]): Promise<Transaction[]> {
    const uniqueIds = Array.from(new Set(ids.map((id) => Number(id)).filter(Number.isInteger)));
    if (uniqueIds.length === 0) return [];

    try {
      const placeholders = uniqueIds.map(() => '?').join(',');
      const rows = await this.workerService.query(
        `
          SELECT ${this.TRANSACTION_SELECT}
          FROM transactions t
          ${this.TRANSACTION_JOINS}
          WHERE t.id IN (${placeholders})
          ORDER BY t.date DESC, t.id DESC
        `,
        uniqueIds
      );
      return rows.map((row) => this.mapToTransaction(row));
    } catch (error) {
      console.error('Failed to get transactions by ids:', error);
      throw error;
    }
  }

  async getSeriesTransactions(seriesId: number): Promise<Transaction[]> {
    try {
      const rows = await this.workerService.query(SUBSCRIPTION_QUERIES.GET_SERIES_TRANSACTIONS, [
        seriesId,
      ]);
      return rows.map((row) => this.mapToTransaction(row));
    } catch (error) {
      console.error('Failed to get series transactions:', error);
      throw error;
    }
  }

  async updateRecurringSeries(
    id: number,
    updates: {
      name: string;
      kind: RecurringSeries['kind'];
      cadence: RecurringSeries['cadence'];
      expected_amount: number | null;
      status: RecurringSeriesStatus;
      notes?: string | null;
    }
  ): Promise<void> {
    try {
      await this.workerService.query(SUBSCRIPTION_QUERIES.UPDATE_SERIES, [
        updates.name.trim(),
        updates.kind,
        updates.cadence,
        updates.expected_amount,
        updates.status,
        updates.notes ?? null,
        id,
      ]);
    } catch (error) {
      console.error('Failed to update recurring series:', error);
      throw error;
    }
  }

  async updateRecurringSeriesStatus(id: number, status: RecurringSeriesStatus): Promise<void> {
    try {
      await this.workerService.query(SUBSCRIPTION_QUERIES.UPDATE_SERIES_STATUS, [status, id]);
    } catch (error) {
      console.error('Failed to update recurring series status:', error);
      throw error;
    }
  }

  // Links are removed explicitly: PRAGMA foreign_keys is not enabled on
  // databases created before this feature, so ON DELETE CASCADE cannot be
  // relied upon.
  async deleteRecurringSeries(id: number): Promise<void> {
    await this.workerService.query('BEGIN TRANSACTION');
    try {
      await this.workerService.query(SUBSCRIPTION_QUERIES.DELETE_LINKS_FOR_SERIES, [id]);
      await this.workerService.query(SUBSCRIPTION_QUERIES.DELETE_SERIES, [id]);
      await this.workerService.query('COMMIT');
    } catch (error) {
      await this.workerService.query('ROLLBACK');
      console.error('Failed to delete recurring series:', error);
      throw error;
    }
  }

  /**
   * Clusters of expense descriptions that match no rule and belong to no
   * series — the "Unmatched recurring charges" section of the page and the
   * input for AI rule suggestions.
   */
  async getUnmatchedRecurringClusters(minOccurrences = 3): Promise<UnmatchedCluster[]> {
    const rules = await this.getEnabledSortedRules();
    const expenseRows = await this.workerService.query(
      SUBSCRIPTION_QUERIES.GET_EXPENSE_TRANSACTIONS_FOR_SCAN
    );
    const linkedRows = await this.workerService.query(
      SUBSCRIPTION_QUERIES.GET_ALL_LINKED_TRANSACTION_IDS
    );
    const linked = new Set<number>(linkedRows.map((row: any) => Number(row.transaction_id)));

    const clusters = new Map<
      string,
      { ids: number[]; totalAmount: number; firstSeen: string; lastSeen: string }
    >();
    for (const row of expenseRows) {
      if (linked.has(row.id)) continue;
      const normalized = normalizeDescription(row.description);
      if (!normalized) continue;
      if (matchRule(normalized, rules)) continue;

      const cluster = clusters.get(normalized) ?? {
        ids: [] as number[],
        totalAmount: 0,
        firstSeen: String(row.date),
        lastSeen: String(row.date),
      };
      cluster.ids.push(row.id);
      cluster.totalAmount += Math.abs(row.amount);
      if (row.date < cluster.firstSeen) cluster.firstSeen = row.date;
      if (row.date > cluster.lastSeen) cluster.lastSeen = row.date;
      clusters.set(normalized, cluster);
    }

    return Array.from(clusters.entries())
      .filter(([, cluster]) => cluster.ids.length >= minOccurrences)
      .map(([normalized, cluster]) => ({
        normalized_description: normalized,
        occurrences: cluster.ids.length,
        average_amount: cluster.totalAmount / cluster.ids.length,
        first_seen: cluster.firstSeen,
        last_seen: cluster.lastSeen,
        transaction_ids: cluster.ids,
      }))
      .sort((a, b) => b.occurrences - a.occurrences);
  }

  /** Dry-run for the rule editor: how many transactions a pattern would match. */
  async previewMerchantRuleMatches(rule: {
    pattern: string;
    match_type: MerchantRuleMatchType;
  }): Promise<number> {
    const pattern = normalizeDescription(rule.pattern);
    if (!pattern) return 0;
    const probe = {
      id: -1,
      rule_key: 'preview',
      source: 'user',
      pattern,
      match_type: rule.match_type,
      priority: 0,
      merchant_name: '',
      service_name: null,
      default_kind: 'unknown',
      enabled: 1,
      user_modified: 0,
      created_at: '',
      updated_at: '',
    } as MerchantRule;

    const rows = await this.workerService.query(
      'SELECT description FROM transactions'
    );
    let count = 0;
    for (const row of rows) {
      if (matchRule(normalizeDescription(row.description), [probe])) count++;
    }
    return count;
  }

  private async getEnabledSortedRules(): Promise<MerchantRule[]> {
    const rows = await this.workerService.query(SUBSCRIPTION_QUERIES.GET_ENABLED_RULES);
    return sortRules(rows.map(this.mapToMerchantRule));
  }

  private generateUserRuleKey(): string {
    const uuid =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return `user:${uuid}`;
  }

  private titleCaseWords(text: string): string {
    return text
      .toLowerCase()
      .split(' ')
      .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
      .join(' ');
  }

  private mapToMerchantRule(row: any): MerchantRule {
    return {
      id: row.id,
      rule_key: row.rule_key,
      source: row.source,
      pattern: row.pattern,
      match_type: row.match_type,
      priority: Number(row.priority),
      merchant_name: row.merchant_name,
      service_name: row.service_name ?? null,
      default_kind: row.default_kind,
      enabled: Number(row.enabled),
      user_modified: Number(row.user_modified),
      notes: row.notes ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private mapToRecurringSeries(row: any): RecurringSeries {
    return {
      id: row.id,
      name: row.name,
      company_id: row.company_id ?? null,
      rule_id: row.rule_id ?? null,
      kind: row.kind,
      cadence: row.cadence,
      expected_amount: row.expected_amount != null ? Number(row.expected_amount) : null,
      amount_is_variable: Number(row.amount_is_variable),
      status: row.status,
      match_key: row.match_key,
      last_seen_date: row.last_seen_date ?? null,
      next_expected_date: row.next_expected_date ?? null,
      notes: row.notes ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      company_name: row.company_name || undefined,
      transaction_count: row.transaction_count != null ? Number(row.transaction_count) : undefined,
      total_spent: row.total_spent != null ? Number(row.total_spent) : undefined,
    };
  }
}
