import type {
  ChatCompletionTool,
  ChatCompletionToolCall,
} from '@wllama/wllama/esm';

import type {
  AiToolCallRecord,
  AiWriteMode,
  ApplyTransactionClassificationInput,
  MerchantRuleSuggestion,
  TransactionClassificationSuggestion,
} from '@/types/ai';
import type {
  Category,
  Company,
  MerchantRuleKind,
  MerchantRuleMatchType,
  Project,
  Transaction,
  TransactionType,
  Trip,
  UnmatchedCluster,
} from '@/types/database';

const DEFAULT_QUERY_LIMIT = 100;
const MAX_QUERY_LIMIT = 500;

export interface AiDatabaseToolContext {
  executeCustomQuery: (sql: string, timeoutMs?: number) => Promise<any[]>;
  applyTransactionClassifications: (
    classifications: ApplyTransactionClassificationInput[]
  ) => Promise<{ appliedCount: number; transactionIds: number[] }>;
  getUnmatchedRecurringClusters?: (minOccurrences?: number) => Promise<UnmatchedCluster[]>;
  categories: Category[];
  companies: Company[];
  projects: Project[];
  trips: Trip[];
  writeMode: AiWriteMode;
}

export interface AiDatabaseToolResult {
  content: string;
  toolCall: AiToolCallRecord;
  classificationSuggestions: TransactionClassificationSuggestion[];
  merchantRuleSuggestions: MerchantRuleSuggestion[];
}

export const AI_DATABASE_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'query_transactions',
      description: 'Run a bounded read-only SELECT query against the local budget database.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sql: {
            type: 'string',
            description: 'A single SELECT or WITH query. Mutation statements are not allowed.',
          },
          maxRows: {
            type: 'number',
            description: 'Maximum rows to return, capped by the application.',
          },
        },
        required: ['sql'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_recurring_subscriptions',
      description: 'Find repeated expense descriptions that may be recurring subscriptions.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          minOccurrences: {
            type: 'number',
            description: 'Minimum number of matching transactions required.',
          },
          maxRows: {
            type: 'number',
            description: 'Maximum recurring groups to return.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'suggest_transaction_classifications',
      description: 'Suggest categories and companies for recent uncategorized transactions using local catalog names.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum uncategorized transactions to inspect.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_unmatched_merchant_clusters',
      description:
        'List repeated expense descriptions that match no merchant rule yet. Use before propose_merchant_rules to see which charges need a merchant name.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          minOccurrences: {
            type: 'number',
            description: 'Minimum number of matching transactions required (default 3).',
          },
          maxRows: {
            type: 'number',
            description: 'Maximum clusters to return.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_merchant_rules',
      description:
        'Stage merchant-rule suggestions (pattern -> merchant/service/kind) for user review. Rules are never created automatically; the user approves them in the review panel.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          rules: {
            type: 'array',
            description: 'Merchant rules to stage for the user to review.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                pattern: {
                  type: 'string',
                  description: 'Normalized description pattern, e.g. "HIGH BANK DISTILL".',
                },
                match_type: { type: 'string', enum: ['exact', 'prefix', 'contains'] },
                merchant_name: {
                  type: 'string',
                  description: 'Clean merchant/brand name, e.g. "High Bank Distillery".',
                },
                service_name: {
                  type: ['string', 'null'] as unknown as string,
                  description: 'Specific product/service under the merchant, if any.',
                },
                default_kind: {
                  type: 'string',
                  enum: ['subscription', 'bill', 'purchase', 'unknown'],
                },
                confidence: { type: 'number' },
                reason: { type: 'string' },
              },
              required: ['pattern', 'match_type', 'merchant_name', 'default_kind'],
            },
          },
        },
        required: ['rules'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apply_transaction_classifications',
      description: 'Apply or stage transaction category/company/project/trip classifications. Review mode stages suggestions for the user.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          classifications: {
            type: 'array',
            description: 'Classification changes to apply or stage for review.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                transactionId: { type: 'number' },
                categoryId: { type: ['number', 'null'] as unknown as string },
                categoryName: { type: ['string', 'null'] as unknown as string },
                categoryType: { type: 'string', enum: ['income', 'expense'] },
                companyId: { type: ['number', 'null'] as unknown as string },
                companyName: { type: ['string', 'null'] as unknown as string },
                projectId: { type: ['number', 'null'] as unknown as string },
                tripId: { type: ['number', 'null'] as unknown as string },
                confidence: { type: 'number' },
                reason: { type: 'string' },
              },
              required: ['transactionId'],
            },
          },
        },
        required: ['classifications'],
      },
    },
  },
];

