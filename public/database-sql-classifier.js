// SQL write/read classifier for the database worker's change-notification
// hook. Used to decide whether a statement should trigger a
// 'database_changed' broadcast — see notifyDatabaseChanged() in
// database-worker.js.

const READ_ONLY_KEYWORDS = new Set([
  'select',
  'pragma',
  'explain',
  'begin',
  'commit',
  'rollback',
  'savepoint',
  'release',
  'values',
]);

const WRITE_VERB_PATTERN = /\b(insert|update|delete|replace)\b/i;

function stripLeadingNoise(sql) {
  let text = sql;
  let changed = true;

  while (changed) {
    changed = false;

    const trimmed = text.replace(/^\s+/, '');
    if (trimmed !== text) {
      text = trimmed;
      changed = true;
    }

    if (text.startsWith('--')) {
      const newlineIndex = text.indexOf('\n');
      text = newlineIndex === -1 ? '' : text.slice(newlineIndex + 1);
      changed = true;
      continue;
    }

    if (text.startsWith('/*')) {
      const endIndex = text.indexOf('*/');
      text = endIndex === -1 ? '' : text.slice(endIndex + 2);
      changed = true;
    }
  }

  return text;
}

// Returns true if `sql` is a statement that mutates database content.
// Over-classifying as a write is harmless (marks the database dirty
// unnecessarily); under-classifying would silently drop a sync.
export function isWriteSql(sql) {
  if (typeof sql !== 'string') {
    return false;
  }

  const text = stripLeadingNoise(sql);
  const match = text.match(/^[a-zA-Z]+/);

  if (!match) {
    return false;
  }

  const keyword = match[0].toLowerCase();

  if (keyword === 'with') {
    return WRITE_VERB_PATTERN.test(text);
  }

  return !READ_ONLY_KEYWORDS.has(keyword);
}
