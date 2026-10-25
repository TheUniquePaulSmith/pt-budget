import type {
  ChatCompletionChunk,
  ChatCompletionMessage,
  ChatCompletionParams,
  ChatCompletionResponse,
  ChatCompletionTool,
  ChatCompletionToolCall,
} from '@wllama/wllama/esm';

import {
  createDeniedToolResult,
  type AiDatabaseToolContext,
  type AiDatabaseToolResult,
} from '@/lib/aiDatabaseTools';
import { executeRegistryToolCall } from '@/lib/aiTools/executeTool';
import { DEFAULT_TOOL_CALL_LIMIT } from '@/lib/aiTools/toolCallLimit';
import { createDefaultToolRegistry, type AiToolRegistry } from '@/lib/aiTools/toolRegistry';
import { logger } from '@/lib/logging';
import type {
  AiChatMessage,
  AiChatRunResult,
  AiChatTokenUsage,
  AiToolCallRecord,
  MerchantRuleSuggestion,
  TransactionClassificationSuggestion,
} from '@/types/ai';
import { AI_OUTPUT_LIMIT_PRESETS } from '@/types/ai';
import type { AiConsentDecision, AiConsentRequest, AiConsentVerdict, AiResolvedTool } from '@/types/aiTools';

const log = logger.child({ component: 'AiChatService' });

const SYSTEM_PROMPT = `You are a personal finance assistant for a budget-tracking app whose data lives in a local SQLite database in the user's browser. Use tools to inspect the database before making claims about transactions. Only the listed tools can change data; every write tool may ask the user for consent first, and a denied call returns an error you must respect rather than retry. For classification writes, call apply_transaction_classifications and respect the application's review mode. To name unmatched recurring merchants, call get_unmatched_merchant_clusters and then propose_merchant_rules; proposed rules are always staged for user review.

When you call suggest_transaction_classifications or propose_merchant_rules, the results are automatically staged in the app's Automation tab for the user to review and apply — do not repeat the full list or a table of the suggestions in your reply. Just briefly state how many suggestions you staged and tell the user to check the Automation tab to review and apply them.`;

const TOOL_LIMIT_MESSAGE =
  'I reached the tool-call limit before producing a final answer. Try a narrower question, or raise the limit in the Tools tab.';

/** Sent once the tool rounds are used up so the model answers instead of asking for more tools. */
function buildToolLimitNudge(maxToolRounds: number): string {
  return `You have used all ${maxToolRounds} allowed rounds of tool calls. Do not call any more tools. Answer the question now from the tool results you already have, and say plainly what you could not verify.`;
}
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
  /** Tools offered to the model; defaults to the built-in registry with safe defaults. */
  registry?: AiToolRegistry;
  /** Policy check for a tool; defaults to the tool's stored/default consent with no session grants. */
  evaluateConsent?: (tool: AiResolvedTool) => AiConsentVerdict;
  /**
   * Called when a tool needs the user's consent. The loop pauses until it
   * resolves. When omitted, calls that would ask are denied.
   */
  requestConsent?: (request: AiConsentRequest) => Promise<AiConsentDecision>;
  /** Progress callback for tool-call records (awaiting-consent, running, completed, failed, denied). */
  onToolCallUpdate?: (record: AiToolCallRecord) => void;
  abortSignal?: AbortSignal;
  /** Rounds of tool calls allowed before the model must answer; defaults to the Tools tab default. */
  maxToolRounds?: number;
  maxOutputTokens?: number;
  onAssistantDelta?: (delta: string) => void;
}

function defaultEvaluateConsent(tool: AiResolvedTool): AiConsentVerdict {
  if (tool.consent === 'deny') {
    return 'deny';
  }
  return tool.consent === 'always' ? 'allow' : 'ask';
}

function createConsentRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `consent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
  tools,
  toolChoice,
}: {
  conversation: ChatCompletionMessage[];
  createChatCompletionStream: (params: ChatCompletionParams) => Promise<AsyncIterable<ChatCompletionChunk>>;
  abortSignal?: AbortSignal;
  onAssistantDelta?: (delta: string) => void;
  tokenUsage: Required<AiChatTokenUsage>;
  maxOutputTokens: number;
  tools: ChatCompletionTool[];
  toolChoice: 'auto' | 'none';
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
    tools,
    tool_choice: toolChoice,
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

interface ToolCallHandlingOptions {
  registry: AiToolRegistry;
  databaseToolContext: AiDatabaseToolContext;
  evaluateConsent: (tool: AiResolvedTool) => AiConsentVerdict;
  requestConsent?: (request: AiConsentRequest) => Promise<AiConsentDecision>;
  onToolCallUpdate?: (record: AiToolCallRecord) => void;
  abortSignal?: AbortSignal;
}

/**
 * Resolves consent for one tool call, then runs it. Unknown or disabled tools
 * and denied calls return an error result so the model can recover.
 */
export async function handleToolCall(
  toolCall: ChatCompletionToolCall,
  options: ToolCallHandlingOptions
): Promise<AiDatabaseToolResult> {
  const { registry, databaseToolContext, evaluateConsent, requestConsent, onToolCallUpdate } = options;
  const name = toolCall.function.name;
  const tool = registry.getTool(name);

  if (!tool) {
    log.warn('Model called an unknown tool', { operation: 'handleToolCall', tool: name });
    return createDeniedToolResult(toolCall, `"${name}" is not an available tool.`);
  }
  if (!tool.enabled) {
    return createDeniedToolResult(toolCall, `"${name}" is disabled in the Tools tab.`);
  }

  let verdict = evaluateConsent(tool);

  if (verdict === 'ask') {
    if (!requestConsent) {
      return createDeniedToolResult(toolCall, `"${name}" requires the user's consent, which could not be requested.`);
    }

    onToolCallUpdate?.({
      id: toolCall.id,
      name,
      argumentsJson: toolCall.function.arguments,
      status: 'awaiting-consent',
    });

    const decision = await requestConsent({
      id: createConsentRequestId(),
      toolCallId: toolCall.id,
      toolName: name,
      crud: tool.crud,
      description: tool.description,
      argumentsJson: toolCall.function.arguments,
      source: tool.source,
      packKey: tool.packKey,
    });
    verdict = decision === 'deny' ? 'deny' : 'allow';
  }

  if (verdict === 'deny') {
    const result = createDeniedToolResult(toolCall, 'the user did not allow this call.');
    onToolCallUpdate?.(result.toolCall);
    return result;
  }

  onToolCallUpdate?.({
    id: toolCall.id,
    name,
    argumentsJson: toolCall.function.arguments,
    status: 'running',
  });

  const result = await executeRegistryToolCall(toolCall, registry, databaseToolContext);
  onToolCallUpdate?.(result.toolCall);
  return result;
}

