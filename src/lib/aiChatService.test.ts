import { describe, expect, it, vi } from 'vitest';
import type { ChatCompletionParams, ChatCompletionResponse } from '@wllama/wllama/esm';

import { runAiChatCompletion } from './aiChatService';
import type { AiDatabaseToolContext } from './aiDatabaseTools';

function createDatabaseToolContext(overrides: Partial<AiDatabaseToolContext> = {}): AiDatabaseToolContext {
  return {
    executeCustomQuery: vi.fn(async (sql: string) => {
      if (sql.includes('pragma_table_info')) {
        return [
          {
            table_name: 'transactions',
            column_position: 0,
            column_name: 'id',
            data_type: 'INTEGER',
            not_null: 0,
            primary_key: 1,
          },
          {
            table_name: 'transactions',
            column_position: 1,
            column_name: 'account_id',
            data_type: 'INTEGER',
            not_null: 1,
            primary_key: 0,
          },
        ];
      }

      if (sql.includes('pragma_foreign_key_list')) {
        return [
          {
            table_name: 'transactions',
            from_column: 'account_id',
            referenced_table: 'accounts',
            referenced_column: 'id',
          },
        ];
      }

      return [];
    }),
    applyTransactionClassifications: vi.fn(),
    categories: [],
    companies: [],
    projects: [],
    trips: [],
    writeMode: 'review',
    ...overrides,
  };
}

function createChatResponse(content: string): ChatCompletionResponse {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 0,
    model: 'local-test-model',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content,
        },
      },
    ],
  } as ChatCompletionResponse;
}

describe('runAiChatCompletion', () => {
  it('includes the live database schema in the system prompt', async () => {
    const databaseToolContext = createDatabaseToolContext();
    const createChatCompletion = vi.fn(async (_params: ChatCompletionParams) => createChatResponse('Done'));

    await runAiChatCompletion({
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: 'How should I query transactions?',
          createdAt: '2026-07-13T00:00:00.000Z',
        },
      ],
      createChatCompletion,
      databaseToolContext,
    });

    expect(databaseToolContext.executeCustomQuery).toHaveBeenCalledTimes(2);
    const systemMessage = createChatCompletion.mock.calls[0][0].messages[0];
    expect(systemMessage.role).toBe('system');
    expect(systemMessage.content).toContain('Current SQLite database schema');
    expect(systemMessage.content).toContain('transactions: id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL');
    expect(systemMessage.content).toContain('Foreign keys: account_id -> accounts.id');
  });

  it('keeps the chat usable when schema introspection fails', async () => {
    const databaseToolContext = createDatabaseToolContext({
      executeCustomQuery: vi.fn().mockRejectedValue(new Error('database unavailable')),
    });
    const createChatCompletion = vi.fn(async (_params: ChatCompletionParams) => createChatResponse('Still works'));

    const result = await runAiChatCompletion({
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: 'Hello',
          createdAt: '2026-07-13T00:00:00.000Z',
        },
      ],
      createChatCompletion,
      databaseToolContext,
    });

    const systemMessage = createChatCompletion.mock.calls[0][0].messages[0];
    expect(result.assistantMessage).toBe('Still works');
    expect(systemMessage.content).toContain('schema could not be loaded');
    expect(systemMessage.content).toContain('database unavailable');
  });
});