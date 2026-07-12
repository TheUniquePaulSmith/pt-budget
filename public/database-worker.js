// Database Shared Worker
// This worker handles all SQLite operations and communicates with the main thread

//import database schema
// Note: ES6 imports will be handled dynamically in the initialize method


class DatabaseWorker {
  constructor() {
    this.sqlite3 = null;
    this.sqlite3Constants = null;
    this.db = 0;
    this.vfs = null;
    this.vfsIdbName = 'ptbudgetapp';
    this.isInitialized = false;
    this.isConnected = false;
    this.ports = new Set();
    this.heartbeatInterval = null;
    this.dbVersion = '1.0.0';
    this.debugMode = false;
    this.currentFilename = '/budget-app.db';

    // Query processing queue and lock
    this.queryQueue = [];
    this.isProcessingQuery = false;

    // Encryption – the password is cached in worker memory for the lifetime of
    // this SharedWorker instance (i.e. while at least one tab remains open).
    this.encryptionPassword = null;

    // Lazy-loaded encryption module (public/database-encryption.js)
    this._encryptionModule = null;
    
    // Start heartbeat
    this.startHeartbeat();
  }

  // ---------------------------------------------------------------------------
  // Encryption helpers
  // ---------------------------------------------------------------------------

  async getEncryptionModule() {
    if (!this._encryptionModule) {
      this._encryptionModule = await import('/database-encryption.js');
    }
    return this._encryptionModule;
  }

  async setPassword(password) {
    if (!password || typeof password !== 'string' || password.length === 0) {
      throw new Error('Password must be a non-empty string');
    }
    this.encryptionPassword = password;
    console.info('[DB Worker] Encryption password set for this session');
  }

  clearPassword() {
    this.encryptionPassword = null;
    console.info('[DB Worker] Encryption password cleared');
  }

  isEncryptionReady() {
    return this.encryptionPassword !== null;
  }

  async encryptArchiveBytes(plainArchiveBytes, lastSaveTimestamp) {
    if (!this.encryptionPassword) {
      throw new Error('Encryption password is not set — call set_password first');
    }
    const enc = await this.getEncryptionModule();
    return enc.encryptArchive(plainArchiveBytes, this.encryptionPassword, lastSaveTimestamp);
  }

  async decryptArchiveBytes(encryptedBytes) {
    if (!this.encryptionPassword) {
      throw new Error('Encryption password is not set — call set_password first');
    }
    const enc = await this.getEncryptionModule();
    return enc.decryptArchive(encryptedBytes, this.encryptionPassword);
  }

  // Initialize WA-SQLite in the worker
  async initialize() {
    if (this.isInitialized) return;

    try {
      console.log('[DB Worker] Loading WA-SQLite modules...');
      
      // Use dynamic import for ES modules
      const sqliteModule = await import('/wa-sqlite/wa-sqlite-async.mjs');
      const SQLiteModule = sqliteModule.default;

      const apiModule = await import('/wa-sqlite/src/sqlite-api.js');
      const { Factory } = apiModule;

      //Load constants
      this.sqlite3Constants = await import('/wa-sqlite/src/sqlite-constants.js');

      const vfsModule = await import('/wa-sqlite/src/examples/IDBBatchAtomicVFS.js');
      const { IDBBatchAtomicVFS } = vfsModule;

      console.log('[DB Worker] Initializing SQLite WASM module...');
      const wasmModule = await SQLiteModule();

      console.log('[DB Worker] Creating SQLite API...');
      this.sqlite3 = Factory(wasmModule);

      console.log('[DB Worker] Creating IDB VFS...');
      this.vfs = await IDBBatchAtomicVFS.create(this.vfsIdbName, wasmModule);

      console.log('[DB Worker] Registering IDB VFS...');
      this.sqlite3.vfs_register(this.vfs, true);
      
      this.isInitialized = true;
      console.log('[DB Worker] Initialization complete');
      
      this.broadcastMessage({
        type: 'init_complete',
        isSuccessful: true,
        dbStatus: 'initialized',
        version: this.dbVersion,
        sqlResponse: null
      });
    } catch (error) {
      console.error('[DB Worker] Initialization failed:', error);
      this.broadcastMessage({
        type: 'init_error',
        isSuccessful: false,
        dbStatus: 'error',
        version: this.dbVersion,
        sqlResponse: { error: error.message }
      });
      throw error;
    }
  }

