# Templates (modelled on the loans domain)

Replace `Widget`/`widget`/`WIDGET` with the domain name. Compare with the real loans files when in doubt:
`src/lib/sqlQueriesLoans.ts`, `src/lib/databaseServiceLoans.ts`, `src/lib/databaseServiceLoans.test.ts`,
`src/contexts/useDatabaseLoansSlice.ts`, `src/contexts/useLoansSlices.ts`.

## SQL module: `src/lib/sqlQueriesWidgets.ts`

```ts
// Widgets (schema vN): what this domain stores.
// Owned by the widgets feature; re-exported from the sqlQueries.ts hub.

export const WIDGET_QUERIES = {
  LIST: `SELECT w.*, a.currency AS account_currency
           FROM widgets w LEFT JOIN accounts a ON a.id = w.account_id
          ORDER BY w.name COLLATE NOCASE`,
  GET_BY_ID: `SELECT * FROM widgets WHERE id = ?`,
  CREATE: `INSERT INTO widgets (name, account_id, amount, created_at, updated_at)
           VALUES (?, ?, ?, datetime('now'), datetime('now'))
           RETURNING id`,
  UPDATE: `UPDATE widgets SET name = ?, account_id = ?, amount = ?, updated_at = datetime('now') WHERE id = ?`,
  DELETE: `DELETE FROM widgets WHERE id = ?`,
} as const;
```

Hub: add `export { WIDGET_QUERIES } from './sqlQueriesWidgets';` to `src/lib/sqlQueries.ts`.

## Service: `src/lib/databaseServiceWidgets.ts`

```ts
import type { DatabaseWorkerTransport } from './databaseService';
import { WIDGET_QUERIES } from './sqlQueriesWidgets';
import { logger } from './logging';
import type { Widget, WidgetInput } from '../types/database';

type WidgetsTransport = Pick<DatabaseWorkerTransport, 'query'>;

const log = logger.child({ component: 'WidgetsService' });

export function mapToWidget(row: any): Widget {
  return {
    id: Number(row.id),
    name: String(row.name),
    account_id: row.account_id == null ? null : Number(row.account_id),
    amount: Number(row.amount ?? 0),
    account_currency: row.account_currency ?? undefined,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

function validate(input: WidgetInput): void {
  // Throw codes or plain English; the component maps codes to t('widgets:errors.<code>').
  if (!input.name?.trim()) throw new Error('WIDGET_NAME_REQUIRED');
}

export class WidgetsService {
  constructor(private readonly worker: WidgetsTransport) {}

  async list(): Promise<Widget[]> {
    return (await this.worker.query(WIDGET_QUERIES.LIST)).map(mapToWidget);
  }

  async create(input: WidgetInput): Promise<number> {
    validate(input);
    const rows = await this.worker.query(WIDGET_QUERIES.CREATE, [input.name.trim(), input.account_id ?? null, input.amount]);
    const id = Number(rows[0].id);
    log.withOperation('createWidget').info('Created widget', { id });
    return id;
  }

  async remove(id: number): Promise<void> {
    await this.worker.query(WIDGET_QUERIES.DELETE, [id]);
  }
}
```

Compose it in `databaseService.ts`: `import { WidgetsService } from './databaseServiceWidgets';`, add
`readonly widgets: WidgetsService;` with a doc comment, and in the constructor `this.widgets = new WidgetsService(workerService);`.
Inserts use `RETURNING id` (as `LOAN_QUERIES.CREATE` does) rather than a second `last_insert_rowid()` round trip.

## Service test: `src/lib/databaseServiceWidgets.test.ts` (transport stub)

