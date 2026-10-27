// Transaction classification (schema v4): deciding whether a row is income,
// an expense, a refund or a transfer, by description rules, by pairing the two
// legs of a transfer across accounts, or by inference. Row shapes live in
// ./database; these are the detector's inputs and outputs.

import type {
  AccountType,
  ClassificationRule,
  TransactionType,
  TransactionTypeSource,
} from './database';

/**
 * A row the classifier reasons about: a stored transaction (`id`) or a row
 * staged by the CSV import (`tempId`). `key` is stable within one run:
 * `tx:<id>` or `tmp:<tempId>`.
 */
export interface ClassifiableTransaction {
  key: string;
  id: number | null;
  tempId: number | null;
  account_id: number;
  account_type: AccountType;
  date: string; // YYYY-MM-DD
  amount: number; // signed: negative = money out
  description: string;
  type: TransactionType;
  type_locked: boolean;
  type_source: TransactionTypeSource;
  transfer_group_id: string | null;
}

/** Two rows that look like the legs of one transfer. */
export interface TransferPairSuggestion {
  outKey: string;
  inKey: string;
  confidence: number; // 0..1, rounded to 2 decimals
  dateGapDays: number;
  /** Human-readable evidence: "same amount", "1 day apart", "description mentions a transfer". */
  reasons: string[];
}

/**
 * What the classifier wants written for one row. Only rows whose type,
 * source or transfer group would change are returned.
 */
export interface TypeDecision {
  key: string;
  type: TransactionType;
  source: Exclude<TransactionTypeSource, 'manual'>;
  confidence: number | null;
  transferGroupId: string | null;
  ruleId: number | null;
  /** The other leg's key when the decision comes from pairing. */
  pairedWithKey: string | null;
  reasons: string[];
}

export type ClassifyMode = 'import' | 'scan';

export interface ClassifyOptions {
  /** Enabled rules; sorted by the classifier. */
  rules: ClassificationRule[];
  rows: ClassifiableTransaction[];
  /**
   * import: rows in `newKeys` are the staged file; existing rows only ever
   * change by becoming the other leg of a new transfer.
   * scan: every unlocked row is re-evaluated from scratch.
   */
  mode: ClassifyMode;
  newKeys?: ReadonlySet<string>;
  /** Legs of a transfer may post this many days apart (default 7). */
  windowDays?: number;
  /** Pairs below this confidence are reported as possible, not applied (default 0.6). */
  minConfidence?: number;
  /** Supplies transfer_group_id values (crypto.randomUUID in the app, deterministic in tests). */
  newGroupId: () => string;
}

export interface ClassifyResult {
  decisions: TypeDecision[];
  /** Pairs applied in `decisions`. */
  pairs: TransferPairSuggestion[];
  /** Amount-matched pairs that scored below minConfidence; the import shows them unchecked. */
  possiblePairs: TransferPairSuggestion[];
}

/** One leg of a transfer as shown in the import review and the counterpart picker. */
export interface TransferLegSummary {
  key: string;
  id: number | null;
  tempId: number | null;
  account_id: number;
  account_name: string;
  date: string;
  amount: number;
  description: string;
  /** False for a row already in the database (import review). */
  isNew: boolean;
}

export interface TransferPairPreview extends TransferPairSuggestion {
  pairId: string;
  out: TransferLegSummary;
  in: TransferLegSummary;
  /** True when one leg is a row already in the database. */
  involvesExisting: boolean;
  /** True when the pair cleared minConfidence (checked by default in the review). */
  recommended: boolean;
}

/** Result of classifying a staged import, shown before the user imports. */
export interface ImportClassificationPreview {
  pairs: TransferPairPreview[];
  /** Decisions for staged rows not coming from pairing (rules, refund inference), keyed by temp id. */
  rowDecisions: TypeDecision[];
  /** Decisions for rows already in the database (the existing leg of a pair). */
  existingDecisions: TypeDecision[];
  summary: {
    stagedRows: number;
    ruleMatches: number;
    refundsInferred: number;
    transfersDetected: number;
    transfersWithExisting: number;
    possibleTransfers: number;
  };
}

export interface ClassificationScanSummary {
  scanned: number;
  rulesApplied: number;
  transfersPaired: number;
  refundsInferred: number;
  /** Rows whose earlier automatic type no longer holds and reverted to the sign default. */
  reverted: number;
}

/** A candidate counterpart for linking a transfer by hand. */
export interface TransferCandidate {
  id: number;
  account_id: number;
  account_name: string;
  date: string;
  amount: number;
  description: string;
  type: TransactionType;
  type_locked: number;
  transfer_group_id: string | null;
  dateGapDays: number;
  amountMatches: boolean;
}
