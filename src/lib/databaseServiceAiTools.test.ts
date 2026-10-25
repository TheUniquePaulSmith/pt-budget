import { describe, expect, it, vi } from 'vitest';

import { DatabaseService, type DatabaseWorkerTransport } from './databaseService';
import { DEFAULT_TOOL_CALL_LIMIT, MAX_TOOL_CALL_LIMIT } from './aiTools/toolCallLimit';
import { AI_PROVIDER_CONFIG_KEY, AI_TOOL_CALL_LIMIT_KEY, AiToolsService } from './databaseServiceAiTools';
import { AppMetadataService } from './databaseServiceAppMetadata';
import { AI_TOOL_QUERIES } from './sqlQueriesAiTools';
import { APP_METADATA_QUERIES } from './sqlQueriesAppMetadata';

const packRow = {
  id: 1,
  pack_key: 'community.reports',
  name: 'Community reports',
  version: '1.0.0',
  source: 'user',
  enabled: 1,
  definition_json: '{"tools":[]}',
  created_at: 'now',
  updated_at: 'now',
};

function createQuerySpy(rowsBySql: Record<string, unknown[]> = {}) {
  return vi.fn(async (sql: string) => rowsBySql[sql] ?? []);
}

function createService(query: ReturnType<typeof createQuerySpy>) {
  return new AiToolsService({ query }, new AppMetadataService({ query }));
}

describe('AiToolsService', () => {
  it('lists, fetches, upserts, toggles and deletes tool packs', async () => {
    const query = createQuerySpy({
      [AI_TOOL_QUERIES.PACKS_LIST]: [packRow],
      [AI_TOOL_QUERIES.PACK_GET_BY_KEY]: [packRow],
      [AI_TOOL_QUERIES.PACK_UPSERT]: [{ id: 1 }],
    });
    const service = createService(query);

    await expect(service.listPacks()).resolves.toEqual([
      expect.objectContaining({ pack_key: 'community.reports', enabled: 1, source: 'user' }),
    ]);
    await expect(service.getPack('community.reports')).resolves.toMatchObject({ id: 1 });

    await expect(
      service.upsertPack({ pack_key: 'community.reports', name: 'Community reports', definition_json: '{"tools":[]}' })
    ).resolves.toBe(1);
    expect(query).toHaveBeenCalledWith(AI_TOOL_QUERIES.PACK_UPSERT, [
      'community.reports', 'Community reports', null, 'user', 1, '{"tools":[]}',
    ]);

    await service.upsertPack({
      pack_key: 'builtin.core', name: 'Core', version: '2', source: 'builtin', enabled: false, definition_json: '{}',
    });
    expect(query).toHaveBeenCalledWith(AI_TOOL_QUERIES.PACK_UPSERT, ['builtin.core', 'Core', '2', 'builtin', 0, '{}']);

    await service.setPackEnabled('community.reports', false);
    expect(query).toHaveBeenCalledWith(AI_TOOL_QUERIES.PACK_SET_ENABLED, [0, 'community.reports']);

    await service.deletePack('community.reports');
    expect(query).toHaveBeenCalledWith(AI_TOOL_QUERIES.SETTINGS_DELETE_FOR_PACK, ['community.reports']);
    expect(query).toHaveBeenCalledWith(AI_TOOL_QUERIES.PACK_DELETE, ['community.reports']);
  });

  it('manages per-tool settings', async () => {
    const query = createQuerySpy({
      [AI_TOOL_QUERIES.SETTINGS_LIST]: [
        { tool_name: 'delete_transaction', pack_key: null, enabled: 0, consent: 'ask', updated_at: 'now' },
      ],
    });
    const service = createService(query);

    await expect(service.listToolSettings()).resolves.toEqual([
      { tool_name: 'delete_transaction', pack_key: null, enabled: 0, consent: 'ask', updated_at: 'now' },
    ]);

    await service.upsertToolSetting({ tool_name: 'query_transactions', pack_key: null, enabled: 1, consent: 'always' });
    expect(query).toHaveBeenCalledWith(AI_TOOL_QUERIES.SETTINGS_UPSERT, ['query_transactions', null, 1, 'always']);

    await service.deleteToolSetting('query_transactions');
    expect(query).toHaveBeenCalledWith(AI_TOOL_QUERIES.SETTINGS_DELETE, ['query_transactions']);
  });

  it('stores the provider configuration as JSON in app_metadata', async () => {
    const query = createQuerySpy();
    const service = createService(query);

    await expect(service.getProviderConfig()).resolves.toBeNull();

    await service.setProviderConfig({ activeProfileId: 'p1', profiles: [{ id: 'p1', kind: 'anthropic' }] });
    expect(query).toHaveBeenCalledWith(APP_METADATA_QUERIES.SET, [
      AI_PROVIDER_CONFIG_KEY,
      JSON.stringify({ activeProfileId: 'p1', profiles: [{ id: 'p1', kind: 'anthropic' }] }),
    ]);

    query.mockResolvedValueOnce([{ value: '{"activeProfileId":"p1"}' }]);
    await expect(service.getProviderConfig<{ activeProfileId: string }>()).resolves.toEqual({ activeProfileId: 'p1' });

    await service.clearProviderConfig();
    expect(query).toHaveBeenCalledWith(APP_METADATA_QUERIES.DELETE, [AI_PROVIDER_CONFIG_KEY]);
  });

  it('stores the tool-call limit as a clamped JSON number and defaults when unset or invalid', async () => {
    const query = createQuerySpy();
    const service = createService(query);

    await expect(service.getToolCallLimit()).resolves.toBe(DEFAULT_TOOL_CALL_LIMIT);

    await service.setToolCallLimit(12);
    expect(query).toHaveBeenCalledWith(APP_METADATA_QUERIES.SET, [AI_TOOL_CALL_LIMIT_KEY, '12']);

    await service.setToolCallLimit(500);
    expect(query).toHaveBeenCalledWith(APP_METADATA_QUERIES.SET, [AI_TOOL_CALL_LIMIT_KEY, String(MAX_TOOL_CALL_LIMIT)]);

    query.mockResolvedValueOnce([{ value: '6' }]);
    await expect(service.getToolCallLimit()).resolves.toBe(6);

    query.mockResolvedValueOnce([{ value: '"lots"' }]);
    await expect(service.getToolCallLimit()).resolves.toBe(DEFAULT_TOOL_CALL_LIMIT);
  });

  it('is composed into DatabaseService sharing the app metadata service', async () => {
    const query = createQuerySpy();
    const service = new DatabaseService({ query } as unknown as DatabaseWorkerTransport);

    await service.aiTools.setProviderConfig({ ok: true });
    expect(query).toHaveBeenCalledWith(APP_METADATA_QUERIES.SET, [AI_PROVIDER_CONFIG_KEY, '{"ok":true}']);
  });
});
