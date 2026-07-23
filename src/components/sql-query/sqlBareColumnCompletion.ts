// @codemirror/lang-sql's built-in schema completion only ever suggests
// columns once a `table.` or `alias.` prefix has been typed (see its
// completeFromSchema: with no dot before the cursor, `parents` is empty and
// the lookup never descends into a table's column list). That's a big gap
// for a query console where most people type bare column names. This adds a
// second completion source — registered alongside the built-in one, not
// replacing it — that offers columns from whichever tables are referenced
// via FROM/JOIN in the query, without requiring a prefix.
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';

import type { SqlSchemaMap } from '@/lib/sqlSchemaIntrospection';

const TABLE_REF_PATTERN =
  /\b(?:from|join)\s+(`[^`]+`|"[^"]+"|\[[^\]]+\]|[a-zA-Z_]\w*)(?:\s+(?:as\s+)?(`[^`]+`|"[^"]+"|\[[^\]]+\]|[a-zA-Z_]\w*))?/gi;

// Keywords that can legally follow a table name in a FROM/JOIN clause
// without being an alias (so the regex's optional second capture doesn't
// misread "FROM transactions WHERE" as aliasing "transactions" to "WHERE").
const NON_ALIAS_KEYWORDS = new Set([
  'where', 'group', 'having', 'order', 'limit', 'union', 'intersect', 'except',
  'on', 'join', 'left', 'right', 'inner', 'outer', 'full', 'cross', 'using',
  'offset', 'fetch', 'for', 'and', 'or', 'as', 'by', 'desc', 'asc', 'all', 'distinct',
]);

function stripQuotes(raw: string): string {
  return raw.replace(/^[`"[]|[`"\]]$/g, '');
}

interface TableReference {
  table: string;
  alias: string | null;
}

function extractTableReferences(text: string): TableReference[] {
  const refs: TableReference[] = [];
  TABLE_REF_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TABLE_REF_PATTERN.exec(text))) {
    const table = stripQuotes(match[1]);
    let alias: string | null = null;
    if (match[2]) {
      const candidate = stripQuotes(match[2]);
      if (!NON_ALIAS_KEYWORDS.has(candidate.toLowerCase())) {
        alias = candidate;
      }
    }
    refs.push({ table, alias });
  }
  return refs;
}

export function createBareColumnCompletionSource(schema: SqlSchemaMap | null) {
  return (context: CompletionContext): CompletionResult | null => {
    if (!schema) {
      return null;
    }

    const word = context.matchBefore(/\w+/);
    if (!word || (word.from === word.to && !context.explicit)) {
      return null;
    }
    // A dotted reference ("alias.col") is handled by the built-in schema
    // completion source — stay out of its way.
    if (context.state.sliceDoc(word.from - 1, word.from) === '.') {
      return null;
    }

    const refs = extractTableReferences(context.state.doc.toString());
    if (refs.length === 0) {
      return null;
    }

    const seen = new Set<string>();
    const options: Completion[] = [];
    for (const ref of refs) {
      const table = schema[ref.table.toLowerCase()];
      if (!table) {
        continue;
      }
      for (const column of table.columns) {
        if (seen.has(column.name)) {
          continue;
        }
        seen.add(column.name);
        options.push({ label: column.name, type: 'property', detail: table.name });
      }
    }

    if (options.length === 0) {
      return null;
    }

    return { from: word.from, options, validFor: /^\w*$/ };
  };
}
