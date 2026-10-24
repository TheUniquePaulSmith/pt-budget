import { describe, expect, it, vi } from 'vitest';

import { DatabaseService, type DatabaseWorkerTransport } from './databaseService';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NotificationsService,
  mapToAppNotification,
} from './databaseServiceNotifications';
import { NOTIFICATION_QUERIES } from './sqlQueriesNotifications';

const notificationRow = {
  id: 7,
  kind: 'reminder',
  type: 'birthday',
  title: "Mom's birthday",
  body: null,
  due_date: '2026-11-02',
  recurrence: 'yearly',
  lead_days: null,
  status: 'active',
  snoozed_until: null,
  source: 'user',
  dedupe_key: null,
  entity_table: null,
  entity_id: null,
  payload_json: null,
  last_notified_at: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
};

function createQuerySpy(rowsBySql: Record<string, unknown[]> = {}) {
  return vi.fn(async (sql: string, _params?: unknown[]) => rowsBySql[sql] ?? []);
}

describe('NotificationsService', () => {
  it('lists all rows or rows filtered by status', async () => {
    const query = createQuerySpy({
      [NOTIFICATION_QUERIES.LIST_ALL]: [notificationRow],
      [NOTIFICATION_QUERIES.LIST_BY_STATUS]: [{ ...notificationRow, id: 8, status: 'snoozed', snoozed_until: '2026-10-20' }],
    });
    const service = new NotificationsService({ query });

    const all = await service.list();
    expect(all).toEqual([mapToAppNotification(notificationRow)]);
    expect(all[0]).toMatchObject({ id: 7, kind: 'reminder', recurrence: 'yearly', lead_days: null, entity_id: null });

    const snoozed = await service.list({ status: 'snoozed' });
    expect(query).toHaveBeenCalledWith(NOTIFICATION_QUERIES.LIST_BY_STATUS, ['snoozed']);
    expect(snoozed[0]).toMatchObject({ id: 8, status: 'snoozed', snoozed_until: '2026-10-20' });
  });

  it('creates a reminder with defaults filled in and returns the new id', async () => {
    const query = createQuerySpy({ [NOTIFICATION_QUERIES.CREATE]: [{ id: 42 }] });
    const service = new NotificationsService({ query });

    const id = await service.create({ kind: 'reminder', type: 'custom', title: 'Winterize irrigation', due_date: '2026-10-15' });

    expect(id).toBe(42);
    expect(query).toHaveBeenCalledWith(NOTIFICATION_QUERIES.CREATE, [
      'reminder',
      'custom',
      'Winterize irrigation',
      null,
      '2026-10-15',
      'once',
      null,
      'active',
      null,
      'user',
      null,
      null,
      null,
      null,
    ]);
  });

  it('updates a row in place and keeps explicit values', async () => {
    const query = createQuerySpy();
    const service = new NotificationsService({ query });

    await service.update(7, {
      kind: 'reminder',
      type: 'birthday',
      title: "Mom's birthday",
      recurrence: 'yearly',
      lead_days: 21,
      status: 'snoozed',
      snoozed_until: '2026-10-25',
    });

    const [, params] = query.mock.calls[0];
    expect(query.mock.calls[0][0]).toBe(NOTIFICATION_QUERIES.UPDATE);
    expect(params).toEqual([
      'reminder', 'birthday', "Mom's birthday", null, null, 'yearly', 21, 'snoozed', '2026-10-25', 'user', null, null, null, null, 7,
    ]);
  });

  it('upserts system alerts on their dedupe key with source defaulting to system', async () => {
    const query = createQuerySpy({ [NOTIFICATION_QUERIES.UPSERT_BY_DEDUPE_KEY]: [{ id: 9 }] });
    const service = new NotificationsService({ query });

    const id = await service.upsertByDedupeKey({
      kind: 'alert',
      type: 'overdue_payment',
      title: 'Electric bill is overdue',
      due_date: '2026-10-01',
      dedupe_key: 'overdue:series:12:2026-10-01',
      entity_table: 'recurring_series',
      entity_id: 12,
    });

    expect(id).toBe(9);
    const [, params] = query.mock.calls[0];
    expect(params).toEqual([
      'alert', 'overdue_payment', 'Electric bill is overdue', null, '2026-10-01', 'once', null, 'active', null,
      'system', 'overdue:series:12:2026-10-01', 'recurring_series', 12, null,
    ]);
  });

  it('sets status, clearing the snooze date unless the new status is snoozed', async () => {
    const query = createQuerySpy();
    const service = new NotificationsService({ query });

    await service.setStatus(7, 'snoozed', '2026-10-30');
    expect(query).toHaveBeenCalledWith(NOTIFICATION_QUERIES.SET_STATUS, ['snoozed', '2026-10-30', 7]);

    await service.setStatus(7, 'done', '2026-10-30');
    expect(query).toHaveBeenCalledWith(NOTIFICATION_QUERIES.SET_STATUS, ['done', null, 7]);

    await service.markNotified(7);
    expect(query).toHaveBeenCalledWith(NOTIFICATION_QUERIES.SET_LAST_NOTIFIED, [7]);

    await service.remove(7);
    expect(query).toHaveBeenCalledWith(NOTIFICATION_QUERIES.DELETE, [7]);

    await service.removeSystemByDedupePrefix('overdue:series:12:');
    expect(query).toHaveBeenCalledWith(NOTIFICATION_QUERIES.DELETE_BY_DEDUPE_PREFIX, ['overdue:series:12:%']);
  });

  it('looks up single rows by id and dedupe key', async () => {
    const query = createQuerySpy({
      [NOTIFICATION_QUERIES.GET_BY_ID]: [notificationRow],
      [NOTIFICATION_QUERIES.GET_BY_DEDUPE_KEY]: [],
    });
    const service = new NotificationsService({ query });

    await expect(service.getById(7)).resolves.toMatchObject({ id: 7 });
    await expect(service.getByDedupeKey('nope')).resolves.toBeNull();
  });

  it('merges stored settings over the built-in defaults and keeps unknown types', async () => {
    const query = createQuerySpy({
      [NOTIFICATION_QUERIES.SETTINGS_LIST]: [
        { type: 'birthday', enabled: 0, lead_days: 30, os_notify: 1, updated_at: 'now' },
        { type: 'custom_plugin', enabled: 1, lead_days: 2, os_notify: 0, updated_at: 'now' },
      ],
    });
    const service = new NotificationsService({ query });

    const settings = await service.getSettings();

    expect(settings.find((s) => s.type === 'birthday')).toMatchObject({ enabled: 0, lead_days: 30, os_notify: 1 });
    expect(settings.find((s) => s.type === 'overdue_payment')).toMatchObject(
      DEFAULT_NOTIFICATION_SETTINGS.find((s) => s.type === 'overdue_payment')!
    );
    expect(settings.map((s) => s.type)).toEqual([...DEFAULT_NOTIFICATION_SETTINGS.map((s) => s.type), 'custom_plugin']);

    await service.upsertSetting({ type: 'birthday', enabled: 1, lead_days: 10, os_notify: 0 });
    expect(query).toHaveBeenCalledWith(NOTIFICATION_QUERIES.SETTINGS_UPSERT, ['birthday', 1, 10, 0]);
  });

  it('is exposed on DatabaseService with a getNotifications facade for cached collections', async () => {
    const query = createQuerySpy({ [NOTIFICATION_QUERIES.LIST_ALL]: [notificationRow] });
    const service = new DatabaseService({ query } as unknown as DatabaseWorkerTransport);

    await expect(service.getNotifications()).resolves.toEqual([mapToAppNotification(notificationRow)]);
    expect(service.notifications).toBeInstanceOf(NotificationsService);
  });
});
