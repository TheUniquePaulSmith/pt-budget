import { describe, expect, it, vi } from 'vitest';
import type { ChatCompletionParams, ChatCompletionResponse } from '@wllama/wllama/esm';

import { runAiChatCompletion } from './aiChatService';
import type { AiDatabaseToolContext } from './aiDatabaseTools';
import { DEFAULT_TOOL_CALL_LIMIT } from './aiTools/toolCallLimit';

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
describe('runAiChatCompletion tool consent', () => {
  function createToolCallResponse(name: string, args: Record<string, unknown>): ChatCompletionResponse {
    return {
      id: 'chatcmpl-tool',
      object: 'chat.completion',
      created: 0,
      model: 'local-test-model',
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'call-1', type: 'function', function: { name, arguments: JSON.stringify(args) } }],
          },
        },
      ],
    } as ChatCompletionResponse;
  }

  const userMessages = [{ id: 'user-1', role: 'user' as const, content: 'Add a Fuel category', createdAt: '2026-07-13T00:00:00.000Z' }];

  it('only offers enabled registry tools to the model', async () => {
    const createChatCompletion = vi.fn(async (_params: ChatCompletionParams) => createChatResponse('ok'));
    await runAiChatCompletion({ messages: userMessages, createChatCompletion, databaseToolContext: createDatabaseToolContext() });

    const offered = (createChatCompletion.mock.calls[0][0].tools ?? []).map((tool) => tool.function.name);
    expect(offered).toContain('create_category');
    expect(offered).not.toContain('delete_transaction');
  });

  it('pauses for consent and returns a denial to the model when the user denies', async () => {
    const createChatCompletion = vi.fn(async (params: ChatCompletionParams) => (
      params.messages.some((message) => message.role === 'tool')
        ? createChatResponse('Understood, I will not create it.')
        : createToolCallResponse('create_category', { name: 'Fuel', type: 'expense' })
    ));
    const addCategory = vi.fn().mockResolvedValue(1);
    const requestConsent = vi.fn(async () => 'deny' as const);
    const updates: string[] = [];

    const result = await runAiChatCompletion({
      messages: userMessages,
      createChatCompletion,
      databaseToolContext: createDatabaseToolContext({ addCategory }),
      requestConsent,
      onToolCallUpdate: (record) => updates.push(record.status),
    });

    expect(requestConsent).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'create_category', crud: 'create', toolCallId: 'call-1' }));
    expect(addCategory).not.toHaveBeenCalled();
    expect(updates).toEqual(['awaiting-consent', 'denied']);
    expect(result.toolCalls[0]).toMatchObject({ name: 'create_category', status: 'denied' });
    const toolMessage = createChatCompletion.mock.calls[1][0].messages.find((message) => message.role === 'tool');
    expect(toolMessage && 'content' in toolMessage ? toolMessage.content : '').toMatch(/denied/);
    expect(result.assistantMessage).toBe('Understood, I will not create it.');
  });

  it('runs the tool after the user allows it', async () => {
    const createChatCompletion = vi.fn(async (params: ChatCompletionParams) => (
      params.messages.some((message) => message.role === 'tool')
        ? createChatResponse('Created.')
        : createToolCallResponse('create_category', { name: 'Fuel', type: 'expense' })
    ));
    const addCategory = vi.fn().mockResolvedValue(7);

    const result = await runAiChatCompletion({
      messages: userMessages,
      createChatCompletion,
      databaseToolContext: createDatabaseToolContext({ addCategory }),
      requestConsent: async () => 'allow_once',
    });

    expect(addCategory).toHaveBeenCalledWith({ name: 'Fuel', type: 'expense', color: '#607d8b' });
    expect(result.toolCalls[0]).toMatchObject({ status: 'completed', result: { created: true, categoryId: 7 } });
  });

  it('denies ask-policy tools when no consent handler is available and skips consent for always-allowed reads', async () => {
    const requestConsent = vi.fn();
    const createChatCompletion = vi.fn(async (params: ChatCompletionParams) => (
      params.messages.some((message) => message.role === 'tool')
        ? createChatResponse('done')
        : createToolCallResponse('list_categories', {})
    ));

    const read = await runAiChatCompletion({
      messages: userMessages,
      createChatCompletion,
      databaseToolContext: createDatabaseToolContext(),
      requestConsent,
    });
    expect(requestConsent).not.toHaveBeenCalled();
    expect(read.toolCalls[0].status).toBe('completed');

    const writeCompletion = vi.fn(async (params: ChatCompletionParams) => (
      params.messages.some((message) => message.role === 'tool')
        ? createChatResponse('done')
        : createToolCallResponse('create_category', { name: 'X', type: 'expense' })
    ));
    const write = await runAiChatCompletion({
      messages: userMessages,
      createChatCompletion: writeCompletion,
      databaseToolContext: createDatabaseToolContext({ addCategory: vi.fn() }),
    });
    expect(write.toolCalls[0].status).toBe('denied');
  });

  it('refuses disabled and unknown tools', async () => {
    const createChatCompletion = vi.fn(async (params: ChatCompletionParams) => (
      params.messages.some((message) => message.role === 'tool')
        ? createChatResponse('ok')
        : createToolCallResponse('delete_transaction', { transactionId: 1 })
    ));
    const deleteTransaction = vi.fn();
    const result = await runAiChatCompletion({
      messages: userMessages,
      createChatCompletion,
      databaseToolContext: createDatabaseToolContext({ deleteTransaction }),
      requestConsent: async () => 'allow_once',
    });
    expect(deleteTransaction).not.toHaveBeenCalled();
    expect(result.toolCalls[0]).toMatchObject({ status: 'denied' });
    expect(result.toolCalls[0].error).toMatch(/disabled/);
  });
});

