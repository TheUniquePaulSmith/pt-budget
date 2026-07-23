'use client';

import React, { useMemo } from 'react';
import { useTheme } from '@mui/material';
import CodeMirror from '@uiw/react-codemirror';
import { keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { sql, SQLite, type SQLNamespace } from '@codemirror/lang-sql';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';

import { analyzeSqlQuery, type SqlQueryAnalysis } from './sqlQueryAnalysis';
import { createBareColumnCompletionSource } from './sqlBareColumnCompletion';
import { toCodeMirrorSchema, type SqlSchemaMap } from '@/lib/sqlSchemaIntrospection';

export interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  schema: SqlSchemaMap | null;
  onExecute?: () => void;
  onAnalysis?: (analysis: SqlQueryAnalysis) => void;
  minHeight?: string;
  maxHeight?: string;
  'data-testid'?: string;
}

function clampDiagnosticRange(from: number, to: number, docLength: number): { from: number; to: number } {
  const safeFrom = Math.min(Math.max(from, 0), docLength);
  const minTo = Math.min(safeFrom + 1, docLength);
  const safeTo = Math.min(Math.max(to, minTo), docLength);
  return { from: safeFrom, to: Math.max(safeTo, safeFrom) };
}

export default function SqlEditor({
  value,
  onChange,
  schema,
  onExecute,
  onAnalysis,
  minHeight = '160px',
  maxHeight = '480px',
  'data-testid': testId,
}: SqlEditorProps) {
  const theme = useTheme();
  const paletteMode = theme.palette.mode;

  const cmSchema: SQLNamespace = useMemo(
    () => (schema ? toCodeMirrorSchema(schema) : {}),
    [schema]
  );

  const extensions = useMemo(() => {
    const result = [
      sql({ dialect: SQLite, schema: cmSchema, upperCaseKeywords: true }),
      SQLite.language.data.of({ autocomplete: createBareColumnCompletionSource(schema) }),
      linter(
        async (view) => {
          const text = view.state.doc.toString();
          const analysis = await analyzeSqlQuery(text, schema);
          onAnalysis?.(analysis);
          return analysis.issues.map((issue): Diagnostic => ({
            ...clampDiagnosticRange(issue.from, issue.to, text.length),
            severity: issue.severity,
            message: issue.message,
          }));
        },
        { delay: 400 }
      ),
      lintGutter(),
    ];

    if (onExecute) {
      // Prec.highest: @codemirror/commands' defaultKeymap (part of
      // basicSetup) already binds Mod-Enter to insertBlankLine, and it's
      // registered before this extension, so without an explicit
      // precedence bump it always wins the race and this handler never runs.
      result.push(
        Prec.highest(
          keymap.of([
            {
              key: 'Mod-Enter',
              run: () => {
                onExecute();
                return true;
              },
            },
          ])
        )
      );
    }

    return result;
  }, [cmSchema, schema, onExecute, onAnalysis]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      theme={paletteMode}
      extensions={extensions}
      height="auto"
      minHeight={minHeight}
      maxHeight={maxHeight}
      placeholder="Enter your SQL query here..."
      basicSetup={{ tabSize: 2 }}
      style={{ fontSize: '0.875rem', fontFamily: 'monospace' }}
      data-testid={testId}
    />
  );
}
