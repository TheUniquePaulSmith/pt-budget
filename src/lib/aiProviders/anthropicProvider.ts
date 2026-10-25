import type {
  ChatCompletionChunk,
  ChatCompletionMessage,
  ChatCompletionParams,
  ChatCompletionResponse,
  ChatCompletionTool,
  ChatCompletionToolCall,
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
import { normalizeBaseUrl } from './openAiCompatibleProvider';
import type { AiProvider, AiProviderProfile, AiProviderTestResult, FetchLike } from './types';

const log = logger.child({ component: 'AnthropicProvider' });

export const ANTHROPIC_API_BASE_URL = 'https://api.anthropic.com';
export const ANTHROPIC_API_VERSION = '2023-06-01';
export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-5-5';
const DEFAULT_MAX_TOKENS = 4096;

// --- Anthropic wire shapes (only the parts this provider uses) -------------

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicRequestBody {
  model: string;
  max_tokens: number;
  system?: string;
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  stream?: boolean;
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
}

interface AnthropicMessageResponse {
  id: string;
  model: string;
  stop_reason: string | null;
  content: Array<AnthropicTextBlock | AnthropicToolUseBlock | { type: string }>;
  usage?: AnthropicUsage;
}

// --- Request mapping -------------------------------------------------------

export function toAnthropicTools(tools: ChatCompletionTool[] | undefined): AnthropicTool[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: (tool.function.parameters as Record<string, unknown> | undefined) ?? {
      type: 'object',
      properties: {},
    },
  }));
}

function parseToolArguments(toolCall: ChatCompletionToolCall): Record<string, unknown> {
  const raw = toolCall.function.arguments?.trim();
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function contentToText(content: ChatCompletionMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!content) {
    return '';
  }
  return content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('');
}

/**
 * Converts the OpenAI-shaped conversation to Anthropic's `system` + `messages`.
 * Tool results (role `tool`) become `tool_result` blocks inside a user turn;
 * consecutive results are merged into one turn as the API expects.
 */
export function toAnthropicMessages(messages: ChatCompletionMessage[]): {
  system?: string;
  messages: AnthropicMessage[];
} {
  const systemParts: string[] = [];
  const out: AnthropicMessage[] = [];

  const pushToolResult = (block: AnthropicToolResultBlock) => {
    const last = out[out.length - 1];
    if (last && last.role === 'user' && Array.isArray(last.content) && last.content.some((item) => item.type === 'tool_result')) {
      last.content.push(block);
    } else {
      out.push({ role: 'user', content: [block] });
    }
  };

  for (const message of messages) {
    if (message.role === 'system') {
      systemParts.push(message.content);
      continue;
    }

    if (message.role === 'user') {
      const text = contentToText(message.content);
      out.push({ role: 'user', content: text || '(empty)' });
      continue;
    }

    if (message.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = [];
      const text = contentToText(message.content ?? '');
      if (text.trim()) {
        blocks.push({ type: 'text', text });
      }
      for (const toolCall of message.tool_calls ?? []) {
        blocks.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.function.name,
          input: parseToolArguments(toolCall),
        });
      }
      if (blocks.length === 0) {
        continue;
      }
      out.push({ role: 'assistant', content: blocks });
      continue;
    }

    if (message.role === 'tool') {
      let isError = false;
      try {
        const parsed = JSON.parse(message.content) as { error?: unknown };
        isError = typeof parsed === 'object' && parsed !== null && 'error' in parsed;
      } catch {
        // Plain-text tool output.
      }
      pushToolResult({
        type: 'tool_result',
        tool_use_id: message.tool_call_id,
        content: message.content,
        ...(isError ? { is_error: true } : {}),
      });
    }
  }

  // Anthropic requires the first message to be a user turn.
  if (out.length === 0 || out[0].role !== 'user') {
    out.unshift({ role: 'user', content: '(conversation start)' });
  }

  return {
    system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    messages: out,
  };
}

