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

/**
 * Extracts the model ids from a `GET /models` body (`{ data: [{ id }] }`, or a
 * bare array). Returns `null` when the body is not a model list at all, which
 * is how a plain web server answering 200 gives itself away.
 */
export function parseModelIds(body: unknown): string[] | null {
  const list = Array.isArray(body) ? body : (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(list)) {
    return null;
  }

  const ids = list
    .map((entry) => (typeof entry === 'string' ? entry : (entry as { id?: unknown } | null)?.id))
    .filter((id): id is string => typeof id === 'string' && id.trim() !== '');
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
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
 * browser, so the server must allow this origin (CORS). When the profile asks
 * for a client certificate, requests carry `credentials: 'include'`: that is
 * what makes the browser present the certificate installed in the system store
 * on a cross-origin request.
 */
export function createOpenAiCompatibleProvider(
  profile: AiProviderProfile,
  options: OpenAiCompatibleProviderOptions = {}
): AiProvider {
  const baseFetch: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const clientCertificate = profile.useClientCertificate === true;
  const fetchImpl: FetchLike = clientCertificate
    ? (input, init) => baseFetch(input, { ...init, credentials: 'include' })
    : baseFetch;
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

    /**
     * Validates that the endpoint really is an OpenAI-compatible LLM server
     * and, when it lists models, returns them for the model drop-down. A bare
     * 200 is not enough (any web server answers one), so a response that is
     * not a model list falls back to a one-token completion.
     */
    async testConnection(): Promise<AiProviderTestResult> {
      const startedAt = performance.now();
      const elapsedMs = () => Math.round(performance.now() - startedAt);

      // Used when /models cannot vouch for the server: prove it answers chat completions.
      const verifyWithCompletion = async (): Promise<AiProviderTestResult> => {
        if (!model) {
          return {
            ok: false,
            message: 'The endpoint did not return a model list',
            hint: 'Check that the base URL ends with the API version (e.g. …/v1), or enter a model name so the test can use a chat request instead.',
            latencyMs: elapsedMs(),
          };
        }
        await post({ messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }, false);
        return { ok: true, message: 'Connected', latencyMs: elapsedMs() };
      };

      try {
        const response = await fetchOrThrow(fetchImpl, `${baseUrl}/models`, {
          method: 'GET',
          headers: buildHeaders(profile.apiKey),
        });
        const latencyMs = elapsedMs();

        if (response.ok) {
          let models: string[] | null = null;
          try {
            models = parseModelIds(await response.json());
          } catch {
            // Not JSON: handled below as "not a model list".
          }
          if (models === null) {
            return await verifyWithCompletion();
          }
          if (models.length === 0) {
            return {
              ok: true,
              message: 'Connected, but the server reports no models',
              hint: 'Pull or load a model on the server, then test again.',
              models,
              latencyMs,
            };
          }
          if (model && !models.includes(model)) {
            return {
              ok: true,
              message: `Connected, but the server did not list model "${model}"`,
              hint: 'Pick one of the listed models, or check the name; some servers pull or load models on first use.',
              models,
              latencyMs,
            };
          }
          return { ok: true, message: 'Connected', models, latencyMs };
        }

        if (response.status === 404 || response.status === 405) {
          // No /models route: try a tiny completion instead.
          return await verifyWithCompletion();
        }

        const body = await readErrorBody(response);
        return { ok: false, message: describeHttpFailure(response.status, body), latencyMs };
      } catch (error) {
        log.warn('Provider test failed', { operation: 'testConnection', provider: profile.kind, error });
        return toTestResult(error, baseUrl, startedAt, { clientCertificate });
      }
    },
  };
}
