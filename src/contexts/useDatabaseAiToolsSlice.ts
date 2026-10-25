"use client";

import { useCallback, useMemo } from 'react';

import type { DatabaseService } from '../lib/databaseService';
import type { AiToolPack, AiToolPackInput, AiToolSetting } from '../types/database';
import type { AiToolPackResultMode } from '../types/aiTools';

/**
 * Provider-domain slice for the AI tool registry and provider configuration
 * (schema v3). Nothing here is a cached collection: the AI panel reads on
 * open. Owned by the AI feature after the foundation lands.
 */
export interface DatabaseAiToolsSlice {
  listToolPacks: () => Promise<AiToolPack[]>;
  getToolPack: (packKey: string) => Promise<AiToolPack | null>;
  upsertToolPack: (input: AiToolPackInput) => Promise<number>;
  setToolPackEnabled: (packKey: string, enabled: boolean) => Promise<void>;
  deleteToolPack: (packKey: string) => Promise<void>;
  listToolSettings: () => Promise<AiToolSetting[]>;
  upsertToolSetting: (setting: AiToolSetting) => Promise<void>;
  deleteToolSetting: (toolName: string) => Promise<void>;
  executeToolPackSql: (
    sql: string,
    params: Array<string | number | boolean | null>,
    resultMode: AiToolPackResultMode
  ) => Promise<unknown>;
  getAiProviderConfig: <T = unknown>() => Promise<T | null>;
  setAiProviderConfig: (config: unknown) => Promise<void>;
  clearAiProviderConfig: () => Promise<void>;
}

type AiToolsService = Pick<DatabaseService, 'aiTools'>;

interface UseDatabaseAiToolsSliceOptions {
  databaseService: AiToolsService | null;
}

export function useDatabaseAiToolsSlice({
  databaseService,
}: UseDatabaseAiToolsSliceOptions): DatabaseAiToolsSlice {
  const requireService = useCallback(() => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    return databaseService.aiTools;
  }, [databaseService]);

  const listToolPacks = useCallback(async () => requireService().listPacks(), [requireService]);
  const getToolPack = useCallback(async (packKey: string) => requireService().getPack(packKey), [requireService]);
  const upsertToolPack = useCallback(
    async (input: AiToolPackInput) => requireService().upsertPack(input),
    [requireService]
  );
  const setToolPackEnabled = useCallback(
    async (packKey: string, enabled: boolean) => requireService().setPackEnabled(packKey, enabled),
    [requireService]
  );
  const deleteToolPack = useCallback(async (packKey: string) => requireService().deletePack(packKey), [requireService]);
  const listToolSettings = useCallback(async () => requireService().listToolSettings(), [requireService]);
  const upsertToolSetting = useCallback(
    async (setting: AiToolSetting) => requireService().upsertToolSetting(setting),
    [requireService]
  );
  const deleteToolSetting = useCallback(
    async (toolName: string) => requireService().deleteToolSetting(toolName),
    [requireService]
  );
  const executeToolPackSql = useCallback(
    async (sql: string, params: Array<string | number | boolean | null>, resultMode: AiToolPackResultMode) =>
      requireService().executePackSql(sql, params, resultMode),
    [requireService]
  );
  const getAiProviderConfig = useCallback(
    async <T = unknown,>() => requireService().getProviderConfig<T>(),
    [requireService]
  );
  const setAiProviderConfig = useCallback(
    async (config: unknown) => requireService().setProviderConfig(config),
    [requireService]
  );
  const clearAiProviderConfig = useCallback(async () => requireService().clearProviderConfig(), [requireService]);

  return useMemo(
    () => ({
      listToolPacks,
      getToolPack,
      upsertToolPack,
      setToolPackEnabled,
      deleteToolPack,
      listToolSettings,
      upsertToolSetting,
      deleteToolSetting,
      executeToolPackSql,
      getAiProviderConfig,
      setAiProviderConfig,
      clearAiProviderConfig,
    }),
    [
      clearAiProviderConfig,
      deleteToolPack,
      deleteToolSetting,
      executeToolPackSql,
      getAiProviderConfig,
      getToolPack,
      listToolPacks,
      listToolSettings,
      setAiProviderConfig,
      setToolPackEnabled,
      upsertToolPack,
      upsertToolSetting,
    ]
  );
}
