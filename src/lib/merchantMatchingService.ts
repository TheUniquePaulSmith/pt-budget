/**
 * Merchant Matching Service
 *
 * Pure functions (no database access) for normalizing raw bank charge
 * descriptions and matching them against merchant rules.
 *
 * IMPORTANT: normalized text is compute-only. The stored transaction
 * description participates in the duplicate-detection hash and must never
 * be mutated (see csvImportService.generateTransactionHash usage).
 */

import type { MerchantRule } from '../types/database';

// Payment-processor prefixes that precede the real merchant name.
// Fixed allowlist on purpose: a generic "strip anything before *" rule would
// destroy meaningful prefixes like "AMAZON MKTPL*B03SZ4DL1".
//   TST*   Toast            SQ *  Square       DD *  DoorDash storefront
//   PY *   Payrix/other     PP*   PayPal       PAYPAL *  PayPal
//   IN *   Intuit           IC*   Instacart    WL *  Digital River
//   HLU*   Hulu biller      FSP*  FanShield    SPO*  Spotify/other
//   GFM*   GoFundMe         SP    Shopify      LS    Lightspeed
const PROCESSOR_PREFIX_RE =
  /^(?:TST\s?\*|SQ\s?\*|DD\s?\*|PY\s\*|PP\*|PAYPAL\s\*|IN\s\*|IC\*|WL\s\*|HLU\*|FSP\*|SPO\*|GFM\*|SP\s|LS\s)\s*/;

const MAX_NORMALIZE_PASSES = 5;

function isJunkToken(token: string): boolean {
  // All digits: store numbers, phone fragments, trailing ids
  if (/^\d+$/.test(token)) return true;
  // Phone-number-like: 800-555-1234, (614)555-1234
  if (/\d/.test(token) && /^[\d().\-]+$/.test(token)) return true;
  // Reference codes: alphanumeric with at least one digit, length >= 5
  // (kills B03SZ4DL1, P43C314821, E0500ZSTGX; keeps SERVICES, MEMBERSHIP)
  if (token.length >= 5 && /\d/.test(token) && /^[A-Z0-9.\-/]+$/.test(token)) return true;
  return false;
}

function normalizeOnce(input: string): string {
  let text = input.toUpperCase().replace(/\s+/g, ' ').trim();

  // Strip processor prefixes until none remain ("TST* SP FOO" -> "FOO")
  let previous;
  do {
    previous = text;
    text = text.replace(PROCESSOR_PREFIX_RE, '');
  } while (text !== previous && text.length > 0);

  // Star separators become spaces so attached ref codes split into their own token
  text = text.replace(/\*/g, ' ');

  // Store-number markers anywhere: "GIANT EAGLE #6507" -> "GIANT EAGLE"
  text = text.replace(/#\d+/g, ' ');

  text = text.replace(/\s+/g, ' ').trim();

  // Strip trailing junk tokens, but never the last remaining token
  const tokens = text.split(' ');
  while (tokens.length > 1 && isJunkToken(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  text = tokens.join(' ');

  // Trailing punctuation: "BLEND CANDLE CO." -> "BLEND CANDLE CO"
  text = text.replace(/[.,&\-]+$/, '').trim();

  return text;
}

/**
 * Normalizes a raw bank description for matching and clustering.
 * Idempotent: normalizeDescription(normalizeDescription(x)) === normalizeDescription(x).
 */
export function normalizeDescription(raw: string): string {
  let text = String(raw ?? '');
  for (let pass = 0; pass < MAX_NORMALIZE_PASSES; pass++) {
    const next = normalizeOnce(text);
    if (next === text) break;
    text = next;
  }
  return text;
}

/**
 * Sorts rules into evaluation order: lowest priority number first
 * (user 50 < service-level 100 < merchant catch-all 200), then longest
 * pattern (most specific), then rule_key for determinism.
 */
export function sortRules(rules: MerchantRule[]): MerchantRule[] {
  return [...rules].sort(
    (a, b) =>
      a.priority - b.priority ||
      b.pattern.length - a.pattern.length ||
      a.rule_key.localeCompare(b.rule_key)
  );
}

/**
 * Returns the first enabled rule that matches the normalized description,
 * or null. Callers must pass rules already ordered by sortRules().
 */
export function matchRule(
  normalizedDescription: string,
  sortedRules: MerchantRule[]
): MerchantRule | null {
  for (const rule of sortedRules) {
    if (!rule.enabled) continue;
    if (ruleMatches(normalizedDescription, rule)) return rule;
  }
  return null;
}

function ruleMatches(normalizedDescription: string, rule: MerchantRule): boolean {
  switch (rule.match_type) {
    case 'exact':
      return normalizedDescription === rule.pattern;
    case 'prefix':
      return normalizedDescription.startsWith(rule.pattern);
    case 'contains':
      return normalizedDescription.includes(rule.pattern);
    default:
      return false;
  }
}

/**
 * Dry-run helper for the rule editor's "would match N transactions" preview.
 * Evaluates one rule in isolation (no precedence).
 */
export function countRuleMatches(
  rule: Pick<MerchantRule, 'pattern' | 'match_type'>,
  descriptions: string[]
): number {
  const probe = {
    ...rule,
    enabled: 1,
  } as MerchantRule;
  let count = 0;
  for (const description of descriptions) {
    if (ruleMatches(normalizeDescription(description), probe)) count++;
  }
  return count;
}