interface AssistantTurn {
  content: string;
  toolCalls: ChatCompletionToolCall[];
  missingResponse?: boolean;
}

export async function runAiChatCompletion({
  messages,
  createChatCompletion,
  createChatCompletionStream,
  databaseToolContext,
  registry = createDefaultToolRegistry(),
  evaluateConsent = defaultEvaluateConsent,
  requestConsent,
  onToolCallUpdate,
  abortSignal,
  maxToolRounds = DEFAULT_TOOL_CALL_LIMIT,
  maxOutputTokens = AI_OUTPUT_LIMIT_PRESETS.medium.tokens,
  onAssistantDelta,
}: RunAiChatOptions): Promise<AiChatRunResult> {
  const systemPrompt = await buildSystemPrompt(databaseToolContext);
  const conversation = toWllamaMessages(messages, systemPrompt);
  const tools = registry.toChatTools();
  const toolCalls: AiToolCallRecord[] = [];
  const classificationSuggestions: TransactionClassificationSuggestion[] = [];
  const merchantRuleSuggestions: MerchantRuleSuggestion[] = [];
  const tokenUsage: Required<AiChatTokenUsage> = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };

  const finish = (assistantMessage: string): AiChatRunResult => ({
    assistantMessage,
    toolCalls,
    classificationSuggestions,
    merchantRuleSuggestions,
    tokenUsage,
  });

  const nextAssistantTurn = async (toolChoice: 'auto' | 'none'): Promise<AssistantTurn> => {
    if (createChatCompletionStream) {
      return streamAssistantTurn({
        conversation,
        createChatCompletionStream,
        abortSignal,
        onAssistantDelta,
        tokenUsage,
        maxOutputTokens,
        tools,
        toolChoice,
      });
    }

    const response = await createChatCompletion({
      messages: conversation,
      tools,
      tool_choice: toolChoice,
      temperature: 0.2,
      max_tokens: maxOutputTokens,
      abortSignal,
    });
    addResponseUsage(tokenUsage, response);

    const assistantMessage = response.choices[0]?.message;
    if (!assistantMessage) {
      return { content: '', toolCalls: [], missingResponse: true };
    }
    return {
      content: assistantMessage.content ?? '',
      toolCalls: assistantMessage.tool_calls ?? [],
    };
  };

  // `maxToolRounds` rounds may use tools; the turn after the last one is the
  // model's chance to answer, with tools withheld and a nudge to stop asking.
  for (let round = 0; ; round += 1) {
    const mustAnswer = round >= maxToolRounds;
    if (mustAnswer) {
      conversation.push({ role: 'user', content: buildToolLimitNudge(maxToolRounds) });
    }

    const assistantTurn = await nextAssistantTurn(mustAnswer ? 'none' : 'auto');

    if (assistantTurn.missingResponse) {
      return finish('The model did not return a response.');
    }

    if (assistantTurn.toolCalls.length === 0) {
      return finish(assistantTurn.content);
    }

    if (mustAnswer) {
      log.warn('Model kept requesting tools after the limit', { operation: 'runAiChatCompletion', maxToolRounds });
      onAssistantDelta?.(TOOL_LIMIT_MESSAGE);
      return finish(TOOL_LIMIT_MESSAGE);
    }

    conversation.push({
      role: 'assistant',
      content: assistantTurn.content || null,
      tool_calls: assistantTurn.toolCalls,
    });

    for (const toolCall of assistantTurn.toolCalls) {
      if (abortSignal?.aborted) {
        throw new DOMException('The AI request was aborted', 'AbortError');
      }

      const result = await handleToolCall(toolCall, {
        registry,
        databaseToolContext,
        evaluateConsent,
        requestConsent,
        onToolCallUpdate,
        abortSignal,
      });
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
}
