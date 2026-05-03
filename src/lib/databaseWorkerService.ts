// Database Worker Message Channel Service
// Handles communication between main thread and database worker

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
}

export interface WorkerStatus {
  isWorkerAlive: boolean;
  isConnected: boolean;
  dbStatus: 'disconnected' | 'connected' | 'initialized' | 'error';
  version: string;
  lastHeartbeat: number;
}

export class DatabaseWorkerService {
  private worker: SharedWorker | null = null;
  private port: MessagePort | null = null;
  private messageId = 0;
  private pendingMessages = new Map<string, { resolve: (value: any) => void; reject: (reason?: any) => void; timeout: NodeJS.Timeout }>();
  private statusCallbacks = new Set<(status: WorkerStatus) => void>();
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

  private initializeWorker() {
    // Skip initialization on server-side
    if (typeof window === 'undefined') {
      console.log('[DB Service] Skipping worker initialization on server-side');
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
      
      // Start monitoring heartbeat
      this.startHeartbeatMonitoring();

      // // Send initialization message to worker
      // this.port.postMessage({ id: this.generateMessageId(), type: 'initialize', payload: null });

      console.log('[DB Service] Database worker service started and ready to receive messages');
    } catch (error) {
      console.error('[DB Service] Failed to initialize worker:', error);
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

    // Handle worker connection confirmation
    if (response.type === 'worker_connected') {
      this.updateStatus({
        isWorkerAlive: true,
        dbStatus: response.dbStatus,
        version: response.version
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
      console.debug(`[DB Service] Received message: ${response.type} with ID: ${response.id}`, response);
      const pending = this.pendingMessages.get(response.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingMessages.delete(response.id);
        
        if (response.isSuccessful) {
          pending.resolve(response);
        } else {
          pending.reject(new Error(response.sqlResponse?.error || 'Unknown error'));
        }
      }
    }
  }

  private handleError(event: Event) {
    console.error('[DB Service] Worker error:', event);
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
      console.warn('[DB Service] Heartbeat timeout - worker appears dead');
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
        console.error('[DB Service] Status callback error:', error);
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

  private generateMessageId(): string {
    return `msg_${++this.messageId}_${Date.now()}`;
  }

  // Operation-specific timeout configurations
  private readonly OPERATION_TIMEOUTS = {
    query: 10000,        // 10s for queries
    batch_query: 120000, // 2m for batched inserts/imports
    exec: 5000,          // 5s for commands
    ping: 5000,          // 5s for heartbeat
    initialize: 30000,   // 30s for initialization
    open_database: 30000, // 30s for opening database
    export_database: 60000, // 1min for exports
    import_database: 120000, // 2min for CSV imports
    default: 30000       // 30s default for other operations
  };

  private getTimeoutForOperation(type: string): number {
    return this.OPERATION_TIMEOUTS[type as keyof typeof this.OPERATION_TIMEOUTS] 
      || this.OPERATION_TIMEOUTS.default;
  }

  private sendMessage<T = any>(type: string, payload?: any, customTimeoutMs?: number): Promise<DatabaseResponse> {
    return new Promise((resolve, reject) => {
      // Handle server-side or worker not available
      if (typeof window === 'undefined' || !this.port) {
        reject(new Error('Worker not available (server-side or not initialized)'));
        return;
      }

      const id = this.generateMessageId();
      const message: DatabaseMessage = { id, type, payload };

      // Use custom timeout if provided, otherwise use operation-specific timeout
      const timeoutMs = customTimeoutMs ?? this.getTimeoutForOperation(type);

      const timeout = setTimeout(() => {
        console.warn(`[DB Service] Message timeout after ${timeoutMs}ms: ${type} with ID: ${id}`);
        this.pendingMessages.delete(id);
        reject(new Error(`Database operation timed out after ${timeoutMs}ms: ${type}`));
      }, timeoutMs);

      this.pendingMessages.set(id, { resolve, reject, timeout });

      try {
        this.port.postMessage(message);        
        // console.debug(`[DB Service] Sent message: ${type} with ID: ${id}`);
      } catch (error) {
        clearTimeout(timeout);
        this.pendingMessages.delete(id);
        reject(error);
      }
    });
  }

  // Database operations
  public async initialize(): Promise<DatabaseResponse> {
    return this.sendMessage('initialize');
  }

  public async openDatabase(filename?: string, isNew?: boolean): Promise<DatabaseResponse> {
    return this.sendMessage('open_database', { filename, isNew });
  }

  public async createTables(): Promise<DatabaseResponse> {
    return this.sendMessage('create_tables');
  }

  public async query(sql: string, parameters: any[] = []): Promise<any[]> {
    const response = await this.sendMessage('query', { sql, parameters });
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

  public async exec(sql: string): Promise<void> {
    await this.sendMessage('exec', { sql });
  }

  public async ping(): Promise<DatabaseResponse> {
    return this.sendMessage('ping', null, 5000);
  }

  public async exportDatabase(): Promise<Uint8Array> {
    const response = await this.sendMessage('export_database');
    if (response.isSuccessful && response.sqlResponse?.data) {
      return response.sqlResponse.data;
    }
    throw new Error(response.sqlResponse?.error || 'Failed to export database');
  }

  public async importDatabase(fileData: Uint8Array): Promise<DatabaseResponse> {
    return this.sendMessage('import_database', { fileData });
  }

  // Cleanup
  public destroy() {
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
    }

    // Clear all pending messages
    this.pendingMessages.forEach(({ timeout, reject }) => {
      clearTimeout(timeout);
      reject(new Error('Service destroyed'));
    });
    this.pendingMessages.clear();

    // Clear status callbacks
    this.statusCallbacks.clear();

    if (this.port) {
      this.port.close();
    }

    this.worker = null;
    this.port = null;
  }
}

// Singleton instance
export const databaseWorkerService = new DatabaseWorkerService();
