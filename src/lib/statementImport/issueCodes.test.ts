/**
 * Keeps the issue catalog, the assumption codes and their English texts in
 * step: every code has a text, every text belongs to a code, and the
 * `{{placeholders}}` a text uses are exactly the params the code declares
 * (and the analysis really supplies them: see the corpus check at the end).
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import english from '@/locales/en-US/importIssues.json';

import { ALL_IMPORT_ISSUE_CODES, IMPORT_ISSUE_CODES, analyzeStatement, proposeLayout, readStatement } from './index';
import { ASSUMPTION_CODES } from './interpret';
import { ISSUE_TEXT_PARAMS, type ImportIssueCode } from './issueCodes';
import type { Assumption, ImportIssue } from './types';

const PLACEHOLDER_RE = /\{\{\s*([\w.]+)\s*\}\}/g;
const PLURAL_RE = /_(one|other)$/;

type TextGroup = Record<string, string>;
const issueTexts = english.issues as Record<string, TextGroup>;
const assumptionTexts = english.assumptions as Record<string, string>;

function placeholdersOf(...texts: string[]): string[] {
  const names = new Set<string>();
  for (const text of texts) for (const match of text.matchAll(PLACEHOLDER_RE)) names.add(match[1]);
  return [...names].sort();
}

/** The variants of `title` or `detail`: the plain key, or its `_one` / `_other` pair. */
function variantsOf(group: TextGroup, part: 'title' | 'detail'): string[] {
  return Object.entries(group)
    .filter(([key]) => key.replace(PLURAL_RE, '') === part)
    .map(([, text]) => text);
}

describe('issue catalog and its English texts', () => {
  it.each(ALL_IMPORT_ISSUE_CODES)('%s has a title and a detail', (code) => {
    const group = issueTexts[code];
    expect(group, `importIssues:issues.${code}`).toBeDefined();
    for (const part of ['title', 'detail'] as const) {
      const keys = Object.keys(group).filter((key) => key.replace(PLURAL_RE, '') === part);
      // Either the plain key, or both plural forms: one form alone would leave a count without a text.
      expect(
        keys.length === 1 ? keys[0] === part : keys.sort().join() === `${part}_one,${part}_other`,
        `importIssues:issues.${code}.${part} has keys [${keys.join(', ')}]`
      ).toBe(true);
      for (const text of variantsOf(group, part)) expect(text.trim()).not.toBe('');
    }
  });

  it('has no text for a code that does not exist', () => {
    expect(Object.keys(issueTexts).sort()).toEqual([...ALL_IMPORT_ISSUE_CODES].sort());
  });

  it.each(ALL_IMPORT_ISSUE_CODES)('%s uses exactly the placeholders it declares', (code) => {
    const group = issueTexts[code];
    const used = placeholdersOf(...variantsOf(group, 'title'), ...variantsOf(group, 'detail'));
    expect(used).toEqual([...(ISSUE_TEXT_PARAMS[code] ?? [])].sort());
    // A plural title needs a count to choose its form.
    if ('title_one' in group || 'detail_one' in group) expect(ISSUE_TEXT_PARAMS[code]).toContain('count');
  });

  it('keeps the texts of codes raised outside the analysis free of placeholders', () => {
    // Readers, the wizard and the service raise these with params of their own choosing.
    const raisedElsewhere = ALL_IMPORT_ISSUE_CODES.filter(
      (code) =>
        IMPORT_ISSUE_CODES[code].scope === 'account' || ['duplicateInFile', 'alreadyImported', 'raggedRows'].includes(code)
    );
    expect(raisedElsewhere.length).toBeGreaterThan(8);
    for (const code of raisedElsewhere) expect(ISSUE_TEXT_PARAMS[code]).toBeUndefined();
  });
});

describe('assumption codes and their English texts', () => {
  const codes = Object.keys(ASSUMPTION_CODES) as Array<keyof typeof ASSUMPTION_CODES>;

  it.each(codes)('%s has a text that uses exactly its params', (code) => {
    const text = assumptionTexts[code];
    expect(text, `importIssues:assumptions.${code}`).toBeDefined();
    expect(text.trim()).not.toBe('');
    expect(placeholdersOf(text)).toEqual([...ASSUMPTION_CODES[code]].sort());
  });

  it('has no text for a code that does not exist', () => {
    expect(Object.keys(assumptionTexts).sort()).toEqual([...codes].sort());
  });
});

describe('what the pipeline emits can always be rendered', () => {
  const corpus = path.resolve(process.cwd(), 'tests', 'fixtures', 'statements', 'layouts');
  const files = fs.readdirSync(corpus).filter((name) => name.endsWith('.csv'));

  const expectRenderable = (issue: ImportIssue, where: string) => {
    for (const name of ISSUE_TEXT_PARAMS[issue.code as ImportIssueCode] ?? []) {
      expect(issue.params?.[name], `${where}: issue ${issue.code} is missing param "${name}"`).toBeDefined();
      expect(issue.params?.[name], `${where}: issue ${issue.code} has an empty "${name}"`).not.toBe('');
    }
  };
  const expectKnown = (assumption: Assumption, where: string) => {
    const params = ASSUMPTION_CODES[assumption.code as keyof typeof ASSUMPTION_CODES];
    expect(params, `${where}: unknown assumption code ${assumption.code}`).toBeDefined();
    for (const name of params) {
      expect(assumption.params?.[name], `${where}: assumption ${assumption.code} is missing param "${name}"`).toBeDefined();
    }
    expect(assumption.confidence).toBeGreaterThanOrEqual(0);
    expect(assumption.confidence).toBeLessThanOrEqual(1);
  };

  it.each(files)('%s: every issue and assumption has its params', async (name) => {
    const bytes = new Uint8Array(fs.readFileSync(path.join(corpus, name)));
    const { tables } = await readStatement({ name, size: bytes.length, bytes });
    for (const accountType of [undefined, 'credit', 'savings'] as const) {
      const proposal = proposeLayout(tables[0], { accountType });
      proposal.assumptions.forEach((assumption) => expectKnown(assumption, name));
      const report = analyzeStatement(tables[0], proposal.layout, {
        today: '2026-09-20',
        accountType,
        accountCurrency: 'GBP',
        coverage: { accountId: 1, firstDate: '2026-01-01', lastDate: '2026-03-01', lastImportThrough: '2026-03-01', transactionCount: 60 },
      });
      report.issues.forEach((issue) => expectRenderable(issue, name));
    }
  });
});
