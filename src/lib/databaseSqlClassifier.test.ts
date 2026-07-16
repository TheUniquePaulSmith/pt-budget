import { describe, expect, it } from 'vitest';

import { isWriteSql } from '../../public/database-sql-classifier.js';

describe('isWriteSql', () => {
  it('classifies SELECT/PRAGMA/EXPLAIN/transaction control as read-only', () => {
    expect(isWriteSql('SELECT * FROM transactions')).toBe(false);
    expect(isWriteSql('  select id from accounts')).toBe(false);
    expect(isWriteSql('PRAGMA foreign_keys=ON')).toBe(false);
    expect(isWriteSql('EXPLAIN QUERY PLAN SELECT 1')).toBe(false);
    expect(isWriteSql('BEGIN IMMEDIATE')).toBe(false);
    expect(isWriteSql('COMMIT')).toBe(false);
    expect(isWriteSql('ROLLBACK')).toBe(false);
    expect(isWriteSql('SAVEPOINT sp1')).toBe(false);
    expect(isWriteSql('RELEASE sp1')).toBe(false);
  });

  it('classifies INSERT/UPDATE/DELETE/REPLACE/schema statements as writes', () => {
    expect(isWriteSql('INSERT INTO transactions (id) VALUES (1)')).toBe(true);
    expect(isWriteSql('UPDATE accounts SET name = ?')).toBe(true);
    expect(isWriteSql('DELETE FROM transactions WHERE id = 1')).toBe(true);
    expect(isWriteSql('REPLACE INTO app_metadata (key, value) VALUES (?, ?)')).toBe(true);
    expect(isWriteSql('CREATE TABLE foo (id INTEGER)')).toBe(true);
    expect(isWriteSql('DROP TABLE foo')).toBe(true);
    expect(isWriteSql('ALTER TABLE foo ADD COLUMN bar TEXT')).toBe(true);
    expect(isWriteSql('VACUUM')).toBe(true);
  });

  it('classifies WITH (CTE) statements based on the trailing verb', () => {
    expect(isWriteSql('WITH cte AS (SELECT 1) SELECT * FROM cte')).toBe(false);
    expect(
      isWriteSql('WITH cte AS (SELECT 1) INSERT INTO foo SELECT * FROM cte')
    ).toBe(true);
    expect(
      isWriteSql('with cte as (select id from accounts) update accounts set x = 1')
    ).toBe(true);
  });

  it('skips leading whitespace and comments before classifying', () => {
    expect(isWriteSql('  \n\t  SELECT 1')).toBe(false);
    expect(isWriteSql('-- a comment\nSELECT 1')).toBe(false);
    expect(isWriteSql('-- a comment\nINSERT INTO foo VALUES (1)')).toBe(true);
    expect(isWriteSql('/* block comment */ SELECT 1')).toBe(false);
    expect(isWriteSql('/* block comment */ INSERT INTO foo VALUES (1)')).toBe(true);
    expect(isWriteSql('-- line\n/* block */\n  INSERT INTO foo VALUES (1)')).toBe(true);
  });

  it('handles empty/invalid input defensively', () => {
    expect(isWriteSql('')).toBe(false);
    expect(isWriteSql('   ')).toBe(false);
    expect(isWriteSql('-- only a comment')).toBe(false);
    // isWriteSql defends against non-string input at runtime even though
    // the (untyped) .js module doesn't enforce it at the type level.
    expect(isWriteSql(null)).toBe(false);
    expect(isWriteSql(undefined)).toBe(false);
  });
});
