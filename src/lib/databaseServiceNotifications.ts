import type { DatabaseWorkerTransport } from './databaseService';
import { NOTIFICATION_QUERIES } from './sqlQueriesNotifications';
import type {
  AppNotification,
  AppNotificationInput,
  NotificationSetting,
  NotificationStatus,
} from '../types/database';

type NotificationsTransport = Pick<DatabaseWorkerTransport, 'query'>;

/**
 * Built-in per-type defaults, merged under whatever rows exist in
 * `notification_settings`. Types mirror `notifications.type`.
 */
export const DEFAULT_NOTIFICATION_SETTINGS: ReadonlyArray<NotificationSetting> = [
  { type: 'birthday', enabled: 1, lead_days: 14, os_notify: 0 },
  { type: 'anniversary', enabled: 1, lead_days: 14, os_notify: 0 },
  { type: 'seasonal', enabled: 1, lead_days: 30, os_notify: 0 },
  { type: 'custom', enabled: 1, lead_days: 7, os_notify: 0 },
  { type: 'overdue_payment', enabled: 1, lead_days: 3, os_notify: 0 },
  { type: 'budget_overspend', enabled: 1, lead_days: 0, os_notify: 0 },
];

/**
 * CRUD for `notifications` and `notification_settings` (schema v3). The scan
 * that decides *what* to notify lives in the notifications feature; this class
 * only knows rows.
 */
export class NotificationsService {
  constructor(private readonly worker: NotificationsTransport) {}

  async list(filter?: { status?: NotificationStatus }): Promise<AppNotification[]> {
    const rows = filter?.status
      ? await this.worker.query(NOTIFICATION_QUERIES.LIST_BY_STATUS, [filter.status])
      : await this.worker.query(NOTIFICATION_QUERIES.LIST_ALL);
    return rows.map(mapToAppNotification);
  }

  async getById(id: number): Promise<AppNotification | null> {
    const rows = await this.worker.query(NOTIFICATION_QUERIES.GET_BY_ID, [id]);
    return rows.length > 0 ? mapToAppNotification(rows[0]) : null;
  }

  async getByDedupeKey(dedupeKey: string): Promise<AppNotification | null> {
    const rows = await this.worker.query(NOTIFICATION_QUERIES.GET_BY_DEDUPE_KEY, [dedupeKey]);
    return rows.length > 0 ? mapToAppNotification(rows[0]) : null;
  }

  async create(input: AppNotificationInput): Promise<number> {
    const rows = await this.worker.query(NOTIFICATION_QUERIES.CREATE, toWriteParams(input));
    return Number(rows[0].id);
  }

  async update(id: number, input: AppNotificationInput): Promise<void> {
    await this.worker.query(NOTIFICATION_QUERIES.UPDATE, [...toWriteParams(input), id]);
  }

  /** Insert-or-refresh a system alert; user state (status/snooze) is kept on conflict. */
  async upsertByDedupeKey(input: AppNotificationInput & { dedupe_key: string }): Promise<number> {
    const rows = await this.worker.query(
      NOTIFICATION_QUERIES.UPSERT_BY_DEDUPE_KEY,
      toWriteParams({ ...input, source: input.source ?? 'system' })
    );
    return Number(rows[0].id);
  }

  async setStatus(id: number, status: NotificationStatus, snoozedUntil: string | null = null): Promise<void> {
    await this.worker.query(NOTIFICATION_QUERIES.SET_STATUS, [
      status,
      status === 'snoozed' ? snoozedUntil : null,
      id,
    ]);
  }

  async markNotified(id: number): Promise<void> {
    await this.worker.query(NOTIFICATION_QUERIES.SET_LAST_NOTIFIED, [id]);
  }

  async remove(id: number): Promise<void> {
    await this.worker.query(NOTIFICATION_QUERIES.DELETE, [id]);
  }

  /** Drop system alerts whose dedupe_key starts with `prefix` (e.g. 'overdue:series:12:'). */
  async removeSystemByDedupePrefix(prefix: string): Promise<void> {
    await this.worker.query(NOTIFICATION_QUERIES.DELETE_BY_DEDUPE_PREFIX, [`${prefix}%`]);
  }

  /** Stored rows merged over DEFAULT_NOTIFICATION_SETTINGS, so every known type is present. */
  async getSettings(): Promise<NotificationSetting[]> {
    const rows = await this.worker.query(NOTIFICATION_QUERIES.SETTINGS_LIST);
    const stored = new Map<string, NotificationSetting>(
      rows.map((row: any) => [String(row.type), mapToNotificationSetting(row)])
    );
    const merged = DEFAULT_NOTIFICATION_SETTINGS.map((setting) => stored.get(setting.type) ?? { ...setting });
    for (const [type, setting] of stored) {
      if (!merged.some((entry) => entry.type === type)) merged.push(setting);
    }
    return merged;
  }

  async upsertSetting(setting: NotificationSetting): Promise<void> {
    await this.worker.query(NOTIFICATION_QUERIES.SETTINGS_UPSERT, [
      setting.type,
      setting.enabled ? 1 : 0,
      setting.lead_days,
      setting.os_notify ? 1 : 0,
    ]);
  }
}

function toWriteParams(input: AppNotificationInput): unknown[] {
  return [
    input.kind,
    input.type,
    input.title,
    input.body ?? null,
    input.due_date ?? null,
    input.recurrence ?? 'once',
    input.lead_days ?? null,
    input.status ?? 'active',
    input.snoozed_until ?? null,
    input.source ?? 'user',
    input.dedupe_key ?? null,
    input.entity_table ?? null,
    input.entity_id ?? null,
    input.payload_json ?? null,
  ];
}

export function mapToAppNotification(row: any): AppNotification {
  return {
    id: Number(row.id),
    kind: row.kind,
    type: String(row.type),
    title: String(row.title),
    body: row.body ?? null,
    due_date: row.due_date ?? null,
    recurrence: row.recurrence ?? 'once',
    lead_days: row.lead_days != null ? Number(row.lead_days) : null,
    status: row.status ?? 'active',
    snoozed_until: row.snoozed_until ?? null,
    source: row.source ?? 'user',
    dedupe_key: row.dedupe_key ?? null,
    entity_table: row.entity_table ?? null,
    entity_id: row.entity_id != null ? Number(row.entity_id) : null,
    payload_json: row.payload_json ?? null,
    last_notified_at: row.last_notified_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function mapToNotificationSetting(row: any): NotificationSetting {
  return {
    type: String(row.type),
    enabled: Number(row.enabled ?? 1),
    lead_days: Number(row.lead_days ?? 7),
    os_notify: Number(row.os_notify ?? 0),
    updated_at: row.updated_at,
  };
}
