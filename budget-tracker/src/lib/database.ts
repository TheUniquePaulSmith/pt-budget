// Browser-only database implementation
export interface Transaction {
  id: string;
  date: string;
  amount: number;
  description: string;
  category_id: string;
  company_id?: string;
  account_last_four: string;
  type: 'income' | 'expense';
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  type: 'income' | 'expense';
  color: string;
  created_at: string;
  updated_at: string;
}

export interface Company {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Account {
  id: string;
  name: string;
  last_four: string;
  type: string;
  created_at: string;
  updated_at: string;
}

export interface Budget {
  id: string;
  category_id: string;
  amount: number;
  period: 'weekly' | 'monthly' | 'yearly';
  start_date: string;
  end_date: string;
  created_at: string;
  updated_at: string;
}

export class DatabaseManager {
  private db: any | null = null;
  private SQL: any = null;
  private sqlJsInitializer: any = null;

  async initialize(): Promise<void> {
    // Only initialize in browser environment
    if (typeof window === 'undefined') {
      throw new Error('Database can only be initialized in browser environment');
    }

    try {
      // Use script tag to load sql.js to avoid webpack issues
      if (!this.sqlJsInitializer) {
        await this.loadSqlJsFromCDN();
      }

      this.SQL = await this.sqlJsInitializer({
        locateFile: (file: string) => `https://sql.js.org/dist/${file}`
      });
    } catch (error) {
      console.error('Failed to initialize SQL.js:', error);
      throw new Error('Failed to initialize database');
    }
  }

