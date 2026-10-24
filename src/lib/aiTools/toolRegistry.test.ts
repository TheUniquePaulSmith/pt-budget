import { describe, expect, it, vi } from 'vitest';
import type { ChatCompletionToolCall } from '@wllama/wllama/esm';

import type { AiDatabaseToolContext } from '@/lib/aiDatabaseTools';
import type { AiToolPack } from '@/types/database';
import { BUILTIN_TOOL_DEFINITIONS } from './builtinTools';
import { executeRegistryToolCall } from './executeTool';
import { composeToolRegistry, createDefaultToolRegistry } from './toolRegistry';

const packDocument = {
  id: 'notes',
  name: 'Notes',
  version: '1.0.0',
  tools: [
    {
      name: 'set_note',
      description: 'Set a note',
      inputSchema: { type: 'object', properties: { transactionId: { type: 'integer' }, note: { type: 'string' } }, required: ['transactionId', 'note'] },
      crud: 'update',
      sql: 'UPDATE transactions SET comment = :note WHERE id = :transactionId',
      resultMode: 'changes',
    },
    {
      name: 'recent_notes',
      description: 'Recent notes',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer' } } },
      crud: 'read',
      sql: 'SELECT id, comment FROM transactions WHERE comment IS NOT NULL ORDER BY id DESC LIMIT COALESCE(:limit, 5)',
      resultMode: 'rows',
    },
  ],
};