  async createTables(options = {}) {
    console.info("[DB Worker] Creating database tables...");
    const {CREATE_TABLES, CREATE_INDEXES, DEFAULT_DATA} = await import('/database-schema.js');
    const { ensureIndexes = true } = options;

    // Create all tables
      try {
          await this.sqlite3.exec(this.db, CREATE_TABLES.CATEGORIES);
          await this.sqlite3.exec(this.db, CREATE_TABLES.COMPANIES);
          await this.sqlite3.exec(this.db, CREATE_TABLES.USERS);
          await this.sqlite3.exec(this.db, CREATE_TABLES.ACCOUNTS);
          // ACCOUNT_USERS removed in favor of owner_user_id on accounts
          await this.sqlite3.exec(this.db, CREATE_TABLES.ACCOUNT_CARDS);
          await this.sqlite3.exec(this.db, CREATE_TABLES.TRANSACTIONS);
          await this.sqlite3.exec(this.db, CREATE_TABLES.BUDGETS);
          await this.sqlite3.exec(this.db, CREATE_TABLES.PROJECTS);
          await this.sqlite3.exec(this.db, CREATE_TABLES.TRIPS);
          await this.sqlite3.exec(this.db, CREATE_TABLES.TEMP_IMPORT_TRANSACTIONS);
          await this.sqlite3.exec(this.db, CREATE_TABLES.MERCHANT_RULES);
          await this.sqlite3.exec(this.db, CREATE_TABLES.RECURRING_SERIES);
          await this.sqlite3.exec(this.db, CREATE_TABLES.TRANSACTION_SERIES_LINKS);
          await this.sqlite3.exec(this.db, CREATE_TABLES.APP_METADATA);

          // Insert default data
          await this.sqlite3.exec(this.db, DEFAULT_DATA.CATEGORIES);
          // await this.sqlite3.exec(this.db, DEFAULT_DATA.USERS);
          // await this.sqlite3.exec(this.db, DEFAULT_DATA.ACCOUNTS);
          // await this.sqlite3.exec(this.db, DEFAULT_DATA.ACCOUNT_CARDS);

          if (ensureIndexes) {
            await this.ensureIndexes(CREATE_INDEXES);
          }

        console.info("[DB Worker] Database tables created successfully");
      } catch (error) {
        console.error("[DB Worker] Failed to create tables:", error);
        throw error;
      }
    }

  async ensureIndexes(createIndexes) {
    if (!createIndexes) {
      const { CREATE_INDEXES } = await import('/database-schema.js');
      createIndexes = CREATE_INDEXES;
    }
    console.info("[DB Worker] Ensuring indexes...");
    for (const sql of createIndexes) {
      await this.sqlite3.exec(this.db, sql);
    }
    console.info("[DB Worker] Indexes ready");
  }

  // Applies schema migrations gated by PRAGMA user_version. Must run before
  // ensureIndexes() on existing databases so indexes on migrated tables succeed.
  async runMigrations() {
    const { MIGRATIONS } = await import('/database-schema.js');

    let currentVersion = 0;
    await this.sqlite3.exec(this.db, 'PRAGMA user_version', (row) => {
      currentVersion = Number(row[0]) || 0;
    });

    const pending = MIGRATIONS.filter((migration) => migration.version > currentVersion)
      .sort((a, b) => a.version - b.version);

    for (const migration of pending) {
      const targetVersion = Number(migration.version);
      if (!Number.isInteger(targetVersion) || targetVersion <= 0) {
        throw new Error(`[DB Worker] Invalid migration version: ${migration.version}`);
      }
      console.info(`[DB Worker] Applying schema migration ${targetVersion}...`);
      for (const sql of migration.statements) {
        await this.sqlite3.exec(this.db, sql);
      }
      // PRAGMA values cannot be parameter-bound; targetVersion is validated above.
      await this.sqlite3.exec(this.db, `PRAGMA user_version = ${targetVersion}`);
      console.info(`[DB Worker] Schema migration ${targetVersion} applied`);
    }
  }

