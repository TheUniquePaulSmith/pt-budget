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
    this.isInitialized = false;
    this.isConnected = false;
    this.ports = new Set();
    this.heartbeatInterval = null;
    this.dbVersion = '1.0.0';
    
    // Query processing queue and lock
    this.queryQueue = [];
    this.isProcessingQuery = false;
    
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

  async createTables() {
    console.info("[DB Worker] Creating database tables...");
    const {CREATE_TABLES, DEFAULT_DATA} = await import('/database-schema.js');

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

          // Insert default data
          await this.sqlite3.exec(this.db, DEFAULT_DATA.CATEGORIES);
          // await this.sqlite3.exec(this.db, DEFAULT_DATA.USERS);
          // await this.sqlite3.exec(this.db, DEFAULT_DATA.ACCOUNTS);
          // await this.sqlite3.exec(this.db, DEFAULT_DATA.ACCOUNT_CARDS);

        console.info("[DB Worker] Database tables created successfully");
      } catch (error) {
        console.error("[DB Worker] Failed to create tables:", error);
        throw error;
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

    // Queue the query operation to prevent concurrent access
    return await this.enqueueQuery(async () => {
      try {
        const results = [];
        
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

        case 'create_tables':
          await this.createTables();
          response = {
            type: 'create_tables_response',
            isSuccessful: true,
            dbStatus: this.isConnected ? 'connected' : 'disconnected',
            version: this.dbVersion,
            sqlResponse: { message: 'Tables created successfully' }
          };
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