```ts
import { describe, expect, it, vi } from 'vitest';

import { WidgetsService, mapToWidget } from './databaseServiceWidgets';
import { WIDGET_QUERIES } from './sqlQueriesWidgets';

type Rows = Record<string, unknown[] | ((params?: unknown[]) => unknown[])>;

function createWorker(rowsBySql: Rows = {}) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    const entry = rowsBySql[sql];
    if (typeof entry === 'function') return entry(params);
    return entry ?? [];
  });
  return { query };
}

describe('WidgetsService', () => {
  it('maps rows, including nulls', async () => {
    const worker = createWorker({ [WIDGET_QUERIES.LIST]: [{ id: 1, name: 'A', account_id: null, amount: null }] });
    const [widget] = await new WidgetsService(worker).list();
    expect(widget).toMatchObject({ id: 1, name: 'A', account_id: null, amount: 0 });
  });

  it('rejects a blank name before touching the database', async () => {
    const worker = createWorker();
    await expect(new WidgetsService(worker).create({ name: ' ', amount: 1 } as any)).rejects.toThrow('WIDGET_NAME_REQUIRED');
    expect(worker.query).not.toHaveBeenCalled();
  });
});
```

To test through the full `DatabaseService`, use `new DatabaseService({ query } as DatabaseWorkerTransport)`, the same stub pattern.

## Provider slice: `src/contexts/useDatabaseWidgetsSlice.ts`

```ts
"use client";

import { useCallback, useMemo } from 'react';

import type { DatabaseService } from '../lib/databaseService';
import type { Widget, WidgetInput } from '../types/database';

/** Provider-domain slice for widgets. Mutations refresh the cached `widgets` collection. */
export interface DatabaseWidgetsSlice {
  addWidget: (input: WidgetInput) => Promise<number>;
  deleteWidget: (id: number) => Promise<void>;
}

interface UseDatabaseWidgetsSliceOptions {
  databaseService: Pick<DatabaseService, 'widgets'> | null;
  refreshWidgets: () => Promise<void>;
}

export function useDatabaseWidgetsSlice({ databaseService, refreshWidgets }: UseDatabaseWidgetsSliceOptions): DatabaseWidgetsSlice {
  const requireService = useCallback(() => {
    if (!databaseService) throw new Error('Database service not initialized');
    return databaseService.widgets;
  }, [databaseService]);

  const addWidget = useCallback(async (input: WidgetInput) => {
    const id = await requireService().create(input);
    await refreshWidgets();
    return id;
  }, [refreshWidgets, requireService]);

  const deleteWidget = useCallback(async (id: number) => {
    await requireService().remove(id);
    await refreshWidgets();
  }, [refreshWidgets, requireService]);

  return useMemo(() => ({ addWidget, deleteWidget }), [addWidget, deleteWidget]);
}
```

`DatabaseContext.tsx` wiring, following the loans lines:
1. Import `useDatabaseWidgetsSlice, type DatabaseWidgetsSlice`.
2. Add `widgets: DatabaseWidgetsSlice` to the aggregate type.
3. `const DatabaseWidgetsContext = createContext<DatabaseWidgetsSlice | null>(null);`
4. `export const useDatabaseWidgets = () => useRequiredContext(DatabaseWidgetsContext, 'useDatabaseWidgets');`
5. Add `widgets: useDatabaseWidgets()` to the compatibility aggregator.
6. `const widgetsSlice = useDatabaseWidgetsSlice({ databaseService, refreshWidgets });`
7. Wrap the tree in `<DatabaseWidgetsContext.Provider value={widgetsSlice}>`.

`useDatabaseCollectionsState.ts`: the `widgets: Widget[]` field, `useState`, the entry in the parallel initial load
(`service.widgets.list()`), and a `refreshWidgets` callback that logs failures with `log.error(…, { operation: 'refreshWidgets', error })`.

## Page-facing slice: `src/contexts/useWidgetsSlices.ts`

```ts
'use client';

// Page-facing slices for widgets. Re-exported from useDatabaseSlices.ts (the hub).

import { useDatabaseCollections, useDatabaseWidgets } from './DatabaseContext';

export function useWidgetsPageSlice() {
  const collections = useDatabaseCollections();
  const widgets = useDatabaseWidgets();
  return {
    widgets: collections.widgets,
    accounts: collections.accounts,
    addWidget: widgets.addWidget,
    deleteWidget: widgets.deleteWidget,
  };
}
```

Hub: `export { useWidgetsPageSlice } from './useWidgetsSlices';` in `useDatabaseSlices.ts`.
