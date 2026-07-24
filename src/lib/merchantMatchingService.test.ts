import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  countRuleMatches,
  matchRule,
  normalizeDescription,
  sortRules,
} from './merchantMatchingService';
import type { CommunityRulesFile } from './merchantRulesSeedService';
import type { MerchantRule, MerchantRuleKind, MerchantRuleMatchType } from '../types/database';

function makeRule(overrides: Partial<MerchantRule>): MerchantRule {
  return {
    id: 1,
    rule_key: 'test:rule',
    source: 'community',
    pattern: 'TEST',
    match_type: 'prefix',
    priority: 100,
    merchant_name: 'Test',
    service_name: null,
    default_kind: 'purchase',
    enabled: 1,
    user_modified: 0,
    notes: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function loadCommunityRules(): CommunityRulesFile {
  const filePath = path.resolve(__dirname, '../../public/community-data/merchant-rules.json');
  return JSON.parse(readFileSync(filePath, 'utf-8')) as CommunityRulesFile;
}

function toMerchantRules(file: CommunityRulesFile): MerchantRule[] {
  return file.data.map((entry, index) =>
    makeRule({
      id: index + 1,
      rule_key: entry.rule_key,
      pattern: entry.pattern,
      match_type: entry.match_type,
      priority: entry.priority,
      merchant_name: entry.merchant_name,
      service_name: entry.service_name ?? null,
      default_kind: entry.default_kind,
    })
  );
}

describe('normalizeDescription', () => {
  // Table-driven cases from real bank charge descriptions
  const cases: Array<[raw: string, normalized: string]> = [
    ['AMAZON MKTPL*B03SZ4DL1', 'AMAZON MKTPL'],
    ['AMAZON PRIME*591NQ1G33', 'AMAZON PRIME'],
    ['AMAZON WEB SERVICES', 'AMAZON WEB SERVICES'],
    ['AMAZON.COM*D74RO00S3', 'AMAZON.COM'],
    ['APPLE.COM/BILL', 'APPLE.COM/BILL'],
    ['NETFLIX.COM', 'NETFLIX.COM'],
    ['SPOTIFY P43C314821', 'SPOTIFY'],
    ['MSFT * E0500ZSTGX', 'MSFT'],
    ['PELOTON* MEMBERSHIP', 'PELOTON MEMBERSHIP'],
    ['KINDLE UNLTD*NZ4A32VA3', 'KINDLE UNLTD'],
    ['TST* HIGH BANK DISTILL', 'HIGH BANK DISTILL'],
    ['TST*ASTERISK', 'ASTERISK'],
    ['SQ *BLEND CANDLE CO.', 'BLEND CANDLE CO'],
    ['DD *DOORDASH P.F.CHANG', 'DOORDASH P.F.CHANG'],
    ['IC* INSTACART*161', 'INSTACART'],
    ['HLU*HULUPLUS', 'HULUPLUS'],
    ['WL *STEAM PURCHASE', 'STEAM PURCHASE'],
    ['GIANT EAGLE #6507', 'GIANT EAGLE'],
    ['CHIPOTLE 0530', 'CHIPOTLE'],
    ['TARGET        00012369', 'TARGET'],
    ['UNITED   01621115998843', 'UNITED'],
    ['ALASKA A 02774614034334', 'ALASKA A'],
    ['UBER   *TRIP', 'UBER TRIP'],
    ['VZWRLSS*APOCC VISN', 'VZWRLSS APOCC VISN'],
    ['SP POPFLEX', 'POPFLEX'],
    ['TST*YABOS SPORTS BAR &', 'YABOS SPORTS BAR'],
    ['BREEZELINE', 'BREEZELINE'],
  ];

  it.each(cases)('normalizes %s to %s', (raw, expected) => {
    expect(normalizeDescription(raw)).toBe(expected);
  });

  it.each(cases)('is idempotent for %s', (raw) => {
    const once = normalizeDescription(raw);
    expect(normalizeDescription(once)).toBe(once);
  });

  it('never strips the final remaining token', () => {
    expect(normalizeDescription('01621115998843')).toBe('01621115998843');
  });

  it('handles empty and nullish input', () => {
    expect(normalizeDescription('')).toBe('');
    expect(normalizeDescription(undefined as unknown as string)).toBe('');
  });
});

describe('rule matching against the community list', () => {
  const rules = sortRules(toMerchantRules(loadCommunityRules()));

  const expectations: Array<
    [description: string, ruleKey: string | null, kind?: MerchantRuleKind]
  > = [
    ['AMAZON MKTPL*B03SZ4DL1', 'community:amazon-marketplace', 'purchase'],
    ['AMAZON PRIME*591NQ1G33', 'community:amazon-prime', 'subscription'],
    ['AMAZON WEB SERVICES', 'community:amazon-web-services', 'bill'],
    ['AMAZON RETA* 8T60N9EX3', 'community:amazon-retail', 'purchase'],
    ['APPLE.COM/BILL', 'community:apple-bill', 'subscription'],
    ['NETFLIX.COM', 'community:netflix', 'subscription'],
    ['SPOTIFY P43C314821', 'community:spotify', 'subscription'],
    ['MSFT * E0500ZSTGX', 'community:microsoft', 'subscription'],
    ['HLU*HULUPLUS', 'community:hulu', 'subscription'],
    ['PELOTON* MEMBERSHIP', 'community:peloton-membership', 'subscription'],
    ['SP PELOTON APPAREL US', 'community:peloton-generic', 'purchase'],
    ['VZWRLSS*APOCC VISN', 'community:verizon-vzw', 'bill'],
    ['BREEZELINE', 'community:breezeline', 'bill'],
    ['DD *DOORDASH P.F.CHANG', 'community:doordash', 'purchase'],
    ['IC* COSTCO BY INSTACAR', 'community:instacart', 'purchase'],
    ['UNITED   01621115998843', 'community:united-airlines', 'purchase'],
    // Guard: the exact-match airline rule must not swallow United Dairy Farmers,
    // which has its own merchant rule.
    ['UNITED DAIRY FARMERS', 'community:udf', 'purchase'],
    ['TST* HIGH BANK DISTILL', null],
    ['SQ *BLEND CANDLE CO.', null],
  ];

  it.each(expectations)('matches %s to %s', (description, expectedRuleKey, expectedKind) => {
    const rule = matchRule(normalizeDescription(description), rules);
    expect(rule?.rule_key ?? null).toBe(expectedRuleKey);
    if (expectedKind) {
      expect(rule?.default_kind).toBe(expectedKind);
    }
  });

  it('lets the generic AMAZON catch-all win only when no service rule matches', () => {
    const rule = matchRule(normalizeDescription('AMAZON MKTPLACE PMTS'), rules);
    // 'AMAZON MKTPL' prefix (priority 100) covers this before the catch-all
    expect(rule?.rule_key).toBe('community:amazon-marketplace');

    const genericHit = matchRule(normalizeDescription('AMAZON MARK* 0X0ED0WX3'), rules);
    expect(genericHit?.rule_key).toBe('community:amazon-generic');
  });

  it('skips disabled rules', () => {
    const disabled = rules.map((rule) =>
      rule.rule_key === 'community:netflix' ? { ...rule, enabled: 0 } : rule
    );
    expect(matchRule('NETFLIX.COM', disabled)).toBeNull();
  });
});

describe('sortRules precedence', () => {
  it('orders by priority, then pattern length, then rule_key', () => {
    const rules = [
      makeRule({ rule_key: 'b', pattern: 'AAA', priority: 100 }),
      makeRule({ rule_key: 'a', pattern: 'AAA', priority: 100 }),
      makeRule({ rule_key: 'c', pattern: 'AAAAA', priority: 100 }),
      makeRule({ rule_key: 'd', pattern: 'A', priority: 50 }),
    ];

    const sorted = sortRules(rules);
    expect(sorted.map((rule) => rule.rule_key)).toEqual(['d', 'c', 'a', 'b']);
  });

  it('user rules (priority 50) beat community rules for the same text', () => {
    const community = makeRule({
      rule_key: 'community:amazon-generic',
      pattern: 'AMAZON',
      priority: 200,
      merchant_name: 'Amazon',
    });
    const user = makeRule({
      rule_key: 'user:my-override',
      source: 'user',
      pattern: 'AMAZON',
      priority: 50,
      merchant_name: 'My Amazon Override',
    });

    const winner = matchRule('AMAZON MKTPLACE', sortRules([community, user]));
    expect(winner?.rule_key).toBe('user:my-override');
  });
});

describe('countRuleMatches', () => {
  it('counts raw descriptions the rule would match after normalization', () => {
    const count = countRuleMatches(
      { pattern: 'NETFLIX', match_type: 'prefix' },
      ['NETFLIX.COM', 'netflix.com', 'HULU', 'NETFLIX 12345']
    );
    expect(count).toBe(3);
  });
});

describe('community merchant-rules JSON lint', () => {
  const file = loadCommunityRules();
  const validMatchTypes: MerchantRuleMatchType[] = ['exact', 'prefix', 'contains'];
  const validKinds: MerchantRuleKind[] = ['subscription', 'bill', 'purchase', 'unknown'];

  it('has a positive integer version and non-empty data', () => {
    expect(Number.isInteger(file.version)).toBe(true);
    expect(file.version).toBeGreaterThan(0);
    expect(file.data.length).toBeGreaterThan(0);
  });

  it('has unique community-prefixed rule keys and valid enum values', () => {
    const keys = new Set<string>();
    for (const entry of file.data) {
      expect(entry.rule_key.startsWith('community:')).toBe(true);
      expect(keys.has(entry.rule_key)).toBe(false);
      keys.add(entry.rule_key);
      expect(validMatchTypes).toContain(entry.match_type);
      expect(validKinds).toContain(entry.default_kind);
      expect(entry.pattern.length).toBeGreaterThan(0);
      expect(entry.merchant_name.length).toBeGreaterThan(0);
      expect(Number.isInteger(entry.priority)).toBe(true);
    }
  });

  it('stores every pattern pre-normalized', () => {
    for (const entry of file.data) {
      expect(normalizeDescription(entry.pattern)).toBe(entry.pattern);
    }
  });

  // Precedence invariant: when one prefix pattern is a prefix of another,
  // the shorter (more general) rule must have a strictly larger priority,
  // or the longer rule can never shadow it correctly.
  it('never lets a generic prefix rule shadow a more specific one', () => {
    const prefixRules = file.data.filter((entry) => entry.match_type === 'prefix');
    for (const general of prefixRules) {
      for (const specific of prefixRules) {
        if (general.rule_key === specific.rule_key) continue;
        if (!specific.pattern.startsWith(general.pattern)) continue;
        expect(
          general.priority,
          `${general.rule_key} (${general.pattern}) shadows ${specific.rule_key} (${specific.pattern})`
        ).toBeGreaterThan(specific.priority);
      }
    }
  });
});
