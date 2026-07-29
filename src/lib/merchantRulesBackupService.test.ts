import { describe, expect, it, vi } from 'vitest';

import {
  buildMerchantRulesExportFile,
  importMerchantRulesFile,
  validateMerchantRuleImportEntry,
  CUSTOM_RULES_EXPORT_VERSION,
  type MerchantRulesExportFile,
} from './merchantRulesBackupService';
import { SUBSCRIPTION_QUERIES } from './sqlQueries';
import type { MerchantRule } from '../types/database';

function makeRule(overrides: Partial<MerchantRule>): MerchantRule {
  return {
    id: 1,
    rule_key: 'user:aaa',
    source: 'user',
    pattern: 'TEST',
    match_type: 'prefix',
    priority: 50,
    merchant_name: 'Test',
    service_name: null,
    default_kind: 'purchase',
    enabled: 1,
    user_modified: 1,
    notes: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

const VALID_ENTRY = {
  rule_key: 'user:abc',
  pattern: 'HIGH BANK DISTILL',
  match_type: 'prefix' as const,
  priority: 40,
  merchant_name: 'High Bank Distillery',
  service_name: null,
  default_kind: 'purchase' as const,
  enabled: true,
  notes: null,
};

describe('buildMerchantRulesExportFile', () => {
  it('includes only user rules, ordered like the app evaluates them', () => {
    const rules = [
      makeRule({ rule_key: 'community:a', source: 'community', pattern: 'A', priority: 1000 }),
      makeRule({ rule_key: 'user:low', pattern: 'AA', priority: 5 }),
      makeRule({ rule_key: 'user:tie-b', pattern: 'AAA', priority: 10 }),
      makeRule({ rule_key: 'user:tie-a', pattern: 'AAA', priority: 10 }),
      makeRule({ rule_key: 'user:high', pattern: 'A', priority: 90 }),
    ];

    const file = buildMerchantRulesExportFile(rules);

    expect(file.data.map((entry) => entry.rule_key)).toEqual([
      'user:low',
      'user:tie-a',
      'user:tie-b',
      'user:high',
    ]);
  });

  it('shapes each entry and stamps file metadata', () => {
    const rule = makeRule({
      rule_key: 'user:xyz',
      pattern: 'FOO',
      priority: 25,
      merchant_name: 'Foo Co',
      service_name: 'Foo Plus',
      default_kind: 'subscription',
      enabled: 0,
      notes: 'hand-added',
    });

    const file = buildMerchantRulesExportFile([rule]);

    expect(file.table).toBe('merchant_rules');
    expect(file.kind).toBe('custom-rules-export');
    expect(file.version).toBe(CUSTOM_RULES_EXPORT_VERSION);
    expect(() => new Date(file.exported_at).toISOString()).not.toThrow();
    expect(file.data).toEqual([
      {
        rule_key: 'user:xyz',
        pattern: 'FOO',
        match_type: 'prefix',
        priority: 25,
        merchant_name: 'Foo Co',
        service_name: 'Foo Plus',
        default_kind: 'subscription',
        enabled: false,
        notes: 'hand-added',
      },
    ]);
  });

  it('returns an empty data array when there are no user rules', () => {
    const file = buildMerchantRulesExportFile([
      makeRule({ rule_key: 'community:a', source: 'community' }),
    ]);
    expect(file.data).toEqual([]);
  });
});

describe('validateMerchantRuleImportEntry', () => {
  it('accepts a well-formed entry', () => {
    expect(validateMerchantRuleImportEntry(VALID_ENTRY)).toBe(true);
  });

  it('accepts an entry missing the optional enabled/notes fields', () => {
    const { enabled, notes, ...rest } = VALID_ENTRY;
    expect(validateMerchantRuleImportEntry(rest)).toBe(true);
  });

  it('rejects non-objects, missing fields, and bad enums', () => {
    expect(validateMerchantRuleImportEntry(null)).toBe(false);
    expect(validateMerchantRuleImportEntry('rule')).toBe(false);
    expect(validateMerchantRuleImportEntry({ ...VALID_ENTRY, pattern: '' })).toBe(false);
    expect(validateMerchantRuleImportEntry({ ...VALID_ENTRY, match_type: 'regex' })).toBe(false);
    expect(validateMerchantRuleImportEntry({ ...VALID_ENTRY, priority: 1.5 })).toBe(false);
    expect(validateMerchantRuleImportEntry({ ...VALID_ENTRY, merchant_name: '' })).toBe(false);
    expect(validateMerchantRuleImportEntry({ ...VALID_ENTRY, default_kind: 'nonsense' })).toBe(
      false
    );
    expect(validateMerchantRuleImportEntry({ ...VALID_ENTRY, enabled: 'yes' })).toBe(false);
    expect(validateMerchantRuleImportEntry({ ...VALID_ENTRY, rule_key: 123 })).toBe(false);
  });
});

// Simple in-memory fake covering the single query the importer issues.
function createQueryFake() {
  const upserts: unknown[][] = [];
  const query = vi.fn(async (sql: string, parameters: unknown[] = []) => {
    if (sql === SUBSCRIPTION_QUERIES.IMPORT_USER_RULE) {
      upserts.push(parameters);
      return [];
    }
    throw new Error(`Unexpected SQL in importer test: ${sql}`);
  });
  return { query, upserts };
}

describe('importMerchantRulesFile', () => {
  it('throws on a file that is not a recognized export', async () => {
    const fake = createQueryFake();
    const deps = { query: fake.query, generateRuleKey: () => 'user:new' };

    await expect(importMerchantRulesFile(deps, null)).rejects.toThrow(/doesn't look like/i);
    await expect(importMerchantRulesFile(deps, { table: 'other', data: [] })).rejects.toThrow(
      /doesn't look like/i
    );
    await expect(
      importMerchantRulesFile(deps, { table: 'merchant_rules', data: 'nope' })
    ).rejects.toThrow(/doesn't look like/i);
    expect(fake.query).not.toHaveBeenCalled();
  });

  it('imports valid entries and preserves an existing user: rule_key', async () => {
    const fake = createQueryFake();
    const file: MerchantRulesExportFile = {
      table: 'merchant_rules',
      kind: 'custom-rules-export',
      version: 1,
      exported_at: '2026-01-01T00:00:00.000Z',
      note: '',
      data: [VALID_ENTRY],
    };

    const result = await importMerchantRulesFile(
      { query: fake.query, generateRuleKey: () => 'user:should-not-be-used' },
      file
    );

    expect(result).toEqual({ imported: 1, rejected: 0 });
    expect(fake.upserts).toEqual([
      [
        'user:abc',
        'HIGH BANK DISTILL',
        'prefix',
        40,
        'High Bank Distillery',
        null,
        'purchase',
        1,
        null,
      ],
    ]);
  });

  it('generates a fresh rule_key when one is missing or not user-owned', async () => {
    const fake = createQueryFake();
    const deps = { query: fake.query, generateRuleKey: () => 'user:generated' };

    await importMerchantRulesFile(deps, {
      table: 'merchant_rules',
      data: [{ ...VALID_ENTRY, rule_key: 'community:sneaky' }],
    });
    await importMerchantRulesFile(deps, {
      table: 'merchant_rules',
      data: [{ ...VALID_ENTRY, rule_key: undefined }],
    });

    expect(fake.upserts[0][0]).toBe('user:generated');
    expect(fake.upserts[1][0]).toBe('user:generated');
  });

  it('normalizes patterns and defaults/stores enabled correctly', async () => {
    const fake = createQueryFake();
    const deps = { query: fake.query, generateRuleKey: () => 'user:new' };

    await importMerchantRulesFile(deps, {
      table: 'merchant_rules',
      data: [
        { ...VALID_ENTRY, rule_key: 'user:1', pattern: 'tst* lower case merchant', enabled: undefined },
        { ...VALID_ENTRY, rule_key: 'user:2', enabled: false },
      ],
    });

    expect(fake.upserts[0][1]).toBe('LOWER CASE MERCHANT'); // normalized + enabled default
    expect(fake.upserts[0][7]).toBe(1);
    expect(fake.upserts[1][7]).toBe(0); // explicit enabled: false
  });

  it('rejects malformed entries but imports the valid ones, reporting both counts', async () => {
    const fake = createQueryFake();
    const deps = { query: fake.query, generateRuleKey: () => 'user:new' };

    const result = await importMerchantRulesFile(deps, {
      table: 'merchant_rules',
      data: [
        VALID_ENTRY,
        { ...VALID_ENTRY, rule_key: 'user:bad-kind', default_kind: 'nonsense' },
        { ...VALID_ENTRY, rule_key: 'user:blank-pattern', pattern: '***' }, // normalizes to empty
      ],
    });

    expect(result).toEqual({ imported: 1, rejected: 2 });
    expect(fake.upserts).toHaveLength(1);
  });
});