function packRow(overrides: Partial<AiToolPack> = {}): AiToolPack {
  return {
    id: 1,
    pack_key: 'user:notes',
    name: 'Notes',
    version: '1.0.0',
    source: 'user',
    enabled: 1,
    definition_json: JSON.stringify(packDocument),
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function createContext(overrides: Partial<AiDatabaseToolContext> = {}): AiDatabaseToolContext {
  return {
    executeCustomQuery: vi.fn().mockResolvedValue([]),
    applyTransactionClassifications: vi.fn(),
    categories: [{ id: 3, name: 'Groceries', type: 'expense', color: '#000', created_at: '', updated_at: '' }],
    companies: [],
    projects: [],
    trips: [],
    writeMode: 'review',
    ...overrides,
  };
}

function call(name: string, args: unknown): ChatCompletionToolCall {
  return { id: `call-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

describe('composeToolRegistry', () => {
  it('starts from built-ins with safe defaults', () => {
    const registry = createDefaultToolRegistry();
    const names = registry.tools.map((tool) => tool.name);

    expect(names).toEqual(expect.arrayContaining([
      'query_transactions', 'find_recurring_subscriptions', 'suggest_transaction_classifications',
      'get_unmatched_merchant_clusters', 'propose_merchant_rules', 'apply_transaction_classifications',
      'list_accounts', 'list_categories', 'get_budget_status', 'create_transaction', 'update_transaction',
      'delete_transaction', 'create_category', 'set_transaction_category', 'create_reminder',
    ]));
    expect(registry.getTool('list_accounts')).toMatchObject({ crud: 'read', consent: 'always', enabled: true });
    expect(registry.getTool('create_transaction')).toMatchObject({ crud: 'create', consent: 'ask', enabled: true });
    expect(registry.getTool('delete_transaction')).toMatchObject({ crud: 'delete', consent: 'ask', enabled: false });
    expect(registry.toChatTools().map((tool) => tool.function.name)).not.toContain('delete_transaction');
    expect(BUILTIN_TOOL_DEFINITIONS.every((tool) => tool.source === 'builtin')).toBe(true);
  });

  it('applies stored settings over defaults', () => {
    const registry = composeToolRegistry({
      settings: [
        { tool_name: 'delete_transaction', pack_key: null, enabled: 1, consent: 'ask' },
        { tool_name: 'list_accounts', pack_key: null, enabled: 0, consent: 'always' },
        { tool_name: 'create_transaction', pack_key: null, enabled: 1, consent: 'deny' },
      ],
    });

    expect(registry.getTool('delete_transaction')).toMatchObject({ enabled: true, hasUserSetting: true });
    expect(registry.getTool('list_accounts')?.enabled).toBe(false);
    expect(registry.getTool('create_transaction')?.consent).toBe('deny');
    const chatNames = registry.toChatTools().map((tool) => tool.function.name);
    expect(chatNames).toContain('delete_transaction');
    expect(chatNames).not.toContain('list_accounts');
  });

  it('adds pack tools, honours the pack enabled flag and reports collisions', () => {
    const registry = composeToolRegistry({ packRows: [packRow()] });
    expect(registry.getTool('set_note')).toMatchObject({ source: 'pack', packKey: 'user:notes', crud: 'update', consent: 'ask', group: 'Notes' });
    expect(registry.getPackTool('recent_notes')?.tool.resultMode).toBe('rows');
    expect(registry.toChatTools().map((tool) => tool.function.name)).toEqual(expect.arrayContaining(['set_note', 'recent_notes']));

    const disabled = composeToolRegistry({ packRows: [packRow({ enabled: 0 })] });
    expect(disabled.getTool('set_note')?.enabled).toBe(false);

    const colliding = composeToolRegistry({
      packRows: [packRow({
        pack_key: 'user:clash',
        definition_json: JSON.stringify({
          ...packDocument,
          id: 'clash',
          tools: [{ ...packDocument.tools[1], name: 'list_accounts' }],
        }),
      })],
    });
    expect(colliding.getTool('list_accounts')?.source).toBe('builtin');
    expect(colliding.failedPacks[0]).toMatchObject({ packKey: 'user:clash' });
  });

  it('keeps invalid pack rows out of the registry but lists them', () => {
    const registry = composeToolRegistry({ packRows: [packRow({ pack_key: 'user:bad', definition_json: '{"id":"bad"}' })] });
    expect(registry.failedPacks.map((pack) => pack.packKey)).toEqual(['user:bad']);
    expect(registry.packs).toHaveLength(0);
  });
});

describe('executeRegistryToolCall', () => {
  it('runs built-in tools through their executors', async () => {
    const registry = createDefaultToolRegistry();
    const context = createContext();

    const result = await executeRegistryToolCall(call('list_categories', { type: 'expense' }), registry, context);
    expect(result.toolCall.status).toBe('completed');
    expect(result.toolCall.result).toEqual({ categories: [{ id: 3, name: 'Groceries', type: 'expense' }], returnedRows: 1 });
  });

  it('reports a missing capability instead of throwing', async () => {
    const registry = createDefaultToolRegistry();
    const result = await executeRegistryToolCall(call('create_category', { name: 'Fuel', type: 'expense' }), registry, createContext());
    expect(result.toolCall.status).toBe('failed');
    expect(result.toolCall.error).toMatch(/create_category is not available/);
  });

  it('validates built-in arguments against the schema', async () => {
    const registry = createDefaultToolRegistry();
    const addCategory = vi.fn().mockResolvedValue(9);
    const result = await executeRegistryToolCall(call('create_category', { name: 'Fuel', type: 'nonsense' }), registry, createContext({ addCategory }));
    expect(result.toolCall.status).toBe('failed');
    expect(result.toolCall.error).toMatch(/type must be one of income, expense/);
    expect(addCategory).not.toHaveBeenCalled();
  });

  it('binds and runs pack SQL through executeToolPackSql', async () => {
    const registry = composeToolRegistry({ packRows: [packRow()] });
    const executeToolPackSql = vi.fn(async (sql: string, _params: unknown[], mode: string) => (mode === 'rows' ? [{ id: 1, comment: 'x' }] : { changes: 1 }));
    const context = createContext({ executeToolPackSql });

    const update = await executeRegistryToolCall(call('set_note', { transactionId: 4, note: "x'); DROP TABLE transactions; --" }), registry, context);
    expect(update.toolCall.status).toBe('completed');
    expect(executeToolPackSql).toHaveBeenCalledWith(
      'UPDATE transactions SET comment = ? WHERE id = ?',
      ["x'); DROP TABLE transactions; --", 4],
      'changes'
    );
    expect(update.toolCall.result).toEqual({ changes: 1 });

    const read = await executeRegistryToolCall(call('recent_notes', {}), registry, context);
    expect(read.toolCall.status).toBe('completed');
    const [sql, params, mode] = executeToolPackSql.mock.calls[1];
    expect(sql).toMatch(/^SELECT \* FROM \(SELECT id, comment FROM transactions .* LIMIT COALESCE\(\?, 5\)\) LIMIT \d+$/);
    expect(params).toEqual([null]);
    expect(mode).toBe('rows');
    expect(read.toolCall.result).toEqual({ rows: [{ id: 1, comment: 'x' }], returnedRows: 1, maxRows: 200 });
  });

  it('rejects pack arguments that fail validation before touching the database', async () => {
    const registry = composeToolRegistry({ packRows: [packRow()] });
    const executeToolPackSql = vi.fn();
    const result = await executeRegistryToolCall(call('set_note', { transactionId: 'four', note: 'x' }), registry, createContext({ executeToolPackSql }));
    expect(result.toolCall.status).toBe('failed');
    expect(executeToolPackSql).not.toHaveBeenCalled();
  });

  it('fails unknown tools', async () => {
    const result = await executeRegistryToolCall(call('nope', {}), createDefaultToolRegistry(), createContext());
    expect(result.toolCall.status).toBe('failed');
    expect(result.toolCall.error).toMatch(/Unknown AI tool: nope/);
  });
});