  // Queue management for sequential query processing
  async enqueueQuery(queryFunction) {
    return new Promise((resolve, reject) => {
      this.queryQueue.push({
        execute: queryFunction,
        resolve,
        reject
      });
      
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.isProcessingQuery || this.queryQueue.length === 0) {
      return;
    }

    this.isProcessingQuery = true;

    while (this.queryQueue.length > 0) {
      const queryItem = this.queryQueue.shift();
      
      try {
        const result = await queryItem.execute();
        queryItem.resolve(result);
      } catch (error) {
        queryItem.reject(error);
      }
    }

    this.isProcessingQuery = false;
  }

  async openDatabase(filename = '/budget-app.db', isNew = false, options = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const { deferIndexes = false } = options;
      console.log(`[DB Worker] Opening database: ${filename}`);
      this.currentFilename = filename;
      
      this.db = await this.sqlite3.open_v2(
        filename,
        this.sqlite3.SQLITE_OPEN_CREATE | this.sqlite3.SQLITE_OPEN_READWRITE,
        this.vfs.name
      );
      
      if (!this.db) {
        throw new Error('Failed to open database');
      }

      console.log(`[DB Worker] Database opened successfully with handle: ${this.db}`);
      this.isConnected = true;

      if (isNew) {
        // Configure database for optimal performance and consistency
        await this.sqlite3.exec(this.db, 'PRAGMA locking_mode=NORMAL');
        await this.sqlite3.exec(this.db, 'PRAGMA synchronous=NORMAL');
        await this.sqlite3.exec(this.db, 'PRAGMA foreign_keys=ON');

        // Create database tables
        await this.createTables({ ensureIndexes: !deferIndexes });

        // Stamp the schema version (tables already exist; statements are idempotent)
        await this.runMigrations();
      } else {
        // Migrations must run before indexes so indexes on new tables succeed
        await this.runMigrations();

        // Ensure indexes exist on existing databases (idempotent)
        await this.ensureIndexes();
      }

      
      return {
        type: 'database_opened',
        isSuccessful: true,
        dbStatus: 'connected',
        version: this.dbVersion,
        sqlResponse: { filename, isNew, deferIndexes }
      };
    } catch (error) {
      console.error('[DB Worker] Failed to open database:', error);
      this.isConnected = false;
      return {
        type: 'database_error',
        isSuccessful: false,
        dbStatus: 'disconnected',
        version: this.dbVersion,
        sqlResponse: { error: error.message }
      };
    }
  }

  async executeQuery(sql, parameters = []) {
    if (!this.isConnected || !this.db) {
      return {
        type: 'query_error',
        isSuccessful: false,
        dbStatus: 'disconnected',
        version: this.dbVersion,
        sqlResponse: { error: 'Database not connected' }
      };
    }

    // Queue the query operation to prevent concurrent access
    return await this.enqueueQuery(async () => {
      try {
        const results = [];

        // Prepare the statement if parameters are provided
        if (parameters.length > 0) {
          const preparedResults = await this.executePreparedStatement(
            sql,
            parameters,
            true
          );
          results.push(...preparedResults);
        } else {
          // Use exec for simple queries without parameters
          await this.sqlite3.exec(this.db, sql, (row, columns) => {
            const rowObj = {};
            columns.forEach((column, index) => {
              rowObj[column] = row[index];
            });
            results.push(rowObj);
          });
        }
        
        return {
          type: 'query_success',
          isSuccessful: true,
          dbStatus: 'connected',
          version: this.dbVersion,
          sqlResponse: { results, sql, parameters }
        };
      } catch (error) {
        console.error('[DB Worker] Query execution failed:', error);
        console.error('[DB Worker] Failed SQL:', sql);
        console.error('[DB Worker] Parameters:', parameters);
        return {
          type: 'query_error',
          isSuccessful: false,
          dbStatus: 'connected',
          version: this.dbVersion,
          sqlResponse: { 
            error: error.message, 
            sql, 
            parameters,
            stackTrace: error.stack 
          }
        };
      }
    });
  }

