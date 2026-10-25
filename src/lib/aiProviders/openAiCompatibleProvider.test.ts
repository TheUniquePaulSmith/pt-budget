import { describe, expect, it, vi } from 'vitest';
import type { ChatCompletionChunk, ChatCompletionParams } from '@wllama/wllama/esm';

import { buildOpenAiChatBody, createOpenAiCompatibleProvider, parseModelIds } from './openAiCompatibleProvider';
import { parseSseBlock, readSseEvents } from './sse';
import type { AiProviderProfile } from './types';

const profile: AiProviderProfile = {
  id: 'p1',
  kind: 'openai_compatible',
  label: 'Ollama',
  baseUrl: 'http://localhost:11434/v1/',
  apiKey: 'sk-test',
  model: 'llama3.1',
  isActive: true,
};

const params: ChatCompletionParams = {
  messages: [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
  ],
  tools: [{ type: 'function', function: { name: 'list_accounts', description: 'd', parameters: { type: 'object', properties: {} } } }],
  tool_choice: 'auto',
  temperature: 0.2,
  max_tokens: 100,
};

function sseResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function collect(iterable: AsyncIterable<ChatCompletionChunk>): Promise<ChatCompletionChunk[]> {
  const chunks: ChatCompletionChunk[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('buildOpenAiChatBody', () => {
  it('forwards messages, tools and sampling and asks for usage in streams', () => {
    const body = buildOpenAiChatBody(params, 'llama3.1', true);
    expect(body.model).toBe('llama3.1');
    expect(body.messages).toEqual(params.messages);
    expect(body.tools).toEqual(params.tools);
    expect(body.tool_choice).toBe('auto');
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(100);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it('omits tools when none are given', () => {
    const body = buildOpenAiChatBody({ messages: [] }, 'm', false);
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('stream_options');
  });
});

describe('createOpenAiCompatibleProvider', () => {
  it('posts to {baseUrl}/chat/completions with a bearer token and returns the JSON response', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      id: 'r1',
      object: 'chat.completion',
      created: 1,
      model: 'llama3.1',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop', logprobs: null }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const provider = createOpenAiCompatibleProvider(profile, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const response = await provider.createChatCompletion(params);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body as string).stream).toBe(false);
    expect(response.choices[0].message.content).toBe('hello');
  });

  it('surfaces HTTP failures with the server message', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 }));
    const provider = createOpenAiCompatibleProvider(profile, { fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(provider.createChatCompletion(params)).rejects.toThrow(/Authentication failed \(HTTP 401\): bad key/);
  });

  it('parses SSE chunks including split tool-call arguments and skips [DONE]', async () => {
    const fetchImpl = vi.fn(async () => sseResponse([
      'data: {"id":"c","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"Hel"},"finish_reason":null,"logprobs":null}]}\n\n',
      'data: {"id":"c","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"content":"lo"},"fini',
      'sh_reason":null,"logprobs":null}]}\n\n',
      'data: {"id":"c","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"list_accounts","arguments":"{\\"inclu"}}]},"finish_reason":null,"logprobs":null}]}\n\n',
      'data: {"id":"c","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"deInactive\\":true}"}}]},"finish_reason":"tool_calls","logprobs":null}]}\n\n',
      ': keep-alive\n\n',
      'data: {"id":"c","object":"chat.completion.chunk","created":1,"model":"m","choices":[],"usage":{"prompt_tokens":5,"completion_tokens":7,"total_tokens":12}}\n\n',
      'data: [DONE]\n\n',
    ]));
    const provider = createOpenAiCompatibleProvider(profile, { fetchImpl: fetchImpl as unknown as typeof fetch });

    const chunks = await collect(await provider.createChatCompletionStream(params));

    expect(JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).stream).toBe(true);
    expect(chunks).toHaveLength(5);
    expect(chunks[0].choices[0].delta.content).toBe('Hel');
    expect(chunks[1].choices[0].delta.content).toBe('lo');
    expect(chunks[2].choices[0].delta.tool_calls?.[0]).toMatchObject({ index: 0, id: 'call_1', function: { name: 'list_accounts', arguments: '{"inclu' } });
    expect(chunks[3].choices[0].delta.tool_calls?.[0].function?.arguments).toBe('deInactive":true}');
    expect(chunks[4].usage?.total_tokens).toBe(12);
  });

  it('falls back to a single chunk when the server ignores stream=true', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      id: 'r1',
      object: 'chat.completion',
      created: 1,
      model: 'm',
      choices: [{ index: 0, message: { role: 'assistant', content: 'plain', tool_calls: [{ id: 't', type: 'function', function: { name: 'x', arguments: '{}' } }] }, finish_reason: 'tool_calls', logprobs: null }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const provider = createOpenAiCompatibleProvider(profile, { fetchImpl: fetchImpl as unknown as typeof fetch });

    const chunks = await collect(await provider.createChatCompletionStream(params));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].choices[0].delta.content).toBe('plain');
    expect(chunks[0].choices[0].delta.tool_calls?.[0]).toMatchObject({ index: 0, id: 't', function: { name: 'x' } });
  });

  describe('testConnection', () => {
    it('reports Connected when /models lists the configured model', async () => {
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'llama3.1' }] }), { status: 200 }));
      const provider = createOpenAiCompatibleProvider(profile, { fetchImpl: fetchImpl as unknown as typeof fetch });

      const result = await provider.testConnection();
      expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('http://localhost:11434/v1/models');
      expect(result.ok).toBe(true);
      expect(result.message).toBe('Connected');
    });

    it('warns when the model is not listed', async () => {
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'other' }] }), { status: 200 }));
      const provider = createOpenAiCompatibleProvider(profile, { fetchImpl: fetchImpl as unknown as typeof fetch });

      const result = await provider.testConnection();
      expect(result.ok).toBe(true);
      expect(result.message).toContain('did not list model "llama3.1"');
    });

    it('explains a CORS / network failure for a local server', async () => {
      const fetchImpl = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
      const provider = createOpenAiCompatibleProvider(profile, { fetchImpl: fetchImpl as unknown as typeof fetch });

      const result = await provider.testConnection();
      expect(result.ok).toBe(false);
      expect(result.message).toBe('Connection failed');
      expect(result.hint).toMatch(/OLLAMA_ORIGINS/);
    });

    it('falls back to a tiny completion when /models is missing', async () => {
      const fetchImpl = vi.fn(async (url: string) => {
        if (url.endsWith('/models')) {
          return new Response('not found', { status: 404 });
        }
        return new Response(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop', logprobs: null }] }), { status: 200 });
      });
      const provider = createOpenAiCompatibleProvider(profile, { fetchImpl: fetchImpl as unknown as typeof fetch });

      const result = await provider.testConnection();
      expect(result.ok).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('returns the sorted, de-duplicated model ids for the drop-down', async () => {
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
        object: 'list',
        data: [{ id: 'qwen2.5' }, { id: 'llama3.1' }, { id: 'qwen2.5' }, { object: 'model' }],
      }), { status: 200 }));
      const provider = createOpenAiCompatibleProvider(profile, { fetchImpl: fetchImpl as unknown as typeof fetch });

      const result = await provider.testConnection();
      expect(result).toMatchObject({ ok: true, message: 'Connected', models: ['llama3.1', 'qwen2.5'] });
    });

    it('still returns the models when the configured one is not among them', async () => {
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'other' }] }), { status: 200 }));
      const provider = createOpenAiCompatibleProvider(profile, { fetchImpl: fetchImpl as unknown as typeof fetch });

      const result = await provider.testConnection();
      expect(result.ok).toBe(true);
      expect(result.models).toEqual(['other']);
    });

    it('connects without a configured model so the list can be discovered', async () => {
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'llama3.1' }] }), { status: 200 }));
      const provider = createOpenAiCompatibleProvider({ ...profile, model: '' }, { fetchImpl: fetchImpl as unknown as typeof fetch });

      const result = await provider.testConnection();
      expect(result).toMatchObject({ ok: true, message: 'Connected', models: ['llama3.1'] });
    });

    it('says so when the server is up but has no models', async () => {
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
      const provider = createOpenAiCompatibleProvider(profile, { fetchImpl: fetchImpl as unknown as typeof fetch });

      const result = await provider.testConnection();
      expect(result).toMatchObject({ ok: true, models: [] });
      expect(result.message).toContain('no models');
    });

    it('does not accept a 200 that is not a model list as an LLM server', async () => {
      const fetchImpl = vi.fn(async () => new Response('<html>hello</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
      const provider = createOpenAiCompatibleProvider({ ...profile, model: '' }, { fetchImpl: fetchImpl as unknown as typeof fetch });

      const result = await provider.testConnection();
      expect(result.ok).toBe(false);
      expect(result.message).toBe('The endpoint did not return a model list');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('vouches for a server whose /models is not a list by completing a one-token chat', async () => {
      const fetchImpl = vi.fn(async (url: string) => {
        if (url.endsWith('/models')) {
          return new Response('{}', { status: 200 });
        }
        return new Response(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop', logprobs: null }] }), { status: 200 });
      });
      const provider = createOpenAiCompatibleProvider(profile, { fetchImpl: fetchImpl as unknown as typeof fetch });

      const result = await provider.testConnection();
      expect(result.ok).toBe(true);
      expect(result.models).toBeUndefined();
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('reports an authentication failure instead of a model list', async () => {
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 }));
      const provider = createOpenAiCompatibleProvider(profile, { fetchImpl: fetchImpl as unknown as typeof fetch });

      const result = await provider.testConnection();
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/Authentication failed \(HTTP 401\): bad key/);
      expect(result.models).toBeUndefined();
    });
  });

  describe('client certificate (mTLS)', () => {
    it('sends credentials: include on every request when the profile asks for a client certificate', async () => {
      const fetchImpl = vi.fn(async (url: string) => {
        if (url.endsWith('/models')) {
          return new Response(JSON.stringify({ data: [{ id: 'llama3.1' }] }), { status: 200 });
        }
        return new Response(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop', logprobs: null }] }), { status: 200 });
      });
      const provider = createOpenAiCompatibleProvider(
        { ...profile, kind: 'local_endpoint', useClientCertificate: true },
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      );

      await provider.testConnection();
      await provider.createChatCompletion(params);

      const inits = fetchImpl.mock.calls.map((call) => (call as unknown as [string, RequestInit])[1]);
      expect(inits).toHaveLength(2);
      expect(inits.every((init) => init.credentials === 'include')).toBe(true);
    });

    it('leaves the credentials mode alone by default', async () => {
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
      const provider = createOpenAiCompatibleProvider(profile, { fetchImpl: fetchImpl as unknown as typeof fetch });

      await provider.testConnection();
      expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1]).not.toHaveProperty('credentials');
    });

    it('explains the credentialed CORS and certificate-store requirements when the connection fails', async () => {
      const fetchImpl = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
      const provider = createOpenAiCompatibleProvider(
        { ...profile, kind: 'local_endpoint', useClientCertificate: true },
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      );

      const result = await provider.testConnection();
      expect(result.ok).toBe(false);
      expect(result.hint).toMatch(/Access-Control-Allow-Credentials: true/);
      expect(result.hint).toMatch(/certificate store/);
    });
  });
});

describe('parseModelIds', () => {
  it('reads OpenAI-style lists and bare arrays, and rejects anything else', () => {
    expect(parseModelIds({ data: [{ id: 'b' }, { id: 'a' }] })).toEqual(['a', 'b']);
    expect(parseModelIds(['b', 'a'])).toEqual(['a', 'b']);
    expect(parseModelIds({ data: [] })).toEqual([]);
    expect(parseModelIds({})).toBeNull();
    expect(parseModelIds(null)).toBeNull();
    expect(parseModelIds('text')).toBeNull();
  });
});

describe('SSE parser', () => {
  it('joins multi-line data fields and ignores comments', () => {
    expect(parseSseBlock('event: ping\n: comment\ndata: a\ndata: b')).toEqual({ event: 'ping', data: 'a\nb' });
    expect(parseSseBlock(': only a comment')).toBeNull();
  });

  it('handles CRLF separators and trailing blocks without a final blank line', async () => {
    const response = sseResponse(['data: 1\r\n\r\ndata: 2\r\n\r\n', 'data: 3']);
    const events: string[] = [];
    for await (const event of readSseEvents(response.body)) {
      events.push(event.data);
    }
    expect(events).toEqual(['1', '2', '3']);
  });
});
