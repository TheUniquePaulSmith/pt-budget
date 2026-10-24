// app_metadata is the only key/value table. Feature code must namespace its
// keys (e.g. 'notifications.enabled', 'ai.provider.config', 'logging.level')
// and declare the key constants in its own module.
export const APP_METADATA_QUERIES = {
  GET: `SELECT value FROM app_metadata WHERE key = ?`,
  SET: `
    INSERT INTO app_metadata (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `,
  DELETE: `DELETE FROM app_metadata WHERE key = ?`,
  // Prefix match, e.g. 'notifications.' — callers pass the prefix plus '%'.
  GET_BY_PREFIX: `SELECT key, value, updated_at FROM app_metadata WHERE key LIKE ? ORDER BY key`,
};
