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
      this.worker = new SharedWorker('/database-worker.js');
      this.port = this.worker.port;
      
      this.port.addEventListener('message', this.handleMessage.bind(this));
      this.port.addEventListener('messageerror', this.handleError.bind(this));
      
      this.port.start();
      
      console.log('[DB Service] Database worker service initialized');
      
      // Start monitoring heartbeat
      this.startHeartbeatMonitoring();
      
    } catch (error) {
      console.error('[DB Service] Failed to initialize worker:', error);
      this.updateStatus({ isWorkerAlive: false });
    }
  }

  private handleMessage(event: MessageEvent<DatabaseResponse>) {
    const response = event.data;
    
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

    // Handle pending message responses
    if (response.id) {
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

  private sendMessage<T = any>(type: string, payload?: any, timeoutMs = 30000): Promise<DatabaseResponse> {
    return new Promise((resolve, reject) => {
      // Handle server-side or worker not available
      if (typeof window === 'undefined' || !this.port) {
        reject(new Error('Worker not available (server-side or not initialized)'));
        return;
      }

      const id = this.generateMessageId();
      const message: DatabaseMessage = { id, type, payload };

      const timeout = setTimeout(() => {
        this.pendingMessages.delete(id);
        reject(new Error(`Message timeout: ${type}`));
      }, timeoutMs);

      this.pendingMessages.set(id, { resolve, reject, timeout });

      try {
        this.port.postMessage(message);
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

  public async query(sql: string, parameters: any[] = []): Promise<any[]> {
    const response = await this.sendMessage('query', { sql, parameters });
    return response.sqlResponse?.results || [];
  }

  public async exec(sql: string): Promise<void> {
    await this.sendMessage('exec', { sql });
  }

  public async ping(): Promise<DatabaseResponse> {
    return this.sendMessage('ping', null, 10000);
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

  public async checkDatabaseExists(dbName = 'ptbudgetapp'): Promise<boolean> {
    const response = await this.sendMessage('check_database_exists', { dbName });
    if (response.isSuccessful) {
      return response.sqlResponse?.exists || false;
    }
    throw new Error(response.sqlResponse?.error || 'Failed to check database existence');
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
