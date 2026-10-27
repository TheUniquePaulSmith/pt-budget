import { describe, expect, it } from 'vitest';

import {
  CREATE_INDEXES,
  CREATE_TABLES,
  MIGRATIONS,
  SCHEMA_VERSION,
} from '../../public/database-schema.js';

type MigrationOp =
  | string
  | { op: 'addColumn'; table: string; column: string; ddl: string }
  | { op: 'dropTable'; table: string }
  | { op: 'rebuild'; table: string; guardColumn: string; create: string; columnExpressions: Record<string, string> }
  | { op: 'rehashTransactions' };

const migrations = MIGRATIONS as Array<{ version: number; statements: MigrationOp[] }>;

describe('database schema', () => {
  it('is at version 4 with migrations in ascending order ending at the current version', () => {
    expect(SCHEMA_VERSION).toBe(4);
    const versions = migrations.map((migration) => migration.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(versions.at(-1)).toBe(SCHEMA_VERSION);
  });

  it('only contains migration ops the worker knows how to run', () => {
    for (const migration of migrations) {
      for (const op of migration.statements) {
        if (typeof op === 'string') {
          // Plain SQL must be idempotent so a crash mid-migration can be retried:
          // CREATE ... IF NOT EXISTS, or an UPDATE whose WHERE excludes rows it
          // already changed.
          expect(op).toMatch(/CREATE (TABLE|INDEX|UNIQUE INDEX) IF NOT EXISTS|^\s*UPDATE \w+ SET [\s\S]* WHERE /);
          continue;
        }
        switch (op.op) {
          case 'addColumn':
            expect(op.table).toBeTruthy();
            expect(op.column).toBeTruthy();
            expect(op.ddl.startsWith(op.column)).toBe(true);
            break;
          case 'dropTable':
            expect(op.table).toBeTruthy();
            break;
          case 'rebuild':
            expect(op.guardColumn).toBeTruthy();
            expect(op.create).toContain(`CREATE TABLE IF NOT EXISTS ${op.table} (`);
            // The guard column must exist in the new shape, or the rebuild would re-run on every open.
            expect(op.create).toContain(op.guardColumn);
            expect(typeof op.columnExpressions).toBe('object');
            break;
          case 'rehashTransactions':
            break;
          default:
            throw new Error(`Unknown migration op: ${JSON.stringify(op)}`);
        }
      }
    }
  });

  it('widens transaction and account types and splits ownership out of the account type', () => {
    expect(CREATE_TABLES.TRANSACTIONS).toContain("CHECK(type IN ('income', 'expense', 'refund', 'transfer'))");
    expect(CREATE_TABLES.TEMP_IMPORT_TRANSACTIONS).toContain("CHECK(type IN ('income', 'expense', 'refund', 'transfer'))");
    expect(CREATE_TABLES.ACCOUNTS).toContain(
      "CHECK(type IN ('checking', 'savings', 'credit', 'loan', 'investment', 'retirement'))"
    );
    expect(CREATE_TABLES.ACCOUNTS).toContain("ownership TEXT CHECK(ownership IN ('individual', 'joint'))");
    expect(CREATE_TABLES.ACCOUNTS).not.toContain("'joint',");
  });

  it('version 2 repairs the version-1 gap, rebuilds both money tables, and rehashes', () => {
    const v2 = migrations.find((migration) => migration.version === 2)!;
    expect(v2.statements).toContain(CREATE_TABLES.BUDGET_PLANS);
    expect(v2.statements).toContain(CREATE_TABLES.BUDGET_PLAN_CATEGORIES);
    expect(v2.statements).toContain(CREATE_TABLES.INCOME_SOURCES);
    expect(v2.statements).toContain(CREATE_TABLES.IMPORT_BATCHES);
    expect(v2.statements).toContain(CREATE_TABLES.ACCOUNT_BALANCE_SNAPSHOTS);

    const rebuilds = v2.statements.filter(
      (op): op is Extract<MigrationOp, { op: 'rebuild' }> => typeof op !== 'string' && op.op === 'rebuild'
    );
    expect(rebuilds.map((op) => op.table)).toEqual(['accounts', 'transactions']);
    const accounts = rebuilds[0];
    expect(accounts.columnExpressions.type).toContain("'joint' THEN 'checking'");
    expect(accounts.columnExpressions.ownership).toContain("'joint' THEN 'joint' ELSE 'individual'");

    // import_batches must exist before the transactions rebuild that references it.
    const importBatchesIndex = v2.statements.indexOf(CREATE_TABLES.IMPORT_BATCHES);
    const transactionsRebuildIndex = v2.statements.indexOf(rebuilds[1]);
    expect(importBatchesIndex).toBeLessThan(transactionsRebuildIndex);

    // The staging table is dropped and recreated (its own CHECK changed).
    const dropIndex = v2.statements.findIndex(
      (op) => typeof op !== 'string' && op.op === 'dropTable' && op.table === 'temp_import_transactions'
    );
    expect(dropIndex).toBeGreaterThan(-1);
    expect(v2.statements[dropIndex + 1]).toBe(CREATE_TABLES.TEMP_IMPORT_TRANSACTIONS);

    expect(v2.statements.at(-1)).toEqual({ op: 'rehashTransactions' });
  });

  it('version 3 adds the notification and AI tool tables plus nullable-or-defaulted columns', () => {
    const v3 = migrations.find((migration) => migration.version === 3)!;
    expect(v3.statements).toContain(CREATE_TABLES.NOTIFICATIONS);
    expect(v3.statements).toContain(CREATE_TABLES.NOTIFICATION_SETTINGS);
    expect(v3.statements).toContain(CREATE_TABLES.AI_TOOL_PACKS);
    expect(v3.statements).toContain(CREATE_TABLES.AI_TOOL_SETTINGS);

    const addColumns = v3.statements.filter(
      (op): op is Extract<MigrationOp, { op: 'addColumn' }> => typeof op !== 'string' && op.op === 'addColumn'
    );
    expect(addColumns.map((op) => `${op.table}.${op.column}`)).toEqual([
      'recurring_series.is_autopay',
      'recurring_series.due_day',
      'budget_plan_categories.carry_mode',
      'budget_plan_categories.carry_reset',
      'projects.budget_category_id',
      'projects.monthly_contribution',
      'projects.contribution_start_month',
      'trips.budget_category_id',
      'trips.monthly_contribution',
      'trips.contribution_start_month',
    ]);

    // Every added column must be nullable or defaulted: ALTER TABLE ADD COLUMN
    // requires it, and the sample-data validator treats NOT NULL columns
    // without a DEFAULT as required fixture fields.
    for (const op of addColumns) {
      const nullable = !/NOT NULL/.test(op.ddl) || /DEFAULT/.test(op.ddl);
      expect(nullable, `${op.table}.${op.column} must be nullable or defaulted`).toBe(true);
      // The CREATE statement for fresh databases carries the same column.
      const createKey = op.table.toUpperCase() as keyof typeof CREATE_TABLES;
      expect(CREATE_TABLES[createKey]).toContain(` ${op.column} `);
    }

    const carryMode = addColumns.find((op) => op.column === 'carry_mode')!;
    expect(carryMode.ddl).toContain("CHECK(carry_mode IN ('none', 'surplus', 'deficit', 'both'))");
    expect(CREATE_TABLES.BUDGET_PLAN_CATEGORIES).toContain("CHECK(carry_mode IN ('none', 'surplus', 'deficit', 'both'))");
    expect(CREATE_TABLES.NOTIFICATIONS).toContain('dedupe_key TEXT UNIQUE');
    expect(CREATE_TABLES.AI_TOOL_SETTINGS).toContain("CHECK(consent IN ('ask', 'always', 'deny'))");
  });

  it('version 4 adds classification rules, type provenance columns and rebuilds the staging table', () => {
    const v4 = migrations.find((migration) => migration.version === 4)!;
    expect(v4.statements[0]).toBe(CREATE_TABLES.CLASSIFICATION_RULES);

    const addColumns = v4.statements.filter(
      (op): op is Extract<MigrationOp, { op: 'addColumn' }> => typeof op !== 'string' && op.op === 'addColumn'
    );
    expect(addColumns.map((op) => `${op.table}.${op.column}`)).toEqual([
      'transactions.type_source',
      'transactions.type_confidence',
    ]);
    for (const op of addColumns) {
      const nullable = !/NOT NULL/.test(op.ddl) || /DEFAULT/.test(op.ddl);
      expect(nullable, `${op.table}.${op.column} must be nullable or defaulted`).toBe(true);
      expect(CREATE_TABLES.TRANSACTIONS).toContain(` ${op.column} `);
    }
    expect(addColumns[0].ddl).toContain("CHECK(type_source IN ('sign', 'rule', 'pair', 'inferred', 'manual'))");

    // Hand-picked types that predate v4 are recorded as manual decisions.
    const backfill = v4.statements.find((op) => typeof op === 'string' && op.startsWith('UPDATE transactions'));
    expect(backfill).toContain("SET type_source = 'manual' WHERE type_locked = 1");

    // The staging table is dropped and recreated with the classification columns.
    const dropIndex = v4.statements.findIndex(
      (op) => typeof op !== 'string' && op.op === 'dropTable' && op.table === 'temp_import_transactions'
    );
    expect(dropIndex).toBeGreaterThan(-1);
    expect(v4.statements[dropIndex + 1]).toBe(CREATE_TABLES.TEMP_IMPORT_TRANSACTIONS);
    expect(CREATE_TABLES.TEMP_IMPORT_TRANSACTIONS).toContain('transfer_group_id TEXT');
    expect(CREATE_TABLES.TEMP_IMPORT_TRANSACTIONS).toContain('type_confidence REAL');

    expect(CREATE_TABLES.CLASSIFICATION_RULES).toContain("CHECK(type IN ('income', 'expense', 'refund', 'transfer'))");
    expect(CREATE_TABLES.CLASSIFICATION_RULES).toContain('counterpart_account_id INTEGER');
  });

  it('indexes the new sparse columns', () => {
    const indexes = CREATE_INDEXES.join('\n');
    expect(indexes).toContain("ON transactions(type_source) WHERE type_locked = 0 AND type_source != 'sign'");
    expect(indexes).toContain('ON transactions(amount, date)');
    expect(indexes).toContain('ON classification_rules(enabled, priority)');
    expect(indexes).toContain('ON transactions(transfer_group_id) WHERE transfer_group_id IS NOT NULL');
    expect(indexes).toContain('ON transactions(import_batch_id) WHERE import_batch_id IS NOT NULL');
    expect(indexes).toContain('ON transactions(account_id, external_id) WHERE external_id IS NOT NULL');
    expect(indexes).toContain('ON notifications(status, due_date)');
    expect(indexes).toContain('ON recurring_series(is_autopay, status)');
    expect(indexes).toContain('ON projects(budget_category_id) WHERE budget_category_id IS NOT NULL');
    expect(indexes).toContain('ON trips(budget_category_id) WHERE budget_category_id IS NOT NULL');
  });
});
