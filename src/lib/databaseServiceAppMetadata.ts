import type { DatabaseWorkerTransport } from './databaseService';
import { APP_METADATA_QUERIES } from './sqlQueriesAppMetadata';

export interface AppMetadataEntry {
  key: string;
  value: string;
  updated_at: string;
}

type MetadataTransport = Pick<DatabaseWorkerTransport, 'query'>;

/**
 * Key/value access to `app_metadata`, the one settings table. Feature code
 * namespaces its keys ('notifications.*', 'ai.*', 'logging.*') and keeps the
 * key constants in its own module; this service never interprets them.
 */
export class AppMetadataService {
  constructor(private readonly worker: MetadataTransport) {}

  async get(key: string): Promise<string | null> {
    const rows = await this.worker.query(APP_METADATA_QUERIES.GET, [key]);
    return rows.length > 0 ? String(rows[0].value) : null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.worker.query(APP_METADATA_QUERIES.SET, [key, value]);
  }

  async delete(key: string): Promise<void> {
    await this.worker.query(APP_METADATA_QUERIES.DELETE, [key]);
  }

  /** Every entry whose key starts with `prefix` (e.g. 'notifications.'). */
  async getByPrefix(prefix: string): Promise<AppMetadataEntry[]> {
    const rows = await this.worker.query(APP_METADATA_QUERIES.GET_BY_PREFIX, [`${prefix}%`]);
    return rows.map((row: any) => ({
      key: String(row.key),
      value: String(row.value),
      updated_at: String(row.updated_at),
    }));
  }

  /** JSON document under one key; returns `fallback` when missing or unparsable. */
  async getJson<T>(key: string, fallback: T): Promise<T> {
    const raw = await this.get(key);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  async setJson(key: string, value: unknown): Promise<void> {
    await this.set(key, JSON.stringify(value));
  }
}
