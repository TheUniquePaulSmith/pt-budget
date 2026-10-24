import type { ChatCompletionToolCall } from '@wllama/wllama/esm';

import {
  executeAiDatabaseToolCall,
  type AiDatabaseToolContext,
  type AiDatabaseToolResult,
  type AiToolExecutor,
} from '@/lib/aiDatabaseTools';
import { getBuiltinToolExecutor, PACK_TOOL_MAX_ROWS } from './builtinTools';
import { bindPackToolArguments } from './jsonToolPack';
import type { AiToolRegistry } from './toolRegistry';

/** Executor for a declarative pack tool: validate + bind args, then run the SQL. */
export function createPackToolExecutor(registry: AiToolRegistry, toolName: string): AiToolExecutor | undefined {
  const entry = registry.getPackTool(toolName);
  if (!entry) {
    return undefined;
  }

  return async (args, context) => {
    const run = context.executeToolPackSql;
    if (!run) {
      throw new Error('Tool packs are not available in this context');
    }
    const bound = bindPackToolArguments(entry.tool, args);
    if (entry.tool.crud === 'read') {
      const rows = await run(`SELECT * FROM (${bound.sql.replace(/;\s*$/, '')}) LIMIT ${PACK_TOOL_MAX_ROWS}`, bound.params, 'rows');
      const list = Array.isArray(rows) ? rows : [];
      return { result: { rows: list, returnedRows: list.length, maxRows: PACK_TOOL_MAX_ROWS } };
    }
    const result = await run(bound.sql, bound.params, entry.tool.resultMode);
    return { result };
  };
}

export function resolveToolExecutor(registry: AiToolRegistry, toolName: string): AiToolExecutor | undefined {
  const tool = registry.getTool(toolName);
  if (!tool) {
    return undefined;
  }
  if (tool.source === 'pack') {
    return createPackToolExecutor(registry, toolName);
  }
  return getBuiltinToolExecutor(toolName);
}

/** Runs a tool call through the registry (built-in or pack). */
export async function executeRegistryToolCall(
  toolCall: ChatCompletionToolCall,
  registry: AiToolRegistry,
  context: AiDatabaseToolContext
): Promise<AiDatabaseToolResult> {
  const executor = resolveToolExecutor(registry, toolCall.function.name);
  if (!executor) {
    return executeAiDatabaseToolCall(toolCall, context, async () => {
      throw new Error(`Unknown AI tool: ${toolCall.function.name}`);
    });
  }
  return executeAiDatabaseToolCall(toolCall, context, executor);
}
