// Database Shared Worker
// This worker handles all SQLite operations and communicates with the main thread

class DatabaseWorker {
  constructor() {
    this.sqlite3 = null;
    this.sqlite3Constants = null;
    this.db = 0;
    this.vfs = null;
    this.isInitialized = false;
    this.isConnected = false;
    this.ports = new Set();
    this.heartbeatInterval = null;
    this.dbVersion = '1.0.0';
    
    // Start heartbeat
    this.startHeartbeat();
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
      this.vfs = await IDBBatchAtomicVFS.create('ptbudgetapp', wasmModule);

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

  async openDatabase(filename = '/budget-app.db', isNew = false) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      console.log(`[DB Worker] Opening database: ${filename}`);
      
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
        await this.createTables();
      }

      
      return {
        type: 'database_opened',
        isSuccessful: true,
        dbStatus: 'connected',
        version: this.dbVersion,
        sqlResponse: { filename, isNew }
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

    try {
      const results = [];

       // Add a small delay to prevent rapid concurrent access
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Prepare the statement if parameters are provided
      if (parameters.length > 0) {
        for await (const stmt of this.sqlite3.statements(this.db, sql)) {
          // Bind parameters
          for (let i = 0; i < parameters.length; i++) {
            const param = parameters[i];
            if (param === null || param === undefined) {
              this.sqlite3.bind_null(stmt, i + 1);
            } else if (typeof param === 'number') {
              if (Number.isInteger(param)) {
                this.sqlite3.bind_int(stmt, i + 1, param);
              } else {
                this.sqlite3.bind_double(stmt, i + 1, param);
              }
            } else if (typeof param === 'string') {
              this.sqlite3.bind_text(stmt, i + 1, param);
            } else {
              this.sqlite3.bind_text(stmt, i + 1, String(param));
            }
          }
          
          // Execute and collect results
          const columnNames = [];
          while (await this.sqlite3.step(stmt) === (this.sqlite3Constants.SQLITE_ROW || this.sqlite3Constants.SQLITE_DONE)) {
            if (columnNames.length === 0) {
              const columnCount = this.sqlite3.column_count(stmt);
              for (let i = 0; i < columnCount; i++) {
                columnNames.push(this.sqlite3.column_name(stmt, i));
              }
            }
            
            const row = {};
            columnNames.forEach((column, index) => {
              const value = this.sqlite3.column(stmt, index);
              row[column] = value;
            });
            results.push(row);
          }
        }
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
      return {
        type: 'query_error',
        isSuccessful: false,
        dbStatus: 'connected',
        version: this.dbVersion,
        sqlResponse: { error: error.message, sql, parameters }
      };
    }
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
  }

  async createTables() {
    if (!this.isConnected || !this.db) {
      throw new Error('Database not connected');
    }

    try {
      // Create all the database tables
      const tableQueries = [
        // Categories table
        `CREATE TABLE IF NOT EXISTS categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
          color TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        
        // Companies table
        `CREATE TABLE IF NOT EXISTS companies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        
        // Projects table
        `CREATE TABLE IF NOT EXISTS projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          company_name TEXT NOT NULL,
          contact_details TEXT,
          project_category TEXT NOT NULL CHECK (project_category IN ('plumbing', 'electrical', 'hvac', 'roofing', 'flooring', 'painting', 'landscaping', 'general_contractor', 'other')),
          status TEXT NOT NULL CHECK (status IN ('planning', 'in_progress', 'completed', 'on_hold')),
          start_date TEXT,
          end_date TEXT,
          estimated_cost REAL,
          actual_cost REAL,
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        
        // Accounts table
        `CREATE TABLE IF NOT EXISTS accounts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        
        // Account aliases table
        `CREATE TABLE IF NOT EXISTS account_aliases (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id INTEGER NOT NULL,
          last_four TEXT NOT NULL,
          alias_name TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE,
          UNIQUE(last_four, account_id)
        )`,
        
        // Transactions table
        `CREATE TABLE IF NOT EXISTS transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL,
          amount REAL NOT NULL,
          description TEXT NOT NULL,
          account_id INTEGER,
          category_id INTEGER,
          company_id INTEGER,
          project_id INTEGER,
          type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
          transaction_hash TEXT UNIQUE,
          account_last_four TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE SET NULL,
          FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL,
          FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE SET NULL,
          FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE SET NULL
        )`,
        
        // Budgets table
        `CREATE TABLE IF NOT EXISTS budgets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category_id INTEGER NOT NULL,
          amount REAL NOT NULL,
          period TEXT NOT NULL CHECK (period IN ('weekly', 'monthly', 'quarterly', 'yearly')),
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE CASCADE
        )`
      ];

      // Execute each table creation query
      for (const query of tableQueries) {
        await this.sqlite3.exec(this.db, query);
      }

      // Create indexes
      const indexQueries = [
        'CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date)',
        'CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id)',
        'CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id)',
        'CREATE INDEX IF NOT EXISTS idx_transactions_project ON transactions(project_id)',
        'CREATE INDEX IF NOT EXISTS idx_transactions_company ON transactions(company_id)',
        'CREATE INDEX IF NOT EXISTS idx_transactions_hash ON transactions(transaction_hash)',
        'CREATE INDEX IF NOT EXISTS idx_account_aliases_last_four ON account_aliases(last_four)',
        'CREATE INDEX IF NOT EXISTS idx_account_aliases_account ON account_aliases(account_id)'
      ];

      for (const query of indexQueries) {
        await this.sqlite3.exec(this.db, query);
      }

      console.log('[DB Worker] Database tables created successfully');
    } catch (error) {
      console.error('[DB Worker] Failed to create tables:', error);
      throw error;
    }
  }

  async exportDatabase() {
    if (!this.isConnected || !this.db) {
      throw new Error('Database not connected');
    }

    try {
      console.log('[DB Worker] Exporting database...');
      
      // Use SQLite serialize function to export the database
      const serialized = this.sqlite3.serialize(this.db, 'main');
      
      console.log('[DB Worker] Database exported successfully');
      return {
        type: 'database_exported',
        isSuccessful: true,
        dbStatus: 'connected',
        version: this.dbVersion,
        sqlResponse: { data: serialized }
      };
    } catch (error) {
      console.error('[DB Worker] Failed to export database:', error);
      return {
        type: 'export_error',
        isSuccessful: false,
        dbStatus: this.isConnected ? 'connected' : 'disconnected',
        version: this.dbVersion,
        sqlResponse: { error: error.message }
      };
    }
  }

  async importDatabaseFromFile(fileData) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      console.log('[DB Worker] Importing database from file...');
      
      // Close existing database if open
      if (this.db) {
        this.sqlite3.close(this.db);
        this.db = 0;
        this.isConnected = false;
      }

      // Open a new database
      this.db = await this.sqlite3.open_v2(
        '/imported-budget-app.db',
        this.sqlite3.SQLITE_OPEN_CREATE | this.sqlite3.SQLITE_OPEN_READWRITE | this.sqlite3.SQLITE_OPEN_FULLMUTEX,
        this.vfs.name
      );
      
      if (!this.db) {
        throw new Error('Failed to open database for import');
      }

      // Deserialize the data into the database
      this.sqlite3.deserialize(this.db, 'main', fileData);

      // Configure database
      await this.sqlite3.exec(this.db, 'PRAGMA locking_mode=NORMAL');
      await this.sqlite3.exec(this.db, 'PRAGMA synchronous=NORMAL');
      await this.sqlite3.exec(this.db, 'PRAGMA foreign_keys=ON');

      this.isConnected = true;

      console.log('[DB Worker] Database imported successfully');
      return {
        type: 'database_imported',
        isSuccessful: true,
        dbStatus: 'connected',
        version: this.dbVersion,
        sqlResponse: { message: 'Database imported successfully' }
      };
    } catch (error) {
      console.error('[DB Worker] Failed to import database:', error);
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
    console.debug(`[DB Worker] Received message ${id}: ${type}`, payload);
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
          response = await this.openDatabase(payload?.filename, payload?.isNew);
          break;
          
        case 'query':
          response = await this.executeQuery(payload.sql, payload.parameters);
          console.debug(`[DB Worker] Response for query: `, response);
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
          
        case 'export_database':
          response = await this.exportDatabase();
          break;
          
        case 'import_database':
          response = await this.importDatabaseFromFile(payload.fileData);
          break;
          
          
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
