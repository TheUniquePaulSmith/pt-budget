import { describe, expect, it, vi } from 'vitest';
import type { ChatCompletionChunk, ChatCompletionParams } from '@wllama/wllama/esm';

import {
  ANTHROPIC_DEFAULT_MODEL,
  anthropicEventsToChunks,
  buildAnthropicRequestBody,
  createAnthropicProvider,
  toAnthropicMessages,
  toChatCompletionResponse,
} from './anthropicProvider';
import type { AiProviderProfile } from './types';

const profile: AiProviderProfile = {
  id: 'a1',
  kind: 'anthropic',
  label: 'Claude',
  apiKey: 'sk-ant-test',
  model: '',
  isActive: true,
};

const params: ChatCompletionParams = {
  messages: [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'List my accounts' },
    {
      role: 'assistant',
      content: 'Sure.',
      tool_calls: [{ id: 'toolu_1', type: 'function', function: { name: 'list_accounts', arguments: '{"includeInactive":false}' } }],
    },
    { role: 'tool', tool_call_id: 'toolu_1', content: '{"accounts":[]}' },
    { role: 'tool', tool_call_id: 'toolu_2', content: '{"error":"boom"}' },
  ],
  tools: [{ type: 'function', function: { name: 'list_accounts', description: 'List accounts', parameters: { type: 'object', properties: { includeInactive: { type: 'boolean' } } } } }],
  temperature: 0.2,
  max_tokens: 512,
};

async function* events(items: Array<Record<string, unknown>>) {
  for (const item of items) {
    yield { event: item.type as string, data: JSON.stringify(item) };
  }
}

async function collect(iterable: AsyncIterable<ChatCompletionChunk>): Promise<ChatCompletionChunk[]> {
  const chunks: ChatCompletionChunk[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('toAnthropicMessages', () => {
  it('lifts system prompts, maps tool calls to tool_use and merges tool results into one user turn', () => {
    const { system, messages } = toAnthropicMessages(params.messages);

    expect(system).toBe('You are helpful.');
    expect(messages).toEqual([
      { role: 'user', content: 'List my accounts' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Sure.' },
          { type: 'tool_use', id: 'toolu_1', name: 'list_accounts', input: { includeInactive: false } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"accounts":[]}' },
          { type: 'tool_result', tool_use_id: 'toolu_2', content: '{"error":"boom"}', is_error: true },
        ],
      },
    ]);
  });

  it('ensures the conversation starts with a user turn', () => {
    const { messages } = toAnthropicMessages([{ role: 'assistant', content: 'hi' }]);
    expect(messages[0].role).toBe('user');
  });
});

describe('buildAnthropicRequestBody', () => {
  it('maps tools to input_schema and never forwards temperature or tool_choice', () => {
    const body = buildAnthropicRequestBody(params, ANTHROPIC_DEFAULT_MODEL, true);

    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.max_tokens).toBe(512);
    expect(body.stream).toBe(true);
    expect(body.tools).toEqual([
      { name: 'list_accounts', description: 'List accounts', input_schema: { type: 'object', properties: { includeInactive: { type: 'boolean' } } } },
    ]);
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('tool_choice');
  });
});

describe('toChatCompletionResponse', () => {
  it('maps text and tool_use blocks to an OpenAI-shaped response', () => {
    const response = toChatCompletionResponse({
      id: 'msg_1',
      model: 'claude-sonnet-5-5',
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'Looking that up.' },
        { type: 'tool_use', id: 'toolu_9', name: 'list_accounts', input: { includeInactive: true } },
      ],
      usage: { input_tokens: 10, output_tokens: 4 },
    });

    expect(response.choices[0].finish_reason).toBe('tool_calls');
    expect(response.choices[0].message.content).toBe('Looking that up.');
    expect(response.choices[0].message.tool_calls).toEqual([
      { id: 'toolu_9', type: 'function', function: { name: 'list_accounts', arguments: '{"includeInactive":true}' } },
    ]);
    expect(response.usage).toEqual({ prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 });
  });
});

describe('anthropicEventsToChunks', () => {
  it('turns the SSE event stream into text and tool-call deltas with usage', async () => {
    const chunks = await collect(anthropicEventsToChunks(events([
      { type: 'message_start', message: { id: 'msg_1', model: 'claude-sonnet-5-5', usage: { input_tokens: 12, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'list_accounts' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"inclu' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'deInactive":true}' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } },
      { type: 'message_stop' },
    ]), 'claude-sonnet-5-5'));

    expect(chunks[0].choices[0].delta.role).toBe('assistant');
    expect(chunks[1].choices[0].delta.content).toBe('Hello');
    expect(chunks[2].choices[0].delta.tool_calls?.[0]).toMatchObject({ index: 0, id: 'toolu_1', function: { name: 'list_accounts', arguments: '' } });
    expect(chunks[3].choices[0].delta.tool_calls?.[0].function?.arguments).toBe('{"inclu');
    expect(chunks[4].choices[0].delta.tool_calls?.[0].function?.arguments).toBe('deInactive":true}');
    const last = chunks[chunks.length - 1];
    expect(last.choices[0].finish_reason).toBe('tool_calls');
    expect(last.usage).toEqual({ prompt_tokens: 12, completion_tokens: 20, total_tokens: 32 });
  });

  it('throws on an error event', async () => {
    await expect(collect(anthropicEventsToChunks(events([
      { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
    ]), 'm'))).rejects.toThrow('Overloaded');
  });
});

describe('createAnthropicProvider', () => {
  it('posts to /v1/messages with the browser-access headers and the default model', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      id: 'msg_1',
      model: 'claude-sonnet-5-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Done' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }), { status: 200 }));

    const provider = createAnthropicProvider(profile, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const response = await provider.createChatCompletion({ messages: [{ role: 'user', content: 'hi' }], max_tokens: 64 });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(JSON.parse(init.body as string).model).toBe('claude-sonnet-5-5');
    expect(response.choices[0].message.content).toBe('Done');
  });

  it('testConnection checks the configured model and explains network failures', async () => {
    const okFetch = vi.fn(async () => new Response(JSON.stringify({ id: 'claude-sonnet-5-5' }), { status: 200 }));
    const okProvider = createAnthropicProvider(profile, { fetchImpl: okFetch as unknown as typeof fetch });
    const okResult = await okProvider.testConnection();
    expect((okFetch.mock.calls[0] as unknown as [string])[0]).toBe('https://api.anthropic.com/v1/models/claude-sonnet-5-5');
    expect(okResult.ok).toBe(true);

    const failingFetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const failingProvider = createAnthropicProvider(profile, { fetchImpl: failingFetch as unknown as typeof fetch });
    const failed = await failingProvider.testConnection();
    expect(failed.ok).toBe(false);
    expect(failed.hint).toMatch(/CORS/);
  });
});
