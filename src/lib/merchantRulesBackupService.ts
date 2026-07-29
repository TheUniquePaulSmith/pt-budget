/**
 * Merchant Rules Backup Service
 *
 * Export/import of a user's own ('user' source) merchant rules as a
 * standalone JSON file, independent of the full database export. Lets
 * someone back up rules they hand-built and restore them later, or move
 * them to another browser profile.
 *
 * Pure DI style (like merchantRulesSeedService): database access is
 * injected so validation/import logic is unit-testable without a real DB.
 * Re-importing the same file is idempotent — entries upsert by rule_key
 * (see SUBSCRIPTION_QUERIES.IMPORT_USER_RULE) instead of duplicating rows.
 */

import { normalizeDescription } from './merchantMatchingService';
import { SUBSCRIPTION_QUERIES } from './sqlQueries';
import type { MerchantRule, MerchantRuleKind, MerchantRuleMatchType } from '../types/database';

export const CUSTOM_RULES_EXPORT_TABLE = 'merchant_rules';
export const CUSTOM_RULES_EXPORT_KIND = 'custom-rules-export';
export const CUSTOM_RULES_EXPORT_VERSION = 1;

const VALID_MATCH_TYPES: MerchantRuleMatchType[] = ['exact', 'prefix', 'contains'];
const VALID_KINDS: MerchantRuleKind[] = ['subscription', 'bill', 'purchase', 'unknown'];

export interface MerchantRuleExportEntry {
  rule_key: string;
  pattern: string;
  match_type: MerchantRuleMatchType;
  priority: number;
  merchant_name: string;
  service_name: string | null;
  default_kind: MerchantRuleKind;
  enabled: boolean;
  notes: string | null;
}

export interface MerchantRulesExportFile {
  table: typeof CUSTOM_RULES_EXPORT_TABLE;
  kind: typeof CUSTOM_RULES_EXPORT_KIND;
  version: number;
  exported_at: string;
  note: string;
  data: MerchantRuleExportEntry[];
}

/**
 * Builds the exportable file from the full rule set: only 'user' rules are
 * included (the community list ships with the app and is restored via
 * "Re-apply Community Rules"), ordered exactly as the app evaluates them so
 * re-importing reproduces the same precedence.
 */
export function buildMerchantRulesExportFile(rules: MerchantRule[]): MerchantRulesExportFile {
  const data = rules
    .filter((rule) => rule.source === 'user')
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        b.pattern.length - a.pattern.length ||
        a.rule_key.localeCompare(b.rule_key)
    )
    .map((rule) => ({
      rule_key: rule.rule_key,
      pattern: rule.pattern,
      match_type: rule.match_type,
      priority: rule.priority,
      merchant_name: rule.merchant_name,
      service_name: rule.service_name ?? null,
      default_kind: rule.default_kind,
      enabled: Boolean(rule.enabled),
      notes: rule.notes ?? null,
    }));

  return {
    table: CUSTOM_RULES_EXPORT_TABLE,
    kind: CUSTOM_RULES_EXPORT_KIND,
    version: CUSTOM_RULES_EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    note: 'Your custom merchant rules, in priority order (lower priority number wins). Re-import from Settings → Data & Backup → Merchant Rules.',
    data,
  };
}

export function validateMerchantRuleImportEntry(entry: unknown): entry is MerchantRuleExportEntry {
  if (!entry || typeof entry !== 'object') return false;
  const rule = entry as Record<string, unknown>;
  return (
    (rule.rule_key === undefined || typeof rule.rule_key === 'string') &&
    typeof rule.pattern === 'string' &&
    rule.pattern.trim().length > 0 &&
    VALID_MATCH_TYPES.includes(rule.match_type as MerchantRuleMatchType) &&
    typeof rule.priority === 'number' &&
    Number.isInteger(rule.priority) &&
    typeof rule.merchant_name === 'string' &&
    rule.merchant_name.trim().length > 0 &&
    (rule.service_name === null ||
      rule.service_name === undefined ||
      typeof rule.service_name === 'string') &&
    VALID_KINDS.includes(rule.default_kind as MerchantRuleKind) &&
    (rule.enabled === undefined || typeof rule.enabled === 'boolean') &&
    (rule.notes === null || rule.notes === undefined || typeof rule.notes === 'string')
  );
}

function isImportFileShape(file: unknown): file is { table: unknown; data: unknown[] } {
  if (!file || typeof file !== 'object') return false;
  const candidate = file as Record<string, unknown>;
  return candidate.table === CUSTOM_RULES_EXPORT_TABLE && Array.isArray(candidate.data);
}

export interface ImportMerchantRulesDeps {
  query: (sql: string, parameters?: unknown[]) => Promise<any[]>;
  generateRuleKey: () => string;
}

export interface ImportMerchantRulesResult {
  imported: number;
  rejected: number;
}

/**
 * Validates and upserts the entries from a previously-exported custom rules
 * file. A rule_key is only trusted (and thus re-used to update the existing
 * row) when it already has the 'user:' shape a real export would produce;
 * anything else gets a freshly generated key so it always lands as a new or
 * updated *user* rule, never a community one.
 */
export async function importMerchantRulesFile(
  deps: ImportMerchantRulesDeps,
  file: unknown
): Promise<ImportMerchantRulesResult> {
  if (!isImportFileShape(file)) {
    throw new Error("This file doesn't look like a merchant rules export.");
  }

  let imported = 0;
  let rejected = 0;

  for (const entry of file.data) {
    if (!validateMerchantRuleImportEntry(entry)) {
      rejected++;
      continue;
    }

    const pattern = normalizeDescription(entry.pattern);
    if (!pattern) {
      rejected++;
      continue;
    }

    const ruleKey =
      typeof entry.rule_key === 'string' && entry.rule_key.startsWith('user:')
        ? entry.rule_key
        : deps.generateRuleKey();

    await deps.query(SUBSCRIPTION_QUERIES.IMPORT_USER_RULE, [
      ruleKey,
      pattern,
      entry.match_type,
      entry.priority,
      entry.merchant_name.trim(),
      entry.service_name?.trim() || null,
      entry.default_kind,
      entry.enabled === false ? 0 : 1,
      entry.notes ?? null,
    ]);
    imported++;
  }

  return { imported, rejected };
}