export function buildAnthropicRequestBody(
  params: ChatCompletionParams,
  model: string,
  stream: boolean
): AnthropicRequestBody {
  const { system, messages } = toAnthropicMessages(params.messages);
  const body: AnthropicRequestBody = {
    model,
    max_tokens: typeof params.max_tokens === 'number' && params.max_tokens > 0 ? params.max_tokens : DEFAULT_MAX_TOKENS,
    messages,
  };
  if (system) {
    body.system = system;
  }
  const tools = toAnthropicTools(params.tools);
  if (tools) {
    body.tools = tools;
  }
  if (stream) {
    body.stream = true;
  }
  // `temperature` and forced `tool_choice` are deliberately not forwarded:
  // current Claude models reject non-default sampling and forced tool use.
  return body;
}

// --- Response mapping ------------------------------------------------------

function toFinishReason(stopReason: string | null): 'stop' | 'length' | 'tool_calls' | 'content_filter' | null {
  switch (stopReason) {
    case 'tool_use':
      return 'tool_calls';
    case 'max_tokens':
      return 'length';
    case 'refusal':
      return 'content_filter';
    case null:
      return null;
    default:
      return 'stop';
  }
}

function toUsage(usage: AnthropicUsage | undefined) {
  const promptTokens = usage?.input_tokens ?? 0;
  const completionTokens = usage?.output_tokens ?? 0;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
}

export function toChatCompletionResponse(response: AnthropicMessageResponse): ChatCompletionResponse {
  const textParts: string[] = [];
  const toolCalls: ChatCompletionToolCall[] = [];

  for (const block of response.content ?? []) {
    if (block.type === 'text') {
      textParts.push((block as AnthropicTextBlock).text);
    } else if (block.type === 'tool_use') {
      const toolUse = block as AnthropicToolUseBlock;
      toolCalls.push({
        id: toolUse.id,
        type: 'function',
        function: {
          name: toolUse.name,
          arguments: JSON.stringify(toolUse.input ?? {}),
        },
      });
    }
  }

  return {
    id: response.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: response.model,
    usage: toUsage(response.usage),
    choices: [
      {
        index: 0,
        finish_reason: toFinishReason(response.stop_reason),
        logprobs: null,
        message: {
          role: 'assistant',
          content: textParts.join('') || null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
      },
    ],
  };
}

interface AnthropicStreamEvent {
  type: string;
  index?: number;
  message?: { id?: string; model?: string; usage?: AnthropicUsage };
  content_block?: { type: string; id?: string; name?: string; text?: string };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string | null;
  };
  usage?: AnthropicUsage;
  error?: { type?: string; message?: string };
}

/**
 * Turns Anthropic's SSE event stream into OpenAI-shaped chunks. Tool-use
 * blocks map to `tool_calls` deltas keyed by their content-block index, with
 * `input_json_delta` fragments forwarded as `function.arguments`.
 */
