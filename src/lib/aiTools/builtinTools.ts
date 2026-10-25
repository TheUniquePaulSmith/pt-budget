import type { ChatCompletionTool } from '@wllama/wllama/esm';

import {
  AI_DATABASE_TOOLS,
  AI_DATABASE_TOOL_EXECUTORS,
  boundedLimit,
  type AiDatabaseToolContext,
  type AiToolExecutor,
} from '@/lib/aiDatabaseTools';
import type { BudgetPeriod, Category, TransactionType, TransactionUpdateInput } from '@/types/database';
import type { AiToolCrud, AiToolDefinition, AiToolInputSchema } from '@/types/aiTools';
import { consentDefaultForCrud, enabledDefaultForCrud } from './consentDefaults';
import { validateToolArguments } from './toolSchema';

const TRANSACTION_TYPES: readonly TransactionType[] = ['income', 'expense', 'refund', 'transfer'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface BuiltinToolSpec {
  crud: AiToolCrud;
  group: string;
}

/** CRUD class and group for the six original tools (schemas live in aiDatabaseTools.ts). */
const ORIGINAL_TOOL_SPECS: Record<string, BuiltinToolSpec> = {
  query_transactions: { crud: 'read', group: 'Transactions' },
  find_recurring_subscriptions: { crud: 'read', group: 'Subscriptions' },
  suggest_transaction_classifications: { crud: 'read', group: 'Classification' },
  get_unmatched_merchant_clusters: { crud: 'read', group: 'Subscriptions' },
  // Stages suggestions for review; never writes on its own.
  propose_merchant_rules: { crud: 'read', group: 'Subscriptions' },
  // Writes only when the global write mode is autoApply; the mode is the
  // existing staging gate, so the tool itself is classed as an update.
  apply_transaction_classifications: { crud: 'update', group: 'Classification' },
};

function definition(
  tool: ChatCompletionTool,
  spec: BuiltinToolSpec
): AiToolDefinition {
  return {
    name: tool.function.name,
    description: tool.function.description ?? '',
    inputSchema: (tool.function.parameters as AiToolInputSchema | undefined) ?? { type: 'object', properties: {} },
    crud: spec.crud,
    group: spec.group,
    consentDefault: consentDefaultForCrud(spec.crud),
    source: 'builtin',
    enabled: enabledDefaultForCrud(spec.crud),
  };
}

function schema(
  properties: AiToolInputSchema['properties'],
  required: string[] = []
): AiToolInputSchema {
  return { type: 'object', additionalProperties: false, properties, required };
}

function requireCapability<T>(value: T | undefined, name: string): T {
  if (!value) {
    throw new Error(`${name} is not available in this context`);
  }
  return value;
}

function requireArgs(tool: AiToolDefinition, args: Record<string, unknown>): void {
  const errors = validateToolArguments(tool.inputSchema, args);
  if (errors.length > 0) {
    throw new Error(`Invalid arguments for ${tool.name}: ${errors.join('; ')}`);
  }
}

function requireDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new Error(`${field} must be a date in YYYY-MM-DD format`);
  }
  return value;
}

// --- New built-in tools ----------------------------------------------------

const listAccounts: AiToolDefinition = {
  name: 'list_accounts',
  description: 'List the user\'s accounts (id, name, type, institution, owner) so transactions can reference a valid account id.',
  inputSchema: schema({
    includeInactive: { type: 'boolean', description: 'Include accounts marked inactive (default false).' },
  }),
  crud: 'read',
  group: 'Accounts',
  consentDefault: 'always',
  source: 'builtin',
  enabled: true,
};

const listCategories: AiToolDefinition = {
  name: 'list_categories',
  description: 'List categories (id, name, type) available for classifying transactions.',
  inputSchema: schema({
    type: { type: 'string', enum: ['income', 'expense'], description: 'Only return categories of this type.' },
  }),
  crud: 'read',
  group: 'Categories',
  consentDefault: 'always',
  source: 'builtin',
  enabled: true,
};

