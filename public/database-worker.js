// Database Shared Worker
// This worker handles all SQLite operations and communicates with the main thread

//import database schema
// Note: ES6 imports will be handled dynamically in the initialize method

// ---------------------------------------------------------------------------
// Logging
//
// This is a classic (non-module) worker script, so the structured logger in
// /database-logger.js is loaded with a dynamic import. The facade below
// accepts records from the first line of execution, queues them until the
// module is ready, and then forwards everything — so startup records are
// never lost. Records land in the shared `ptbudgetapp-logs` IndexedDB store
// with `source: 'worker'` and are joined to app rows by `correlationId`.
// ---------------------------------------------------------------------------

class WorkerLogFacade {
  constructor(shared, context = {}, options = {}) {
    this.shared = shared;
    this.context = context;
    // `debug: false` suppresses trace/debug for this child regardless of the
    // global level (per-port debug: only tabs that asked see their request
    // rows at debug level).
    this.debugEnabled = options.debug !== false;
    if (!shared.loading) {
      shared.loading = import('/database-logger.js')
        .then((module) => {
          shared.module = module;
          shared.logger = module.createWorkerLogger({ level: shared.level });
          for (const [level, message, context] of shared.pending) shared.logger.emit(level, message, context);
          shared.pending = [];
        })
        .catch((error) => {
          console.error('[DB Worker] Failed to load the worker logger module', error);
          shared.pending = [];
          shared.failed = true;
        });
    }
  }

  static create() {
    return new WorkerLogFacade({ level: 'info', pending: [], logger: null, module: null, loading: null, failed: false });
  }

  setLevel(level) {
    this.shared.level = level;
    if (this.shared.logger) this.shared.logger.setLevel(level);
  }

  getLevel() {
    return this.shared.level;
  }

  child(context, options) {
    return new WorkerLogFacade(this.shared, { ...this.context, ...context }, {
      debug: options && options.debug !== undefined ? options.debug : this.debugEnabled,
    });
  }

  emit(level, message, context) {
    if ((level === 'trace' || level === 'debug') && !this.debugEnabled) return;
    const merged = { ...this.context, ...(context || {}) };
    if (this.shared.logger) {
      this.shared.logger.emit(level, message, merged);
      return;
    }
    if (this.shared.failed) {
      if (level === 'warn' || level === 'error') console[level](`[DB Worker] ${message}`, merged);
      return;
    }
    if (this.shared.pending.length < 2000) this.shared.pending.push([level, message, merged]);
  }

  trace(message, context) {
    this.emit('trace', message, context);
  }
  debug(message, context) {
    this.emit('debug', message, context);
  }
  info(message, context) {
    this.emit('info', message, context);
  }
  warn(message, context) {
    this.emit('warn', message, context);
  }
  error(message, context) {
    this.emit('error', message, context);
  }

  /** The request-scoped context (correlation id = message id, operation = type, tab meta). */
  requestContext(id, type, meta) {
    if (this.shared.module) return this.shared.module.requestLogContext(id, type, meta);
    const context = { component: 'DatabaseWorker' };
    if (typeof id === 'string' && id !== '') {
      context.correlationId = id;
      const separator = id.indexOf(':');
      if (separator > 0) context.tabId = id.slice(0, separator);
    }
    if (typeof type === 'string') context.operation = type;
    if (meta && typeof meta === 'object') {
      if (typeof meta.page === 'string') context.page = meta.page;
      if (typeof meta.component === 'string') context.appComponent = meta.component;
      if (typeof meta.operation === 'string' && meta.operation !== type) context.appOperation = meta.operation;
    }
    return context;
  }

  flush() {
    return this.shared.logger ? this.shared.logger.flush() : Promise.resolve();
  }

