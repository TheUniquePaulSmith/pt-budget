# Browser snippets (run with the browser pane's `javascript_tool`)

These are for inspection only. Fix behavior in source, never by patching the page.

## Recent log records (works before unlock)

```js
await new Promise((resolve, reject) => {
  const open = indexedDB.open('ptbudgetapp-logs');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const out = [];
    const cursor = db.transaction('entries').objectStore('entries').openCursor(null, 'prev');
    cursor.onsuccess = () => {
      const c = cursor.result;
      // Change the filter: level, context.source ('app' | 'worker' | 'console'), context.component, message text.
      if (c && out.length < 40) {
        const r = c.value;
        if (['warn', 'error'].includes(r.level) || /fail/i.test(r.message)) {
          out.push({
            t: new Date(r.ts).toISOString().slice(11, 23),
            level: r.level,
            src: r.context?.source,
            component: r.context?.component,
            op: r.context?.operation,
            corr: r.context?.correlationId,
            msg: r.message,
            err: r.error?.message,
          });
        }
        c.continue();
      } else {
        db.close();
        resolve(out);
      }
    };
  };
});
```

## Everything for one correlation id

```js
const CORR = 'paste-id-here';
await new Promise((resolve, reject) => {
  const open = indexedDB.open('ptbudgetapp-logs');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const req = db.transaction('entries').objectStore('entries').index('correlationId').getAll(CORR);
    req.onsuccess = () => {
      db.close();
      resolve(req.result
        .sort((a, b) => a.ts - b.ts)
        .map((r) => `${new Date(r.ts).toISOString().slice(11, 23)} ${r.level} ${r.context?.source}/${r.context?.component} ${r.message}${r.error ? ' :: ' + r.error.message : ''}`));
    };
  };
});
```

## Status at a glance

```js
({
  status: document.querySelector('[data-testid="database-status-text"]')?.textContent,
  url: location.href,
  testApi: Object.keys(window.__budgetTrackerTestApi ?? {}),
  language: localStorage.getItem('budgetTracker_language'),
  crossOriginIsolated,
  sharedWorker: typeof SharedWorker !== 'undefined',
});
```

## Wipe all app state (first-run testing)

This destroys the local database in this browser profile. Fine in the browser pane on localhost. Never do it in the
user's real browser without asking.

```js
for (const { name } of await indexedDB.databases()) indexedDB.deleteDatabase(name);
localStorage.clear();
sessionStorage.clear();
'wiped: now close or reload every app tab so the SharedWorker restarts';
```

## Run a read-only query through the UI

From an e2e spec, use `runQueryAndReadFirstCell(page, sql)`. In the browser pane:
1. `navigate` → click `nav-sql-query`.
2. `find` the editor (`sql-query-input`) and type into its `.cm-content`.
3. Click "Execute Query".
4. `get_page_text` on `sql-query-results`.

Useful queries:

```sql
SELECT user_version FROM pragma_user_version;
SELECT name, type, "notnull", dflt_value FROM pragma_table_info('transactions');
SELECT * FROM pragma_foreign_key_check;
SELECT type, type_source, COUNT(*) FROM transactions GROUP BY 1, 2;
SELECT key, substr(value, 1, 80) FROM app_metadata WHERE key NOT LIKE 'ai.provider%';  -- never print API keys
```

## Force a worker disconnect (recovery paths)

```js
window.__budgetTrackerTestApi?.disconnectWorker();
```

Then reload, and unlock if asked.