  async executeBatchQuery(sql, parameterSets = [], options = {}) {
    if (!this.isConnected || !this.db) {
      return {
        type: 'batch_query_error',
        isSuccessful: false,
        dbStatus: 'disconnected',
        version: this.dbVersion,
        sqlResponse: { error: 'Database not connected' }
      };
    }

    return await this.enqueueQuery(async () => {
      const useTransaction = options.useTransaction !== false;

      try {
        if (!Array.isArray(parameterSets) || parameterSets.length === 0) {
          return {
            type: 'batch_query_success',
            isSuccessful: true,
            dbStatus: 'connected',
            version: this.dbVersion,
            sqlResponse: { rowCount: 0, sql }
          };
        }

        if (useTransaction) {
          await this.sqlite3.exec(this.db, 'BEGIN IMMEDIATE');
        }

        try {
          for (const parameters of parameterSets) {
            await this.executePreparedStatement(sql, parameters, false);
          }

          if (useTransaction) {
            await this.sqlite3.exec(this.db, 'COMMIT');
          }
        } catch (error) {
          if (useTransaction) {
            try {
              await this.sqlite3.exec(this.db, 'ROLLBACK');
            } catch (rollbackError) {
              console.error('[DB Worker] Failed to roll back batch query:', rollbackError);
            }
          }

          throw error;
        }

        return {
          type: 'batch_query_success',
          isSuccessful: true,
          dbStatus: 'connected',
          version: this.dbVersion,
          sqlResponse: { rowCount: parameterSets.length, sql }
        };
      } catch (error) {
        console.error('[DB Worker] Batch query execution failed:', error);
        console.error('[DB Worker] Failed SQL:', sql);

        return {
          type: 'batch_query_error',
          isSuccessful: false,
          dbStatus: 'connected',
          version: this.dbVersion,
          sqlResponse: {
            error: error.message,
            sql,
            rowCount: 0,
          }
        };
      }
    });
  }

  bindParameters(stmt, parameters = []) {
    for (let index = 0; index < parameters.length; index += 1) {
      const param = parameters[index];
      if (param === null || param === undefined) {
        this.sqlite3.bind_null(stmt, index + 1);
      } else if (typeof param === 'number') {
        if (Number.isInteger(param)) {
          this.sqlite3.bind_int(stmt, index + 1, param);
        } else {
          this.sqlite3.bind_double(stmt, index + 1, param);
        }
      } else if (typeof param === 'string') {
        this.sqlite3.bind_text(stmt, index + 1, param);
      } else {
        this.sqlite3.bind_text(stmt, index + 1, String(param));
      }
    }
  }

  async executePreparedStatement(sql, parameters = [], collectResults = false) {
    const results = [];

    for await (const stmt of this.sqlite3.statements(this.db, sql)) {
      this.bindParameters(stmt, parameters);

      const columnNames = [];

      while (true) {
        const stepResult = await this.sqlite3.step(stmt);

        if (stepResult === this.sqlite3Constants.SQLITE_ROW) {
          if (!collectResults) {
            continue;
          }

          if (columnNames.length === 0) {
            const columnCount = this.sqlite3.column_count(stmt);
            for (let index = 0; index < columnCount; index += 1) {
              columnNames.push(this.sqlite3.column_name(stmt, index));
            }
          }

          const row = {};
          columnNames.forEach((column, index) => {
            row[column] = this.sqlite3.column(stmt, index);
          });
          results.push(row);
          continue;
        }

        if (stepResult === this.sqlite3Constants.SQLITE_DONE) {
          break;
        }

        throw new Error(`SQLite step failed with code ${stepResult}`);
      }
    }

    return results;
  }