const getBudgetStatus: AiToolDefinition = {
  name: 'get_budget_status',
  description: 'Get budgeted versus actual spending per category for a month (YYYY-MM), quarter (YYYY-Qn) or year (YYYY).',
  inputSchema: schema({
    periodType: { type: 'string', enum: ['month', 'quarter', 'year'], description: 'Period granularity (default month).' },
    period: { type: 'string', description: 'Period key: YYYY-MM for month, YYYY-Qn for quarter, YYYY for year.' },
  }, ['period']),
  crud: 'read',
  group: 'Budget',
  consentDefault: 'always',
  source: 'builtin',
  enabled: true,
};

const createTransaction: AiToolDefinition = {
  name: 'create_transaction',
  description: 'Create a transaction. Amount sign convention: negative = money out (expense), positive = money in (income). Use list_accounts for a valid accountId.',
  inputSchema: schema({
    accountId: { type: 'integer', description: 'Account id from list_accounts.' },
    date: { type: 'string', description: 'Transaction date, YYYY-MM-DD.' },
    amount: { type: 'number', description: 'Signed amount; negative for expenses.' },
    description: { type: 'string', description: 'Payee or description.' },
    type: { type: 'string', enum: ['income', 'expense', 'refund', 'transfer'], description: 'Defaults from the amount sign.' },
    categoryId: { type: ['integer', 'null'], description: 'Optional category id.' },
    comment: { type: ['string', 'null'], description: 'Optional note.' },
  }, ['accountId', 'date', 'amount', 'description']),
  crud: 'create',
  group: 'Transactions',
  consentDefault: 'ask',
  source: 'builtin',
  enabled: true,
};

const updateTransaction: AiToolDefinition = {
  name: 'update_transaction',
  description: 'Update fields of an existing transaction. Only the provided fields change.',
  inputSchema: schema({
    transactionId: { type: 'integer' },
    date: { type: 'string', description: 'YYYY-MM-DD' },
    amount: { type: 'number' },
    description: { type: 'string' },
    comment: { type: ['string', 'null'] },
    categoryId: { type: ['integer', 'null'] },
    type: { type: 'string', enum: ['income', 'expense', 'refund', 'transfer'] },
  }, ['transactionId']),
  crud: 'update',
  group: 'Transactions',
  consentDefault: 'ask',
  source: 'builtin',
  enabled: true,
};

const deleteTransaction: AiToolDefinition = {
  name: 'delete_transaction',
  description: 'Permanently delete a transaction by id.',
  inputSchema: schema({
    transactionId: { type: 'integer' },
  }, ['transactionId']),
  crud: 'delete',
  group: 'Transactions',
  consentDefault: 'ask',
  source: 'builtin',
  enabled: false,
};

const createCategory: AiToolDefinition = {
  name: 'create_category',
  description: 'Create a new income or expense category.',
  inputSchema: schema({
    name: { type: 'string' },
    type: { type: 'string', enum: ['income', 'expense'] },
    color: { type: 'string', description: 'Optional hex colour such as #4caf50.' },
  }, ['name', 'type']),
  crud: 'create',
  group: 'Categories',
  consentDefault: 'ask',
  source: 'builtin',
  enabled: true,
};

const setTransactionCategory: AiToolDefinition = {
  name: 'set_transaction_category',
  description: 'Assign a category to a transaction (or clear it with null).',
  inputSchema: schema({
    transactionId: { type: 'integer' },
    categoryId: { type: ['integer', 'null'] },
  }, ['transactionId', 'categoryId']),
  crud: 'update',
  group: 'Classification',
  consentDefault: 'ask',
  source: 'builtin',
  enabled: true,
};

