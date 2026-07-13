/**
 * Merchant Rules Seed Service
 *
 * Loads the bundled community merchant-rule list from /community-data and
 * upserts it into the merchant_rules table. Pure DI style (like
 * csvImportService): database access is injected so the logic is unit-testable.
 *
 * Reseed semantics:
 * - New community rules always arrive.
 * - Updates to existing community rules apply ONLY when the user has not
 *   edited/disabled that rule (merchant_rules.user_modified = 0 guard in SQL).
 * - User rules ('user:' keys) are never touched.
 * - Community rules removed from the JSON stay in the DB (deleting could
 *   orphan recurring_series.rule_id expectations).
 */

import { SUBSCRIPTION_QUERIES } from './sqlQueries';
import type { MerchantRuleKind, MerchantRuleMatchType } from '../types/database';

export const COMMUNITY_RULES_URL = '/community-data/merchant-rules.json';
export const SEED_VERSION_METADATA_KEY = 'merchant_rules_seed_version';

const VALID_MATCH_TYPES: MerchantRuleMatchType[] = ['exact', 'prefix', 'contains'];
const VALID_KINDS: MerchantRuleKind[] = ['subscription', 'bill', 'purchase', 'unknown'];

export interface CommunityRuleEntry {
  rule_key: string;
  pattern: string;
  match_type: MerchantRuleMatchType;
  priority: number;
  merchant_name: string;
  service_name?: string | null;
  default_kind: MerchantRuleKind;
}

export interface CommunityRulesFile {
  table: string;
  version: number;
  note?: string;
  data: CommunityRuleEntry[];
}

export interface SeedMerchantRulesDeps {
  query: (sql: string, parameters?: unknown[]) => Promise<any[]>;
  fetchRulesFile?: () => Promise<CommunityRulesFile>;
}

export interface SeedMerchantRulesResult {
  skipped: boolean;
  fileVersion: number;
  rulesProcessed: number;
  rulesRejected: number;
}

export function validateCommunityRule(entry: unknown): entry is CommunityRuleEntry {
  if (!entry || typeof entry !== 'object') return false;
  const rule = entry as Record<string, unknown>;
  return (
    typeof rule.rule_key === 'string' &&
    rule.rule_key.startsWith('community:') &&
    typeof rule.pattern === 'string' &&
    rule.pattern.length > 0 &&
    VALID_MATCH_TYPES.includes(rule.match_type as MerchantRuleMatchType) &&
    typeof rule.priority === 'number' &&
    Number.isInteger(rule.priority) &&
    typeof rule.merchant_name === 'string' &&
    rule.merchant_name.length > 0 &&
    (rule.service_name === null ||
      rule.service_name === undefined ||
      typeof rule.service_name === 'string') &&
    VALID_KINDS.includes(rule.default_kind as MerchantRuleKind)
  );
}

async function fetchCommunityRulesFile(): Promise<CommunityRulesFile> {
  const response = await fetch(COMMUNITY_RULES_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch community merchant rules: HTTP ${response.status}`);
  }
  return (await response.json()) as CommunityRulesFile;
}

/**
 * Seeds/updates community merchant rules. Safe to call on every app start:
 * a version gate skips work when the bundled list has already been applied.
 * Pass force=true (Settings "Re-apply community rules") to bypass the gate;
 * user-modified rules are still protected by the SQL upsert guard.
 */
export async function seedMerchantRules(
  deps: SeedMerchantRulesDeps,
  options: { force?: boolean } = {}
): Promise<SeedMerchantRulesResult> {
  const fetchRulesFile = deps.fetchRulesFile ?? fetchCommunityRulesFile;
  const file = await fetchRulesFile();

  const fileVersion = Number(file?.version) || 0;
  if (!Array.isArray(file?.data) || fileVersion <= 0) {
    throw new Error('Community merchant rules file is malformed (missing version or data)');
  }

  if (!options.force) {
    const versionRows = await deps.query(SUBSCRIPTION_QUERIES.GET_METADATA, [
      SEED_VERSION_METADATA_KEY,
    ]);
    const seededVersion = Number(versionRows?.[0]?.value) || 0;

    if (seededVersion >= fileVersion) {
      const countRows = await deps.query(
        `SELECT COUNT(*) as count FROM merchant_rules WHERE source = 'community'`
      );
      const existingCount = Number(countRows?.[0]?.count) || 0;
      if (existingCount > 0) {
        return { skipped: true, fileVersion, rulesProcessed: 0, rulesRejected: 0 };
      }
    }
  }

  let rulesProcessed = 0;
  let rulesRejected = 0;

  for (const entry of file.data) {
    if (!validateCommunityRule(entry)) {
      rulesRejected++;
      console.warn('[Merchant Rules Seed] Rejected malformed community rule:', entry);
      continue;
    }

    await deps.query(SUBSCRIPTION_QUERIES.UPSERT_COMMUNITY_RULE, [
      entry.rule_key,
      entry.pattern,
      entry.match_type,
      entry.priority,
      entry.merchant_name,
      entry.service_name ?? null,
      entry.default_kind,
    ]);
    rulesProcessed++;
  }

  await deps.query(SUBSCRIPTION_QUERIES.SET_METADATA, [
    SEED_VERSION_METADATA_KEY,
    String(fileVersion),
  ]);

  return { skipped: false, fileVersion, rulesProcessed, rulesRejected };
}
