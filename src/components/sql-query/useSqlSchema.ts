'use client';

import { useCallback, useEffect, useState } from 'react';

import { fetchSqlSchema, type SqlSchemaMap } from '@/lib/sqlSchemaIntrospection';

export interface UseSqlSchemaResult {
  schema: SqlSchemaMap | null;
  schemaError: string | null;
  schemaLoading: boolean;
  refreshSchema: () => Promise<void>;
}

export function useSqlSchema(
  executeCustomQuery: (sql: string, timeoutMs?: number) => Promise<unknown[]>,
  isDatabaseLoaded: boolean
): UseSqlSchemaResult {
  const [schema, setSchema] = useState<SqlSchemaMap | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);

  const refreshSchema = useCallback(async () => {
    if (!isDatabaseLoaded) {
      return;
    }
    setSchemaLoading(true);
    setSchemaError(null);
    try {
      const nextSchema = await fetchSqlSchema(executeCustomQuery);
      setSchema(nextSchema);
    } catch (err) {
      setSchemaError(err instanceof Error ? err.message : 'Failed to load database schema');
    } finally {
      setSchemaLoading(false);
    }
  }, [executeCustomQuery, isDatabaseLoaded]);

  useEffect(() => {
    if (isDatabaseLoaded) {
      void refreshSchema();
    } else {
      setSchema(null);
      setSchemaError(null);
    }
    // Deliberately only re-runs when the database's loaded state flips, not
    // on every `refreshSchema` identity change — this is a one-shot fetch
    // per database (re)load, not something to chase on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDatabaseLoaded]);

  return { schema, schemaError, schemaLoading, refreshSchema };
}
