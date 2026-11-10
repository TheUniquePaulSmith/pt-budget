/**
 * Fixtures for the wizard's reducer tests: a reducer wired to the stand-in
 * pipeline (./fakePipeline) and helpers to reach a given point of the flow.
 */

import type { AccountResolution, SavedImportProfile, StatementTable } from '@/lib/statementImport';

import {
  createInitialState,
  createWizardReducer,
  type PreparedTable,
  type WizardAction,
  type WizardState,
} from '../wizardModel';

import { SIMPLE_ROWS, TODAY, fakeAnalyze, fakePropose, makeTable } from './fakePipeline';

export { SIMPLE_ROWS, TODAY, fakeAnalyze, fakePropose, makeTable } from './fakePipeline';

export const testReducer = createWizardReducer({ propose: fakePropose, analyze: fakeAnalyze });

export function initialState(): WizardState {
  return {
    ...createInitialState({ today: TODAY, fallbackDateOrder: 'MDY', fallbackDecimal: '.' }),
    accountFacts: {
      1: { id: 1, type: 'checking', currency: 'USD' }, // i18n-ignore: test fixture
      2: { id: 2, type: 'credit', currency: 'USD' }, // i18n-ignore: test fixture
    },
  };
}

export function run(state: WizardState, ...actions: WizardAction[]): WizardState {
  return actions.reduce(testReducer, state);
}

/** `profile` is shorthand for a file whose fingerprint matched exactly one saved format. */
export type PreparedExtra = Partial<PreparedTable> & { profile?: SavedImportProfile | null };

export function prepared(table: StatementTable, { profile, ...extra }: PreparedExtra = {}): PreparedTable {
  return {
    id: 'file-1:0',
    table,
    detectedFingerprint: table.fingerprint,
    readOptions: {},
    profiles: profile ? [profile] : [],
    ...extra,
  };
}

/** A state with one readable file loaded. */
export function withFile(table: StatementTable = makeTable(SIMPLE_ROWS), extra: PreparedExtra = {}): WizardState {
  return run(
    initialState(),
    { type: 'fileAdded', file: { id: 'file-1', name: table.meta.fileName, size: 120 } },
    { type: 'fileRead', fileId: 'file-1', tables: [prepared(table, extra)], issues: [] }
  );
}

export function resolution(value: string, partial: Partial<AccountResolution> = {}): AccountResolution {
  return { value, status: 'unknown', basis: null, accountId: null, cardId: null, candidateAccountIds: [], ...partial };
}

export function savedProfile(table: StatementTable, overrides: Partial<SavedImportProfile> = {}): SavedImportProfile {
  return {
    id: 7,
    name: 'My bank',
    format: 'delimited',
    fingerprint: table.fingerprint,
    institution: null,
    account_id: 1,
    use_count: 1,
    last_used_at: '2030-02-01T00:00:00.000Z',
    created_at: '2030-02-01T00:00:00.000Z',
    updated_at: '2030-02-01T00:00:00.000Z',
    account_name: 'Household Checking',
    config: {
      version: 1,
      layout: fakePropose(table, {}).layout,
    },
    ...overrides,
  };
}
