// Notifications and reminders (schema v3). Owned by the notifications feature;
// the foundation only ships the basic CRUD the service layer needs.
export const NOTIFICATION_QUERIES = {
  LIST_ALL: `
    SELECT * FROM notifications
    ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'snoozed' THEN 1 ELSE 2 END, due_date ASC, id ASC
  `,
  LIST_BY_STATUS: `
    SELECT * FROM notifications
    WHERE status = ?
    ORDER BY due_date ASC, id ASC
  `,
  GET_BY_ID: `SELECT * FROM notifications WHERE id = ?`,
  GET_BY_DEDUPE_KEY: `SELECT * FROM notifications WHERE dedupe_key = ?`,
  CREATE: `
    INSERT INTO notifications (
      kind, type, title, body, due_date, recurrence, lead_days, status, snoozed_until,
      source, dedupe_key, entity_table, entity_id, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `,
  UPDATE: `
    UPDATE notifications
    SET kind = ?, type = ?, title = ?, body = ?, due_date = ?, recurrence = ?, lead_days = ?,
        status = ?, snoozed_until = ?, source = ?, dedupe_key = ?, entity_table = ?, entity_id = ?,
        payload_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
  // System alerts are keyed on dedupe_key so a rescan refreshes rather than
  // duplicates. User-facing state (status, snoozed_until) is preserved on
  // conflict so acknowledging an alert survives the next scan.
  UPSERT_BY_DEDUPE_KEY: `
    INSERT INTO notifications (
      kind, type, title, body, due_date, recurrence, lead_days, status, snoozed_until,
      source, dedupe_key, entity_table, entity_id, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(dedupe_key) DO UPDATE SET
      title = excluded.title,
      body = excluded.body,
      due_date = excluded.due_date,
      lead_days = excluded.lead_days,
      entity_table = excluded.entity_table,
      entity_id = excluded.entity_id,
      payload_json = excluded.payload_json,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id
  `,
  SET_STATUS: `
    UPDATE notifications
    SET status = ?, snoozed_until = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
  SET_LAST_NOTIFIED: `UPDATE notifications SET last_notified_at = CURRENT_TIMESTAMP WHERE id = ?`,
  DELETE: `DELETE FROM notifications WHERE id = ?`,
  DELETE_BY_DEDUPE_PREFIX: `DELETE FROM notifications WHERE source = 'system' AND dedupe_key LIKE ?`,

  // Linked payments the payment scan compares against a series' due date.
  // One row per (series, transaction date) from `sinceDate` on.
  SERIES_PAYMENTS_SINCE: `
    SELECT tsl.series_id AS series_id, t.date AS date
    FROM transaction_series_links tsl
    JOIN transactions t ON t.id = tsl.transaction_id
    WHERE t.date >= ?
    ORDER BY t.date ASC, tsl.series_id ASC
  `,

  // --- notification_settings ---
  SETTINGS_LIST: `SELECT * FROM notification_settings ORDER BY type`,
  SETTINGS_UPSERT: `
    INSERT INTO notification_settings (type, enabled, lead_days, os_notify, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(type) DO UPDATE SET
      enabled = excluded.enabled,
      lead_days = excluded.lead_days,
      os_notify = excluded.os_notify,
      updated_at = CURRENT_TIMESTAMP
  `,
};
