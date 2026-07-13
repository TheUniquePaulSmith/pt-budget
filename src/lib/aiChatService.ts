import type {
  ChatCompletionChunk,
  ChatCompletionMessage,
  ChatCompletionParams,
  ChatCompletionResponse,
  ChatCompletionToolCall,
} from '@wllama/wllama/esm';

import {
  AI_DATABASE_TOOLS,
  executeAiDatabaseToolCall,
  type AiDatabaseToolContext,
} from '@/lib/aiDatabaseTools';
import type {
  AiChatMessage,
  AiChatRunResult,
  AiChatTokenUsage,
  AiToolCallRecord,
  MerchantRuleSuggestion,
  TransactionClassificationSuggestion,
} from '@/types/ai';
import { AI_OUTPUT_LIMIT_PRESETS } from '@/types/ai';

const SYSTEM_PROMPT = `You are a local-only personal finance assistant running in the browser. Use tools to inspect the user's local SQLite budget database before making claims about transactions. Arbitrary database mutations are not allowed. For classification writes, call apply_transaction_classifications and respect the application's review mode. To name unmatched recurring merchants, call get_unmatched_merchant_clusters and then propose_merchant_rules; proposed rules are always staged for user review.`;

export interface RunAiChatOptions {
  messages: AiChatMessage[];
  createChatCompletion: (params: ChatCompletionParams) => Promise<ChatCompletionResponse>;
  createChatCompletionStream?: (params: ChatCompletionParams) => Promise<AsyncIterable<ChatCompletionChunk>>;
  databaseToolContext: AiDatabaseToolContext;
  abortSignal?: AbortSignal;
  maxToolIterations?: number;
  maxOutputTokens?: number;
  onAssistantDelta?: (delta: string) => void;
}

function toWllamaMessages(messages: AiChatMessage[]): ChatCompletionMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => ({
        role: message.role as 'user' | 'assistant',
        content: message.content,
      })),
  ];
}

function addResponseUsage(
  currentUsage: Required<AiChatTokenUsage>,
  response: ChatCompletionResponse
) {
  currentUsage.promptTokens += response.usage?.prompt_tokens ?? 0;
  currentUsage.completionTokens += response.usage?.completion_tokens ?? 0;
  currentUsage.totalTokens += response.usage?.total_tokens ?? 0;
}

function addChunkUsage(
  currentUsage: Required<AiChatTokenUsage>,
  chunk: ChatCompletionChunk
) {
  const promptTokens = chunk.usage?.prompt_tokens ?? chunk.timings?.prompt_n ?? 0;
  const completionTokens = chunk.usage?.completion_tokens ?? chunk.timings?.predicted_n ?? 0;
  const totalTokens = chunk.usage?.total_tokens ?? (
    promptTokens > 0 || completionTokens > 0
      ? promptTokens + completionTokens
      : 0
  );

  currentUsage.promptTokens = Math.max(currentUsage.promptTokens, promptTokens);
  currentUsage.completionTokens = Math.max(currentUsage.completionTokens, completionTokens);
  currentUsage.totalTokens = Math.max(currentUsage.totalTokens, totalTokens);
}

function addTurnUsage(
  currentUsage: Required<AiChatTokenUsage>,
  turnUsage: Required<AiChatTokenUsage>
) {
  currentUsage.promptTokens += turnUsage.promptTokens;
  currentUsage.completionTokens += turnUsage.completionTokens;
  currentUsage.totalTokens += turnUsage.totalTokens;
}

interface StreamedToolCallPart {
  index: number;
  id?: string;
  name?: string;
  arguments: string;
}

interface StreamedAssistantTurn {
  content: string;
  toolCalls: ChatCompletionToolCall[];
}

function toToolCalls(toolCallParts: Map<number, StreamedToolCallPart>): ChatCompletionToolCall[] {
  return Array.from(toolCallParts.values())
    .sort((left, right) => left.index - right.index)
    .filter((toolCall) => Boolean(toolCall.name))
    .map((toolCall, index) => ({
      id: toolCall.id || `tool-call-${Date.now()}-${index}`,
      type: 'function',
      function: {
        name: toolCall.name || '',
        arguments: toolCall.arguments,
      },
    }));
}

