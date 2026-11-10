/**
 * Runs every fixture in tests/fixtures/statements/{raw,layouts} through the
 * whole pipeline and compares the result with its `<name>.expected.json`.
 * The manifest format is documented in tests/fixtures/statements/README.md;
 * a section the manifest leaves out is not checked.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AccountType } from '@/types/database';

import { analyzeStatement, proposeLayout, readStatement } from './index';
import type { DateOrder, DecimalSeparator, ImportLayout } from './types';

interface FixtureManifest {
  file: string;
  description: string;
  context?: {
    today?: string;
    accountType?: AccountType;
    fallbackDateOrder?: DateOrder;
    fallbackDecimal?: DecimalSeparator;
  };
  read?: {
    issues?: string[];
    tables?: number;
    tableIndex?: number;
    format?: string;
    encoding?: string;
    delimiter?: string;
    headerLine?: number | null;
    columns?: string[];
    rows?: number;
    notes?: string[];
    fingerprint?: string;
  };
  layout?: Partial<ImportLayout> & { missing?: string[] };
  analysis?: {
    readyRows?: number;
    blockedRows?: number;
    skippedRows?: number;
    firstDate?: string | null;
    lastDate?: string | null;
    moneyIn?: number;
    moneyOut?: number;
    issueCodes?: string[];
  };
}

const CORPUS_ROOT = path.resolve(process.cwd(), 'tests', 'fixtures', 'statements');
const DEFAULT_TODAY = '2026-11-10';

function loadFixtures(folder: string): Array<{ name: string; dir: string; manifest: FixtureManifest }> {
  const dir = path.join(CORPUS_ROOT, folder);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.expected.json'))
    .sort()
    .map((name) => ({
      name: `${folder}/${name.replace(/\.expected\.json$/, '')}`,
      dir,
      manifest: JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as FixtureManifest,
    }));
}

const fixtures = [...loadFixtures('raw'), ...loadFixtures('layouts')];

describe('statement fixture corpus', () => {
  it('has fixtures in both folders, each with a description and a data file', () => {
    expect(fixtures.some((fixture) => fixture.name.startsWith('raw/'))).toBe(true);
    expect(fixtures.some((fixture) => fixture.name.startsWith('layouts/'))).toBe(true);
    for (const { dir, manifest } of fixtures) {
      expect(manifest.description.trim()).not.toBe('');
      expect(fs.existsSync(path.join(dir, manifest.file))).toBe(true);
    }
  });

  it('covers the shapes of export the interpretation has to cope with', () => {
    const layouts = fixtures.filter((fixture) => fixture.name.startsWith('layouts/'));
    expect(layouts.length).toBeGreaterThanOrEqual(15);
    // A layouts/ fixture is there to pin what is detected and what is reported.
    for (const { name, manifest } of layouts) {
      expect(manifest.layout, `${name} states a layout`).toBeDefined();
      expect(manifest.analysis?.issueCodes, `${name} states its issue codes`).toBeDefined();
    }
  });

  it.each(fixtures)('$name', async ({ dir, manifest }) => {
    const bytes = new Uint8Array(fs.readFileSync(path.join(dir, manifest.file)));
    const result = await readStatement({ name: manifest.file, size: bytes.length, bytes });

    const { read, layout: expectedLayout, analysis, context = {} } = manifest;
    if (read?.issues) expect(result.issues.map((issue) => issue.code)).toEqual(read.issues);
    if (read?.tables !== undefined) expect(result.tables).toHaveLength(read.tables);

    const table = result.tables[read?.tableIndex ?? 0];
    if (!table) {
      // A fixture for an unreadable file states its issues and nothing else.
      expect(expectedLayout ?? analysis).toBeUndefined();
      return;
    }

    if (read?.format) expect(table.format).toBe(read.format);
    if (read?.encoding) expect(table.meta.encoding).toBe(read.encoding);
    if (read?.delimiter) expect(table.meta.delimiter).toBe(read.delimiter);
    if (read?.headerLine !== undefined) expect(table.meta.headerLine).toBe(read.headerLine);
    if (read?.columns) expect(table.columns.map((column) => column.name)).toEqual(read.columns);
    if (read?.rows !== undefined) expect(table.rows).toHaveLength(read.rows);
    if (read?.notes) expect(table.notes.map((note) => note.code)).toEqual(read.notes);
    if (read?.fingerprint) expect(table.fingerprint).toBe(read.fingerprint);

    const proposal = proposeLayout(table, {
      accountType: context.accountType,
      fallbackDateOrder: context.fallbackDateOrder,
      fallbackDecimal: context.fallbackDecimal,
    });
    if (expectedLayout) {
      const { missing, ...layoutFields } = expectedLayout;
      expect(proposal.layout).toMatchObject(layoutFields);
      if (missing) expect(proposal.missing).toEqual(missing);
    }

    if (analysis) {
      const report = analyzeStatement(table, proposal.layout, {
        today: context.today ?? DEFAULT_TODAY,
        accountType: context.accountType,
      });
      const { issueCodes, moneyIn, moneyOut, ...stats } = analysis;
      expect(report.stats).toMatchObject(stats);
      if (moneyIn !== undefined) expect(report.stats.moneyIn).toBeCloseTo(moneyIn, 2);
      if (moneyOut !== undefined) expect(report.stats.moneyOut).toBeCloseTo(moneyOut, 2);
      if (issueCodes) expect(report.issues.map((issue) => issue.code).sort()).toEqual([...issueCodes].sort());
    }
  });
});
