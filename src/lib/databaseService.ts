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
  BUDGET_QUERIES,
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
  Budget,
  Project,
  User,
  Trip,
  TransactionQueryParams,
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
  openDatabase(filename?: string, isNew?: boolean, options?: OpenDatabaseOptions): Promise<unknown>;
  createTables(options?: { ensureIndexes?: boolean }): Promise<unknown>;
  ensureIndexes(): Promise<unknown>;
  query(sql: string, parameters?: any[]): Promise<any[]>;
  queryWithTimeout(sql: string, parameters?: any[], timeoutMs?: number): Promise<any[]>;
  exec(sql: string): Promise<void>;
  exportDatabaseSnapshot(): Promise<DatabaseVfsSnapshot>;
  importDatabaseSnapshot(snapshot: DatabaseVfsSnapshot): Promise<{
    isSuccessful: boolean;
    sqlResponse?: { error?: string };
  }>;
  // Encryption
  setEncryptionPassword(password: string): Promise<void>;
  clearEncryptionPassword(): Promise<void>;
  isEncryptionReady(): Promise<boolean>;
  encryptArchive(archiveBytes: Uint8Array, lastSaveTimestamp: string): Promise<Uint8Array>;
  decryptArchive(encryptedBytes: Uint8Array): Promise<Uint8Array>;
  onStatusChange(callback: (status: WorkerStatus) => void): () => void;
  destroy?(): void;
}

export interface DatabaseStatusSummary {
  lastWriteTimestamp: string | null;
  tableStats: Record<string, number>;
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

  async openDatabase(
    filename: string = "/budget-app.db",
    isNew: boolean = false,
    options: OpenDatabaseOptions = {}
  ): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      console.debug(`Opening database: ${filename}`);
      await this.workerService.openDatabase(filename, isNew, options);

