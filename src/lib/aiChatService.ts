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

const SYSTEM_PROMPT = `You are a local-only personal finance assistant running in the browser. Use tools to inspect the user's local SQLite budget database before making claims about transactions. Arbitrary database mutations are not allowed. For classification writes, call apply_transaction_classifications and respect the application's review mode. To name unmatched recurring merchants, call get_unmatched_merchant_clusters and then propose_merchant_rules; proposed rules are always staged for user review.

When you call suggest_transaction_classifications or propose_merchant_rules, the results are automatically staged in the app's Automation tab for the user to review and apply — do not repeat the full list or a table of the suggestions in your reply. Just briefly state how many suggestions you staged and tell the user to check the Automation tab to review and apply them.`;
const DATABASE_SCHEMA_TIMEOUT_MS = 10000;

const DATABASE_SCHEMA_COLUMNS_QUERY = `
SELECT
  m.name AS table_name,
  p.cid AS column_position,
  p.name AS column_name,
  p.type AS data_type,
  p.[notnull] AS not_null,
  p.pk AS primary_key
FROM sqlite_master m
JOIN pragma_table_info(m.name) p
WHERE m.type = 'table'
  AND m.name NOT LIKE 'sqlite_%'
ORDER BY m.name, p.cid
`;

const DATABASE_SCHEMA_FOREIGN_KEYS_QUERY = `
SELECT
  m.name AS table_name,
  fk.[from] AS from_column,
  fk.[table] AS referenced_table,
  fk.[to] AS referenced_column
FROM sqlite_master m
JOIN pragma_foreign_key_list(m.name) fk
WHERE m.type = 'table'
  AND m.name NOT LIKE 'sqlite_%'
ORDER BY m.name, fk.id, fk.seq
`;

interface DatabaseSchemaColumnRow {
  table_name?: unknown;
  column_position?: unknown;
  column_name?: unknown;
  data_type?: unknown;
  not_null?: unknown;
  primary_key?: unknown;
}

interface DatabaseSchemaForeignKeyRow {
  table_name?: unknown;
  from_column?: unknown;
  referenced_table?: unknown;
  referenced_column?: unknown;
}

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

function isTruthySqlFlag(value: unknown): boolean {
  return value === 1 || value === true || value === '1';
}

function formatDatabaseSchemaForPrompt(
  columnRows: DatabaseSchemaColumnRow[],
  foreignKeyRows: DatabaseSchemaForeignKeyRow[]
): string {
  const tables = new Map<string, { columns: string[]; foreignKeys: string[] }>();

  for (const row of columnRows) {
    if (typeof row.table_name !== 'string' || typeof row.column_name !== 'string') {
      continue;
    }

    const table = tables.get(row.table_name) ?? { columns: [], foreignKeys: [] };
    const dataType = typeof row.data_type === 'string' && row.data_type.trim()
      ? ` ${row.data_type.trim()}`
      : '';
    const primaryKey = isTruthySqlFlag(row.primary_key) ? ' PRIMARY KEY' : '';
    const notNull = isTruthySqlFlag(row.not_null) ? ' NOT NULL' : '';
    table.columns.push(`${row.column_name}${dataType}${primaryKey}${notNull}`);
    tables.set(row.table_name, table);
  }

  for (const row of foreignKeyRows) {
    if (
      typeof row.table_name !== 'string' ||
      typeof row.from_column !== 'string' ||
      typeof row.referenced_table !== 'string' ||
      typeof row.referenced_column !== 'string'
    ) {
      continue;
    }

    const table = tables.get(row.table_name) ?? { columns: [], foreignKeys: [] };
    table.foreignKeys.push(`${row.from_column} -> ${row.referenced_table}.${row.referenced_column}`);
    tables.set(row.table_name, table);
  }

  if (tables.size === 0) {
    return 'Current SQLite database schema: no application tables were found.';
  }

  const tableLines = Array.from(tables.entries()).map(([tableName, table]) => {
    const foreignKeys = table.foreignKeys.length > 0
      ? ` Foreign keys: ${table.foreignKeys.join('; ')}.`
      : '';
    return `- ${tableName}: ${table.columns.join(', ')}.${foreignKeys}`;
  });

  return [
    'Current SQLite database schema. Use these exact table and column names when writing SQL:',
    ...tableLines,
  ].join('\n');
}

async function buildSystemPrompt(databaseToolContext: AiDatabaseToolContext): Promise<string> {
  try {
    const [columnRows, foreignKeyRows] = await Promise.all([
      databaseToolContext.executeCustomQuery(DATABASE_SCHEMA_COLUMNS_QUERY, DATABASE_SCHEMA_TIMEOUT_MS),
      databaseToolContext.executeCustomQuery(DATABASE_SCHEMA_FOREIGN_KEYS_QUERY, DATABASE_SCHEMA_TIMEOUT_MS),
    ]);

    return `${SYSTEM_PROMPT}\n\n${formatDatabaseSchemaForPrompt(columnRows, foreignKeyRows)}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';

    return `${SYSTEM_PROMPT}\n\nCurrent SQLite database schema could not be loaded for this prompt (${message}). Use query_transactions to inspect sqlite_master before answering schema-sensitive questions.`;
  }
}

function toWllamaMessages(messages: AiChatMessage[], systemPrompt: string): ChatCompletionMessage[] {
  return [
    { role: 'system', content: systemPrompt },
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
  const systemPrompt = await buildSystemPrompt(databaseToolContext);
  const conversation = toWllamaMessages(messages, systemPrompt);
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