// AI tool registry persistence (schema v3). Owned by the AI feature.
export const AI_TOOL_QUERIES = {
  PACKS_LIST: `SELECT * FROM ai_tool_packs ORDER BY source, name`,
  PACK_GET_BY_KEY: `SELECT * FROM ai_tool_packs WHERE pack_key = ?`,
  PACK_UPSERT: `
    INSERT INTO ai_tool_packs (pack_key, name, version, source, enabled, definition_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(pack_key) DO UPDATE SET
      name = excluded.name,
      version = excluded.version,
      source = excluded.source,
      enabled = excluded.enabled,
      definition_json = excluded.definition_json,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id
  `,
  PACK_SET_ENABLED: `UPDATE ai_tool_packs SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE pack_key = ?`,
  PACK_DELETE: `DELETE FROM ai_tool_packs WHERE pack_key = ?`,

  SETTINGS_LIST: `SELECT * FROM ai_tool_settings ORDER BY tool_name`,
  SETTINGS_UPSERT: `
    INSERT INTO ai_tool_settings (tool_name, pack_key, enabled, consent, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(tool_name) DO UPDATE SET
      pack_key = excluded.pack_key,
      enabled = excluded.enabled,
      consent = excluded.consent,
      updated_at = CURRENT_TIMESTAMP
  `,
  SETTINGS_DELETE: `DELETE FROM ai_tool_settings WHERE tool_name = ?`,
  SETTINGS_DELETE_FOR_PACK: `DELETE FROM ai_tool_settings WHERE pack_key = ?`,
};
