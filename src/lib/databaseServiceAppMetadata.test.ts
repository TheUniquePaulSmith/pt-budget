import { describe, expect, it, vi } from 'vitest';

import { DatabaseService, type DatabaseWorkerTransport } from './databaseService';
import { AppMetadataService } from './databaseServiceAppMetadata';
import { APP_METADATA_QUERIES } from './sqlQueriesAppMetadata';

function createQuerySpy(rowsBySql: Record<string, unknown[]> = {}) {
  return vi.fn(async (sql: string) => rowsBySql[sql] ?? []);
}

describe('AppMetadataService', () => {
  it('reads a stored value and returns null when the key is missing', async () => {
    const query = createQuerySpy({ [APP_METADATA_QUERIES.GET]: [{ value: 'v1' }] });
    const service = new AppMetadataService({ query });

    await expect(service.get('seed.version')).resolves.toBe('v1');
    expect(query).toHaveBeenCalledWith(APP_METADATA_QUERIES.GET, ['seed.version']);

    query.mockResolvedValueOnce([]);
    await expect(service.get('missing')).resolves.toBeNull();
  });

  it('upserts, deletes, and lists by prefix', async () => {
    const query = createQuerySpy({
      [APP_METADATA_QUERIES.GET_BY_PREFIX]: [
        { key: 'notifications.enabled', value: '1', updated_at: 'now' },
        { key: 'notifications.os_enabled', value: '0', updated_at: 'now' },
      ],
    });
    const service = new AppMetadataService({ query });

    await service.set('notifications.enabled', '1');
    expect(query).toHaveBeenCalledWith(APP_METADATA_QUERIES.SET, ['notifications.enabled', '1']);

    await service.delete('notifications.enabled');
    expect(query).toHaveBeenCalledWith(APP_METADATA_QUERIES.DELETE, ['notifications.enabled']);

    const entries = await service.getByPrefix('notifications.');
    expect(query).toHaveBeenCalledWith(APP_METADATA_QUERIES.GET_BY_PREFIX, ['notifications.%']);
    expect(entries.map((entry) => entry.key)).toEqual(['notifications.enabled', 'notifications.os_enabled']);
  });

  it('round-trips JSON documents and falls back on missing or corrupt values', async () => {
    const query = createQuerySpy();
    const service = new AppMetadataService({ query });

    await service.setJson('ai.provider.config', { active: 'anthropic', profiles: [] });
    expect(query).toHaveBeenCalledWith(APP_METADATA_QUERIES.SET, [
      'ai.provider.config',
      JSON.stringify({ active: 'anthropic', profiles: [] }),
    ]);

    query.mockResolvedValueOnce([{ value: '{"active":"openai"}' }]);
    await expect(service.getJson('ai.provider.config', null)).resolves.toEqual({ active: 'openai' });

    query.mockResolvedValueOnce([]);
    await expect(service.getJson('ai.provider.config', { active: null })).resolves.toEqual({ active: null });

    query.mockResolvedValueOnce([{ value: '{not json' }]);
    await expect(service.getJson('ai.provider.config', 'fallback')).resolves.toBe('fallback');
  });

  it('is composed into DatabaseService from the same transport', async () => {
    const query = createQuerySpy({ [APP_METADATA_QUERIES.GET]: [{ value: 'shared' }] });
    const service = new DatabaseService({ query } as unknown as DatabaseWorkerTransport);

    await expect(service.appMetadata.get('k')).resolves.toBe('shared');
    expect(query).toHaveBeenCalledWith(APP_METADATA_QUERIES.GET, ['k']);
  });
});
