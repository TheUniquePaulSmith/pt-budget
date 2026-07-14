// Database Browser Compatibility Tester Shared Worker
// This worker performs a simple compatibility test for WA-SQLite functionality

class DatabaseTester {
  constructor() {
    this.ports = new Set();
    this.testResults = this.createInitialResults();
  }

  createInitialResults() {
    this.testResults = {
      sharedWorkerSupport: true,
      wasmSupport: false,
      sqliteSupport: false,
      vfsSupport: false,
      databaseOperationsSupport: false,
      overallCompatible: false,
      errorDetails: null
    };

    return this.testResults;
  }

  formatError(error, vfs) {
    if (!error) return 'Unknown error';
    const message = error.message || String(error);
    let details = error.stack ? `${message}\n\n${error.stack}` : message;

    // The VFS catches its own IndexedDB exceptions and remaps them to
    // generic SQLite IOERR codes, so the SQLiteError above (e.g. "disk I/O
    // error") loses the real browser-level exception. Pull it back out of
    // the VFS so Safari/WebKit-specific errors (QuotaExceededError,
    // TransactionInactiveError, etc.) are visible instead of just "disk I/O
    // error".
    const vfsError = vfs?.lastError;
    if (vfsError && vfsError !== error) {
      const vfsMessage = vfsError.name
        ? `${vfsError.name}: ${vfsError.message || vfsError}`
        : (vfsError.message || String(vfsError));
      details += `\n\nUnderlying storage error: ${vfsMessage}`;
      if (vfsError.stack) {
        details += `\n${vfsError.stack}`;
      }
    }

    return details;
  }

  async performCompatibilityTest() {
    console.log('[DB Tester] Starting browser compatibility test...');
    this.testResults = this.createInitialResults();
    let vfs = null;

    try {
      // Test 1: WASM Support (basic check)
      this.testResults.wasmSupport = typeof WebAssembly === 'object' && 
                                   typeof WebAssembly.instantiate === 'function';
      
      if (!this.testResults.wasmSupport) {
        console.log('[DB Tester] WebAssembly not supported');
        return this.testResults;
      }

      // Test 2: Try to load WA-SQLite modules
      console.log('[DB Tester] Testing WA-SQLite module loading...');
      
      const sqliteModule = await import('/wa-sqlite/wa-sqlite-async.mjs');
      const SQLiteModule = sqliteModule.default;

      const sqliteConstants = await import('/wa-sqlite/src/sqlite-constants.js');

      const apiModule = await import('/wa-sqlite/src/sqlite-api.js');
      const { Factory } = apiModule;

      const vfsModule = await import('/wa-sqlite/src/examples/IDBBatchAtomicVFS.js');
      const { IDBBatchAtomicVFS } = vfsModule;

      console.log('[DB Tester] Modules loaded successfully, initializing WASM...');
      
      // Test 3: Initialize SQLite WASM
      const wasmModule = await SQLiteModule();
      const sqlite3 = Factory(wasmModule);
      this.testResults.sqliteSupport = true;

      console.log('[DB Tester] SQLite WASM initialized, testing VFS...');

      // Test 4: Create and test VFS
      vfs = await IDBBatchAtomicVFS.create('test-db-compatibility', wasmModule);
      sqlite3.vfs_register(vfs, true);
      this.testResults.vfsSupport = true;

      console.log('[DB Tester] VFS created, testing database operations...');

      // Test 5: Basic database operations
      const db = await sqlite3.open_v2(
        '/test-compatibility.db',
        sqlite3.SQLITE_OPEN_CREATE | sqlite3.SQLITE_OPEN_READWRITE,
        vfs.name
      );

      if (!db) {
        throw new Error('Failed to open test database');
      }

      // Test 6: Execute a simple query with parameter binding
      const testString = 'compatibility_test_' + Date.now();
      let resultMatched = false;

      for await (const stmt of sqlite3.statements(db, 'SELECT ? as test_result')) {
        sqlite3.bind_text(stmt, 1, testString);
        
        while (await sqlite3.step(stmt) === (sqliteConstants.SQLITE_ROW || sqliteConstants.SQLITE_DONE)) {
          const result = sqlite3.column_text(stmt, 0);
          if (result === testString) {
            resultMatched = true;
          }
        }
      }

      // Clean up
      sqlite3.close(db);
      
      console.log('[DB Tester] Test query executed successfully');

      this.testResults.databaseOperationsSupport = resultMatched;
      
      this.testResults.overallCompatible =
        this.testResults.sharedWorkerSupport &&
        this.testResults.wasmSupport &&
        this.testResults.sqliteSupport &&
        this.testResults.vfsSupport &&
        this.testResults.databaseOperationsSupport;
      
      console.log('[DB Tester] Compatibility test completed successfully:', this.testResults);
      
    } catch (error) {
      console.error('[DB Tester] Compatibility test failed:', error);
      this.testResults.databaseOperationsSupport = false;
      this.testResults.overallCompatible = false;
      this.testResults.errorDetails = this.formatError(error, vfs);
    }

    return this.testResults;
  }

  addPort(port) {
    this.ports.add(port);
    console.log(`[DB Tester] Port added. Total ports: ${this.ports.size}`);
  }

  removePort(port) {
    this.ports.delete(port);
    console.log(`[DB Tester] Port removed. Total ports: ${this.ports.size}`);
  }

  broadcastMessage(message) {
    this.ports.forEach(port => {
      try {
        port.postMessage(message);
      } catch (error) {
        console.error('[DB Tester] Failed to send message to port:', error);
        this.removePort(port);
      }
    });
  }

  async handleMessage(event, port) {
    const { id, type } = event.data;
    console.log(`[DB Tester] Received message ${id}: ${type}`);
    let response;
    
    try {
      switch (type) {
        case 'test_compatibility':
          const results = await this.performCompatibilityTest();
          response = {
            type: 'test_results',
            isSuccessful: true,
            testResults: results
          };
          break;
          
        case 'ping':
          response = {
            type: 'pong',
            isSuccessful: true,
            timestamp: Date.now()
          };
          break;
          
        default:
          response = {
            type: 'error',
            isSuccessful: false,
            error: `Unknown message type: ${type}`
          };
      }
    } catch (error) {
      response = {
        type: 'error',
        isSuccessful: false,
        error: error.message
      };
    }
    
    // Add the request ID to the response for correlation
    response.id = id;
    
    port.postMessage(response);
  }
}

// Create the tester instance
const dbTester = new DatabaseTester();

// Handle new connections
self.addEventListener('connect', (event) => {
  const port = event.ports[0];
  
  dbTester.addPort(port);
  
  port.addEventListener('message', (event) => {
    dbTester.handleMessage(event, port);
  });
  
  port.addEventListener('close', () => {
    dbTester.removePort(port);
  });
  
  port.start();
  
  // Send initial status
  port.postMessage({
    type: 'tester_connected',
    isSuccessful: true,
    message: 'Database tester worker connected successfully'
  });
});

console.log('[DB Tester] Database compatibility tester worker initialized');