function parseToolArguments(toolCall: ChatCompletionToolCall): Record<string, unknown> {
  if (!toolCall.function.arguments.trim()) {
    return {};
  }

  const parsed = JSON.parse(toolCall.function.arguments) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Tool arguments must be a JSON object');
  }

  return parsed as Record<string, unknown>;
}

function boundedLimit(value: unknown, fallback = DEFAULT_QUERY_LIMIT): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(Math.trunc(value), MAX_QUERY_LIMIT));
}

function buildBoundedSelect(sql: string, maxRows: number): string {
  const trimmed = sql.trim().replace(/;+$/, '');
  const normalized = trimmed.toLowerCase();

  if (!normalized.startsWith('select') && !normalized.startsWith('with')) {
    throw new Error('AI database tools only allow SELECT queries');
  }

  if (trimmed.includes(';')) {
    throw new Error('AI database tools only allow one SQL statement at a time');
  }

  return `SELECT * FROM (${trimmed}) LIMIT ${maxRows}`;
}

const TRANSACTION_TYPES: readonly TransactionType[] = ['income', 'expense', 'refund', 'transfer'];

function asTransaction(row: any): Pick<Transaction, 'id' | 'date' | 'amount' | 'description' | 'type'> {
  return {
    id: Number(row.id),
    date: String(row.date),
    amount: Number(row.amount),
    description: String(row.description),
    type: TRANSACTION_TYPES.includes(row.type) ? (row.type as TransactionType) : 'expense',
  };
}

function normalizeClassifications(value: unknown): TransactionClassificationSuggestion[] {
  if (!Array.isArray(value)) {
    throw new Error('classifications must be an array');
  }

  return value.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`Classification ${index + 1} must be an object`);
    }

    const record = item as Record<string, unknown>;
    if (typeof record.transactionId !== 'number') {
      throw new Error(`Classification ${index + 1} is missing transactionId`);
    }

    return {
      transactionId: record.transactionId,
      categoryId: typeof record.categoryId === 'number' || record.categoryId === null ? record.categoryId : undefined,
      categoryName: typeof record.categoryName === 'string' || record.categoryName === null ? record.categoryName : undefined,
      categoryType: record.categoryType === 'income' || record.categoryType === 'expense' ? record.categoryType : undefined,
      companyId: typeof record.companyId === 'number' || record.companyId === null ? record.companyId : undefined,
      companyName: typeof record.companyName === 'string' || record.companyName === null ? record.companyName : undefined,
      projectId: typeof record.projectId === 'number' || record.projectId === null ? record.projectId : undefined,
      tripId: typeof record.tripId === 'number' || record.tripId === null ? record.tripId : undefined,
      confidence: typeof record.confidence === 'number' ? record.confidence : undefined,
      reason: typeof record.reason === 'string' ? record.reason : undefined,
    };
  });
}

const VALID_RULE_MATCH_TYPES: MerchantRuleMatchType[] = ['exact', 'prefix', 'contains'];
const VALID_RULE_KINDS: MerchantRuleKind[] = ['subscription', 'bill', 'purchase', 'unknown'];