  /** Persists (or with `discard`, drops) queued records, releases the log database and stops all further writes. */
  async close(options) {
    await this.shared.loading;
    this.shared.pending = [];
    if (this.shared.logger) await this.shared.logger.close(options);
  }
}

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
    // Ports that asked for debug logging (`set_debug` is per-port); the
    // worker's global level is debug while at least one such port is open.
    this.debugPorts = new WeakSet();
    this.debugPortCount = 0;
    this.currentFilename = '/budget-app.db';

    // Structured logger (see WorkerLogFacade). `activeLog` is the request-
    // scoped child for the queued operation currently executing, so deep
    // helpers (migrations, pragmas) log under the right correlation id.
    this.log = WorkerLogFacade.create();
    this.activeLog = this.log;

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

    // Set by terminateWorker(): from then on every request is refused so
    // nothing can reopen the storage that was just released and deleted.
    this.isTerminated = false;

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

  // True when a page key is held AND the header it was derived from still
  // exists. The header lives in its own IndexedDB database, so it can vanish
  // (Reset App, cleared site data) while this SharedWorker keeps running with
  // the key in memory. Such a key is orphaned — nothing on disk matches it —
  // so drop it and let the caller fall back to the setup/password flow
  // rather than importing into a store that has no header.
  async isEncryptionReady(requestLog) {
    if (this.pageKey === null) {
      return false;
    }

    let header;
    try {
      header = await this.readEncryptionHeader();
    } catch (error) {
      // Can't prove the header is gone, so keep the key rather than lock out
      // a database that may be perfectly healthy.
      (requestLog || this.log).warn('Could not verify the encryption header', { error });
      return true;
    }
    if (header) {
      return true;
    }

    await this.discardOrphanedEncryptionState(requestLog || this.log);
    return false;
  }

  // The wipe that removed the header also tried to delete the VFS store, but
  // this worker's open handle either blocks that delete (and every later open
  // of the store queues behind it) or was force-closed by the browser. Either
  // way the VFS is unusable, so forget the key and swap in a fresh VFS: closing
  // the old handle lets the pending delete finish, and the new one recreates
  // the store.
  async discardOrphanedEncryptionState(log) {
    log.warn('Encryption header is missing while a key is held — discarding the orphaned key and VFS');

    try {
      await this.closeDatabaseConnection();
    } catch (error) {
      log.warn('Could not close the database connection cleanly', { error });
      this.db = 0;
      this.isConnected = false;
    }

    this.vfs.clearKey();
    this.pageKey = null;
    this.encryptionPassword = null;

    this.vfs.close();
    const { EncryptedIDBBatchAtomicVFS } = await import('/database-encrypted-vfs.js');
    this.vfs = await EncryptedIDBBatchAtomicVFS.create(this.vfsIdbName, this.wasmModule);
    this.sqlite3.vfs_register(this.vfs, true);
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

  // The header is the only record of the block size and key salt, so a VFS
  // snapshot can be neither read nor written without it.
  async requireEncryptionHeader() {
    const header = await this.readEncryptionHeader();
    if (!header) {
      throw new Error(
        'Encryption header not found on this device — the local database appears to have been removed. ' +
          'Reload the app and set the database up again.'
      );
    }
    return header;
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
  async createNewDatabase(password, filename, options, requestLog) {
    const log = requestLog || this.log;
    if (!this.isInitialized) {
      await this.initialize(log);
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
    log.info('Encryption header written for a new database');

    return await this.openDatabase(filename, true, options, log);
  }

  /** Unlocks the existing encrypted database on this device. Rejects on a wrong password without touching the VFS/blocks. */
  async unlockDatabase(password, filename, requestLog) {
    const log = requestLog || this.log;
    if (!this.isInitialized) {
      await this.initialize(log);
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
      log.warn('Unlock rejected: incorrect password');
      throw new Error('Incorrect password');
    }

    this.vfs.setKey(pageKey, header.blockSize);
    this.pageKey = pageKey;
    this.encryptionPassword = password;

    return await this.openDatabase(filename, false, {}, log);
  }

  /** Closes the live connection and forgets the key — the database cannot be read again until unlock_database succeeds. */
  async lockDatabase(requestLog) {
    await this.closeDatabaseConnection();
    this.vfs?.clearKey();
    this.pageKey = null;
    this.encryptionPassword = null;
    (requestLog || this.log).info('Database locked');
  }

  deleteIndexedDatabase(name) {
    return new Promise((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve('deleted');
      request.onerror = () => resolve('failed');
      // Another tab still holds a connection; the browser finishes the delete
      // as soon as that tab closes it (its reload does).
      request.onblocked = () => resolve('blocked');
    });
  }

  /**
   * Debug-only Reset App support: releases everything this worker holds, deletes
   * the IndexedDB stores it owns (the VFS blocks and the encryption header) and
   * exits, so the next page load starts a brand-new worker with no state.
   *
   * A worker has no localStorage/sessionStorage; its only "session" is the
   * in-memory key material, which is dropped here. `includeLogs` discards the
   * log records still queued instead of persisting them — the caller deletes the
   * shared log database itself, and the sink must not write into it again.
   */
  async terminateWorker(options, requestLog) {
    const log = requestLog || this.log;
    const includeLogs = options?.includeLogs === true;
    log.warn('Terminating the database worker', { process: 'terminate', includeLogs });

    this.isTerminated = true;
    this.stopHeartbeat();
    if (this.changeNotifyTimer) {
      clearTimeout(this.changeNotifyTimer);
      this.changeNotifyTimer = null;
    }
    this.pendingWriteCount = 0;

    try {
      await this.closeDatabaseConnection();
    } catch (error) {
      log.warn('Could not close the database connection cleanly', { process: 'terminate', error });
      this.db = 0;
      this.isConnected = false;
    }

    this.vfs?.clearKey();
    this.pageKey = null;
    this.encryptionPassword = null;
    try {
      this.vfs?.close();
    } catch (error) {
      log.warn('Could not close the VFS cleanly', { process: 'terminate', error });
    }
    this.vfs = null;
    this.isInitialized = false;

    // With the handles above closed these complete at once.
    const [vfsStore, headerStore] = await Promise.all([
      this.deleteIndexedDatabase(this.vfsIdbName),
      this.deleteIndexedDatabase(this._headerIdbName),
    ]);
    log.info('Database worker storage released', { process: 'terminate', vfsStore, headerStore });

    this.broadcastMessage({
      type: 'worker_terminated',
      isSuccessful: true,
      dbStatus: 'disconnected',
      version: this.dbVersion,
      sqlResponse: { message: 'Database worker terminated' },
    });

    await this.log.close({ discard: includeLogs });

    // Exit once the reply to the requesting tab has been posted.
    setTimeout(() => self.close(), 100);

    return {
      type: 'terminate_worker_response',
      isSuccessful: true,
      dbStatus: 'disconnected',
      version: this.dbVersion,
      sqlResponse: { message: 'Database worker terminated', vfsStore, headerStore },
    };
  }

  /**
   * Re-encrypts every physically-stored block under a newly-derived key.
   * Only the `data` field of each `blocks` record changes — file paths,
   * physical offsets, and the VFS's own version/crash-recovery bookkeeping
   * in `metadata` are untouched.
   */
  async changePassword(oldPassword, newPassword, requestLog) {
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
      const log = this.activeLog.child({ process: 'change-password' });
      log.info('Re-encrypting database under a new password...');
      const startedAt = Date.now();
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
      log.info('Password changed', { durationMs: Date.now() - startedAt });
    }, requestLog);
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
  async initialize(requestLog) {
    if (this.isInitialized) return;
    const log = (requestLog || this.log).child({ process: 'initialize' });

    try {
      log.info('Loading WA-SQLite modules...');
      
      // Use dynamic import for ES modules
      const sqliteModule = await import('/wa-sqlite/wa-sqlite-async.mjs');
      const SQLiteModule = sqliteModule.default;

      const apiModule = await import('/wa-sqlite/src/sqlite-api.js');
      const { Factory } = apiModule;

      //Load constants
      this.sqlite3Constants = await import('/wa-sqlite/src/sqlite-constants.js');

      const vfsModule = await import('/database-encrypted-vfs.js');
      const { EncryptedIDBBatchAtomicVFS } = vfsModule;

      log.debug('Initializing SQLite WASM module...');
      const wasmModule = await SQLiteModule();
      this.wasmModule = wasmModule;

      log.debug('Creating SQLite API...');
      this.sqlite3 = Factory(wasmModule);

      log.debug('Creating encrypting IDB VFS...');
      // Constructed once for the SharedWorker's lifetime — setKey()/clearKey()
      // (called from createNewDatabase/unlockDatabase/lockDatabase) toggle
      // whether it reads/writes ciphertext, but the VFS instance itself is
      // only ever re-created to recover from a wiped header
      // (discardOrphanedEncryptionState).
      this.vfs = await EncryptedIDBBatchAtomicVFS.create(this.vfsIdbName, wasmModule);

      log.debug('Registering IDB VFS...');
      this.sqlite3.vfs_register(this.vfs, true);
      
      this.isInitialized = true;
      log.info('Initialization complete');
      
      this.broadcastMessage({
        type: 'init_complete',
        isSuccessful: true,
        dbStatus: 'initialized',
        version: this.dbVersion,
        sqlResponse: null
      });
    } catch (error) {
      log.error('Initialization failed', { error });
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

  async createTables(options = {}, requestLog) {
    const log = requestLog || this.activeLog;
    log.info('Creating database tables...');
    const {CREATE_TABLES, CREATE_INDEXES, DEFAULT_DATA} = await import('/database-schema.js');
    const { ensureIndexes = true } = options;

    // Create all tables. Every entry of CREATE_TABLES is created, in
    // declaration order, so a table added to the schema file cannot be
    // forgotten here (SQLite does not require referenced parent tables to
    // exist at CREATE time).
      try {
          for (const createTableSql of Object.values(CREATE_TABLES)) {
            await this.sqlite3.exec(this.db, createTableSql);
          }

          // Insert default data
          await this.sqlite3.exec(this.db, DEFAULT_DATA.CATEGORIES);
          // await this.sqlite3.exec(this.db, DEFAULT_DATA.USERS);
          // await this.sqlite3.exec(this.db, DEFAULT_DATA.ACCOUNTS);
          // await this.sqlite3.exec(this.db, DEFAULT_DATA.ACCOUNT_CARDS);

          if (ensureIndexes) {
            await this.ensureIndexes(CREATE_INDEXES, log);
          }

        log.info('Database tables created successfully');
      } catch (error) {
        log.error('Failed to create tables', { error });
        throw error;
      }
    }

  async ensureIndexes(createIndexes, requestLog) {
    const log = requestLog || this.activeLog;
    if (!createIndexes) {
      const { CREATE_INDEXES } = await import('/database-schema.js');
      createIndexes = CREATE_INDEXES;
    }
    log.info('Ensuring indexes...', { indexCount: createIndexes.length });
    const startedAt = Date.now();
    for (const sql of createIndexes) {
      await this.sqlite3.exec(this.db, sql);
    }
    log.info('Indexes ready', { durationMs: Date.now() - startedAt });
  }

  // ---------------------------------------------------------------------------
  // Schema migrations (see the MIGRATIONS notes in database-schema.js)
  // ---------------------------------------------------------------------------

  // Runs a statement and collects its rows as objects (PRAGMA / SELECT).
  async readRows(sql) {
    const rows = [];
    await this.sqlite3.exec(this.db, sql, (row, columns) => {
      const record = {};
      columns.forEach((column, index) => {
        record[column] = row[index];
      });
      rows.push(record);
    });
    return rows;
  }

  quoteIdentifier(name) {
    return `"${String(name).replace(/"/g, '""')}"`;
  }

  async readUserVersion() {
    const rows = await this.readRows('PRAGMA user_version');
    return Number(rows[0]?.user_version) || 0;
  }

  async readTableColumns(table) {
    const rows = await this.readRows(`PRAGMA table_info(${this.quoteIdentifier(table)})`);
    return rows.map((row) => String(row.name));
  }

  // Every FK violation as a stable key, so a migration can be checked for the
  // violations it *introduced* rather than pre-existing orphans (foreign keys
  // are not enforced on reopened databases, so old orphans are possible).
  async readForeignKeyViolations() {
    const rows = await this.readRows('PRAGMA foreign_key_check');
    return new Set(rows.map((row) => `${row.table}:${row.rowid}:${row.parent}:${row.fkid}`));
  }

  // Applies schema migrations gated by PRAGMA user_version. Must run before
  // ensureIndexes() on existing databases so indexes on migrated tables succeed.
  async runMigrations(requestLog) {
    const log = (requestLog || this.activeLog).child({ process: 'migration' });
    const { MIGRATIONS } = await import('/database-schema.js');

    const currentVersion = await this.readUserVersion();
    const pending = MIGRATIONS.filter((migration) => migration.version > currentVersion)
      .sort((a, b) => a.version - b.version);
    if (pending.length === 0) {
      log.debug('Schema is current', { userVersion: currentVersion });
      return;
    }
    log.info('Schema migrations pending', {
      userVersion: currentVersion,
      targetVersions: pending.map((migration) => migration.version),
    });

    // Table rebuilds DROP a parent table; with foreign keys on, that would
    // cascade-delete every child row (e.g. transaction_series_links). PRAGMA
    // foreign_keys is a no-op inside a transaction, so toggle it out here and
    // restore the connection's previous setting afterwards.
    const foreignKeyRows = await this.readRows('PRAGMA foreign_keys');
    const foreignKeysWereOn = Number(foreignKeyRows[0]?.foreign_keys) === 1;
    if (foreignKeysWereOn) {
      await this.sqlite3.exec(this.db, 'PRAGMA foreign_keys=OFF');
    }
    try {
      for (const migration of pending) {
        await this.applyMigration(migration, log);
      }
    } finally {
      if (foreignKeysWereOn) {
        await this.sqlite3.exec(this.db, 'PRAGMA foreign_keys=ON');
      }
    }
  }

  // One migration = one transaction: every op, the integrity check and the
  // version stamp commit together or not at all.
  async applyMigration(migration, requestLog) {
    const log = (requestLog || this.activeLog).child({ process: 'migration' });
    const targetVersion = Number(migration.version);
    if (!Number.isInteger(targetVersion) || targetVersion <= 0) {
      throw new Error(`[DB Worker] Invalid migration version: ${migration.version}`);
    }
    log.info(`Applying schema migration ${targetVersion}...`, { targetVersion });
    const startedAt = Date.now();

    const violationsBefore = await this.readForeignKeyViolations();
    await this.sqlite3.exec(this.db, 'BEGIN IMMEDIATE');
    try {
      for (const op of migration.statements) {
        await this.runMigrationOp(op);
      }

      const violationsAfter = await this.readForeignKeyViolations();
      const introduced = [...violationsAfter].filter((key) => !violationsBefore.has(key));
      if (introduced.length > 0) {
        throw new Error(
          `Schema migration ${targetVersion} introduced ${introduced.length} foreign key violation(s): ` +
            introduced.slice(0, 5).join('; ')
        );
      }

      // PRAGMA values cannot be parameter-bound; targetVersion is validated above.
      await this.sqlite3.exec(this.db, `PRAGMA user_version = ${targetVersion}`);
      await this.sqlite3.exec(this.db, 'COMMIT');
    } catch (error) {
      try {
        await this.sqlite3.exec(this.db, 'ROLLBACK');
      } catch (rollbackError) {
        log.error('Failed to roll back schema migration', { targetVersion, error: rollbackError });
      }
      log.error(`Schema migration ${targetVersion} failed`, { targetVersion, error });
      throw error;
    }
    log.info(`Schema migration ${targetVersion} applied`, { targetVersion, durationMs: Date.now() - startedAt });
  }

  async runMigrationOp(op) {
    if (typeof op === 'string') {
      await this.sqlite3.exec(this.db, op);
      return;
    }
    switch (op?.op) {
      case 'addColumn': {
        // ALTER TABLE ... ADD COLUMN is not idempotent; guard on table_info.
        const columns = await this.readTableColumns(op.table);
        if (columns.includes(op.column)) {
          return;
        }
        await this.sqlite3.exec(
          this.db,
          `ALTER TABLE ${this.quoteIdentifier(op.table)} ADD COLUMN ${op.ddl}`
        );
        return;
      }
      case 'dropTable':
        await this.sqlite3.exec(this.db, `DROP TABLE IF EXISTS ${this.quoteIdentifier(op.table)}`);
        return;
      case 'rebuild':
        await this.rebuildTable(op);
        return;
      case 'rehashTransactions':
        await this.rehashTransactions();
        return;
      default:
        throw new Error(`[DB Worker] Unknown migration op: ${JSON.stringify(op)}`);
    }
  }

  // Recreates a table to change its constraints while preserving rows:
  //   CREATE <table>_new (from the current CREATE_TABLES entry)
  //   INSERT INTO <table>_new (...) SELECT ... FROM <table>
  //   DROP <table>; ALTER TABLE <table>_new RENAME TO <table>
  // The old table is dropped BEFORE the rename on purpose: renaming the old
  // table out of the way first would make SQLite rewrite every foreign key in
  // other tables to point at the renamed (soon deleted) copy.
  // Columns are copied by name when the old table has them; columnExpressions
  // supplies SQL for columns that need translating; anything else takes the
  // new table's DEFAULT.
  async rebuildTable({ table, guardColumn, create, columnExpressions = {} }) {
    const existingColumns = await this.readTableColumns(table);
    if (existingColumns.length === 0) {
      // Table never existed on this database: the final shape is enough.
      await this.sqlite3.exec(this.db, create);
      return;
    }
    if (guardColumn && existingColumns.includes(guardColumn)) {
      return; // already rebuilt (e.g. a retry after a crash past this step)
    }

    const newTable = `${table}_new`;
    const createNew = create.replace(
      /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(/i,
      `CREATE TABLE ${newTable} (`
    );
    if (createNew === create) {
      throw new Error(`[DB Worker] Cannot derive a rebuild statement for ${table}`);
    }

    await this.sqlite3.exec(this.db, `DROP TABLE IF EXISTS ${this.quoteIdentifier(newTable)}`);
    await this.sqlite3.exec(this.db, createNew);

    const targetColumns = await this.readTableColumns(newTable);
    const insertColumns = [];
    const selectExpressions = [];
    for (const column of targetColumns) {
      if (Object.prototype.hasOwnProperty.call(columnExpressions, column)) {
        insertColumns.push(this.quoteIdentifier(column));
        selectExpressions.push(columnExpressions[column]);
      } else if (existingColumns.includes(column)) {
        insertColumns.push(this.quoteIdentifier(column));
        selectExpressions.push(this.quoteIdentifier(column));
      }
    }

    await this.sqlite3.exec(
      this.db,
      `INSERT INTO ${this.quoteIdentifier(newTable)} (${insertColumns.join(', ')}) ` +
        `SELECT ${selectExpressions.join(', ')} FROM ${this.quoteIdentifier(table)}`
    );
    await this.sqlite3.exec(this.db, `DROP TABLE ${this.quoteIdentifier(table)}`);
    await this.sqlite3.exec(
      this.db,
      `ALTER TABLE ${this.quoteIdentifier(newTable)} RENAME TO ${this.quoteIdentifier(table)}`
    );
  }

  // Recomputes every pre-v2 transaction hash with the shared SHA-256 scheme
  // (public/database-hash.js), keyed on the numeric account id. Two legacy rows
  // that collapse onto one hash (a manual entry and its CSV twin, which the old
  // scheme hashed differently) are both kept: the later row gets the next free
  // variation seed and is flagged for the user to review. Rows that already
  // carry a v2 hash are left alone, so the step is safe to re-run.
  async rehashTransactions() {
    const { computeTransactionHash, isLegacyTransactionHash } = await import('/database-hash.js');

    const rows = await this.readRows(
      'SELECT id, account_id, date, amount, description, transaction_hash, hash_variation_seed FROM transactions ORDER BY id'
    );
    const taken = new Set(
      rows.filter((row) => !isLegacyTransactionHash(row.transaction_hash)).map((row) => row.transaction_hash)
    );

    const updates = [];
    for (const row of rows) {
      if (!isLegacyTransactionHash(row.transaction_hash)) {
        continue;
      }
      let seed = Number(row.hash_variation_seed) || 0;
      let hash = await computeTransactionHash(row.account_id, row.date, row.amount, row.description, seed);
      let flagged = 0;
      while (taken.has(hash)) {
        seed += 1;
        flagged = 1;
        hash = await computeTransactionHash(row.account_id, row.date, row.amount, row.description, seed);
      }
      taken.add(hash);
      updates.push([hash, seed, flagged, row.id]);
    }

    if (updates.length === 0) {
      return;
    }
    await this.executeReusablePreparedStatement(
      'UPDATE transactions SET transaction_hash = ?, hash_variation_seed = ?, is_flagged = CASE WHEN ? = 1 THEN 1 ELSE is_flagged END WHERE id = ?',
      updates,
      false
    );
    this.activeLog.info(`Rehashed ${updates.length} transaction(s)`, { process: 'migration', count: updates.length });
  }

  // Queue management for sequential query processing
  // `log` is the request-scoped logger for the operation; it becomes
  // `this.activeLog` while the item executes (the queue runs one item at a
  // time, so nested helpers can read it without threading it through).
  async enqueueQuery(queryFunction, log) {
    return new Promise((resolve, reject) => {
      this.queryQueue.push({
        execute: queryFunction,
        log: log || this.log,
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
      this.activeLog = queryItem.log;

      try {
        const result = await queryItem.execute();
        queryItem.resolve(result);
      } catch (error) {
        queryItem.reject(error);
      } finally {
        this.activeLog = this.log;
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

  async openDatabase(filename = '/budget-app.db', isNew = false, options = {}, requestLog) {
    const log = requestLog || this.activeLog;
    if (!this.isInitialized) {
      await this.initialize(log);
    }

    try {
      const { deferIndexes = false } = options;
      const startedAt = Date.now();
      log.info(`Opening database: ${filename}`, { filename, isNew, deferIndexes });
      this.currentFilename = filename;
      
      this.db = await this.sqlite3.open_v2(
        filename,
        this.sqlite3.SQLITE_OPEN_CREATE | this.sqlite3.SQLITE_OPEN_READWRITE,
        this.vfs.name
      );
      
      if (!this.db) {
        throw new Error('Failed to open database');
      }

      log.debug('Database handle opened', { handle: this.db });
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
        await this.createTables({ ensureIndexes: !deferIndexes }, log);

        // A fresh database already has the current shape, so stamp the version
        // directly instead of replaying migrations written for older shapes.
        const { SCHEMA_VERSION } = await import('/database-schema.js');
        await this.sqlite3.exec(this.db, `PRAGMA user_version = ${Number(SCHEMA_VERSION)}`);
      } else {
        // Migrations must run before indexes so indexes on new tables succeed
        await this.runMigrations(log);

        // Ensure indexes exist on existing databases (idempotent)
        await this.ensureIndexes(undefined, log);
      }

      log.info('Database opened', { filename, isNew, durationMs: Date.now() - startedAt });
      return {
        type: 'database_opened',
        isSuccessful: true,
        dbStatus: 'connected',
        version: this.dbVersion,
        sqlResponse: { filename, isNew, deferIndexes }
      };
    } catch (error) {
      log.error('Failed to open database', { filename, isNew, error });
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

  async executeQuery(sql, parameters = [], requestLog) {
    // Queue the query operation to prevent concurrent access. The
    // connectivity check happens inside the queued task (not before
    // enqueueing) so a query that arrives while an export/import is
    // mid-flight waits its turn instead of failing immediately.
    return await this.enqueueQuery(async () => {
      const log = this.activeLog;
      if (!this.isConnected || !this.db) {
        log.warn('Query rejected: database not connected', { sql });
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
        const startedAt = Date.now();

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
        const isWrite = isWriteSql(sql);
        if (isWrite) {
          this.notifyDatabaseChanged();
        }

        log.debug('Query executed', {
          sql,
          parameterCount: parameters.length,
          rowCount: results.length,
          isWrite,
          durationMs: Date.now() - startedAt,
        });

        return {
          type: 'query_success',
          isSuccessful: true,
          dbStatus: 'connected',
          version: this.dbVersion,
          sqlResponse: { results, sql, parameters }
        };
      } catch (error) {
        log.error('Query execution failed', { sql, parameters, error });
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
    }, requestLog);
  }

  async executeBatchQuery(sql, parameterSets = [], options = {}, requestLog) {
    return await this.enqueueQuery(async () => {
      const log = this.activeLog;
      if (!this.isConnected || !this.db) {
        log.warn('Batch query rejected: database not connected', { sql });
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
      const startedAt = Date.now();

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
              log.error('Failed to roll back batch query', { sql, error: rollbackError });
            }
          }

          throw error;
        }

        const { isWriteSql } = await this.getSqlClassifier();
        const isWrite = isWriteSql(sql);
        if (isWrite) {
          this.notifyDatabaseChanged();
        }

        log.debug('Batch query executed', {
          sql,
          parameterSetCount: parameterSets.length,
          useTransaction,
          isWrite,
          durationMs: Date.now() - startedAt,
        });

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
        log.error('Batch query execution failed', { sql, parameterSetCount: parameterSets.length, error });

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
    }, requestLog);
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

  async executeCommand(sql, requestLog) {
    // Queue the command operation to prevent concurrent access. The
    // connectivity check happens inside the queued task, matching
    // executeQuery/executeBatchQuery.
    return await this.enqueueQuery(async () => {
      const log = this.activeLog;
      if (!this.isConnected || !this.db) {
        log.warn('Command rejected: database not connected', { sql });
        return {
          type: 'command_error',
          isSuccessful: false,
          dbStatus: 'disconnected',
          version: this.dbVersion,
          sqlResponse: { error: 'Database not connected' }
        };
      }

      try {
        const startedAt = Date.now();
        await this.sqlite3.exec(this.db, sql);

        const { isWriteSql } = await this.getSqlClassifier();
        const isWrite = isWriteSql(sql);
        if (isWrite) {
          this.notifyDatabaseChanged();
        }

        log.debug('Command executed', { sql, isWrite, durationMs: Date.now() - startedAt });

        return {
          type: 'command_success',
          isSuccessful: true,
          dbStatus: 'connected',
          version: this.dbVersion,
          sqlResponse: { sql }
        };
      } catch (error) {
        log.error('Command execution failed', { sql, error });
        return {
          type: 'command_error',
          isSuccessful: false,
          dbStatus: 'connected',
          version: this.dbVersion,
          sqlResponse: { error: error.message, sql }
        };
      }
    }, requestLog);
  }

  async exportDatabase(requestLog) {
    // Routed through the query queue so a concurrent query/command can't
    // interleave with the close/read/reopen sequence below (previously this
    // ran outside the queue, so a query arriving mid-export would fail with
    // "Database not connected" instead of waiting its turn).
    return await this.enqueueQuery(async () => {
      const log = this.activeLog.child({ process: 'snapshot-export' });
      if (!this.isConnected || !this.db) {
        throw new Error('Database not connected');
      }

      try {
        log.info('Exporting database snapshot...');
        const startedAt = Date.now();

        await this.closeDatabaseConnection();
        const snapshot = await this.readVfsSnapshot();
        await this.reopenCurrentDatabase();

        log.info('Database snapshot exported successfully', {
          blockCount: snapshot.blocks.length,
          durationMs: Date.now() - startedAt,
        });
        return {
          type: 'database_snapshot_exported',
          isSuccessful: true,
          dbStatus: 'connected',
          version: this.dbVersion,
          sqlResponse: { snapshot }
        };
      } catch (error) {
        log.error('Failed to export database snapshot', { error });
        return {
          type: 'export_error',
          isSuccessful: false,
          dbStatus: this.isConnected ? 'connected' : 'disconnected',
          version: this.dbVersion,
          sqlResponse: { error: error.message }
        };
      }
    }, requestLog);
  }

  async importDatabaseSnapshot(snapshot, requestLog) {
    if (!this.isInitialized) {
      await this.initialize(requestLog);
    }

    // Routed through the query queue for the same reason as exportDatabase:
    // serializes the close/write/reopen sequence against concurrent queries.
    return await this.enqueueQuery(async () => {
      const log = this.activeLog.child({ process: 'snapshot-import' });
      try {
        log.info('Importing database snapshot...', { blockCount: snapshot?.blocks?.length });
        const startedAt = Date.now();

        await this.closeDatabaseConnection();
        await this.writeVfsSnapshot(snapshot);
        await this.reopenCurrentDatabase();

        log.info('Database snapshot imported successfully', { durationMs: Date.now() - startedAt });
        return {
          type: 'database_snapshot_imported',
          isSuccessful: true,
          dbStatus: 'connected',
          version: this.dbVersion,
          sqlResponse: { message: 'Database imported successfully' }
        };
      } catch (error) {
        log.error('Failed to import database snapshot', { error });
        this.isConnected = false;
        return {
          type: 'import_error',
          isSuccessful: false,
          dbStatus: 'disconnected',
          version: this.dbVersion,
          sqlResponse: { error: error.message }
        };
      }
    }, requestLog);
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
    const header = await this.requireEncryptionHeader();
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

    const header = await this.requireEncryptionHeader();
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
    this.log.debug('Heartbeat started', { process: 'heartbeat', intervalMs: 5000 });
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
      this.log.debug('Heartbeat stopped', { process: 'heartbeat' });
    }
  }

  addPort(port) {
    this.ports.add(port);
    this.log.info('Port added', { process: 'connection', portCount: this.ports.size });
  }

  removePort(port) {
    this.ports.delete(port);
    if (this.debugPorts.has(port)) {
      this.debugPorts.delete(port);
      this.debugPortCount = Math.max(0, this.debugPortCount - 1);
      this.updateLogLevel();
    }
    this.log.info('Port removed', { process: 'connection', portCount: this.ports.size });

    if (this.ports.size === 0) {
      this.stopHeartbeat();
      void this.log.flush();
    }
  }

  // `set_debug` is per-port: a port that asked sees debug rows for its own
  // requests; the worker-wide level is debug while any such port is open so
  // background work (migrations, persistence) is captured at debug too.
  setPortDebug(port, enabled) {
    const wasEnabled = this.debugPorts.has(port);
    if (enabled && !wasEnabled) {
      this.debugPorts.add(port);
      this.debugPortCount += 1;
    } else if (!enabled && wasEnabled) {
      this.debugPorts.delete(port);
      this.debugPortCount = Math.max(0, this.debugPortCount - 1);
    }
    this.updateLogLevel();
    this.log.debug('Port debug updated', { process: 'connection', enabled, debugPortCount: this.debugPortCount });
  }

  updateLogLevel() {
    this.log.setLevel(this.debugPortCount > 0 ? 'debug' : 'info');
  }

  broadcastMessage(message) {
    this.ports.forEach(port => {
      try {
        port.postMessage(message);
      } catch (error) {
        this.log.error('Failed to send message to port', { process: 'connection', messageType: message?.type, error });
        this.removePort(port);
      }
    });
  }

  async handleMessage(event, port) {
    const { id, type, payload } = event.data;
    // Request-scoped logger: correlation id = message id, operation = type,
    // plus the page / component the tab sent in payload.meta. Debug rows for
    // this request are only written when this port asked for debug.
    const log = this.log.child(this.log.requestContext(id, type, payload?.meta), {
      debug: this.debugPorts.has(port),
    });
    const startedAt = Date.now();
    log.debug('Received message', { payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload) : [] });

    if (this.isTerminated) {
      port.postMessage({
        id,
        type: 'error',
        isSuccessful: false,
        dbStatus: 'disconnected',
        version: this.dbVersion,
        sqlResponse: { error: 'Database worker has been terminated — reload the app' },
      });
      return;
    }

    let response;

    try {
      switch (type) {
        case 'initialize':
          await this.initialize(log);
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
            payload?.options,
            log
          );
          break;
        }

        case 'create_tables':
          await this.createTables(payload?.options, log);
          response = {
            type: 'create_tables_response',
            isSuccessful: true,
            dbStatus: this.isConnected ? 'connected' : 'disconnected',
            version: this.dbVersion,
            sqlResponse: { message: 'Tables created successfully' }
          };
          break;

        case 'ensure_indexes':
          await this.ensureIndexes(undefined, log);
          response = {
            type: 'ensure_indexes_response',
            isSuccessful: true,
            dbStatus: this.isConnected ? 'connected' : 'disconnected',
            version: this.dbVersion,
            sqlResponse: { message: 'Indexes ensured successfully' }
          };
          break;

        case 'query':
          response = await this.executeQuery(payload.sql, payload.parameters, log);
          break;

        case 'batch_query':
          response = await this.executeBatchQuery(
            payload.sql,
            payload.parameterSets,
            payload.options,
            log
          );
          break;

        case 'exec':
          response = await this.executeCommand(payload.sql, log);
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
          response = await this.exportDatabase(log);
          break;

        case 'import_database_snapshot':
          response = await this.importDatabaseSnapshot(payload.snapshot, log);
          break;

        // ----------------------------------------------------------------
        // Encryption-related messages
        // ----------------------------------------------------------------

        case 'create_new_database': {
          response = await this.createNewDatabase(
            payload?.password,
            payload?.filename,
            payload?.options,
            log
          );
          break;
        }

        case 'unlock_database': {
          response = await this.unlockDatabase(payload?.password, payload?.filename, log);
          break;
        }

        case 'lock_database': {
          await this.lockDatabase(log);
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
          await this.changePassword(payload?.oldPassword, payload?.newPassword, log);
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
            sqlResponse: { isReady: await this.isEncryptionReady(log) }
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

        case 'terminate_worker':
          response = await this.terminateWorker(payload, log);
          break;

        case 'set_debug':
          this.setPortDebug(port, payload?.debug === true);
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
      log.error(`Message handling failed: ${type}`, { error });
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

    log.debug('Responded', {
      responseType: response.type,
      isSuccessful: response.isSuccessful,
      durationMs: Date.now() - startedAt,
    });
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

dbWorker.log.info('Database worker initialized', { process: 'initialize' });
