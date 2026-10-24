import type { ChatCompletionTool } from '@wllama/wllama/esm';

import type { AiToolPack, AiToolSetting } from '@/types/database';
import type {
  AiResolvedTool,
  AiToolDefinition,
  AiToolPackToolDocument,
} from '@/types/aiTools';
import { BUILTIN_TOOL_DEFINITIONS } from './builtinTools';
import {
  loadToolPackRows,
  packToolDefinitions,
  type FailedToolPack,
  type LoadedToolPack,
} from './jsonToolPack';

export interface AiToolRegistry {
  /** Every known tool with settings applied (enabled or not). */
  tools: AiResolvedTool[];
  /** Tools the model is allowed to see. */
  enabledTools: AiResolvedTool[];
  packs: LoadedToolPack[];
  failedPacks: FailedToolPack[];
  getTool: (name: string) => AiResolvedTool | undefined;
  getPackTool: (name: string) => { pack: LoadedToolPack; tool: AiToolPackToolDocument } | undefined;
  /** OpenAI-shaped tool list for the chat completion request. */
  toChatTools: () => ChatCompletionTool[];
}

export interface ComposeToolRegistryOptions {
  builtinDefinitions?: AiToolDefinition[];
  packRows?: AiToolPack[];
  settings?: AiToolSetting[];
}

export function toChatTool(tool: AiToolDefinition): ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as ChatCompletionTool['function']['parameters'],
    },
  };
}

/**
 * Composes built-in tools with every stored pack, then applies the per-tool
 * `ai_tool_settings` rows. A disabled pack hides all of its tools; a pack tool
 * whose name collides with an earlier tool is dropped with an error.
 */
export function composeToolRegistry(options: ComposeToolRegistryOptions = {}): AiToolRegistry {
  const builtinDefinitions = options.builtinDefinitions ?? BUILTIN_TOOL_DEFINITIONS;
  const { loaded, failed } = loadToolPackRows(options.packRows ?? []);
  const settingsByName = new Map((options.settings ?? []).map((setting) => [setting.tool_name, setting]));

  const definitions: AiToolDefinition[] = [...builtinDefinitions];
  const seen = new Set(definitions.map((tool) => tool.name));
  const packToolIndex = new Map<string, { pack: LoadedToolPack; tool: AiToolPackToolDocument }>();
  const failedPacks: FailedToolPack[] = [...failed];

  for (const pack of loaded) {
    const packEnabled = Number(pack.row.enabled) === 1;
    const collisions: string[] = [];

    for (const definition of packToolDefinitions(pack.document, pack.packKey)) {
      if (seen.has(definition.name)) {
        collisions.push(definition.name);
        continue;
      }
      seen.add(definition.name);
      definitions.push(packEnabled ? definition : { ...definition, enabled: false });
      const tool = pack.document.tools.find((candidate) => candidate.name === definition.name);
      if (tool) {
        packToolIndex.set(definition.name, { pack, tool });
      }
    }

    if (collisions.length > 0) {
      failedPacks.push({
        packKey: pack.packKey,
        packName: pack.document.name,
        errors: collisions.map((name) => ({
          packId: pack.document.id,
          toolName: name,
          message: `${name}: a tool with this name already exists and was skipped`,
        })),
      });
    }
  }

  const tools: AiResolvedTool[] = definitions.map((definition) => {
    const setting = settingsByName.get(definition.name);
    const packDisabled = definition.source === 'pack'
      && definition.packKey !== undefined
      && loaded.some((pack) => pack.packKey === definition.packKey && Number(pack.row.enabled) !== 1);
    return {
      ...definition,
      enabled: packDisabled ? false : setting ? Number(setting.enabled) === 1 : definition.enabled,
      consent: setting?.consent ?? definition.consentDefault,
      hasUserSetting: Boolean(setting),
    };
  });

  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const enabledTools = tools.filter((tool) => tool.enabled);

  return {
    tools,
    enabledTools,
    packs: loaded,
    failedPacks,
    getTool: (name) => byName.get(name),
    getPackTool: (name) => packToolIndex.get(name),
    toChatTools: () => enabledTools.map(toChatTool),
  };
}

/** Built-in tools with their safe defaults; used when no settings are loaded. */
export function createDefaultToolRegistry(): AiToolRegistry {
  return composeToolRegistry();
}