function normalizeMerchantRuleSuggestions(value: unknown): MerchantRuleSuggestion[] {
  if (!Array.isArray(value)) {
    throw new Error('rules must be an array');
  }

  return value.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`Rule ${index + 1} must be an object`);
    }

    const record = item as Record<string, unknown>;
    if (typeof record.pattern !== 'string' || !record.pattern.trim()) {
      throw new Error(`Rule ${index + 1} is missing a pattern`);
    }
    if (!VALID_RULE_MATCH_TYPES.includes(record.match_type as MerchantRuleMatchType)) {
      throw new Error(`Rule ${index + 1} has an invalid match_type`);
    }
    if (typeof record.merchant_name !== 'string' || !record.merchant_name.trim()) {
      throw new Error(`Rule ${index + 1} is missing a merchant_name`);
    }
    if (!VALID_RULE_KINDS.includes(record.default_kind as MerchantRuleKind)) {
      throw new Error(`Rule ${index + 1} has an invalid default_kind`);
    }

    return {
      pattern: record.pattern.trim(),
      match_type: record.match_type as MerchantRuleMatchType,
      merchant_name: record.merchant_name.trim(),
      service_name: typeof record.service_name === 'string' ? record.service_name.trim() : null,
      default_kind: record.default_kind as MerchantRuleKind,
      confidence: typeof record.confidence === 'number' ? record.confidence : undefined,
      reason: typeof record.reason === 'string' ? record.reason : undefined,
    };
  });
}

function findNameMatch<T extends { name: string }>(description: string, values: T[]): T | null {
  const lowerDescription = description.toLowerCase();
  return values.find((value) => {
    const name = value.name.toLowerCase();
    return name.length >= 3 && lowerDescription.includes(name);
  }) ?? null;
}

async function queryTransactions(
  args: Record<string, unknown>,
  context: AiDatabaseToolContext
) {
  if (typeof args.sql !== 'string') {
    throw new Error('query_transactions requires a SQL string');
  }

  const maxRows = boundedLimit(args.maxRows);
  const rows = await context.executeCustomQuery(buildBoundedSelect(args.sql, maxRows), 10000);

  return {
    rows,
    returnedRows: rows.length,
    maxRows,
  };
}

async function findRecurringSubscriptions(
  args: Record<string, unknown>,
  context: AiDatabaseToolContext
) {
  const minOccurrences = boundedLimit(args.minOccurrences, 2);
  const maxRows = boundedLimit(args.maxRows, 50);
  const sql = `
    SELECT
      LOWER(TRIM(COALESCE(comp.name, t.description))) AS merchant_or_description,
      COUNT(*) AS occurrences,
      ROUND(AVG(ABS(t.amount)), 2) AS average_amount,
      ROUND(MIN(ABS(t.amount)), 2) AS min_amount,
      ROUND(MAX(ABS(t.amount)), 2) AS max_amount,
      MIN(t.date) AS first_seen,
      MAX(t.date) AS last_seen,
      GROUP_CONCAT(t.id) AS transaction_ids
    FROM transactions t
    LEFT JOIN companies comp ON t.company_id = comp.id
    WHERE t.type = 'expense'
    GROUP BY merchant_or_description
    HAVING COUNT(*) >= ${minOccurrences}
    ORDER BY occurrences DESC, average_amount DESC
  `;

  const rows = await context.executeCustomQuery(buildBoundedSelect(sql, maxRows), 10000);

  return {
    recurringCandidates: rows,
    returnedRows: rows.length,
    minOccurrences,
    maxRows,
  };
}

async function suggestTransactionClassifications(
  args: Record<string, unknown>,
  context: AiDatabaseToolContext
): Promise<TransactionClassificationSuggestion[]> {
  const limit = boundedLimit(args.limit, 50);
  const rows = await context.executeCustomQuery(
    buildBoundedSelect(
      `
        SELECT id, date, amount, description, type, category_id, company_id
        FROM transactions
        WHERE (category_id IS NULL OR company_id IS NULL)
          AND type IN ('income', 'expense', 'refund')
        ORDER BY date DESC, id DESC
      `,
      limit
    ),
    10000
  );

  return rows.map((row) => {
    const transaction = asTransaction(row);
    // A refund keeps the category of the spending it reverses, so it nets out
    // of that category's total; only true income draws from income categories.
    const categoryType: Category['type'] = transaction.type === 'income' ? 'income' : 'expense';
    const category = findNameMatch(
      transaction.description,
      context.categories.filter((candidate) => candidate.type === categoryType)
    );
    const company = findNameMatch(transaction.description, context.companies);

    return {
      transactionId: transaction.id,
      categoryId: category?.id,
      categoryName: category?.name,
      categoryType,
      companyId: company?.id,
      companyName: company?.name,
      confidence: category || company ? 0.55 : 0.25,
      reason: category || company
        ? 'Matched existing catalog names in the transaction description.'
        : 'Needs model review; no direct catalog name match was found.',
      transaction: {
        ...transaction,
        category_name: undefined,
        company_name: undefined,
        project_name: undefined,
        trip_name: undefined,
      },
    };
  });
}