async function streamAssistantTurn({
  conversation,
  createChatCompletionStream,
  abortSignal,
  onAssistantDelta,
  tokenUsage,
  maxOutputTokens,
}: {
  conversation: ChatCompletionMessage[];
  createChatCompletionStream: (params: ChatCompletionParams) => Promise<AsyncIterable<ChatCompletionChunk>>;
  abortSignal?: AbortSignal;
  onAssistantDelta?: (delta: string) => void;
  tokenUsage: Required<AiChatTokenUsage>;
  maxOutputTokens: number;
}): Promise<StreamedAssistantTurn> {
  let content = '';
  const toolCallParts = new Map<number, StreamedToolCallPart>();
  const turnUsage: Required<AiChatTokenUsage> = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  const stream = await createChatCompletionStream({
    messages: conversation,
    tools: AI_DATABASE_TOOLS,
    tool_choice: 'auto',
    temperature: 0.2,
    max_tokens: maxOutputTokens,
    timings_per_token: true,
    abortSignal,
  });

  for await (const chunk of stream) {
    addChunkUsage(turnUsage, chunk);
    const delta = chunk.choices[0]?.delta;
    const contentDelta = delta?.content ?? '';

    if (contentDelta) {
      content += contentDelta;
      onAssistantDelta?.(contentDelta);
    }

    for (const toolCallDelta of delta?.tool_calls ?? []) {
      const existing = toolCallParts.get(toolCallDelta.index) ?? {
        index: toolCallDelta.index,
        arguments: '',
      };

      toolCallParts.set(toolCallDelta.index, {
        ...existing,
        id: toolCallDelta.id ?? existing.id,
        name: toolCallDelta.function?.name ?? existing.name,
        arguments: `${existing.arguments}${toolCallDelta.function?.arguments ?? ''}`,
      });
    }
  }

  addTurnUsage(tokenUsage, turnUsage);

  return {
    content,
    toolCalls: toToolCalls(toolCallParts),
  };
}

export async function runAiChatCompletion({
  messages,
  createChatCompletion,
  createChatCompletionStream,
  databaseToolContext,
  abortSignal,
  maxToolIterations = 4,
  maxOutputTokens = AI_OUTPUT_LIMIT_PRESETS.medium.tokens,
  onAssistantDelta,
}: RunAiChatOptions): Promise<AiChatRunResult> {
  const conversation = toWllamaMessages(messages);
  const toolCalls: AiToolCallRecord[] = [];
  const classificationSuggestions: TransactionClassificationSuggestion[] = [];
  const merchantRuleSuggestions: MerchantRuleSuggestion[] = [];
  const tokenUsage: Required<AiChatTokenUsage> = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };

  if (createChatCompletionStream) {
    for (let iteration = 0; iteration <= maxToolIterations; iteration += 1) {
      const assistantTurn = await streamAssistantTurn({
        conversation,
        createChatCompletionStream,
        abortSignal,
        onAssistantDelta,
        tokenUsage,
        maxOutputTokens,
      });

      if (assistantTurn.toolCalls.length === 0) {
        return {
          assistantMessage: assistantTurn.content,
          toolCalls,
          classificationSuggestions,
          merchantRuleSuggestions,
          tokenUsage,
        };
      }

      conversation.push({
        role: 'assistant',
        content: assistantTurn.content || null,
        tool_calls: assistantTurn.toolCalls,
      });

      for (const toolCall of assistantTurn.toolCalls) {
        const result = await executeAiDatabaseToolCall(toolCall, databaseToolContext);
        toolCalls.push(result.toolCall);
        classificationSuggestions.push(...result.classificationSuggestions);
        merchantRuleSuggestions.push(...result.merchantRuleSuggestions);
        conversation.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result.content,
        });
      }
    }

    onAssistantDelta?.('I reached the tool-call limit before producing a final answer. Try a narrower question.');

    return {
      assistantMessage: 'I reached the tool-call limit before producing a final answer. Try a narrower question.',
      toolCalls,
      classificationSuggestions,
      merchantRuleSuggestions,
      tokenUsage,
    };
  }

  for (let iteration = 0; iteration <= maxToolIterations; iteration += 1) {
    const response = await createChatCompletion({
      messages: conversation,
      tools: AI_DATABASE_TOOLS,
      tool_choice: 'auto',
      temperature: 0.2,
      max_tokens: maxOutputTokens,
      abortSignal,
    });
    addResponseUsage(tokenUsage, response);

    const assistantMessage = response.choices[0]?.message;
    if (!assistantMessage) {
      return {
        assistantMessage: 'The model did not return a response.',
        toolCalls,
        classificationSuggestions,
        merchantRuleSuggestions,
        tokenUsage,
      };
    }

    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      return {
        assistantMessage: assistantMessage.content || '',
        toolCalls,
        classificationSuggestions,
        merchantRuleSuggestions,
        tokenUsage,
      };
    }

    conversation.push({
      role: 'assistant',
      content: assistantMessage.content,
      tool_calls: assistantMessage.tool_calls,
    });

    for (const toolCall of assistantMessage.tool_calls) {
      const result = await executeAiDatabaseToolCall(toolCall, databaseToolContext);
      toolCalls.push(result.toolCall);
      classificationSuggestions.push(...result.classificationSuggestions);
      merchantRuleSuggestions.push(...result.merchantRuleSuggestions);
      conversation.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result.content,
      });
    }
  }

  onAssistantDelta?.('I reached the tool-call limit before producing a final answer. Try a narrower question.');

  return {
    assistantMessage: 'I reached the tool-call limit before producing a final answer. Try a narrower question.',
    toolCalls,
    classificationSuggestions,
    merchantRuleSuggestions,
    tokenUsage,
  };
}