describe('runAiChatCompletion tool-call limit', () => {
  const userMessages = [{ id: 'user-1', role: 'user' as const, content: 'Why is net income negative?', createdAt: '2026-07-13T00:00:00.000Z' }];

  let callCounter = 0;
  function createListCategoriesResponse(): ChatCompletionResponse {
    callCounter += 1;
    return {
      id: 'chatcmpl-tool',
      object: 'chat.completion',
      created: 0,
      model: 'local-test-model',
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: `call-${callCounter}`, type: 'function', function: { name: 'list_categories', arguments: '{}' } }],
          },
        },
      ],
    } as ChatCompletionResponse;
  }

  it('runs the allowed rounds, then gives the model a tool-free turn to answer', async () => {
    const createChatCompletion = vi.fn(async (params: ChatCompletionParams) => (
      params.tool_choice === 'none' ? createChatResponse('Net income is negative because of transfers.') : createListCategoriesResponse()
    ));

    const result = await runAiChatCompletion({
      messages: userMessages,
      createChatCompletion,
      databaseToolContext: createDatabaseToolContext(),
      maxToolRounds: 2,
    });

    expect(result.toolCalls).toHaveLength(2);
    expect(createChatCompletion).toHaveBeenCalledTimes(3);
    expect(createChatCompletion.mock.calls.map(([params]) => params.tool_choice)).toEqual(['auto', 'auto', 'none']);
    const finalMessages = createChatCompletion.mock.calls[2][0].messages;
    const nudge = finalMessages[finalMessages.length - 1];
    expect(nudge).toMatchObject({ role: 'user' });
    expect('content' in nudge ? nudge.content : '').toMatch(/all 2 allowed rounds.*Do not call any more tools/);
    expect(result.assistantMessage).toBe('Net income is negative because of transfers.');
  });

  it('falls back to the limit message when the model still asks for tools after the limit', async () => {
    const createChatCompletion = vi.fn(async (_params: ChatCompletionParams) => createListCategoriesResponse());
    const deltas: string[] = [];

    const result = await runAiChatCompletion({
      messages: userMessages,
      createChatCompletion,
      databaseToolContext: createDatabaseToolContext(),
      maxToolRounds: 1,
      onAssistantDelta: (delta) => deltas.push(delta),
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(createChatCompletion).toHaveBeenCalledTimes(2);
    expect(result.assistantMessage).toMatch(/tool-call limit.*Tools tab/);
    expect(deltas.join('')).toBe(result.assistantMessage);
  });

  it('uses the default limit when none is passed', async () => {
    const createChatCompletion = vi.fn(async (_params: ChatCompletionParams) => createListCategoriesResponse());

    const result = await runAiChatCompletion({
      messages: userMessages,
      createChatCompletion,
      databaseToolContext: createDatabaseToolContext(),
    });

    expect(result.toolCalls).toHaveLength(DEFAULT_TOOL_CALL_LIMIT);
    expect(createChatCompletion).toHaveBeenCalledTimes(DEFAULT_TOOL_CALL_LIMIT + 1);
  });
});