  async executeCommand(sql) {
    if (!this.isConnected || !this.db) {
      return {
        type: 'command_error',
        isSuccessful: false,
        dbStatus: 'disconnected',
        version: this.dbVersion,
        sqlResponse: { error: 'Database not connected' }
      };
    }

    // Queue the command operation to prevent concurrent access
    return await this.enqueueQuery(async () => {
      try {
        await this.sqlite3.exec(this.db, sql);
        return {
          type: 'command_success',
          isSuccessful: true,
          dbStatus: 'connected',
          version: this.dbVersion,
          sqlResponse: { sql }
        };
      } catch (error) {
        console.error('[DB Worker] Command execution failed:', error);
        return {
          type: 'command_error',
          isSuccessful: false,
          dbStatus: 'connected',
          version: this.dbVersion,
          sqlResponse: { error: error.message, sql }
        };
      }
    });
  }

  async exportDatabase() {
    if (!this.isConnected || !this.db) {
      throw new Error('Database not connected');
    }

    try {
      console.log('[DB Worker] Exporting database snapshot...');

      await this.closeDatabaseConnection();
      const snapshot = await this.readVfsSnapshot();
      await this.reopenCurrentDatabase();

      console.log('[DB Worker] Database snapshot exported successfully');
      return {
        type: 'database_snapshot_exported',
        isSuccessful: true,
        dbStatus: 'connected',
        version: this.dbVersion,
        sqlResponse: { snapshot }
      };
    } catch (error) {
      console.error('[DB Worker] Failed to export database snapshot:', error);
      return {
        type: 'export_error',
        isSuccessful: false,
        dbStatus: this.isConnected ? 'connected' : 'disconnected',
        version: this.dbVersion,
        sqlResponse: { error: error.message }
      };
    }
  }

  async importDatabaseSnapshot(snapshot) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      console.log('[DB Worker] Importing database snapshot...');

      await this.closeDatabaseConnection();
      await this.writeVfsSnapshot(snapshot);
      await this.reopenCurrentDatabase();