export async function* anthropicEventsToChunks(
  events: AsyncIterable<{ event?: string; data: string }>,
  model: string
): AsyncGenerator<ChatCompletionChunk> {
  let messageId = `msg-${Date.now()}`;
  let responseModel = model;
  let inputTokens = 0;
  let outputTokens = 0;
  const toolCallIndexByBlock = new Map<number, number>();
  let nextToolCallIndex = 0;

  const makeChunk = (
    delta: ChatCompletionChunk['choices'][number]['delta'],
    finishReason: ChatCompletionChunk['choices'][number]['finish_reason'] = null,
    includeUsage = false
  ): ChatCompletionChunk => ({
    id: messageId,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: responseModel,
    choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }],
    ...(includeUsage
      ? {
          usage: {
            prompt_tokens: inputTokens,
            completion_tokens: outputTokens,
            total_tokens: inputTokens + outputTokens,
          },
        }
      : {}),
  });

  for await (const sseEvent of events) {
    let event: AnthropicStreamEvent;
    try {
      event = JSON.parse(sseEvent.data) as AnthropicStreamEvent;
    } catch {
      continue;
    }

    switch (event.type) {
      case 'message_start':
        messageId = event.message?.id ?? messageId;
        responseModel = event.message?.model ?? responseModel;
        inputTokens = event.message?.usage?.input_tokens ?? inputTokens;
        outputTokens = event.message?.usage?.output_tokens ?? outputTokens;
        yield makeChunk({ role: 'assistant', content: '' });
        break;

      case 'content_block_start': {
        const block = event.content_block;
        if (block?.type === 'tool_use' && typeof event.index === 'number') {
          const toolCallIndex = nextToolCallIndex;
          nextToolCallIndex += 1;
          toolCallIndexByBlock.set(event.index, toolCallIndex);
          yield makeChunk({
            tool_calls: [
              {
                index: toolCallIndex,
                id: block.id,
                type: 'function',
                function: { name: block.name, arguments: '' },
              },
            ],
          });
        } else if (block?.type === 'text' && block.text) {
          yield makeChunk({ content: block.text });
        }
        break;
      }

      case 'content_block_delta': {
        const delta = event.delta;
        if (!delta) {
          break;
        }
        if (delta.type === 'text_delta' && delta.text) {
          yield makeChunk({ content: delta.text });
        } else if (delta.type === 'input_json_delta' && typeof event.index === 'number') {
          const toolCallIndex = toolCallIndexByBlock.get(event.index);
          if (toolCallIndex !== undefined) {
            yield makeChunk({
              tool_calls: [
                { index: toolCallIndex, function: { arguments: delta.partial_json ?? '' } },
              ],
            });
          }
        }
        break;
      }

      case 'message_delta':
        outputTokens = event.usage?.output_tokens ?? outputTokens;
        inputTokens = event.usage?.input_tokens ?? inputTokens;
        yield makeChunk({}, toFinishReason(event.delta?.stop_reason ?? null), true);
        break;

      case 'error':
        throw new AiProviderRequestError(event.error?.message ?? 'The Anthropic stream reported an error');

      default:
        break;
    }
  }
}

// --- Provider --------------------------------------------------------------

export interface AnthropicProviderOptions {
  fetchImpl?: FetchLike;
}

export function buildAnthropicHeaders(apiKey: string | undefined): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': (apiKey ?? '').trim(),
    'anthropic-version': ANTHROPIC_API_VERSION,
    // The app is client-only, so the key is sent straight from the browser.
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

export function createAnthropicProvider(
  profile: AiProviderProfile,
  options: AnthropicProviderOptions = {}
): AiProvider {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const baseUrl = normalizeBaseUrl(profile.baseUrl, ANTHROPIC_API_BASE_URL);
  const model = profile.model.trim() || ANTHROPIC_DEFAULT_MODEL;

  const post = async (params: ChatCompletionParams, stream: boolean): Promise<Response> => {
    const response = await fetchOrThrow(fetchImpl, `${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: buildAnthropicHeaders(profile.apiKey),
      body: JSON.stringify(buildAnthropicRequestBody(params, model, stream)),
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
    kind: 'anthropic',
    label: profile.label,
    model,

    async createChatCompletion(params) {
      const response = await post(params, false);
      const json = (await response.json()) as AnthropicMessageResponse;
      return toChatCompletionResponse(json);
    },

    async createChatCompletionStream(params) {
      const response = await post(params, true);
      return anthropicEventsToChunks(readSseEvents(response.body, params.abortSignal), model);
    },

    async testConnection(): Promise<AiProviderTestResult> {
      const startedAt = performance.now();
      try {
        const response = await fetchOrThrow(fetchImpl, `${baseUrl}/v1/models/${encodeURIComponent(model)}`, {
          method: 'GET',
          headers: buildAnthropicHeaders(profile.apiKey),
        });
        const latencyMs = Math.round(performance.now() - startedAt);
        if (response.ok) {
          return { ok: true, message: `Connected (${model})`, latencyMs };
        }
        const body = await readErrorBody(response);
        if (response.status === 404) {
          return { ok: false, message: `Model "${model}" was not found`, hint: body || undefined, latencyMs };
        }
        return { ok: false, message: describeHttpFailure(response.status, body), latencyMs };
      } catch (error) {
        log.warn('Provider test failed', { operation: 'testConnection', provider: 'anthropic', error });
        return toTestResult(error, baseUrl, startedAt);
      }
    },
  };
}