  private async loadSqlJsFromCDN(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Check if sql.js is already loaded
      if ((window as any).initSqlJs) {
        this.sqlJsInitializer = (window as any).initSqlJs;
        resolve();
        return;
      }

      // Load sql.js from CDN
      const script = document.createElement('script');
      script.src = 'https://sql.js.org/dist/sql-wasm.js';
      script.onload = () => {
        this.sqlJsInitializer = (window as any).initSqlJs;
        resolve();
      };
      script.onerror = () => {
        reject(new Error('Failed to load sql.js from CDN'));
      };
      document.head.appendChild(script);
    });
  }

  createNewDatabase(): void {
    if (!this.SQL) throw new Error('Database not initialized');
    
    this.db = new this.SQL.Database();
    this.createTables();
    this.insertDefaultData();
  }

  loadFromFile(file: ArrayBuffer): void {
    if (!this.SQL) throw new Error('Database not initialized');
    
    this.db = new this.SQL.Database(new Uint8Array(file));
  }

  exportToFile(): Uint8Array {
    if (!this.db) throw new Error('Database not loaded');
    
    return this.db.export();
  }

  private createTables(): void {
    if (!this.db) throw new Error('Database not loaded');

    // Categories table
    this.db.run(`
      CREATE TABLE categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
        color TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Companies table
    this.db.run(`
      CREATE TABLE companies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Accounts table
    this.db.run(`
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        last_four TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Budgets table
    this.db.run(`
      CREATE TABLE budgets (
        id TEXT PRIMARY KEY,
        category_id TEXT NOT NULL,
        amount REAL NOT NULL,
        period TEXT NOT NULL CHECK (period IN ('weekly', 'monthly', 'yearly')),
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES categories (id)
      )
    `);

    // Transactions table
    this.db.run(`
      CREATE TABLE transactions (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT NOT NULL,
        category_id TEXT,
        company_id TEXT,
        account_last_four TEXT,
        type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES categories (id),
        FOREIGN KEY (company_id) REFERENCES companies (id)
      )
    `);

    // Create indexes for better performance
    this.db.run('CREATE INDEX idx_transactions_date ON transactions(date)');
    this.db.run('CREATE INDEX idx_transactions_category ON transactions(category_id)');
    this.db.run('CREATE INDEX idx_transactions_company ON transactions(company_id)');
    this.db.run('CREATE INDEX idx_transactions_type ON transactions(type)');
  }

  private insertDefaultData(): void {
    if (!this.db) throw new Error('Database not loaded');

    // Default expense categories
    const expenseCategories = [
      { id: 'cat-1', name: 'Mortgage/Rent', color: '#FF6B6B' },
      { id: 'cat-2', name: 'Insurance', color: '#4ECDC4' },
      { id: 'cat-3', name: 'Food & Dining', color: '#45B7D1' },
      { id: 'cat-4', name: 'Utilities', color: '#FFA07A' },
      { id: 'cat-5', name: 'Transportation', color: '#98D8C8' },
      { id: 'cat-6', name: 'Entertainment', color: '#F7DC6F' },
      { id: 'cat-7', name: 'Healthcare', color: '#BB8FCE' },
      { id: 'cat-8', name: 'Shopping', color: '#85C1E9' },
    ];

    // Default income categories
    const incomeCategories = [
      { id: 'cat-inc-1', name: 'Salary', color: '#58D68D' },
      { id: 'cat-inc-2', name: 'Freelance', color: '#52BE80' },
      { id: 'cat-inc-3', name: 'Investment', color: '#48C9B0' },
      { id: 'cat-inc-4', name: 'Other Income', color: '#45B39D' },
    ];

    // Insert expense categories
    expenseCategories.forEach(cat => {
      this.db!.run(
        'INSERT INTO categories (id, name, type, color) VALUES (?, ?, ?, ?)',
        [cat.id, cat.name, 'expense', cat.color]
      );
    });

    // Insert income categories
    incomeCategories.forEach(cat => {
      this.db!.run(
        'INSERT INTO categories (id, name, type, color) VALUES (?, ?, ?, ?)',
        [cat.id, cat.name, 'income', cat.color]
      );
    });
  }

  // CRUD operations for transactions
  addTransaction(transaction: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>): string {
    if (!this.db) throw new Error('Database not loaded');

    const id = `txn-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const now = new Date().toISOString();

    this.db.run(`
      INSERT INTO transactions (id, date, amount, description, category_id, company_id, account_last_four, type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, transaction.date, transaction.amount, transaction.description, transaction.category_id, 
        transaction.company_id || null, transaction.account_last_four, transaction.type, now, now]);

    return id;
  }

  getTransactions(limit?: number, offset?: number): Transaction[] {
    if (!this.db) throw new Error('Database not loaded');

    let query = `
      SELECT * FROM transactions 
      ORDER BY date DESC, created_at DESC
    `;
    
    if (limit) {
      query += ` LIMIT ${limit}`;
      if (offset) {
        query += ` OFFSET ${offset}`;
      }
    }

    const result = this.db.exec(query);
    if (result.length === 0) return [];

    return result[0].values.map((row: any[]) => ({
      id: row[0] as string,
      date: row[1] as string,
      amount: row[2] as number,
      description: row[3] as string,
      category_id: row[4] as string,
      company_id: row[5] as string,
      account_last_four: row[6] as string,
      type: row[7] as 'income' | 'expense',
      created_at: row[8] as string,
      updated_at: row[9] as string,
    }));
  }

  // CRUD operations for categories
  addCategory(category: Omit<Category, 'id' | 'created_at' | 'updated_at'>): string {
    if (!this.db) throw new Error('Database not loaded');

    const id = `cat-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const now = new Date().toISOString();

    this.db.run(`
      INSERT INTO categories (id, name, type, color, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id, category.name, category.type, category.color, now, now]);

    return id;
  }

  getCategories(type?: 'income' | 'expense'): Category[] {
    if (!this.db) throw new Error('Database not loaded');

    let query = 'SELECT * FROM categories';
    let params: any[] = [];

    if (type) {
      query += ' WHERE type = ?';
      params.push(type);
    }

    query += ' ORDER BY name';

    const result = this.db.exec(query, params);
    if (result.length === 0) return [];

    return result[0].values.map((row: any[]) => ({
      id: row[0] as string,
      name: row[1] as string,
      type: row[2] as 'income' | 'expense',
      color: row[3] as string,
      created_at: row[4] as string,
      updated_at: row[5] as string,
    }));
  }

  // CRUD operations for companies
  addCompany(name: string): string {
    if (!this.db) throw new Error('Database not loaded');

    const id = `comp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const now = new Date().toISOString();

    this.db.run(`
      INSERT INTO companies (id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `, [id, name, now, now]);

    return id;
  }

  getCompanies(): Company[] {
    if (!this.db) throw new Error('Database not loaded');

    const result = this.db.exec('SELECT * FROM companies ORDER BY name');
    if (result.length === 0) return [];

    return result[0].values.map((row: any[]) => ({
      id: row[0] as string,
      name: row[1] as string,
      created_at: row[2] as string,
      updated_at: row[3] as string,
    }));
  }

  findCompanyByName(name: string): Company | null {
    if (!this.db) throw new Error('Database not loaded');

    const result = this.db.exec('SELECT * FROM companies WHERE name = ?', [name]);
    if (result.length === 0 || result[0].values.length === 0) return null;

    const row = result[0].values[0];
    return {
      id: row[0] as string,
      name: row[1] as string,
      created_at: row[2] as string,
      updated_at: row[3] as string,
    };
  }

  // CRUD operations for accounts
  addAccount(account: Omit<Account, 'id' | 'created_at' | 'updated_at'>): string {
    if (!this.db) throw new Error('Database not loaded');

    const id = `acc-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const now = new Date().toISOString();

    this.db.run(`
      INSERT INTO accounts (id, name, last_four, type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id, account.name, account.last_four, account.type, now, now]);

    return id;
  }

  getAccounts(): Account[] {
    if (!this.db) throw new Error('Database not loaded');

    const result = this.db.exec('SELECT * FROM accounts ORDER BY name');
    if (result.length === 0) return [];

    return result[0].values.map((row: any[]) => ({
      id: row[0] as string,
      name: row[1] as string,
      last_four: row[2] as string,
      type: row[3] as string,
      created_at: row[4] as string,
      updated_at: row[5] as string,
    }));
  }

  // Budget Management
  async addBudget(budget: Omit<Budget, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    if (!this.db) throw new Error('Database not loaded');

    const id = `bud-${Date.now()}`;
    const now = new Date().toISOString();

    this.db.run(`
      INSERT INTO budgets (id, category_id, amount, period, start_date, end_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, budget.category_id, budget.amount, budget.period, budget.start_date, budget.end_date, now, now]);

    return id;
  }

  getBudgets(): Budget[] {
    if (!this.db) throw new Error('Database not loaded');

    const result = this.db.exec('SELECT * FROM budgets ORDER BY created_at DESC');
    
    if (result.length === 0) return [];

    return result[0].values.map((row: any[]) => ({
      id: row[0] as string,
      category_id: row[1] as string,
      amount: row[2] as number,
      period: row[3] as 'weekly' | 'monthly' | 'yearly',
      start_date: row[4] as string,
      end_date: row[5] as string,
      created_at: row[6] as string,
      updated_at: row[7] as string,
    }));
  }

  updateBudget(id: string, updates: Partial<Omit<Budget, 'id' | 'created_at' | 'updated_at'>>): void {
    if (!this.db) throw new Error('Database not loaded');

    const now = new Date().toISOString();
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);
    
    this.db.run(
      `UPDATE budgets SET ${fields}, updated_at = ? WHERE id = ?`,
      [...values, now, id]
    );
  }

  deleteBudget(id: string): void {
    if (!this.db) throw new Error('Database not loaded');
    
    this.db.run('DELETE FROM budgets WHERE id = ?', [id]);
  }

  // Analytics methods
  getTransactionsByDateRange(startDate: string, endDate: string, type?: 'income' | 'expense'): Transaction[] {
    if (!this.db) throw new Error('Database not loaded');

    let query = `
      SELECT * FROM transactions 
      WHERE date >= ? AND date <= ?
    `;
    let params = [startDate, endDate];

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    query += ' ORDER BY date DESC';

    const result = this.db.exec(query, params);
    if (result.length === 0) return [];

    return result[0].values.map((row: any[]) => ({
      id: row[0] as string,
      date: row[1] as string,
      amount: row[2] as number,
      description: row[3] as string,
      category_id: row[4] as string,
      company_id: row[5] as string,
      account_last_four: row[6] as string,
      type: row[7] as 'income' | 'expense',
      created_at: row[8] as string,
      updated_at: row[9] as string,
    }));
  }

  getSpendingByCategory(startDate: string, endDate: string): { category_id: string; category_name: string; total: number; color: string }[] {
    if (!this.db) throw new Error('Database not loaded');

    const result = this.db.exec(`
      SELECT 
        t.category_id,
        c.name as category_name,
        c.color,
        SUM(ABS(t.amount)) as total
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.date >= ? AND t.date <= ? AND t.type = 'expense'
      GROUP BY t.category_id, c.name, c.color
      ORDER BY total DESC
    `, [startDate, endDate]);

    if (result.length === 0) return [];

    return result[0].values.map((row: any[]) => ({
      category_id: row[0] as string,
      category_name: row[1] as string || 'Uncategorized',
      color: row[2] as string || '#999999',
      total: row[3] as number,
    }));
  }

  getIncomeByCategory(startDate: string, endDate: string): { category_id: string; category_name: string; total: number; color: string }[] {
    if (!this.db) throw new Error('Database not loaded');

    const result = this.db.exec(`
      SELECT 
        t.category_id,
        c.name as category_name,
        c.color,
        SUM(t.amount) as total
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.date >= ? AND t.date <= ? AND t.type = 'income'
      GROUP BY t.category_id, c.name, c.color
      ORDER BY total DESC
    `, [startDate, endDate]);

    if (result.length === 0) return [];

    return result[0].values.map((row: any[]) => ({
      category_id: row[0] as string,
      category_name: row[1] as string || 'Uncategorized',
      color: row[2] as string || '#999999',
      total: row[3] as number,
    }));
  }

  getMonthlyTrends(months: number = 12): { month: string; income: number; expense: number }[] {
    if (!this.db) throw new Error('Database not loaded');

    const result = this.db.exec(`
      SELECT 
        strftime('%Y-%m', date) as month,
        SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as income,
        SUM(CASE WHEN type = 'expense' THEN ABS(amount) ELSE 0 END) as expense
      FROM transactions
      WHERE date >= date('now', '-${months} months')
      GROUP BY strftime('%Y-%m', date)
      ORDER BY month DESC
    `);

    if (result.length === 0) return [];

    return result[0].values.map((row: any[]) => ({
      month: row[0] as string,
      income: row[1] as number,
      expense: row[2] as number,
    }));
  }
}
