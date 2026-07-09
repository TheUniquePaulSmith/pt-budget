import { describe, expect, it, vi } from 'vitest';
import type { ChatCompletionToolCall } from '@wllama/wllama/esm';

import { executeAiDatabaseToolCall, type AiDatabaseToolContext } from './aiDatabaseTools';

function createToolCall(name: string, args: unknown): ChatCompletionToolCall {
  return {
    id: `call-${name}`,
    type: 'function',
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

function createContext(overrides: Partial<AiDatabaseToolContext> = {}): AiDatabaseToolContext {
  return {
    executeCustomQuery: vi.fn().mockResolvedValue([{ id: 1 }]),
    applyTransactionClassifications: vi.fn().mockResolvedValue({ appliedCount: 1, transactionIds: [1] }),
    categories: [],
    companies: [],
    projects: [],
    trips: [],
    writeMode: 'review',
    ...overrides,
  };
}

describe('executeAiDatabaseToolCall', () => {
  it('runs bounded SELECT queries through the safe query function', async () => {
    const context = createContext();

    const result = await executeAiDatabaseToolCall(
      createToolCall('query_transactions', {
        sql: 'SELECT id FROM transactions ORDER BY id DESC',
        maxRows: 5,
      }),
      context
    );

    expect(result.toolCall.status).toBe('completed');
    expect(context.executeCustomQuery).toHaveBeenCalledWith(
      'SELECT * FROM (SELECT id FROM transactions ORDER BY id DESC) LIMIT 5',
      10000
    );
  });

  it('rejects mutation SQL before it reaches the database', async () => {
    const context = createContext();

    const result = await executeAiDatabaseToolCall(
      createToolCall('query_transactions', { sql: 'UPDATE transactions SET category_id = 1' }),
      context
    );

    expect(result.toolCall.status).toBe('failed');
    expect(context.executeCustomQuery).not.toHaveBeenCalled();
  });

  it('stages classification writes in review mode', async () => {
    const context = createContext({ writeMode: 'review' });

    const result = await executeAiDatabaseToolCall(
      createToolCall('apply_transaction_classifications', {
        classifications: [
          { transactionId: 1, categoryName: 'Groceries', categoryType: 'expense' },
        ],
      }),
      context
    );

    expect(result.toolCall.status).toBe('completed');
    expect(result.classificationSuggestions).toHaveLength(1);
    expect(context.applyTransactionClassifications).not.toHaveBeenCalled();
  });

  it('applies classification writes in auto-apply mode', async () => {
    const context = createContext({ writeMode: 'autoApply' });

    const result = await executeAiDatabaseToolCall(
      createToolCall('apply_transaction_classifications', {
        classifications: [
          { transactionId: 1, categoryName: 'Groceries', categoryType: 'expense' },
        ],
      }),
      context
    );

    expect(result.toolCall.status).toBe('completed');
    expect(context.applyTransactionClassifications).toHaveBeenCalledWith([
      { transactionId: 1, categoryName: 'Groceries', categoryType: 'expense' },
    ]);
  });
});