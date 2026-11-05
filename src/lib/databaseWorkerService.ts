// Database Worker Message Channel Service
// Handles communication between main thread and database worker

import type { DatabaseVfsSnapshot } from './databaseArchive';
import { getDebugFlags } from './debugMode';
import {
  DatabaseWorkerError,
  type ArchiveRestoreSource,
  type MasterSecret,
  type NewConvenienceSlot,
  type SlotSummary,
  type UnlockMethod,
  type UnlockMethods,
} from './encryptionTypes';
import { getAmbientLogContext, logger, nextCorrelationId, type LogContext } from './logging';

/**
 * Traceability fields sent with every request. The worker stamps them on the
 * records it writes while handling the message, so app and worker rows share
 * a `correlationId` (which is also the message id, `<tabId>:<n>`).
 */
export interface DatabaseMessageMeta {
  correlationId: string;
  page?: string;
  component?: string;
  operation?: string;
}

export interface DatabaseMessage {
  id: string;
  type: string;
  payload?: any;
}

export interface DatabaseResponse {
  id: string;
  type: string;
  isSuccessful: boolean;
  dbStatus: 'disconnected' | 'connected' | 'initialized' | 'error';
  version: string;
  sqlResponse: any;
}

export interface BatchQueryOptions {
  useTransaction?: boolean;
  // When true, the worker collects and returns the rows produced by each
  // execution (e.g. INSERT ... RETURNING) in parameter-set order. Use
  // batchQueryReturning() for the typed row-array result.
  collectResults?: boolean;
}

export interface OpenDatabaseOptions {
  deferIndexes?: boolean;
}

export interface CreateTablesOptions {
  ensureIndexes?: boolean;
}

export interface WorkerStatus {
  isWorkerAlive: boolean;
  isConnected: boolean;
  dbStatus: 'disconnected' | 'connected' | 'initialized' | 'error';
  version: string;
  lastHeartbeat: number;
}

export interface DatabaseChangeEvent {
  changedAt: string;
  writeCount: number;
}

const log = logger.child({ component: 'DatabaseWorkerService' });

/** Builds the `meta` block for a request from the ambient log context (current page, component, operation). */
export function buildMessageMeta(correlationId: string, type: string, ambient: LogContext = getAmbientLogContext()): DatabaseMessageMeta {
  const meta: DatabaseMessageMeta = { correlationId };
  if (typeof ambient.page === 'string') meta.page = ambient.page;
  if (typeof ambient.component === 'string') meta.component = ambient.component;
  meta.operation = typeof ambient.operation === 'string' ? ambient.operation : type;
  return meta;
}

export class DatabaseWorkerService {
  private worker: SharedWorker | null = null;
  private port: MessagePort | null = null;
  private pendingMessages = new Map<string, { resolve: (value: any) => void; reject: (reason?: any) => void; timeout: NodeJS.Timeout | null; type: string; startedAt: number }>();
  private statusCallbacks = new Set<(status: WorkerStatus) => void>();
  private changeCallbacks = new Set<(event: DatabaseChangeEvent) => void>();
  private heartbeatTimeout: NodeJS.Timeout | null = null;
  private status: WorkerStatus = {
    isWorkerAlive: false,
    isConnected: false,
    dbStatus: 'disconnected',
    version: '1.0.0',
    lastHeartbeat: 0
  };

  constructor() {
    this.initializeWorker();
  }

  private isDebugMode(): boolean {
    return getDebugFlags().debug;
  }