async function getUnmatchedMerchantClusters(
  args: Record<string, unknown>,
  context: AiDatabaseToolContext
) {
  if (!context.getUnmatchedRecurringClusters) {
    throw new Error('Unmatched merchant clusters are not available in this context');
  }

  const minOccurrences = boundedLimit(args.minOccurrences, 3);
  const maxRows = boundedLimit(args.maxRows, 25);
  const clusters = await context.getUnmatchedRecurringClusters(minOccurrences);
  const limited = clusters.slice(0, maxRows).map((cluster) => ({
    normalized_description: cluster.normalized_description,
    occurrences: cluster.occurrences,
    average_amount: Math.round(cluster.average_amount * 100) / 100,
    first_seen: cluster.first_seen,
    last_seen: cluster.last_seen,
  }));

  return {
    clusters: limited,
    returnedRows: limited.length,
    minOccurrences,
  };
}

function proposeMerchantRules(args: Record<string, unknown>) {
  const suggestions = normalizeMerchantRuleSuggestions(args.rules);

  return {
    requiresReview: true as const,
    rules: suggestions,
    message:
      'Merchant rules are staged for user review and were not created. The user can approve them in the review panel.',
  };
}

async function applyTransactionClassifications(
  args: Record<string, unknown>,
  context: AiDatabaseToolContext
) {
  const suggestions = normalizeClassifications(args.classifications);

  if (context.writeMode === 'review') {
    return {
      requiresReview: true as const,
      classifications: suggestions,
      message: 'Classifications are staged for user review and were not written to the database.',
    };
  }

  const result = await context.applyTransactionClassifications(suggestions);

  return {
    requiresReview: false as const,
    ...result,
  };
}

export async function executeAiDatabaseToolCall(
  toolCall: ChatCompletionToolCall,
  context: AiDatabaseToolContext
): Promise<AiDatabaseToolResult> {
  const record: AiToolCallRecord = {
    id: toolCall.id,
    name: toolCall.function.name,
    argumentsJson: toolCall.function.arguments,
    status: 'running',
  };

  try {
    const args = parseToolArguments(toolCall);
    let result: unknown;
    let classificationSuggestions: TransactionClassificationSuggestion[] = [];
    let merchantRuleSuggestions: MerchantRuleSuggestion[] = [];

    if (toolCall.function.name === 'query_transactions') {
      result = await queryTransactions(args, context);
    } else if (toolCall.function.name === 'find_recurring_subscriptions') {
      result = await findRecurringSubscriptions(args, context);
    } else if (toolCall.function.name === 'suggest_transaction_classifications') {
      classificationSuggestions = await suggestTransactionClassifications(args, context);
      result = { classifications: classificationSuggestions };
    } else if (toolCall.function.name === 'get_unmatched_merchant_clusters') {
      result = await getUnmatchedMerchantClusters(args, context);
    } else if (toolCall.function.name === 'propose_merchant_rules') {
      const proposeResult = proposeMerchantRules(args);
      result = proposeResult;
      merchantRuleSuggestions = proposeResult.rules;
    } else if (toolCall.function.name === 'apply_transaction_classifications') {
      const applyResult = await applyTransactionClassifications(args, context);
      result = applyResult;
      if (applyResult.requiresReview) {
        classificationSuggestions = applyResult.classifications;
      }
    } else {
      throw new Error(`Unknown AI tool: ${toolCall.function.name}`);
    }

    record.status = 'completed';
    record.result = result;

    return {
      content: JSON.stringify(result),
      toolCall: record,
      classificationSuggestions,
      merchantRuleSuggestions,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI tool call failed';
    record.status = 'failed';
    record.error = message;

    return {
      content: JSON.stringify({ error: message }),
      toolCall: record,
      classificationSuggestions: [],
      merchantRuleSuggestions: [],
    };
  }
}