      console.log('[DB Worker] Database snapshot imported successfully');
      return {
        type: 'database_snapshot_imported',
        isSuccessful: true,
        dbStatus: 'connected',
        version: this.dbVersion,
        sqlResponse: { message: 'Database imported successfully' }
      };
    } catch (error) {
      console.error('[DB Worker] Failed to import database snapshot:', error);
      this.isConnected = false;
      return {
        type: 'import_error',
        isSuccessful: false,
        dbStatus: 'disconnected',
        version: this.dbVersion,
        sqlResponse: { error: error.message }
      };
    }
  }

  async closeDatabaseConnection() {
    if (!this.db) {
      this.isConnected = false;
      return;
    }

    await this.sqlite3.close(this.db);
    this.db = 0;
    this.isConnected = false;
  }

  async reopenCurrentDatabase() {
    const response = await this.openDatabase(this.currentFilename, false);
    if (!response?.isSuccessful) {
      throw new Error(
        response?.sqlResponse?.error ||
          'Failed to reopen database after snapshot operation'
      );
    }
  }

  async openVfsDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.vfsIdbName, 6);

      request.onerror = () => {
        reject(request.error || new Error('Failed to open VFS IndexedDB'));
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
    });
  }

  async readAllFromStore(store) {
    return new Promise((resolve, reject) => {
      const request = store.getAll();

      request.onerror = () => {
        reject(request.error || new Error('Failed to read object store'));
      };
      request.onsuccess = () => {
        resolve(request.result || []);
      };
    });
  }

  async waitForTransaction(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => {
        reject(transaction.error || new Error('IndexedDB transaction failed'));
      };
      transaction.onabort = () => {
        reject(transaction.error || new Error('IndexedDB transaction aborted'));
      };
    });
  }

  async readVfsSnapshot() {
    const idb = await this.openVfsDatabase();

    try {
      const transaction = idb.transaction(['metadata', 'blocks'], 'readonly');
      const metadataStore = transaction.objectStore('metadata');
      const blocksStore = transaction.objectStore('blocks');
      const [metadata, blocks] = await Promise.all([
        this.readAllFromStore(metadataStore),
        this.readAllFromStore(blocksStore),
      ]);
      await this.waitForTransaction(transaction);

      return {
        format: 'wa-sqlite-idb-batch-atomic-v1',
        idbName: this.vfsIdbName,
        exportedAt: new Date().toISOString(),
        metadata,
        blocks: blocks.map((block) => ({
          ...block,
          data:
            block.data instanceof Uint8Array
              ? block.data
              : new Uint8Array(block.data),
        })),
      };
    } finally {
      idb.close();
    }
  }

  async writeVfsSnapshot(snapshot) {
    if (!snapshot || snapshot.format !== 'wa-sqlite-idb-batch-atomic-v1') {
      throw new Error('Snapshot payload is invalid');
    }

    const idb = await this.openVfsDatabase();

    try {
      const transaction = idb.transaction(['metadata', 'blocks'], 'readwrite');
      const metadataStore = transaction.objectStore('metadata');
      const blocksStore = transaction.objectStore('blocks');

      metadataStore.clear();
      blocksStore.clear();

      for (const metadata of snapshot.metadata || []) {
        metadataStore.put(metadata);
      }

      for (const block of snapshot.blocks || []) {
        blocksStore.put({
          ...block,
          data:
            block.data instanceof Uint8Array
              ? block.data
              : new Uint8Array(block.data),
        });
      }

      await this.waitForTransaction(transaction);
    } finally {
      idb.close();
    }
  }

  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      this.broadcastMessage({
        type: 'heartbeat',
        isSuccessful: true,
        dbStatus: this.isConnected ? 'connected' : 'disconnected',
        version: this.dbVersion,
        sqlResponse: { timestamp: Date.now() }
      });
    }, 5000); // Send heartbeat every 5 seconds
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  addPort(port) {
    this.ports.add(port);
    console.log(`[DB Worker] Port added. Total ports: ${this.ports.size}`);
  }

  removePort(port) {
    this.ports.delete(port);
    console.log(`[DB Worker] Port removed. Total ports: ${this.ports.size}`);
    
    if (this.ports.size === 0) {
      this.stopHeartbeat();
    }
  }

  broadcastMessage(message) {
    this.ports.forEach(port => {
      try {
        port.postMessage(message);
      } catch (error) {
        console.error('[DB Worker] Failed to send message to port:', error);
        this.removePort(port);
      }
    });
  }

  async handleMessage(event, port) {
    const { id, type, payload } = event.data;
    if (this.debugMode) {
      console.debug(`[DB Worker] Received message ${id}: ${type}`, payload);
    }
    let response;
    
    try {
      switch (type) {
        case 'initialize':
          await this.initialize();
          response = {
            type: 'initialize_response',
            isSuccessful: true,
            dbStatus: 'initialized',
            version: this.dbVersion,
            sqlResponse: null
          };
          break;
          
        case 'open_database':
          response = await this.openDatabase(
            payload?.filename,
            payload?.isNew,
            payload?.options
          );
          break;

        case 'create_tables':
          await this.createTables(payload?.options);
          response = {
            type: 'create_tables_response',
            isSuccessful: true,
            dbStatus: this.isConnected ? 'connected' : 'disconnected',
            version: this.dbVersion,
            sqlResponse: { message: 'Tables created successfully' }
          };
          break;

        case 'ensure_indexes':
          await this.ensureIndexes();
          response = {
            type: 'ensure_indexes_response',
            isSuccessful: true,
            dbStatus: this.isConnected ? 'connected' : 'disconnected',
            version: this.dbVersion,
            sqlResponse: { message: 'Indexes ensured successfully' }
          };
          break;

        case 'query':
          response = await this.executeQuery(payload.sql, payload.parameters);
          console.debug(`[DB Worker] Response for query: `, response);
          break;

        case 'batch_query':
          response = await this.executeBatchQuery(
            payload.sql,
            payload.parameterSets,
            payload.options
          );
          break;
          
        case 'exec':
          response = await this.executeCommand(payload.sql);
          break;
          
        case 'ping':
          response = {
            type: 'pong',
            isSuccessful: true,
            dbStatus: this.isConnected ? 'connected' : 'disconnected',
            version: this.dbVersion,
            sqlResponse: { timestamp: Date.now() }
          };
          break;
          
        case 'export_database_snapshot':
          response = await this.exportDatabase();
          break;

        case 'import_database_snapshot':
          response = await this.importDatabaseSnapshot(payload.snapshot);
          break;

        // ----------------------------------------------------------------
        // Encryption-related messages
        // ----------------------------------------------------------------

        case 'set_password': {
          await this.setPassword(payload?.password);
          response = {
            type: 'set_password_response',
            isSuccessful: true,
            dbStatus: this.isConnected ? 'connected' : 'disconnected',
            version: this.dbVersion,
            sqlResponse: { message: 'Password set successfully' }
          };
          break;
        }

        case 'clear_password': {
          this.clearPassword();
          response = {
            type: 'clear_password_response',
            isSuccessful: true,
            dbStatus: this.isConnected ? 'connected' : 'disconnected',
            version: this.dbVersion,
            sqlResponse: { message: 'Password cleared' }
          };
          break;
        }

        case 'check_encryption_ready': {
          response = {
            type: 'check_encryption_ready_response',
            isSuccessful: true,
            dbStatus: this.isConnected ? 'connected' : 'disconnected',
            version: this.dbVersion,
            sqlResponse: { isReady: this.isEncryptionReady() }
          };
          break;
        }

        case 'encrypt_archive': {
          // payload: { archiveBytes: Uint8Array, lastSaveTimestamp: string }
          const encryptedBytes = await this.encryptArchiveBytes(
            payload.archiveBytes,
            payload.lastSaveTimestamp
          );
          response = {
            type: 'encrypt_archive_response',
            isSuccessful: true,
            dbStatus: this.isConnected ? 'connected' : 'disconnected',
            version: this.dbVersion,
            sqlResponse: { encryptedBytes }
          };
          break;
        }

        case 'decrypt_archive': {
          // payload: { encryptedBytes: Uint8Array }
          const plainBytes = await this.decryptArchiveBytes(payload.encryptedBytes);
          response = {
            type: 'decrypt_archive_response',
            isSuccessful: true,
            dbStatus: this.isConnected ? 'connected' : 'disconnected',
            version: this.dbVersion,
            sqlResponse: { plainBytes }
          };
          break;
        }

        case 'set_debug':
          this.debugMode = payload?.debug || false;
          return;


        default:
          response = {
            type: 'error',
            isSuccessful: false,
            dbStatus: this.isConnected ? 'connected' : 'disconnected',
            version: this.dbVersion,
            sqlResponse: { error: `Unknown message type: ${type}` }
          };
      }
    } catch (error) {
      response = {
        type: 'error',
        isSuccessful: false,
        dbStatus: this.isConnected ? 'connected' : 'disconnected',
        version: this.dbVersion,
        sqlResponse: { error: error.message }
      };
    }
    
    // Add the request ID to the response for correlation
    response.id = id;
    
    port.postMessage(response);
  }
}

// Create the worker instance
const dbWorker = new DatabaseWorker();

// Handle new connections
self.addEventListener('connect', (event) => {
  const port = event.ports[0];
  
  dbWorker.addPort(port);
  
  port.addEventListener('message', (event) => {
    dbWorker.handleMessage(event, port);
  });
  
  port.addEventListener('close', () => {
    dbWorker.removePort(port);
  });
  
  port.start();
  
  // Send initial status
  port.postMessage({
    type: 'worker_connected',
    isSuccessful: true,
    dbStatus: dbWorker.isConnected ? 'connected' : 'disconnected',
    version: dbWorker.dbVersion,
    sqlResponse: { message: 'Worker connected successfully' }
  });
});

console.log('[DB Worker] Database worker initialized');