  private initializeWorker() {
    // Skip initialization on server-side
    if (typeof window === 'undefined') {
      log.debug('Skipping worker initialization on server-side');
      return;
    }

    try {
      //Define the worker & port
      this.worker = new SharedWorker('/database-worker.js', { name: 'wa-SQLite' });
      this.port = this.worker.port;

      //Add event listeners for messages and errors
      this.port.addEventListener('message', this.handleMessage.bind(this));
      this.port.addEventListener('messageerror', this.handleError.bind(this));

      //Start the worker
      this.port.start();

      // Per-port debug flag: the worker logs debug-level rows for this tab's
      // requests only while this tab asked for it.
      if (this.isDebugMode()) {
        this.port.postMessage({ id: 'debug_config', type: 'set_debug', payload: { debug: true } });
      }

      // Start monitoring heartbeat
      this.startHeartbeatMonitoring();

      log.info('Database worker service started and ready to receive messages');
    } catch (error) {
      log.error('Failed to initialize worker', { error });
      this.updateStatus({ isWorkerAlive: false });
    }
  }

  private handleMessage(event: MessageEvent<DatabaseResponse>) {
    const response = event.data;


    // Handle initialization response
    if (response.type === 'initialize_response') {
      if (response.isSuccessful && response.dbStatus === 'initialized') {
        this.status = {
          isWorkerAlive: true,
          isConnected: true,
          dbStatus: 'initialized',
          version: response.version,
          lastHeartbeat: Date.now()
        };
      }
    }

    // Handle heartbeat messages
    if (response.type === 'heartbeat') {
      this.updateStatus({
        isWorkerAlive: true,
        isConnected: response.dbStatus === 'connected',
        dbStatus: response.dbStatus,
        version: response.version,
        lastHeartbeat: Date.now()
      });
      this.resetHeartbeatTimeout();
      return;
    }

    // The worker released its storage and is exiting (a debug-only Reset App,
    // possibly started from another tab). Mark it dead now rather than waiting
    // for the heartbeat to time out.
    if (response.type === 'worker_terminated') {
      if (this.heartbeatTimeout) {
        clearTimeout(this.heartbeatTimeout);
        this.heartbeatTimeout = null;
      }
      this.updateStatus({
        isWorkerAlive: false,
        isConnected: false,
        dbStatus: 'disconnected',
      });
      return;
    }

    // Handle worker connection confirmation
    if (response.type === 'worker_connected') {
      this.updateStatus({
        isWorkerAlive: true,
        dbStatus: response.dbStatus,
        version: response.version
      });
      return;
    }

    // Handle database-changed broadcasts (fired by the worker after a
    // write-classified statement succeeds — see notifyDatabaseChanged in
    // database-worker.js). Broadcast-only: no id, so it never reaches the
    // pending-message correlation below.
    if (response.type === 'database_changed') {
      const changeEvent = response.sqlResponse as DatabaseChangeEvent;
      this.changeCallbacks.forEach((callback) => {
        try {
          callback(changeEvent);
        } catch (error) {
          log.error('Change callback error', { error });
        }
      });
      return;
    }

    // Handle initialization and database status updates
    if (response.type === 'init_complete' || response.type === 'database_opened') {
      this.updateStatus({
        isWorkerAlive: true,
        isConnected: response.dbStatus === 'connected',
        dbStatus: response.dbStatus,
        version: response.version
      });
    }

    //Handle pending message responses
    if (response.id) {
      const pending = this.pendingMessages.get(response.id);
      if (pending) {
        if (pending.timeout) clearTimeout(pending.timeout);
        this.pendingMessages.delete(response.id);

        const durationMs = Date.now() - pending.startedAt;
        if (response.isSuccessful) {
          log.trace('Worker response', {
            correlationId: response.id,
            operation: pending.type,
            responseType: response.type,
            durationMs,
          });
          pending.resolve(response);
        } else {
          const message = response.sqlResponse?.error || 'Unknown error';
          log.warn('Worker request failed', {
            correlationId: response.id,
            operation: pending.type,
            responseType: response.type,
            durationMs,
            sql: response.sqlResponse?.sql,
            error: message,
          });
          pending.reject(new DatabaseWorkerError(message, response.sqlResponse?.code));
        }
      }
    }
  }

