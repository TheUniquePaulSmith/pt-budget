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
    // Renamed from the original 'ptbudgetapp' so pre-existing plaintext
    // databases are orphaned (never read/migrated) rather than opened by the
    // new encrypting VFS, which would fail to decrypt them.
    this.vfsIdbName = 'ptbudgetapp-v2-encrypted';
    // Out-of-band store for the page-encryption salt/verifier — must be
    // readable before the VFS/SQLite is touched at all (see readEncryptionHeader).
    this._headerIdbName = 'ptbudgetapp-keys';
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

    // Encryption — both are cached in worker memory for the lifetime of this
    // SharedWorker instance (i.e. while at least one tab remains open).
    // `pageKey` (mirrors the VFS's own key) gates every database open/read/
    // write; `encryptionPassword` is the raw password, used only to derive
    // the separate archive-encryption key (see database-encryption.js).
    this.pageKey = null;
    this.encryptionPassword = null;

    // Lazy-loaded encryption module (public/database-encryption.js)
    this._encryptionModule = null;

    // Change-notification debounce state (see notifyDatabaseChanged)
    this.changeNotifyTimer = null;
    this.pendingWriteCount = 0;

    // Lazily-loaded SQL write/read classifier (public/database-sql-classifier.js)
    this._sqlClassifierModule = null;

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

  isEncryptionReady() {
    return this.pageKey !== null;
  }

  async encryptArchiveBytes(plainArchiveBytes, lastSaveTimestamp) {
    if (!this.encryptionPassword) {
      throw new Error('Database is locked — unlock it before exporting');
    }
    const enc = await this.getEncryptionModule();
    return enc.encryptArchive(plainArchiveBytes, this.encryptionPassword, lastSaveTimestamp);
  }

  // `explicitPassword` lets a caller decrypt a standalone archive (e.g. a
  // file/cloud download picked before any local database exists) using
  // whatever password the user just typed, without depending on — or
  // side-affecting — the worker's ambient cached password.
  async decryptArchiveBytes(encryptedBytes, explicitPassword) {
    const password = explicitPassword || this.encryptionPassword;
    if (!password) {
      throw new Error('Database is locked — unlock it before importing');
    }
    const enc = await this.getEncryptionModule();
    return enc.decryptArchive(encryptedBytes, password);
  }

  // ---------------------------------------------------------------------------
  // Out-of-band encryption header (page-encryption salt/verifier)
  //
  // Stored in its own IndexedDB database, entirely separate from the VFS's
  // own `blocks`/`metadata` stores, so it can be read before the VFS/SQLite
  // is touched at all — the salt is needed to derive the key that decrypts
  // page 1, which is itself inside the VFS-managed blocks.
  // ---------------------------------------------------------------------------

  async openHeaderDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this._headerIdbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('header')) {
          db.createObjectStore('header', { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        reject(request.error || new Error('Failed to open encryption header database'));
      };
    });
  }

  async readEncryptionHeader() {
    const idb = await this.openHeaderDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const request = idb.transaction('header', 'readonly').objectStore('header').get('default');
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error('Failed to read encryption header'));
      });
    } finally {
      idb.close();
    }
  }

  async writeEncryptionHeader(header) {
    const idb = await this.openHeaderDatabase();
    try {
      await new Promise((resolve, reject) => {
        const transaction = idb.transaction('header', 'readwrite');
        transaction.objectStore('header').put(header);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('Failed to write encryption header'));
        transaction.onabort = () => reject(transaction.error || new Error('Encryption header transaction aborted'));
      });
    } finally {
      idb.close();
    }
  }

  /** Compares a candidate password against the stored header's verifier, without unlocking anything. */
  async verifyPassword(password) {
    if (typeof password !== 'string' || password.length === 0) return false;
    try {
      const header = await this.readEncryptionHeader();
      if (!header) return false;
      const enc = await this.getEncryptionModule();
      const candidateKey = await enc.derivePageKey(password, enc.hexToBytes(header.pageSalt));
      return await enc.checkPageKeyVerifier(candidateKey, header.verifierIv, header.verifierCiphertext);
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Database create / unlock / lock (VFS-level page encryption)
  // ---------------------------------------------------------------------------

  /** Creates a brand-new encrypted database. Fails if one already exists on this device. */
  async createNewDatabase(password, filename, options) {
    if (!this.isInitialized) {
      await this.initialize();
    }
    if (typeof password !== 'string' || password.length === 0) {
      throw new Error('Password must be a non-empty string');
    }

    const existing = await this.readEncryptionHeader();
    if (existing) {
      throw new Error('An encrypted database already exists on this device');
    }

    const enc = await this.getEncryptionModule();
    const vfsModule = await import('/database-encrypted-vfs.js');
    const pageSalt = crypto.getRandomValues(new Uint8Array(32));
    const pageKey = await enc.derivePageKey(password, pageSalt);
    const verifier = await enc.createPageKeyVerifier(pageKey);

    const header = {
      id: 'default',
      format: 'budget-tracker-page-encryption-header-v1',
      createdAt: new Date().toISOString(),
      pageSalt: enc.bytesToHex(pageSalt),
      pbkdf2Iterations: enc.PBKDF2_ITERATIONS,
      blockSize: vfsModule.DEFAULT_BLOCK_SIZE,
      verifierIv: verifier.verifierIv,
      verifierCiphertext: verifier.verifierCiphertext,
    };
    await this.writeEncryptionHeader(header);

    this.vfs.setKey(pageKey, header.blockSize);
    this.pageKey = pageKey;
    this.encryptionPassword = password;

    return await this.openDatabase(filename, true, options);
  }

  /** Unlocks the existing encrypted database on this device. Rejects on a wrong password without touching the VFS/blocks. */
  async unlockDatabase(password, filename) {
    if (!this.isInitialized) {
      await this.initialize();
    }
    if (typeof password !== 'string' || password.length === 0) {
      throw new Error('Password must be a non-empty string');
    }
    if (this.isConnected) {
      throw new Error('Database is already unlocked — call lock_database first');
    }

    const header = await this.readEncryptionHeader();
    if (!header) {
      throw new Error('No encrypted database found on this device');
    }

    const enc = await this.getEncryptionModule();
    const pageKey = await enc.derivePageKey(password, enc.hexToBytes(header.pageSalt));
    const isValid = await enc.checkPageKeyVerifier(pageKey, header.verifierIv, header.verifierCiphertext);
    if (!isValid) {
      throw new Error('Incorrect password');
    }

    this.vfs.setKey(pageKey, header.blockSize);
    this.pageKey = pageKey;
    this.encryptionPassword = password;

    return await this.openDatabase(filename, false, {});
  }

  /** Closes the live connection and forgets the key — the database cannot be read again until unlock_database succeeds. */
  async lockDatabase() {
    await this.closeDatabaseConnection();
    this.vfs?.clearKey();
    this.pageKey = null;
    this.encryptionPassword = null;
  }

  /**
   * Re-encrypts every physically-stored block under a newly-derived key.
   * Only the `data` field of each `blocks` record changes — file paths,
   * physical offsets, and the VFS's own version/crash-recovery bookkeeping
   * in `metadata` are untouched.
   */
  async changePassword(oldPassword, newPassword) {
    if (typeof newPassword !== 'string' || newPassword.length === 0) {
      throw new Error('New password must be a non-empty string');
    }
    const oldHeader = await this.readEncryptionHeader();
    if (!oldHeader) {
      throw new Error('No encrypted database found on this device');
    }
    const isCurrentValid = await this.verifyPassword(oldPassword);
    if (!isCurrentValid) {
      throw new Error('Current password is incorrect');
    }
    if (!this.pageKey) {
      throw new Error('Database is locked — unlock it before changing the password');
    }

    return await this.enqueueQuery(async () => {
      const enc = await this.getEncryptionModule();
      const vfsModule = await import('/database-encrypted-vfs.js');
      const { physicalBlockSize, decryptBlock, encryptBlock, formatFilename } = vfsModule;

      const oldPageKey = this.pageKey;
      const newPageSalt = crypto.getRandomValues(new Uint8Array(32));
      const newPageKey = await enc.derivePageKey(newPassword, newPageSalt);
      const newVerifier = await enc.createPageKeyVerifier(newPageKey);
      const pbs = physicalBlockSize(oldHeader.blockSize);

      await this.closeDatabaseConnection();

      const idb = await this.openVfsDatabase();
      try {
        const readTransaction = idb.transaction('blocks', 'readonly');
        const blocks = await this.readAllFromStore(readTransaction.objectStore('blocks'));
        await this.waitForTransaction(readTransaction);

        const reencrypted = await Promise.all(
          blocks.map(async (block) => {
            const physicalOffset = -block.offset;
            const blockIndex = Math.round(physicalOffset / pbs);
            const aad = formatFilename(this.vfs.name, block.path);
            const physicalData = block.data instanceof Uint8Array ? block.data : new Uint8Array(block.data);
            const plaintext = await decryptBlock(oldPageKey, aad, blockIndex, physicalData);
            const newPhysicalData = await encryptBlock(newPageKey, aad, blockIndex, plaintext);
            return { ...block, data: newPhysicalData };
          })
        );

        const writeTransaction = idb.transaction('blocks', 'readwrite');
        const blocksStore = writeTransaction.objectStore('blocks');
        for (const block of reencrypted) {
          blocksStore.put(block);
        }
        await this.waitForTransaction(writeTransaction);
      } finally {
        idb.close();
      }

      const newHeader = {
        ...oldHeader,
        pageSalt: enc.bytesToHex(newPageSalt),
        verifierIv: newVerifier.verifierIv,
        verifierCiphertext: newVerifier.verifierCiphertext,
      };
      await this.writeEncryptionHeader(newHeader);

      this.vfs.setKey(newPageKey, newHeader.blockSize);
      this.pageKey = newPageKey;
      this.encryptionPassword = newPassword;

      await this.reopenCurrentDatabase();
    });
  }

  // ---------------------------------------------------------------------------
  // Change notification
  // ---------------------------------------------------------------------------

  async getSqlClassifier() {
    if (!this._sqlClassifierModule) {
      this._sqlClassifierModule = await import('/database-sql-classifier.js');
    }
    return this._sqlClassifierModule;
  }

  // Broadcasts a 'database_changed' event to all connected tabs, coalescing
  // bursts of writes into a single notification instead of one per statement.
  notifyDatabaseChanged() {
    this.pendingWriteCount += 1;

    if (this.changeNotifyTimer) {
      return;
    }

    this.changeNotifyTimer = setTimeout(() => {
      const writeCount = this.pendingWriteCount;
      this.pendingWriteCount = 0;
      this.changeNotifyTimer = null;

      this.broadcastMessage({
        type: 'database_changed',
        isSuccessful: true,
        dbStatus: this.isConnected ? 'connected' : 'disconnected',
        version: this.dbVersion,
        sqlResponse: { changedAt: new Date().toISOString(), writeCount }
      });
    }, 500);
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

      const vfsModule = await import('/database-encrypted-vfs.js');
      const { EncryptedIDBBatchAtomicVFS } = vfsModule;

      console.log('[DB Worker] Initializing SQLite WASM module...');
      const wasmModule = await SQLiteModule();

      console.log('[DB Worker] Creating SQLite API...');
      this.sqlite3 = Factory(wasmModule);

      console.log('[DB Worker] Creating encrypting IDB VFS...');
      // Constructed once for the SharedWorker's lifetime — setKey()/clearKey()
      // (called from createNewDatabase/unlockDatabase/lockDatabase) toggle
      // whether it reads/writes ciphertext, but the VFS instance itself is
      // never re-created or re-registered.
      this.vfs = await EncryptedIDBBatchAtomicVFS.create(this.vfsIdbName, wasmModule);

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
          await this.sqlite3.exec(this.db, CREATE_TABLES.PROJECTS);
          await this.sqlite3.exec(this.db, CREATE_TABLES.TRIPS);
          await this.sqlite3.exec(this.db, CREATE_TABLES.TEMP_IMPORT_TRANSACTIONS);
          await this.sqlite3.exec(this.db, CREATE_TABLES.MERCHANT_RULES);
          await this.sqlite3.exec(this.db, CREATE_TABLES.RECURRING_SERIES);
          await this.sqlite3.exec(this.db, CREATE_TABLES.TRANSACTION_SERIES_LINKS);
          await this.sqlite3.exec(this.db, CREATE_TABLES.BUDGET_PLANS);
          await this.sqlite3.exec(this.db, CREATE_TABLES.BUDGET_PLAN_CATEGORIES);
          await this.sqlite3.exec(this.db, CREATE_TABLES.INCOME_SOURCES);
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

  // Per-connection PRAGMAs applied on every open. These do not persist in the
  // database file, so a reopened connection reverts to SQLite defaults without
  // this. cache_size is the primary lever against the encrypting VFS's per-page
  // decrypt cost: a larger cache keeps hot pages decrypted in WASM memory.
  async applyConnectionPragmas() {
    // Negative value = absolute memory budget in KiB, independent of page_size,
    // so 32 MB stays 32 MB even though page_size is 8192 (a positive page count
    // would silently double when page_size doubled).
    await this.sqlite3.exec(this.db, 'PRAGMA cache_size=-32768'); // 32 MB
    // Keep GROUP BY/ORDER BY scratch B-trees in RAM instead of spilling to
    // encrypted temp files through the VFS.
    await this.sqlite3.exec(this.db, 'PRAGMA temp_store=MEMORY');
    // Relax durability to match new-database behavior on reopen (the base VFS
    // honors this to use 'relaxed' IndexedDB transaction durability).
    await this.sqlite3.exec(this.db, 'PRAGMA synchronous=NORMAL');
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
        // page_size can only be set while the DB is empty (the base VFS refuses
        // a change once the file has content), so it must precede the first
        // write. 8192 must stay in lockstep with the encrypting VFS block size
        // (DEFAULT_BLOCK_SIZE in database-encrypted-vfs.js).
        await this.sqlite3.exec(this.db, 'PRAGMA page_size=8192');

        // locking_mode is the SQLite default; foreign_keys is intentionally
        // enabled only for new databases (see the FK note in databaseService.ts)
        // and deliberately NOT re-enabled on reopen.
        await this.sqlite3.exec(this.db, 'PRAGMA locking_mode=NORMAL');
        await this.sqlite3.exec(this.db, 'PRAGMA foreign_keys=ON');
      }

      // Per-connection performance PRAGMAs must be applied on EVERY open (new and
      // reopened): cache_size/temp_store/synchronous do not persist across
      // connections and otherwise revert to slow SQLite defaults on reopen.
      await this.applyConnectionPragmas();

      if (isNew) {
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
    // Queue the query operation to prevent concurrent access. The
    // connectivity check happens inside the queued task (not before
    // enqueueing) so a query that arrives while an export/import is
    // mid-flight waits its turn instead of failing immediately.
    return await this.enqueueQuery(async () => {
      if (!this.isConnected || !this.db) {
        return {
          type: 'query_error',
          isSuccessful: false,
          dbStatus: 'disconnected',
          version: this.dbVersion,
          sqlResponse: { error: 'Database not connected' }
        };
      }

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

        const { isWriteSql } = await this.getSqlClassifier();
        if (isWriteSql(sql)) {
          this.notifyDatabaseChanged();
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
    return await this.enqueueQuery(async () => {
      if (!this.isConnected || !this.db) {
        return {
          type: 'batch_query_error',
          isSuccessful: false,
          dbStatus: 'disconnected',
          version: this.dbVersion,
          sqlResponse: { error: 'Database not connected' }
        };
      }

      const useTransaction = options.useTransaction !== false;
      const collectResults = options.collectResults === true;

      try {
        if (!Array.isArray(parameterSets) || parameterSets.length === 0) {
          return {
            type: 'batch_query_success',
            isSuccessful: true,
            dbStatus: 'connected',
            version: this.dbVersion,
            sqlResponse: { rowCount: 0, sql, ...(collectResults ? { results: [] } : {}) }
          };
        }

        if (useTransaction) {
          await this.sqlite3.exec(this.db, 'BEGIN IMMEDIATE');
        }

        let collectedResults = null;
        try {
          // Single compile, reused across all parameter sets (see
          // executeReusablePreparedStatement) within one transaction.
          collectedResults = await this.executeReusablePreparedStatement(
            sql,
            parameterSets,
            collectResults
          );

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

        const { isWriteSql } = await this.getSqlClassifier();
        if (isWriteSql(sql)) {
          this.notifyDatabaseChanged();
        }

        return {
          type: 'batch_query_success',
          isSuccessful: true,
          dbStatus: 'connected',
          version: this.dbVersion,
          sqlResponse: {
            rowCount: parameterSets.length,
            sql,
            ...(collectResults ? { results: collectedResults ?? [] } : {})
          }
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

  // Compiles `sql` once and runs it for every parameter set, reusing the
  // prepared statement (reset + clear_bindings + rebind) instead of recompiling
  // per row as executePreparedStatement would. `sql` must be a single
  // statement (the batch contract). When collectResults is true, returns the
  // rows produced by each execution (e.g. INSERT ... RETURNING id) in
  // parameter-set order; otherwise returns null.
  async executeReusablePreparedStatement(sql, parameterSets, collectResults = false) {
    const collected = collectResults ? [] : null;

    for await (const stmt of this.sqlite3.statements(this.db, sql)) {
      let columnNames = null;

      for (const parameters of parameterSets) {
        // reset() on a freshly prepared statement is a valid no-op, so this is
        // safe on the first iteration too.
        await this.sqlite3.reset(stmt);
        this.sqlite3.clear_bindings(stmt);
        this.bindParameters(stmt, parameters);

        while (true) {
          const stepResult = await this.sqlite3.step(stmt);

          if (stepResult === this.sqlite3Constants.SQLITE_ROW) {
            if (!collectResults) {
              continue;
            }

            if (columnNames === null) {
              columnNames = [];
              const columnCount = this.sqlite3.column_count(stmt);
              for (let index = 0; index < columnCount; index += 1) {
                columnNames.push(this.sqlite3.column_name(stmt, index));
              }
            }

            const row = {};
            columnNames.forEach((column, index) => {
              row[column] = this.sqlite3.column(stmt, index);
            });
            collected.push(row);
            continue;
          }

          if (stepResult === this.sqlite3Constants.SQLITE_DONE) {
            break;
          }

          throw new Error(`SQLite step failed with code ${stepResult}`);
        }
      }
    }

    return collected;
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
    // Queue the command operation to prevent concurrent access. The
    // connectivity check happens inside the queued task, matching
    // executeQuery/executeBatchQuery.
    return await this.enqueueQuery(async () => {
      if (!this.isConnected || !this.db) {
        return {
          type: 'command_error',
          isSuccessful: false,
          dbStatus: 'disconnected',
          version: this.dbVersion,
          sqlResponse: { error: 'Database not connected' }
        };
      }

      try {
        await this.sqlite3.exec(this.db, sql);

        const { isWriteSql } = await this.getSqlClassifier();
        if (isWriteSql(sql)) {
          this.notifyDatabaseChanged();
        }

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
    // Routed through the query queue so a concurrent query/command can't
    // interleave with the close/read/reopen sequence below (previously this
    // ran outside the queue, so a query arriving mid-export would fail with
    // "Database not connected" instead of waiting its turn).
    return await this.enqueueQuery(async () => {
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
    });
  }

  async importDatabaseSnapshot(snapshot) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Routed through the query queue for the same reason as exportDatabase:
    // serializes the close/write/reopen sequence against concurrent queries.
    return await this.enqueueQuery(async () => {
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
    });
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

  // readVfsSnapshot/writeVfsSnapshot are the export/import boundary used by
  // both local file export and cloud sync (Google Drive/OneDrive), so a
  // snapshot must stay a PORTABLE, logically-plaintext representation —
  // decrypting on export and re-encrypting on import — even though the live
  // `blocks` store physically holds ciphertext. Otherwise a snapshot created
  // on one device (encrypted under its own randomly-generated page key)
  // could never be decrypted on another device, breaking cross-device sync.

  async readVfsSnapshot() {
    if (!this.pageKey) {
      throw new Error('Database is locked — unlock it before exporting');
    }
    const enc = await this.getEncryptionModule();
    const header = await this.readEncryptionHeader();
    const vfsModule = await import('/database-encrypted-vfs.js');
    const { physicalBlockSize, decryptBlock, formatFilename } = vfsModule;
    const blockSize = header.blockSize;
    const pbs = physicalBlockSize(blockSize);

    const idb = await this.openVfsDatabase();

    try {
      const transaction = idb.transaction(['metadata', 'blocks'], 'readonly');
      const metadataStore = transaction.objectStore('metadata');
      const blocksStore = transaction.objectStore('blocks');
      const [physicalMetadata, physicalBlocks] = await Promise.all([
        this.readAllFromStore(metadataStore),
        this.readAllFromStore(blocksStore),
      ]);
      await this.waitForTransaction(transaction);

      const metadata = physicalMetadata.map((entry) => ({
        ...entry,
        fileSize: Math.round((entry.fileSize / pbs) * blockSize),
      }));

      const blocks = await Promise.all(
        physicalBlocks.map(async (block) => {
          const physicalOffset = -block.offset;
          const blockIndex = Math.round(physicalOffset / pbs);
          const physicalData = block.data instanceof Uint8Array ? block.data : new Uint8Array(block.data);
          const plaintext = await decryptBlock(this.pageKey, formatFilename(this.vfs.name, block.path), blockIndex, physicalData);
          return { ...block, offset: -(blockIndex * blockSize), data: plaintext };
        })
      );

      return {
        format: 'wa-sqlite-idb-batch-atomic-v1',
        idbName: this.vfsIdbName,
        exportedAt: new Date().toISOString(),
        metadata,
        blocks,
      };
    } finally {
      idb.close();
    }
  }

  async writeVfsSnapshot(snapshot) {
    if (!snapshot || snapshot.format !== 'wa-sqlite-idb-batch-atomic-v1') {
      throw new Error('Snapshot payload is invalid');
    }
    if (!this.pageKey) {
      throw new Error('Database is locked — unlock it before importing');
    }

    const header = await this.readEncryptionHeader();
    const vfsModule = await import('/database-encrypted-vfs.js');
    const { physicalBlockSize, encryptBlock, formatFilename } = vfsModule;
    const blockSize = header.blockSize;
    const pbs = physicalBlockSize(blockSize);

    const idb = await this.openVfsDatabase();

    try {
      const transaction = idb.transaction(['metadata', 'blocks'], 'readwrite');
      const metadataStore = transaction.objectStore('metadata');
      const blocksStore = transaction.objectStore('blocks');

      metadataStore.clear();
      blocksStore.clear();

      for (const metadata of snapshot.metadata || []) {
        metadataStore.put({
          ...metadata,
          fileSize: Math.round((metadata.fileSize / blockSize) * pbs),
        });
      }

      const encryptedBlocks = await Promise.all(
        (snapshot.blocks || []).map(async (block) => {
          const logicalOffset = -block.offset;
          const blockIndex = Math.round(logicalOffset / blockSize);
          const plainSource = block.data instanceof Uint8Array ? block.data : new Uint8Array(block.data);
          // Every physical block must be a fixed, full block size — pad a
          // short trailing block (possible for auxiliary/journal files)
          // rather than storing a variably-sized physical block, which would
          // corrupt later reads (see EncryptedIDBBatchAtomicVFS#readBlock).
          const plaintext =
            plainSource.byteLength === blockSize
              ? plainSource
              : (() => {
                  const padded = new Uint8Array(blockSize);
                  padded.set(plainSource.subarray(0, Math.min(plainSource.byteLength, blockSize)));
                  return padded;
                })();
          const physicalData = await encryptBlock(this.pageKey, formatFilename(this.vfs.name, block.path), blockIndex, plaintext);
          return { ...block, offset: -(blockIndex * pbs), data: physicalData };
        })
      );

      for (const block of encryptedBlocks) {
        blocksStore.put(block);
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
          
        case 'recreate_database': {
          if (!this.pageKey) {
            throw new Error('Database is locked — unlock it first');
          }
          response = await this.openDatabase(
            payload?.filename ?? this.currentFilename,
            true,
            payload?.options
          );
          break;
        }

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

        case 'create_new_database': {
          response = await this.createNewDatabase(
            payload?.password,
            payload?.filename,
            payload?.options
          );
          break;
        }

        case 'unlock_database': {
          response = await this.unlockDatabase(payload?.password, payload?.filename);
          break;
        }

        case 'lock_database': {
          await this.lockDatabase();
          response = {
            type: 'lock_database_response',
            isSuccessful: true,
            dbStatus: 'disconnected',
            version: this.dbVersion,
            sqlResponse: { message: 'Database locked' }
          };
          break;
        }

        case 'change_password': {
          await this.changePassword(payload?.oldPassword, payload?.newPassword);
          response = {
            type: 'change_password_response',
            isSuccessful: true,
            dbStatus: this.isConnected ? 'connected' : 'disconnected',
            version: this.dbVersion,
            sqlResponse: { message: 'Password changed successfully' }
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

        case 'verify_password': {
          const isMatch = await this.verifyPassword(payload?.password);
          response = {
            type: 'verify_password_response',
            isSuccessful: true,
            dbStatus: this.isConnected ? 'connected' : 'disconnected',
            version: this.dbVersion,
            sqlResponse: { isMatch }
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
          // payload: { encryptedBytes: Uint8Array, password?: string }
          const plainBytes = await this.decryptArchiveBytes(payload.encryptedBytes, payload.password);
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
