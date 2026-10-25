import type {
  ChatCompletionChunk,
  ChatCompletionParams,
  ChatCompletionResponse,
} from '@wllama/wllama/esm';

import { logger } from '@/lib/logging';
import {
  AiProviderRequestError,
  describeHttpFailure,
  fetchOrThrow,
  readErrorBody,
  toTestResult,
} from './providerErrors';
import { readSseEvents } from './sse';
import type { AiProvider, AiProviderProfile, AiProviderTestResult, FetchLike } from './types';

const log = logger.child({ component: 'OpenAiCompatibleProvider' });

export interface OpenAiCompatibleProviderOptions {
  fetchImpl?: FetchLike;
}

export function normalizeBaseUrl(baseUrl: string | undefined, fallback: string): string {
  const value = (baseUrl ?? '').trim() || fallback;
  return value.replace(/\/+$/, '');
}

/** Builds the JSON body for `POST {baseUrl}/chat/completions`. */
export function buildOpenAiChatBody(
  params: ChatCompletionParams,
  model: string,
  stream: boolean
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: params.messages,
    stream,
  };

  if (params.tools && params.tools.length > 0) {
    body.tools = params.tools;
    body.tool_choice = params.tool_choice ?? 'auto';
  }
  if (typeof params.temperature === 'number') {
    body.temperature = params.temperature;
  }
  if (typeof params.max_tokens === 'number') {
    body.max_tokens = params.max_tokens;
  }
  if (stream) {
    body.stream_options = { include_usage: true };
  }

  return body;
}

function buildHeaders(apiKey: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey && apiKey.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }
  return headers;
}

async function* parseOpenAiStream(
  response: Response,
  abortSignal?: AbortSignal
): AsyncGenerator<ChatCompletionChunk> {
  for await (const event of readSseEvents(response.body, abortSignal)) {
    const data = event.data.trim();
    if (!data || data === '[DONE]') {
      continue;
    }

    let chunk: ChatCompletionChunk;
    try {
      chunk = JSON.parse(data) as ChatCompletionChunk;
    } catch {
      log.warn('Skipping malformed SSE chunk', { operation: 'stream' });
      continue;
    }

    if (!chunk || typeof chunk !== 'object') {
      continue;
    }
    if (!Array.isArray(chunk.choices)) {
      chunk.choices = [];
    }
    yield chunk;
  }
}

/**
 * Provider for any OpenAI-shaped `/chat/completions` endpoint: OpenAI itself,
 * and local Ollama / LM Studio / vLLM servers. Requests go straight from the
 * browser, so the server must allow this origin (CORS).
 */
export function createOpenAiCompatibleProvider(
  profile: AiProviderProfile,
  options: OpenAiCompatibleProviderOptions = {}
): AiProvider {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const baseUrl = normalizeBaseUrl(
    profile.baseUrl,
    profile.kind === 'openai' ? 'https://api.openai.com/v1' : 'http://localhost:11434/v1'
  );
  const model = profile.model.trim();

  const post = async (params: ChatCompletionParams, stream: boolean): Promise<Response> => {
    const response = await fetchOrThrow(fetchImpl, `${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(profile.apiKey),
      body: JSON.stringify(buildOpenAiChatBody(params, model, stream)),
      signal: params.abortSignal,
    });

    if (!response.ok) {
      const body = await readErrorBody(response);
      throw new AiProviderRequestError(describeHttpFailure(response.status, body), { status: response.status });
    }

    return response;
  };

  return {
    id: profile.id,
    kind: profile.kind,
    label: profile.label,
    model,

    async createChatCompletion(params) {
      const response = await post(params, false);
      const json = (await response.json()) as ChatCompletionResponse;
      if (!json || !Array.isArray(json.choices)) {
        throw new AiProviderRequestError('The endpoint returned an unexpected response shape');
      }
      return json;
    },

    async createChatCompletionStream(params) {
      const response = await post(params, true);
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('text/event-stream')) {
        // Some servers ignore `stream: true`; fall back to a single chunk.
        const json = (await response.json()) as ChatCompletionResponse;
        return (async function* singleChunk() {
          const message = json.choices?.[0]?.message;
          yield {
            id: json.id,
            object: 'chat.completion.chunk',
            created: json.created,
            model: json.model,
            usage: json.usage,
            choices: [
              {
                index: 0,
                finish_reason: json.choices?.[0]?.finish_reason ?? 'stop',
                logprobs: null,
                delta: {
                  role: 'assistant',
                  content: message?.content ?? '',
                  tool_calls: message?.tool_calls?.map((toolCall, index) => ({
                    index,
                    id: toolCall.id,
                    type: 'function' as const,
                    function: toolCall.function,
                  })),
                },
              },
            ],
          } satisfies ChatCompletionChunk;
        })();
      }
      return parseOpenAiStream(response, params.abortSignal);
    },

    async testConnection(): Promise<AiProviderTestResult> {
      const startedAt = performance.now();
      try {
        const response = await fetchOrThrow(fetchImpl, `${baseUrl}/models`, {
          method: 'GET',
          headers: buildHeaders(profile.apiKey),
        });
        const latencyMs = Math.round(performance.now() - startedAt);

        if (response.ok) {
          let knowsModel: boolean | null = null;
          try {
            const json = (await response.json()) as { data?: Array<{ id?: string }> };
            if (Array.isArray(json.data) && model) {
              knowsModel = json.data.some((entry) => entry.id === model);
            }
          } catch {
            // Body is optional for the check.
          }
          if (knowsModel === false) {
            return {
              ok: true,
              message: `Connected, but the server did not list model "${model}"`,
              hint: 'Check the model name; some servers pull or load models on first use.',
              latencyMs,
            };
          }
          return { ok: true, message: 'Connected', latencyMs };
        }

        if (response.status === 404 || response.status === 405) {
          // No /models route: try a tiny completion instead.
          await post({ messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }, false);
          return { ok: true, message: 'Connected', latencyMs: Math.round(performance.now() - startedAt) };
        }

        const body = await readErrorBody(response);
        return { ok: false, message: describeHttpFailure(response.status, body), latencyMs };
      } catch (error) {
        log.warn('Provider test failed', { operation: 'testConnection', provider: profile.kind, error });
        return toTestResult(error, baseUrl, startedAt);
      }
    },
  };
}