  private handleError(event: Event) {
    log.error('Worker error', { eventType: event.type });
    this.updateStatus({
      isWorkerAlive: false,
      isConnected: false,
      dbStatus: 'error'
    });
  }

  private startHeartbeatMonitoring() {
    this.resetHeartbeatTimeout();
  }

  private resetHeartbeatTimeout() {
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
    }

    // If no heartbeat received within 15 seconds, mark worker as dead
    this.heartbeatTimeout = setTimeout(() => {
      log.warn('Heartbeat timeout - worker appears dead', { process: 'heartbeat' });
      this.updateStatus({
        isWorkerAlive: false,
        isConnected: false,
        dbStatus: 'disconnected'
      });
    }, 15000);
  }

  private updateStatus(updates: Partial<WorkerStatus>) {
    this.status = { ...this.status, ...updates };
    this.statusCallbacks.forEach(callback => {
      try {
        callback(this.status);
      } catch (error) {
        log.error('Status callback error', { error });
      }
    });
  }

  public onStatusChange(callback: (status: WorkerStatus) => void) {
    this.statusCallbacks.add(callback);
    // Immediately call with current status
    callback(this.status);

    // Return unsubscribe function
    return () => {
      this.statusCallbacks.delete(callback);
    };
  }

  public getStatus(): WorkerStatus {
    return { ...this.status };
  }

  /**
   * Subscribes to database-changed broadcasts. Unlike onStatusChange, this
   * does not fire immediately on subscription — there is no "current" change
   * event to replay. Returns an unsubscribe function.
   */
  public onDatabaseChanged(callback: (event: DatabaseChangeEvent) => void) {
    this.changeCallbacks.add(callback);
    return () => {
      this.changeCallbacks.delete(callback);
    };
  }

  /** Message ids are correlation ids (`<tabId>:<n>`) so worker log rows join this tab's rows. */
  private generateMessageId(): string {
    return nextCorrelationId();
  }

  // Operation-specific timeout configurations
  private readonly OPERATION_TIMEOUTS = {
    query: 10000,        // 10s for queries
    batch_query: 120000, // 2m for batched inserts/imports
    exec: 5000,          // 5s for commands
    ping: 5000,          // 5s for heartbeat
    initialize: 30000,   // 30s for initialization
    recreate_database: 30000, // 30s for recreating schema on an already-unlocked connection
    ensure_indexes: 600000, // 10m for building indexes on large datasets
    // Export/import now decrypt/re-encrypt every physical page, so they carry
    // the same generous allowance as change_password's full-database walk.
    export_database_snapshot: 600000, // 10min for exports
    import_database_snapshot: 600000, // 10min for archive imports
    create_new_database: 30000,    // 30s for key derivation + creation
    unlock_database: 30000,        // 30s for key derivation + verification
    lock_database: 10000,
    get_unlock_methods: 5000,
    verify_master: 30000,          // one PBKDF2 derivation
    replace_master: 60000,         // two PBKDF2 derivations; the root key is re-wrapped, no blocks are touched
    add_slot: 30000,
    remove_slot: 10000,
    rename_slot: 10000,
    check_encryption_ready: 5000,
    encrypt_archive: 120000,       // 2min for large archive encryption
    decrypt_archive: 120000,       // 2min for large archive decryption
    terminate_worker: 15000,       // 15s to close handles and delete the worker's stores
    default: 30000       // 30s default for other operations
  };

  private getTimeoutForOperation(type: string): number {
    return this.OPERATION_TIMEOUTS[type as keyof typeof this.OPERATION_TIMEOUTS]
      || this.OPERATION_TIMEOUTS.default;
  }

  private sendMessage<T = any>(
    type: string,
    payload?: any,
    customTimeoutMs?: number,
    transfer?: Transferable[]
  ): Promise<DatabaseResponse> {
    return new Promise((resolve, reject) => {
      // Handle server-side or worker not available
      if (typeof window === 'undefined' || !this.port) {
        reject(new Error('Worker not available (server-side or not initialized)'));
        return;
      }

      const id = this.generateMessageId();
      const meta = buildMessageMeta(id, type);
      // Every request carries `meta` so the worker's log rows for it share
      // this tab's correlation id, page and component. `payload` is spread
      // into a fresh object: callers' objects are never mutated and a null
      // payload (ping) still gets its meta.
      const message: DatabaseMessage = { id, type, payload: { ...(payload ?? {}), meta } };

      // Use custom timeout if provided, otherwise use operation-specific timeout
      const timeoutMs = customTimeoutMs ?? this.getTimeoutForOperation(type);

      const timeout = timeoutMs === Number.MAX_VALUE ? null : setTimeout(() => {
        log.warn(`Message timeout after ${timeoutMs}ms: ${type}`, {
          correlationId: id,
          operation: type,
          timeoutMs,
          sql: this.isDebugMode() ? payload?.sql ?? undefined : undefined,
        });
        this.pendingMessages.delete(id);
        reject(new Error(`Database operation timed out after ${timeoutMs}ms: ${type}`));
      }, timeoutMs);

      this.pendingMessages.set(id, { resolve, reject, timeout, type, startedAt: Date.now() });

      try {
        // Secret buffers (PRF outputs, cloud shares) are transferred rather
        // than copied so this tab's copy is detached the moment it is sent.
        if (transfer && transfer.length > 0) {
          this.port.postMessage(message, transfer);
        } else {
          this.port.postMessage(message);
        }
        log.debug('Worker request', {
          correlationId: id,
          operation: type,
          page: meta.page,
          sql: typeof payload?.sql === 'string' ? payload.sql : undefined,
          parameterCount: Array.isArray(payload?.parameters)
            ? payload.parameters.length
            : Array.isArray(payload?.parameterSets)
              ? payload.parameterSets.length
              : undefined,
        });
      } catch (error) {
        if (timeout) clearTimeout(timeout);
        this.pendingMessages.delete(id);
        log.error('Failed to post message to worker', { correlationId: id, operation: type, error });
        reject(error);
      }
    });
  }

  // Database operations
  public async initialize(): Promise<DatabaseResponse> {
    return this.sendMessage('initialize');
  }

  public async createTables(options: CreateTablesOptions = {}): Promise<DatabaseResponse> {
    return this.sendMessage('create_tables', { options });
  }

  public async ensureIndexes(): Promise<DatabaseResponse> {
    return this.sendMessage('ensure_indexes');
  }

  public async query(sql: string, parameters: any[] = []): Promise<any[]> {
    const response = await this.sendMessage('query', { sql, parameters });
    return response.sqlResponse?.results || [];
  }

  public async queryWithTimeout(sql: string, parameters: any[] = [], timeoutMs: number): Promise<any[]> {
    const response = await this.sendMessage('query', { sql, parameters }, timeoutMs);
    return response.sqlResponse?.results || [];
  }

  public async batchQuery(
    sql: string,
    parameterSets: any[][] = [],
    options: BatchQueryOptions = {}
  ): Promise<number> {
    const response = await this.sendMessage('batch_query', {
      sql,
      parameterSets,
      options,
    });

    return response.sqlResponse?.rowCount || 0;
  }

  // Batch variant that returns the rows produced by each execution (in
  // parameter-set order) — e.g. the ids from INSERT ... RETURNING id. Runs in a
  // single transaction with one compiled statement, like batchQuery().
  public async batchQueryReturning(
    sql: string,
    parameterSets: any[][] = [],
    options: Omit<BatchQueryOptions, 'collectResults'> = {}
  ): Promise<any[]> {
    const response = await this.sendMessage('batch_query', {
      sql,
      parameterSets,
      options: { ...options, collectResults: true },
    });

    return response.sqlResponse?.results || [];
  }

  public async exec(sql: string): Promise<void> {
    await this.sendMessage('exec', { sql });
  }

  public async ping(): Promise<DatabaseResponse> {
    return this.sendMessage('ping', null, 5000);
  }

  public async exportDatabaseSnapshot(): Promise<DatabaseVfsSnapshot> {
    const response = await this.sendMessage('export_database_snapshot');
    if (response.isSuccessful && response.sqlResponse?.snapshot) {
      return response.sqlResponse.snapshot;
    }
    throw new Error(response.sqlResponse?.error || 'Failed to export database');
  }

  public async importDatabaseSnapshot(
    snapshot: DatabaseVfsSnapshot
  ): Promise<DatabaseResponse> {
    return this.sendMessage('import_database_snapshot', { snapshot });
  }

  // ---------------------------------------------------------------------------
  // Database create / unlock / lock (VFS-level page encryption)
  // ---------------------------------------------------------------------------

  /**
   * Creates a brand-new encrypted database protected by `master` (a password
   * or a recovery phrase's entropy): mints a random root key, wraps it in the
   * master key slot, writes the out-of-band encryption header, and opens the
   * database. With `restoreFrom` (an archive's `keyId` + `masterSlot`) the new
   * database adopts that archive's root key instead, so the restored copy and
   * the backup share one master secret. Fails if a database already exists.
   */
  public async createNewDatabase(
    input: { master: MasterSecret; label?: string; restoreFrom?: ArchiveRestoreSource },
    filename?: string,
    options: OpenDatabaseOptions = {}
  ): Promise<DatabaseResponse> {
    return this.sendMessage('create_new_database', {
      master: input.master,
      label: input.label,
      restoreFrom: input.restoreFrom,
      filename,
      options,
    });
  }

  /**
   * Unlocks the existing encrypted database on this device with one of its
   * key slots. Rejects (`INVALID_SECRET`) on a wrong secret without ever
   * opening the database or touching its stored blocks.
   */
  public async unlockDatabase(method: UnlockMethod, filename?: string): Promise<DatabaseResponse> {
    const transfer = method.secret instanceof Uint8Array ? [method.secret.buffer as ArrayBuffer] : undefined;
    return this.sendMessage('unlock_database', { method, filename }, undefined, transfer);
  }

  /** Closes the live connection and forgets the key — nothing is readable again until unlockDatabase succeeds. */
  public async lockDatabase(): Promise<void> {
    await this.sendMessage('lock_database');
  }

  /** Which key slots exist on this device (readable while locked), and whether the worker already holds the key. */
  public async getUnlockMethods(): Promise<UnlockMethods> {
    const response = await this.sendMessage('get_unlock_methods');
    return response.sqlResponse as UnlockMethods;
  }

  /**
   * Replaces the master slot (password → recovery phrase, recovery phrase →
   * password, or a new password). Verifies `current`, then re-wraps the same
   * root key under `next`; no stored block changes. Rejects with
   * `INVALID_SECRET` if `current` is wrong.
   */
  public async replaceMaster(current: MasterSecret, next: MasterSecret, label?: string): Promise<SlotSummary> {
    const response = await this.sendMessage('replace_master', { current, next, label });
    return response.sqlResponse?.masterSlot as SlotSummary;
  }

  /** Registers a passkey or cloud slot wrapping the live root key. The database must be unlocked. */
  public async addSlot(slot: NewConvenienceSlot): Promise<SlotSummary> {
    const response = await this.sendMessage('add_slot', { slot }, undefined, [slot.secret.buffer as ArrayBuffer]);
    return response.sqlResponse?.slot as SlotSummary;
  }

  /** Removes a passkey or cloud slot. The master slot cannot be removed (`CANNOT_REMOVE_MASTER`). */
  public async removeSlot(slotId: string): Promise<void> {
    await this.sendMessage('remove_slot', { slotId });
  }

  public async renameSlot(slotId: string, label: string): Promise<void> {
    await this.sendMessage('rename_slot', { slotId, label });
  }

  /** Recreates the schema on the already-unlocked current connection (e.g. after an aborted sample-data import). */
  public async recreateDatabase(options: OpenDatabaseOptions = {}): Promise<DatabaseResponse> {
    return this.sendMessage('recreate_database', { options });
  }

  /** Returns `true` if the worker currently holds a page-encryption key (i.e. a database is unlocked). */
  public async isEncryptionReady(): Promise<boolean> {
    const response = await this.sendMessage('check_encryption_ready');
    return response.sqlResponse?.isReady === true;
  }

  /** Returns `true` if `master` opens the database's master key slot, without unlocking anything. */
  public async verifyMaster(master: MasterSecret): Promise<boolean> {
    const response = await this.sendMessage('verify_master', { master });
    return response.sqlResponse?.isMatch === true;
  }

  /**
   * Asks the worker to encrypt `archiveBytes` (an inner ZIP) under the
   * unlocked database's archive key and returns the encrypted envelope bytes.
   */
  public async encryptArchive(
    archiveBytes: Uint8Array,
    lastSaveTimestamp: string
  ): Promise<Uint8Array> {
    const response = await this.sendMessage('encrypt_archive', {
      archiveBytes,
      lastSaveTimestamp,
    });
    if (!response.isSuccessful || !response.sqlResponse?.encryptedBytes) {
      throw new Error(response.sqlResponse?.error || 'Failed to encrypt archive');
    }
    return response.sqlResponse.encryptedBytes as Uint8Array;
  }

  /**
   * Asks the worker to decrypt `encryptedBytes` and returns the inner ZIP
   * bytes. With `master`, the archive's embedded master slot is opened with
   * that secret (a standalone archive before any local database exists, or a
   * backup of a different database). Without it, the archive must belong to
   * the unlocked database (same root key id), else `ARCHIVE_KEY_MISMATCH`.
   * `adoptMasterSlot` lets a cloud pull propagate a master change made on
   * another device into this device's header.
   */
  public async decryptArchive(
    encryptedBytes: Uint8Array,
    options: { master?: MasterSecret; adoptMasterSlot?: boolean } = {}
  ): Promise<Uint8Array> {
    const response = await this.sendMessage('decrypt_archive', {
      encryptedBytes,
      master: options.master,
      adoptMasterSlot: options.adoptMasterSlot === true,
    });
    if (!response.isSuccessful || !response.sqlResponse?.plainBytes) {
      throw new Error(response.sqlResponse?.error || 'Failed to decrypt archive');
    }
    return response.sqlResponse.plainBytes as Uint8Array;
  }

  /**
   * Debug-only (Reset App): asks the SharedWorker to close its SQLite
   * connection, forget its keys, release and delete its IndexedDB stores and
   * exit — it is shared by every tab, so this ends it for all of them — then
   * drops this tab's connection. Best-effort: a worker that does not answer
   * must not stop the reset, and the caller wipes storage regardless.
   */
  public async terminate(options: { includeLogs?: boolean } = {}): Promise<void> {
    try {
      await this.sendMessage('terminate_worker', { includeLogs: options.includeLogs === true });
    } catch (error) {
      log.warn('Worker did not confirm termination', { operation: 'terminate_worker', error });
    } finally {
      this.destroy();
    }
  }

  // Cleanup
  public destroy() {
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
    }

    // Clear all pending messages
    this.pendingMessages.forEach(({ timeout, reject }) => {
      if (timeout) clearTimeout(timeout);
      reject(new Error('Service destroyed'));
    });
    this.pendingMessages.clear();

    // Clear status callbacks
    this.statusCallbacks.clear();
    this.changeCallbacks.clear();

    if (this.port) {
      this.port.close();
    }

    this.worker = null;
    this.port = null;
  }
}

// Singleton instance
export const databaseWorkerService = new DatabaseWorkerService();