      console.debug("Database opened successfully");
    } catch (error) {
      console.error("Failed to open database:", error);
      throw error;
    }
  }

  async openExistingDatabase(): Promise<void> {
    await this.openDatabase(undefined, false);
  }

  async createNewDatabase(options: OpenDatabaseOptions = {}): Promise<void> {
    await this.openDatabase(undefined, true, options);
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

  async exportDatabase(): Promise<Uint8Array> {
    try {
      console.info("Exporting database through worker...");
      const databaseStatus = await this.getDatabaseStatus();
      const lastWriteTimestamp =
        databaseStatus.lastWriteTimestamp ?? new Date().toISOString();
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
  // Encryption password management
  // ---------------------------------------------------------------------------

  /**
   * Stores the password in the SharedWorker for this session.
   * Must be called before any export or before importing an encrypted archive.
   */
  async setEncryptionPassword(password: string): Promise<void> {
    try {
      await this.workerService.setEncryptionPassword(password);
      console.info('[DB Service] Encryption password set');
    } catch (error) {
      console.error('[DB Service] Failed to set encryption password:', error);
      throw error;
    }
  }

  async clearEncryptionPassword(): Promise<void> {
    try {
      await this.workerService.clearEncryptionPassword();
    } catch (error) {
      console.error('[DB Service] Failed to clear encryption password:', error);
      throw error;
    }
  }

  /**
   * Returns `true` when the worker holds a password and can encrypt/decrypt.
   * Use this to decide whether to show the password prompt.
   */
  async isEncryptionReady(): Promise<boolean> {
    try {
      return await this.workerService.isEncryptionReady();
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

  async clearAndRecreateDatabase(): Promise<void> {
    try {
      console.warn("Clearing corrupted database...");
      await this.openDatabase("/budget-app.db", true);
      console.info("Database cleared and recreated successfully");
    } catch (error) {
      console.error("Failed to clear and recreate database:", error);
      throw error;
    }
  }

  async databaseAlreadyExists(): Promise<boolean> {
    // Because the SharedWorker and App share the same IndexedDB service, we can just check if the database exists in the services versus the SharedWorker
    console.info("[DB Service] Checking for existing database...");
    try {
      //Logic to check for indexedDB database existence
      const databases = await indexedDB.databases();
      const exists = databases.some((db) => db.name === "ptbudgetapp");

      //If it exists check the number of blocks to ensure we don't have an empty database
      if (exists) {
        const request = window.indexedDB.open("ptbudgetapp");
        const actuallyExists = new Promise<boolean>((resolve) => {
          request.onsuccess = async (event) => {
            const target = event.target as IDBRequest | null;
            if (!target) {
              console.warn(
                "[DB Service] IndexedDB onsuccess event.target is null"
              );
              resolve(false);
              return;
            }
            const db = target.result as IDBDatabase;
            const transaction = db.transaction("blocks", "readonly");
            const blocks = await transaction.objectStore("blocks").getAll();
            blocks.onsuccess = () => {
              const result = blocks.result;
              console.info(
                `[DB Service] Found ${
                  Array.isArray(result) ? result.length : 0
                } blocks in existing database`
              );
              //return false if blocks is empty list
              if (!Array.isArray(result) || result.length === 0) {
                console.warn("[DB Service] No blocks found in existing database, treating as new");
                resolve(false);
              } else {
                resolve(true);
              }
            };
            blocks.onerror = () => {
              console.warn("[DB Service] Error reading blocks object store");
              resolve(false);
            };
          };
          request.onerror = () => {
            console.warn("[DB Service] Error opening IndexedDB");
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
    transaction: Omit<Transaction, "id" | "created_at" | "updated_at">
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
          transaction.account_id,
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
    transactions: Array<Omit<Transaction, "id" | "created_at" | "updated_at">>
  ): Promise<number[]> {
    try {
      const insertedIds: number[] = [];
      for (const transaction of transactions) {
        const result = await this.workerService.query(TRANSACTION_QUERIES.INSERT_TEMP_TRANSACTION, [
          transaction.date,
          transaction.amount,
          transaction.description,
          transaction.account_id,
          transaction.category_id || null,
          transaction.company_id || null,
          transaction.project_id || null,
          transaction.trip_id || null,
          transaction.type,
          transaction.transaction_hash || null,
        ]);
        // SQLite returns the last inserted rowid
        const lastId = await this.workerService.query('SELECT last_insert_rowid() as id');
        insertedIds.push(lastId[0].id);
      }
      return insertedIds;
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
    transactions: Array<Omit<Transaction, "id" | "created_at" | "updated_at">>
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

  async getRecentTransactions(limit: number): Promise<Transaction[]> {
    try {
      const rows = await this.workerService.query(
        TRANSACTION_QUERIES.GET_RECENT,
        [limit]
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

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return { where, params: queryParams };
  }

  private readonly TRANSACTION_JOINS = `
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN companies comp ON t.company_id = comp.id
    LEFT JOIN accounts a ON t.account_id = a.id
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
      const aggregateResult = await this.workerService.query(aggregateSql, filterParams);
      const total = Number(aggregateResult[0]?.total || 0);
      const totalIncome = Number(aggregateResult[0]?.total_income || 0);
      const totalExpenses = Number(aggregateResult[0]?.total_expenses || 0);

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

  async getDashboardSummary(startDate: string, endDate: string): Promise<DashboardSummary> {
    try {
      const rows = await this.workerService.query(
        ANALYTICS_QUERIES.DASHBOARD_SUMMARY,
        [startDate, endDate]
      );
      const row = rows[0] || {};
      const totalIncome = Number(row.total_income || 0);
      const totalExpenses = Number(row.total_expenses || 0);
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

  async getChartData(startDate: string, endDate: string): Promise<ChartData> {
    try {
      const trendStart = new Date(endDate);
      trendStart.setMonth(trendStart.getMonth() - 6);
      const trendStartStr = trendStart.toISOString().split('T')[0];

      const [spendingRows, incomeRows, trendRows, accountRows] = await Promise.all([
        this.workerService.query(ANALYTICS_QUERIES.SPENDING_BY_CATEGORY, [startDate, endDate]),
        this.workerService.query(ANALYTICS_QUERIES.INCOME_BY_SOURCE, [startDate, endDate]),
        this.workerService.query(ANALYTICS_QUERIES.TRENDS_BY_DATE_RANGE, [trendStartStr, endDate]),
        this.workerService.query(ANALYTICS_QUERIES.ACCOUNT_ANALYSIS, [startDate, endDate]),
      ]);

      const spendingByCategory = spendingRows.map((r: any) => ({
        id: r.category_id,
        label: r.category_name,
        value: Number(r.total),
        color: r.color || '#999',
      }));

      const incomeBySource = incomeRows.map((r: any) => {
        const label = `${r.user_display_name || 'Unknown'} - ${r.account_name} - ${r.category_name || 'Not Defined'}`;
        return {
          id: `${r.account_id}-${r.category_id || 'undefined'}`,
          label,
          value: Number(r.total),
          color: r.category_color || '#4caf50',
        };
      });

      const trends = {
        months: trendRows.map((r: any) => r.month),
        income: trendRows.map((r: any) => Number(r.income || 0)),
        expenses: trendRows.map((r: any) => Number(r.expense || 0)),
      };

      const accountAnalysis = {
        accountNames: accountRows.map((r: any) =>
          `${r.user_display_name ? r.user_display_name + ' - ' : ''}${r.account_name}`
        ),
        income: accountRows.map((r: any) => Number(r.income || 0)),
        expenses: accountRows.map((r: any) => Number(r.expenses || 0)),
      };

      return { spendingByCategory, incomeBySource, trends, accountAnalysis };
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

  async addAccount(
    account: Omit<Account, "id" | "created_at" | "updated_at" | "owner_user_id">,
    ownerUserId: number
  ): Promise<number> {
    try {
      const result = await this.workerService.query(ACCOUNT_QUERIES.CREATE, [
        account.name,
        account.type,
        ownerUserId,
      ]);
      const accountId = result[0].id;
      return accountId;
    } catch (error) {
      console.error("Failed to add account:", error);
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
      console.error("Failed to add account card:", error);
      throw error;
    }
  }

  async deleteAccountCard(id: number): Promise<void> {
    try {
      await this.workerService.query(ACCOUNT_CARD_QUERIES.DELETE, [id]);
    } catch (error) {
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

  // Budget operations
  async getBudgets(): Promise<Budget[]> {
    try {
      const rows = await this.workerService.query(BUDGET_QUERIES.GET_ALL);
      return rows.map(this.mapToBudget);
    } catch (error) {
      console.error("Failed to get budgets:", error);
      throw error;
    }
  }

  async addBudget(
    budget: Omit<Budget, "id" | "created_at" | "updated_at">
  ): Promise<number> {
    try {
      const result = await this.workerService.query(BUDGET_QUERIES.CREATE, [
        budget.category_id,
        budget.amount,
        budget.period || "monthly",
        budget.start_date,
        budget.end_date || null,
      ]);
      return result[0].id;
    } catch (error) {
      console.error("Failed to add budget:", error);
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
    user: Omit<User, "id" | "created_at" | "updated_at">
  ): Promise<number> {
    try {
      const result = await this.workerService.query(USER_QUERIES.CREATE, [
        user.display_name,
      ]);
      return result[0].id;
    } catch (error) {
      console.error("Failed to add user:", error);
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
      account_id: row.account_id,
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
    };
  }

  private mapToBudget(row: any): Budget {
    return {
      id: row.id,
      category_id: row.category_id,
      amount: row.amount,
      period: row.period,
      start_date: row.start_date,
      end_date: row.end_date,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
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
    transaction: Omit<Transaction, "id" | "created_at" | "updated_at">
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

  async getRecurringSeriesWithStats(): Promise<RecurringSeries[]> {
    try {
      const rows = await this.workerService.query(SUBSCRIPTION_QUERIES.GET_SERIES_WITH_STATS);
      return rows.map(this.mapToRecurringSeries);
    } catch (error) {
      console.error('Failed to get recurring series:', error);
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
