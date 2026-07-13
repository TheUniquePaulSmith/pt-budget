import { describe, expect, it, vi } from 'vitest';

import {
  seedMerchantRules,
  validateCommunityRule,
  SEED_VERSION_METADATA_KEY,
  type CommunityRulesFile,
} from './merchantRulesSeedService';
import { SUBSCRIPTION_QUERIES } from './sqlQueries';

const RULES_FILE: CommunityRulesFile = {
  table: 'merchant_rules',
  version: 2,
  data: [
    {
      rule_key: 'community:netflix',
      pattern: 'NETFLIX',
      match_type: 'prefix',
      priority: 100,
      merchant_name: 'Netflix',
      service_name: 'Netflix',
      default_kind: 'subscription',
    },
    {
      rule_key: 'community:amazon-generic',
      pattern: 'AMAZON',
      match_type: 'prefix',
      priority: 200,
      merchant_name: 'Amazon',
      service_name: null,
      default_kind: 'purchase',
    },
  ],
};

// Simple in-memory fake covering the queries the seeder issues.
function createQueryFake(options: { seededVersion?: number; communityRuleCount?: number } = {}) {
  const upserts: unknown[][] = [];
  const metadataWrites: unknown[][] = [];

  const query = vi.fn(async (sql: string, parameters: unknown[] = []) => {
    if (sql === SUBSCRIPTION_QUERIES.GET_METADATA) {
      return options.seededVersion != null ? [{ value: String(options.seededVersion) }] : [];
    }
    if (sql.includes('COUNT(*)')) {
      return [{ count: options.communityRuleCount ?? 0 }];
    }
    if (sql === SUBSCRIPTION_QUERIES.UPSERT_COMMUNITY_RULE) {
      upserts.push(parameters);
      return [];
    }
    if (sql === SUBSCRIPTION_QUERIES.SET_METADATA) {
      metadataWrites.push(parameters);
      return [];
    }
    throw new Error(`Unexpected SQL in seeder test: ${sql}`);
  });

  return { query, upserts, metadataWrites };
}

describe('seedMerchantRules', () => {
  it('seeds all rules into an empty database and stamps the version', async () => {
    const fake = createQueryFake();

    const result = await seedMerchantRules({
      query: fake.query,
      fetchRulesFile: async () => RULES_FILE,
    });

    expect(result).toEqual({
      skipped: false,
      fileVersion: 2,
      rulesProcessed: 2,
      rulesRejected: 0,
    });
    expect(fake.upserts).toHaveLength(2);
    expect(fake.upserts[0][0]).toBe('community:netflix');
    expect(fake.metadataWrites).toEqual([[SEED_VERSION_METADATA_KEY, '2']]);
  });

  it('skips when the seeded version is current and rules exist', async () => {
    const fake = createQueryFake({ seededVersion: 2, communityRuleCount: 2 });

    const result = await seedMerchantRules({
      query: fake.query,
      fetchRulesFile: async () => RULES_FILE,
    });

    expect(result.skipped).toBe(true);
    expect(fake.upserts).toHaveLength(0);
    expect(fake.metadataWrites).toHaveLength(0);
  });

  it('reseeds when the version is current but the table is empty', async () => {
    const fake = createQueryFake({ seededVersion: 2, communityRuleCount: 0 });

    const result = await seedMerchantRules({
      query: fake.query,
      fetchRulesFile: async () => RULES_FILE,
    });

    expect(result.skipped).toBe(false);
    expect(fake.upserts).toHaveLength(2);
  });

  it('applies a newer community list over an older seeded version', async () => {
    const fake = createQueryFake({ seededVersion: 1, communityRuleCount: 2 });

    const result = await seedMerchantRules({
      query: fake.query,
      fetchRulesFile: async () => RULES_FILE,
    });

    expect(result.skipped).toBe(false);
    expect(fake.upserts).toHaveLength(2);
    expect(fake.metadataWrites).toEqual([[SEED_VERSION_METADATA_KEY, '2']]);
  });

  it('bypasses the version gate when forced', async () => {
    const fake = createQueryFake({ seededVersion: 5, communityRuleCount: 2 });

    const result = await seedMerchantRules(
      { query: fake.query, fetchRulesFile: async () => RULES_FILE },
      { force: true }
    );

    expect(result.skipped).toBe(false);
    expect(fake.upserts).toHaveLength(2);
  });

  it('rejects malformed rules but seeds the valid ones', async () => {
    const fake = createQueryFake();
    const fileWithBadRule: CommunityRulesFile = {
      ...RULES_FILE,
      data: [
        ...RULES_FILE.data,
        {
          rule_key: 'not-community-prefixed',
          pattern: 'X',
          match_type: 'prefix',
          priority: 100,
          merchant_name: 'X',
          default_kind: 'purchase',
        },
        {
          rule_key: 'community:bad-kind',
          pattern: 'Y',
          match_type: 'prefix',
          priority: 100,
          merchant_name: 'Y',
          default_kind: 'nonsense' as never,
        },
      ],
    };

    const result = await seedMerchantRules({
      query: fake.query,
      fetchRulesFile: async () => fileWithBadRule,
    });

    expect(result.rulesProcessed).toBe(2);
    expect(result.rulesRejected).toBe(2);
  });

  it('throws on a malformed rules file', async () => {
    const fake = createQueryFake();

    await expect(
      seedMerchantRules({
        query: fake.query,
        fetchRulesFile: async () => ({ table: 'merchant_rules', version: 0, data: [] }),
      })
    ).rejects.toThrow(/malformed/);
  });
});

describe('validateCommunityRule', () => {
  it('accepts a well-formed rule', () => {
    expect(validateCommunityRule(RULES_FILE.data[0])).toBe(true);
  });

  it('rejects non-objects, missing fields, and bad enums', () => {
    expect(validateCommunityRule(null)).toBe(false);
    expect(validateCommunityRule('rule')).toBe(false);
    expect(validateCommunityRule({ ...RULES_FILE.data[0], pattern: '' })).toBe(false);
    expect(validateCommunityRule({ ...RULES_FILE.data[0], match_type: 'regex' })).toBe(false);
    expect(validateCommunityRule({ ...RULES_FILE.data[0], priority: 1.5 })).toBe(false);
    expect(validateCommunityRule({ ...RULES_FILE.data[0], rule_key: 'user:abc' })).toBe(false);
  });
});
