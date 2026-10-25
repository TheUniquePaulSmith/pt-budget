import type { DatabaseWorkerTransport } from './databaseService';
import type { AppMetadataService } from './databaseServiceAppMetadata';
import { normalizeToolCallLimit } from './aiTools/toolCallLimit';
import { AI_TOOL_QUERIES } from './sqlQueriesAiTools';
import type { AiToolPack, AiToolPackInput, AiToolSetting } from '../types/database';
import type { AiToolPackResultMode } from '../types/aiTools';

type AiToolsTransport = Pick<DatabaseWorkerTransport, 'query'>;

/**
 * `app_metadata` key holding the AI provider profiles (JSON). Profiles include
 * API keys, which is why they live in the encrypted database and never in
 * localStorage. The document shape is owned by the AI feature.
 */
export const AI_PROVIDER_CONFIG_KEY = 'ai.provider.config';

/** `app_metadata` key holding the per-question tool-call round limit (a JSON number). */
export const AI_TOOL_CALL_LIMIT_KEY = 'ai.tools.callLimit';

/**
 * Persistence for the AI tool registry (schema v3): user-imported tool packs,
 * per-tool enable/consent settings, and the provider configuration document.
 * Tool execution and consent prompting live in the AI feature.
 */
export class AiToolsService {
  constructor(
    private readonly worker: AiToolsTransport,
    private readonly appMetadata: AppMetadataService
  ) {}

  async listPacks(): Promise<AiToolPack[]> {
    const rows = await this.worker.query(AI_TOOL_QUERIES.PACKS_LIST);
    return rows.map(mapToAiToolPack);
  }

  async getPack(packKey: string): Promise<AiToolPack | null> {
    const rows = await this.worker.query(AI_TOOL_QUERIES.PACK_GET_BY_KEY, [packKey]);
    return rows.length > 0 ? mapToAiToolPack(rows[0]) : null;
  }

  async upsertPack(input: AiToolPackInput): Promise<number> {
    const rows = await this.worker.query(AI_TOOL_QUERIES.PACK_UPSERT, [
      input.pack_key,
      input.name,
      input.version ?? null,
      input.source ?? 'user',
      input.enabled === undefined ? 1 : input.enabled ? 1 : 0,
      input.definition_json,
    ]);
    return Number(rows[0].id);
  }

  async setPackEnabled(packKey: string, enabled: boolean): Promise<void> {
    await this.worker.query(AI_TOOL_QUERIES.PACK_SET_ENABLED, [enabled ? 1 : 0, packKey]);
  }

  /** Removes the pack and the per-tool settings that belonged to it. */
  async deletePack(packKey: string): Promise<void> {
    await this.worker.query(AI_TOOL_QUERIES.SETTINGS_DELETE_FOR_PACK, [packKey]);
    await this.worker.query(AI_TOOL_QUERIES.PACK_DELETE, [packKey]);
  }

  async listToolSettings(): Promise<AiToolSetting[]> {
    const rows = await this.worker.query(AI_TOOL_QUERIES.SETTINGS_LIST);
    return rows.map(mapToAiToolSetting);
  }

  async upsertToolSetting(setting: AiToolSetting): Promise<void> {
    await this.worker.query(AI_TOOL_QUERIES.SETTINGS_UPSERT, [
      setting.tool_name,
      setting.pack_key ?? null,
      setting.enabled ? 1 : 0,
      setting.consent,
    ]);
  }

  async deleteToolSetting(toolName: string): Promise<void> {
    await this.worker.query(AI_TOOL_QUERIES.SETTINGS_DELETE, [toolName]);
  }

  /**
   * Runs one validated, parameter-bound statement from a JSON tool pack.
   * The registry validates the SQL and binds `:param` values positionally
   * before this is called; nothing here interpolates argument text.
   * `rows` returns the result set; `changes` returns `{ changes }` from
   * `changes()` on the same worker connection.
   */
  async executePackSql(
    sql: string,
    params: Array<string | number | boolean | null>,
    resultMode: AiToolPackResultMode
  ): Promise<unknown> {
    const rows = await this.worker.query(sql, params);
    if (resultMode === 'rows') {
      return rows;
    }
    const changed = await this.worker.query('SELECT changes() AS changes');
    return { changes: Number(changed[0]?.changes ?? 0) };
  }

  /** Tool-call round limit per question; the default until the user changes it. */
  async getToolCallLimit(): Promise<number> {
    return normalizeToolCallLimit(await this.appMetadata.getJson<unknown>(AI_TOOL_CALL_LIMIT_KEY, null));
  }

  async setToolCallLimit(limit: number): Promise<void> {
    await this.appMetadata.setJson(AI_TOOL_CALL_LIMIT_KEY, normalizeToolCallLimit(limit));
  }

  /** Provider profiles document; `null` until the user configures a provider. */
  async getProviderConfig<T = unknown>(): Promise<T | null> {
    return this.appMetadata.getJson<T | null>(AI_PROVIDER_CONFIG_KEY, null);
  }

  async setProviderConfig(config: unknown): Promise<void> {
    await this.appMetadata.setJson(AI_PROVIDER_CONFIG_KEY, config);
  }

  async clearProviderConfig(): Promise<void> {
    await this.appMetadata.delete(AI_PROVIDER_CONFIG_KEY);
  }
}

export function mapToAiToolPack(row: any): AiToolPack {
  return {
    id: Number(row.id),
    pack_key: String(row.pack_key),
    name: String(row.name),
    version: row.version ?? null,
    source: row.source ?? 'user',
    enabled: Number(row.enabled ?? 1),
    definition_json: String(row.definition_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function mapToAiToolSetting(row: any): AiToolSetting {
  return {
    tool_name: String(row.tool_name),
    pack_key: row.pack_key ?? null,
    enabled: Number(row.enabled ?? 1),
    consent: row.consent ?? 'ask',
    updated_at: row.updated_at,
  };
}