const createReminder: AiToolDefinition = {
  name: 'create_reminder',
  description: 'Create a reminder notification (shown on the dashboard and in the bell) for a date, optionally recurring.',
  inputSchema: schema({
    title: { type: 'string' },
    dueDate: { type: 'string', description: 'YYYY-MM-DD' },
    body: { type: ['string', 'null'] },
    recurrence: { type: 'string', enum: ['once', 'monthly', 'yearly'], description: 'Default once.' },
    reminderType: { type: 'string', enum: ['birthday', 'anniversary', 'seasonal', 'custom'], description: 'Default custom.' },
  }, ['title', 'dueDate']),
  crud: 'create',
  group: 'Reminders',
  consentDefault: 'ask',
  source: 'builtin',
  enabled: true,
};

const NEW_TOOL_EXECUTORS: Record<string, AiToolExecutor> = {
  list_accounts: async (args, context) => {
    requireArgs(listAccounts, args);
    const accounts = requireCapability(context.accounts, 'list_accounts');
    const includeInactive = args.includeInactive === true;
    const rows = accounts
      .filter((account) => includeInactive || account.is_active === undefined || account.is_active === 1)
      .map((account) => ({
        id: account.id,
        name: account.name,
        type: account.type,
        institution: account.institution ?? null,
        ownership: account.ownership ?? null,
        owner: account.owner_display_name ?? null,
        isActive: account.is_active === undefined ? true : account.is_active === 1,
      }));
    return { result: { accounts: rows, returnedRows: rows.length } };
  },

  list_categories: async (args, context) => {
    requireArgs(listCategories, args);
    const type = args.type as Category['type'] | undefined;
    const rows = context.categories
      .filter((category) => !type || category.type === type)
      .map((category) => ({ id: category.id, name: category.name, type: category.type }));
    return { result: { categories: rows, returnedRows: rows.length } };
  },

  get_budget_status: async (args, context) => {
    requireArgs(getBudgetStatus, args);
    const fetchStatus = requireCapability(context.getBudgetStatus, 'get_budget_status');
    const period: BudgetPeriod = {
      type: (args.periodType as BudgetPeriod['type'] | undefined) ?? 'month',
      key: String(args.period),
    };
    const status = await fetchStatus(period);
    return {
      result: {
        period: status.period,
        months: status.months,
        budgetedTotal: status.budgetedTotal,
        actualExpenses: status.actualExpenses,
        remaining: status.remaining,
        isOverBudget: status.isOverBudget,
        unbudgetedSpend: status.unbudgetedSpend,
        expectedIncome: status.expectedIncome,
        actualLinkedIncome: status.actualLinkedIncome,
        categories: status.categories.map((category) => ({
          categoryId: category.category_id,
          name: category.category_name ?? null,
          budgetedAmount: category.budgetedAmount,
          actualExpenses: category.actualExpenses,
          remaining: category.remaining,
          isOverBudget: category.isOverBudget,
        })),
      },
    };
  },

  create_transaction: async (args, context) => {
    requireArgs(createTransaction, args);
    const add = requireCapability(context.addTransaction, 'create_transaction');
    const amount = Number(args.amount);
    const explicitType = args.type as TransactionType | undefined;
    const type: TransactionType = explicitType && TRANSACTION_TYPES.includes(explicitType)
      ? explicitType
      : amount < 0 ? 'expense' : 'income';
    const accountId = Number(args.accountId);
    if (context.accounts && !context.accounts.some((account) => account.id === accountId)) {
      throw new Error(`Unknown accountId ${accountId}; call list_accounts first`);
    }

    await add({
      account_id: accountId,
      date: requireDate(args.date, 'date'),
      amount,
      description: String(args.description),
      type,
      comment: typeof args.comment === 'string' ? args.comment : null,
      card_id: null,
      category_id: typeof args.categoryId === 'number' ? args.categoryId : null,
      company_id: null,
      project_id: null,
      trip_id: null,
    });
    return { result: { created: true, accountId, date: args.date, amount, description: args.description, type } };
  },

  update_transaction: async (args, context) => {
    requireArgs(updateTransaction, args);
    const update = requireCapability(context.updateTransaction, 'update_transaction');
    const patch: TransactionUpdateInput = {};
    if (args.date !== undefined) patch.date = requireDate(args.date, 'date');
    if (args.amount !== undefined) patch.amount = Number(args.amount);
    if (args.description !== undefined) patch.description = String(args.description);
    if (args.comment !== undefined) patch.comment = args.comment === null ? null : String(args.comment);
    if (args.categoryId !== undefined) patch.category_id = args.categoryId === null ? null : Number(args.categoryId);
    if (args.type !== undefined) patch.type = args.type as TransactionType;
    if (Object.keys(patch).length === 0) {
      throw new Error('update_transaction needs at least one field to change');
    }
    const transactionId = Number(args.transactionId);
    await update(transactionId, patch);
    return { result: { updated: true, transactionId, changes: patch } };
  },

  delete_transaction: async (args, context) => {
    requireArgs(deleteTransaction, args);
    const remove = requireCapability(context.deleteTransaction, 'delete_transaction');
    const transactionId = Number(args.transactionId);
    await remove(transactionId);
    return { result: { deleted: true, transactionId } };
  },

  create_category: async (args, context) => {
    requireArgs(createCategory, args);
    const add = requireCapability(context.addCategory, 'create_category');
    const name = String(args.name).trim();
    if (!name) {
      throw new Error('name is required');
    }
    const existing = context.categories.find(
      (category) => category.name.toLowerCase() === name.toLowerCase() && category.type === args.type
    );
    if (existing) {
      return { result: { created: false, categoryId: existing.id, message: 'A category with this name already exists.' } };
    }
    const id = await add({
      name,
      type: args.type as Category['type'],
      color: typeof args.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(args.color) ? args.color : '#607d8b',
    });
    return { result: { created: true, categoryId: id, name, type: args.type } };
  },

  set_transaction_category: async (args, context) => {
    requireArgs(setTransactionCategory, args);
    const setCategory = requireCapability(context.setTransactionCategory, 'set_transaction_category');
    const categoryId = args.categoryId === null ? null : Number(args.categoryId);
    if (categoryId !== null && !context.categories.some((category) => category.id === categoryId)) {
      throw new Error(`Unknown categoryId ${categoryId}; call list_categories first`);
    }
    const transactionId = Number(args.transactionId);
    await setCategory(transactionId, categoryId);
    return { result: { updated: true, transactionId, categoryId } };
  },

  create_reminder: async (args, context) => {
    requireArgs(createReminder, args);
    const create = requireCapability(context.createNotification, 'create_reminder');
    const id = await create({
      kind: 'reminder',
      type: typeof args.reminderType === 'string' ? args.reminderType : 'custom',
      title: String(args.title),
      body: typeof args.body === 'string' ? args.body : null,
      due_date: requireDate(args.dueDate, 'dueDate'),
      recurrence: (args.recurrence as 'once' | 'monthly' | 'yearly' | undefined) ?? 'once',
      status: 'active',
      source: 'user',
    });
    return { result: { created: true, notificationId: id, title: args.title, dueDate: args.dueDate } };
  },
};

/** Every built-in tool, in display order. */
export const BUILTIN_TOOL_DEFINITIONS: AiToolDefinition[] = [
  ...AI_DATABASE_TOOLS.map((tool) => definition(tool, ORIGINAL_TOOL_SPECS[tool.function.name] ?? { crud: 'read', group: 'Other' })),
  listAccounts,
  listCategories,
  getBudgetStatus,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  createCategory,
  setTransactionCategory,
  createReminder,
];

export const BUILTIN_TOOL_EXECUTORS: Record<string, AiToolExecutor> = {
  ...AI_DATABASE_TOOL_EXECUTORS,
  ...NEW_TOOL_EXECUTORS,
};

export function getBuiltinToolExecutor(name: string): AiToolExecutor | undefined {
  return BUILTIN_TOOL_EXECUTORS[name];
}

/** Rows a pack read tool may return, mirroring query_transactions' cap. */
export const PACK_TOOL_MAX_ROWS = boundedLimit(200);

export type { AiDatabaseToolContext };
