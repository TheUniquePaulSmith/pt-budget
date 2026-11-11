import { describe, expect, it } from 'vitest';

import type { AccountResolution, StageResult } from '@/lib/statementImport';
import type { ImportClassificationPreview, TransferLegSummary, TransferPairPreview, TypeDecision } from '@/types/classification';

import {
  SIMPLE_ROWS,
  fakePropose,
  initialState,
  makeTable,
  prepared,
  resolution,
  run,
  savedProfile,
  withFile,
} from './testing/wizardFixtures';
import {
  accountIssueCode,
  accountValuesOf,
  accountsSettled,
  assignRole,
  buildCommitInput,
  buildProfileInput,
  canGoNext,
  currentStatement,
  excludedTempIds,
  hasUnsavedWork,
  identifiersToSave,
  importBlockers,
  isStagingFresh,
  issuesBySeverity,
  keptPairs,
  roleOfColumn,
  rowsToStage,
  settingsToConfirm,
  signNeedsConfirmation,
  statementIssues,
  summarize,
  type StatementResult,
  type StatementSession,
  type WizardState,
} from './wizardModel';

function current(state: WizardState): StatementSession {
  const statement = currentStatement(state);
  if (!statement) throw new Error('no current statement');
  return statement;
}

/** Files → Next, then the account lookup answers. */
function activated(state: WizardState, ...resolutions: Parameters<typeof resolution>[]): WizardState {
  const started = run(state, { type: 'next' });
  const statement = current(started);
  return run(started, {
    type: 'accountsResolved',
    statementId: statement.id,
    resolutions: resolutions.map(([value, partial]) => resolution(value, partial)),
  });
}

const RECOGNISED: Partial<AccountResolution> = { status: 'recognised', basis: 'fullNumber', accountId: 1, cardId: 11, candidateAccountIds: [1] };
const ASSUMED: Partial<AccountResolution> = { status: 'assumed', basis: 'lastFour', accountId: 1, cardId: 11, candidateAccountIds: [1] };

/** A statement whose account is settled and whose reading settings are confirmed. */
function readyForReview(table = makeTable(SIMPLE_ROWS)): WizardState {
  return run(
    activated(withFile(table), ['', {}]),
    { type: 'accountChosen', value: '', accountId: 1, cardId: 11 },
    { type: 'next' },
    { type: 'settingConfirmed', subject: 'dateOrder' },
    { type: 'settingConfirmed', subject: 'amountSign' },
    { type: 'next' }
  );
}

function staged(state: WizardState, result: Partial<StageResult> = {}, classification: ImportClassificationPreview | null = null): WizardState {
  const statement = current(state);
  const rows = rowsToStage(statement);
  return run(state, {
    type: 'staged',
    statementId: statement.id,
    version: statement.rowsVersion,
    result: {
      tempIds: rows.map((_, index) => 100 + index),
      alreadyImported: [],
      duplicateGroups: [],
      ...result,
    },
    rowIndexes: rows.map((row) => row.rowIndex),
    classification,
  });
}

describe('files and the queue', () => {
  it('turns every table of a file into a statement waiting in the queue', () => {
    const first = makeTable(SIMPLE_ROWS, undefined, { format: 'ofx', fingerprint: 'ofx:bank:checking' });
    const second = makeTable(SIMPLE_ROWS.slice(0, 1), undefined, { format: 'ofx', fingerprint: 'ofx:bank:credit' });
    const state = run(
      initialState(),
      { type: 'fileAdded', file: { id: 'file-1', name: 'two-accounts.qfx', size: 900 } },
      {
        type: 'fileRead',
        fileId: 'file-1',
        tables: [prepared(first, { id: 'file-1:0' }), prepared(second, { id: 'file-1:1' })],
        issues: [],
      }
    );

    expect(state.files[0].status).toBe('ready');
    expect(state.statements.map((statement) => [statement.tableIndex, statement.tableCount, statement.report.stats.totalRows])).toEqual([
      [0, 2, 3],
      [1, 2, 1],
    ]);
    expect(state.statements.every((statement) => statement.fileName === 'two-accounts.qfx' && statement.status === 'pending')).toBe(true);
    expect(canGoNext(state)).toBe(true);
  });

  it('queues the statements in the order the files were added, whichever was read first', () => {
    const state = run(
      initialState(),
      { type: 'fileAdded', file: { id: 'file-1', name: 'january.csv', size: 10 } },
      { type: 'fileAdded', file: { id: 'file-2', name: 'february.csv', size: 10 } },
      { type: 'fileRead', fileId: 'file-2', tables: [prepared(makeTable(SIMPLE_ROWS), { id: 'file-2:0' })], issues: [] },
      { type: 'fileRead', fileId: 'file-1', tables: [prepared(makeTable(SIMPLE_ROWS), { id: 'file-1:0' })], issues: [] }
    );
    expect(state.statements.map((statement) => statement.fileName)).toEqual(['january.csv', 'february.csv']);
    expect(run(state, { type: 'next' }).currentId).toBe('file-1:0');
  });

  it('keeps an unreadable file with the reason, and cannot start with nothing to import', () => {
    const state = run(
      initialState(),
      { type: 'fileAdded', file: { id: 'file-1', name: 'statement.xlsx', size: 4000 } },
      { type: 'fileRead', fileId: 'file-1', tables: [], issues: [{ code: 'unsupportedFormat', severity: 'blocker', scope: 'file' }] }
    );

    expect(state.files[0]).toMatchObject({ status: 'unreadable', issues: [{ code: 'unsupportedFormat' }] });
    expect(state.statements).toEqual([]);
    expect(canGoNext(state)).toBe(false);
    expect(run(state, { type: 'next' }).step).toBe('files');
  });

  it('reports a file that failed without a stated reason as an unsupported format', () => {
    const state = run(
      initialState(),
      { type: 'fileAdded', file: { id: 'file-1', name: 'broken.bin', size: 1 } },
      { type: 'fileRead', fileId: 'file-1', tables: [], issues: [] }
    );
    expect(state.files[0].issues.map((issue) => issue.code)).toEqual(['unsupportedFormat']);
  });

  it('waits for files that are still being read', () => {
    const state = run(withFile(), { type: 'fileAdded', file: { id: 'file-2', name: 'second.csv', size: 10 } });
    expect(canGoNext(state)).toBe(false);
  });

  it('removes a file and its statements, and goes back to Files when it was the current one', () => {
    const state = run(activated(withFile(), ['', {}]), { type: 'fileRemoved', fileId: 'file-1' });
    expect(state).toMatchObject({ files: [], statements: [], currentId: null, step: 'files' });
    expect(hasUnsavedWork(state)).toBe(false);
  });

  it('knows there is work to lose once a file is loaded, but not for a file that cannot be read', () => {
    expect(hasUnsavedWork(initialState())).toBe(false);
    expect(hasUnsavedWork(withFile())).toBe(true);

    const reading = run(initialState(), { type: 'fileAdded', file: { id: 'file-1', name: 'statement.pdf', size: 10 } });
    expect(hasUnsavedWork(reading)).toBe(true);
    const unreadable = run(reading, { type: 'fileRead', fileId: 'file-1', tables: [], issues: [] });
    expect(hasUnsavedWork(unreadable)).toBe(false);
  });
});

describe('account step (D10)', () => {
  it('waits on the lookup, then asks when the file names no account', () => {
    const started = run(withFile(), { type: 'next' });
    expect(started).toMatchObject({ step: 'account', activating: true });
    expect(canGoNext(started)).toBe(false);

    const state = activated(withFile(), ['', {}]);
    const statement = current(state);
    expect(state).toMatchObject({ step: 'account', activating: false });
    expect(statement.accounts).toEqual([expect.objectContaining({ value: '', rowCount: 3, accountId: null, confirmed: false })]);
    expect(accountIssueCode(statement.accounts![0].resolution)).toBe('accountUnknown');
    expect(canGoNext(state)).toBe(false);
    expect(importBlockers(statement)).toContainEqual({ kind: 'accounts' });
  });

  it('says the account number is damaged when a spreadsheet shortened it, and still asks for the account', () => {
    const unknown = (value: string) => ({
      value,
      status: 'unknown' as const,
      basis: null,
      accountId: null,
      cardId: null,
      candidateAccountIds: [],
    });
    expect(accountIssueCode(unknown('4.00E+14'))).toBe('accountValueMalformed');
    expect(accountIssueCode(unknown(' 4,00e+14 '))).toBe('accountValueMalformed');
    // A number nobody has stored, or a name, is simply unknown.
    expect(accountIssueCode(unknown('5550001111'))).toBe('accountUnknown');
    expect(accountIssueCode(unknown('Everyday Checking'))).toBe('accountUnknown');

    const table = makeTable(SIMPLE_ROWS, undefined, {
      meta: { ...makeTable([]).meta, accountHints: [{ kind: 'number', value: '4.00E+14', source: 'preamble' }] },
    });
    const state = activated(withFile(table), ['4.00E+14', {}]);
    expect(accountIssueCode(current(state).accounts![0].resolution)).toBe('accountValueMalformed');
    // The finding is a warning; what stops the import is that no account has been chosen.
    expect(canGoNext(state)).toBe(false);
    expect(importBlockers(current(state))).toContainEqual({ kind: 'accounts' });
  });

  it('needs no confirmation for a recognised account', () => {
    const state = activated(withFile(), ['', RECOGNISED]);
    expect(accountsSettled(current(state))).toBe(true);
    expect(canGoNext(state)).toBe(true);
    // Nothing new to remember: the full number is already known.
    expect(identifiersToSave(current(state))).toEqual([]);
  });

  it('shows an assumed account for confirmation and blocks until the user agrees', () => {
    const table = makeTable(SIMPLE_ROWS, undefined, {
      meta: { ...makeTable([]).meta, accountHints: [{ kind: 'number', value: 'XXXX-4821', source: 'preamble' }] },
    });
    const state = activated(withFile(table), ['XXXX-4821', ASSUMED]);
    const statement = current(state);
    expect(statement.accounts![0]).toMatchObject({ value: 'XXXX-4821', accountId: 1, confirmed: false });
    expect(accountIssueCode(statement.accounts![0].resolution)).toBe('accountAssumedByLastFour');
    expect(canGoNext(state)).toBe(false);

    const confirmed = run(state, { type: 'accountConfirmed', value: 'XXXX-4821' });
    expect(canGoNext(confirmed)).toBe(true);
    // Confirming is what saves the identifier.
    expect(identifiersToSave(current(confirmed))).toEqual([{ account_id: 1, kind: 'number', value: 'XXXX-4821' }]);
  });

  it('treats a manual pick as confirmed and remembers what the file called the account', () => {
    const table = makeTable(SIMPLE_ROWS, undefined, {
      meta: { ...makeTable([]).meta, accountHints: [{ kind: 'label', value: 'Joint Checking', source: 'preamble' }] },
    });
    const state = run(activated(withFile(table), ['Joint Checking', {}]), {
      type: 'accountChosen',
      value: 'Joint Checking',
      accountId: 2,
      cardId: null,
    });
    expect(current(state).accounts![0]).toMatchObject({ accountId: 2, confirmed: true });
    expect(identifiersToSave(current(state))).toEqual([{ account_id: 2, kind: 'label', value: 'Joint Checking' }]);
    expect(canGoNext(state)).toBe(true);
  });

  it('lists every value of an account column, and leaves out the rows of a skipped one', () => {
    const table = makeTable(
      [
        ['4821', '2030-02-01', 'Coffee', '-4.50'],
        ['9034', '2030-02-02', 'Fuel', '-30.00'],
        ['4821', '2030-02-03', 'Rent', '-900.00'],
      ],
      ['Account', 'Date', 'Description', 'Amount']
    );
    const loaded = withFile(table);
    expect(accountValuesOf(loaded.statements[0])).toEqual([
      { value: '4821', rowCount: 2 },
      { value: '9034', rowCount: 1 },
    ]);

    const state = activated(loaded, ['4821', RECOGNISED], ['9034', {}]);
    expect(canGoNext(state)).toBe(false);

    const skipped = run(state, { type: 'accountSkipped', value: '9034', skipped: true });
    expect(canGoNext(skipped)).toBe(true);
    expect(rowsToStage(current(skipped)).map((row) => [row.rowIndex, row.accountId, row.cardId])).toEqual([
      [0, 1, 11],
      [2, 1, 11],
    ]);
    expect(summarize(current(skipped))).toMatchObject({ totalRows: 3, toImport: 2, skipped: 1, accountIds: [1] });

    // Skipping every value leaves nothing to import.
    const none = run(skipped, { type: 'accountSkipped', value: '4821', skipped: true });
    expect(accountsSettled(current(none))).toBe(false);
  });

  it('keeps a decision the user made when the accounts are looked up again', () => {
    const table = makeTable([['9034', '2030-02-02', 'Fuel', '-30.00']], ['Account', 'Date', 'Description', 'Amount']);
    const chosen = run(activated(withFile(table), ['9034', {}]), { type: 'accountChosen', value: '9034', accountId: 2, cardId: 22 });
    const again = run(chosen, { type: 'accountsResolved', statementId: current(chosen).id, resolutions: [resolution('9034', ASSUMED)] });
    expect(current(again).accounts![0]).toMatchObject({ accountId: 2, cardId: 22, confirmed: true });
  });
});

describe('check how we read it', () => {
  const onLayout = () =>
    run(activated(withFile(), ['', {}]), { type: 'accountChosen', value: '', accountId: 1, cardId: 11 }, { type: 'next' });

  it('asks about a low-confidence date order and always about the sign of a single amount column (D9)', () => {
    const state = onLayout();
    expect(state.step).toBe('layout');
    // The decimal separator was proposed with confidence 0.9, so it is assumed, not asked.
    expect(settingsToConfirm(current(state))).toEqual(['dateOrder', 'amountSign']);
    expect(canGoNext(state)).toBe(false);

    const confirmed = run(state, { type: 'settingConfirmed', subject: 'dateOrder' }, { type: 'settingConfirmed', subject: 'amountSign' });
    expect(settingsToConfirm(current(confirmed))).toEqual([]);
    expect(run(confirmed, { type: 'next' }).step).toBe('review');
  });

  it('counts changing a setting as the answer, and re-reads the rows with it', () => {
    const state = run(onLayout(), { type: 'amountSignSet', sign: 'inverted' }, { type: 'dateOrderSet', order: 'DMY' });
    const statement = current(state);
    expect(settingsToConfirm(statement)).toEqual([]);
    expect(statement.layout).toMatchObject({ amountSign: 'inverted', dateOrder: 'DMY' });
    expect(statement.layoutEdited).toBe(true);
    // The coffee was -4.50 in the file: inverted, it is money in.
    expect(statement.report.rows[0].amount).toBe(4.5);
  });

  it('stops repeating a warning about a setting once the user confirmed it, or a saved format settled it', () => {
    // The analysis only sees the file: it says "the sign was assumed" on every run.
    const asked = onLayout();
    const codes = (state: WizardState) => issuesBySeverity(current(state), 'warning').map((issue) => issue.code);
    expect(current(asked).report.issues.map((issue) => issue.code)).toContain('signAssumed');
    expect(codes(asked)).toEqual(['signAssumed']);

    const confirmed = run(asked, { type: 'settingConfirmed', subject: 'amountSign' });
    expect(codes(confirmed)).toEqual([]);
    // Flipping the sign is an answer too.
    expect(codes(run(asked, { type: 'amountSignSet', sign: 'inverted' }))).toEqual([]);
    // What is not shown is not recorded on the batch either.
    expect(statementIssues(current(confirmed)).some((issue) => issue.code === 'signAssumed')).toBe(false);

    const table = makeTable(SIMPLE_ROWS);
    const known = activated(withFile(table, { profile: savedProfile(table) }), ['', RECOGNISED]);
    expect(current(known).report.issues.map((issue) => issue.code)).toContain('signAssumed');
    expect(codes(known)).toEqual([]);
  });

  it('asks nothing about the sign when a column says which way the money went', () => {
    const roles = fakePropose(makeTable([], ['Date', 'Description', 'Amount', 'DR/CR']), {}).layout;
    expect(signNeedsConfirmation(roles)).toBe(true);
    expect(signNeedsConfirmation({ ...roles, roles: assignRole(roles.roles, 3, 'direction') })).toBe(false);
  });

  it('needs no sign confirmation when money in and money out have their own columns', () => {
    const table = makeTable(
      [
        ['2030-02-01', 'Coffee', '4.50', ''],
        ['2030-02-02', 'Paycheck', '', '1200'],
      ],
      ['Date', 'Description', 'Debit', 'Credit']
    );
    const state = run(activated(withFile(table), ['', RECOGNISED]), { type: 'next' });
    expect(settingsToConfirm(current(state))).toEqual(['dateOrder']);
    expect(current(state).report.rows.map((row) => row.amount)).toEqual([-4.5, 1200]);
  });

  it('proposes the layout again for the chosen account type, unless the user already edited it', () => {
    const state = activated(withFile(), ['', {}]);
    expect(current(state).layout.amountSign).toBe('asIs');

    const card = run(state, { type: 'accountChosen', value: '', accountId: 2, cardId: null });
    expect(current(card).layout.amountSign).toBe('inverted');
    expect(current(card).report.rows[0].amount).toBe(4.5);

    const edited = run(state, { type: 'amountSignSet', sign: 'asIs' }, { type: 'accountChosen', value: '', accountId: 2, cardId: null });
    expect(current(edited).layout.amountSign).toBe('asIs');
  });

  it('blocks while a required column is missing and unblocks when the user assigns it', () => {
    const table = makeTable([['2030-02-01', 'Coffee', '-4.50']], ['Date', 'Payee', 'Amount']);
    const state = run(activated(withFile(table), ['', RECOGNISED]), { type: 'next' });
    expect(importBlockers(current(state))).toContainEqual({ kind: 'missing', parts: ['description'] });
    expect(canGoNext(state)).toBe(false);

    const assigned = run(
      state,
      { type: 'roleAssigned', column: 1, role: 'description' },
      { type: 'settingConfirmed', subject: 'dateOrder' },
      { type: 'settingConfirmed', subject: 'amountSign' }
    );
    expect(current(assigned).report.rows[0].description).toBe('Coffee');
    expect(canGoNext(assigned)).toBe(true);
  });

  it('gives a part to one column at a time, and keeps amount and debit / credit apart', () => {
    const roles = fakePropose(makeTable([], ['Date', 'Description', 'Amount', 'Extra']), {}).layout.roles;
    expect(roleOfColumn(roles, 2)).toBe('amount');

    const moved = assignRole(roles, 3, 'amount');
    expect([moved.amount, roleOfColumn(moved, 2)]).toEqual([3, null]);

    const split = assignRole(assignRole(roles, 2, 'debit'), 3, 'credit');
    expect(split).toMatchObject({ amount: null, debit: 2, credit: 3 });
    expect(assignRole(split, 2, 'amount')).toMatchObject({ amount: 2, debit: null, credit: null });

    const twoDescriptions = assignRole(roles, 3, 'description');
    expect(twoDescriptions.description).toEqual([1, 3]);
    expect(assignRole(twoDescriptions, 1, null).description).toEqual([3]);
  });

  it('looks the accounts up again when another column becomes the account column', () => {
    const table = makeTable([['9034', '2030-02-02', 'Fuel', '-30.00']], ['Card', 'Date', 'Description', 'Amount']);
    const state = run(activated(withFile(table), ['', RECOGNISED]), { type: 'next' }, { type: 'roleAssigned', column: 0, role: 'account' });
    expect(current(state).accounts).toBeNull();

    // The new value is unknown, so the wizard comes back to the Account step.
    const resolved = run(state, { type: 'accountsResolved', statementId: current(state).id, resolutions: [resolution('9034')] });
    expect(resolved.step).toBe('account');
    expect(current(resolved).accounts![0]).toMatchObject({ value: '9034', accountId: null });
  });

  it('applies an AI suggestion as a layout that is confirmed like any other (D11)', () => {
    const state = run(onLayout(), { type: 'settingConfirmed', subject: 'amountSign' });
    const proposal = fakePropose(current(state).table, {});
    const applied = run(state, {
      type: 'aiProposalApplied',
      proposal: { ...proposal, layout: { ...proposal.layout, amountSign: 'inverted' }, confidence: 0.7 },
    });
    expect(current(applied)).toMatchObject({ layoutSource: 'ai', confirmed: { amountSign: false } });
    expect(settingsToConfirm(current(applied))).toContain('amountSign');
  });

  it('starts over on the rows when the file is read again with other reader choices', () => {
    const state = run(readyForReview(), { type: 'rowsSkipped', indexes: [0], skip: true });
    const reread = run(state, {
      type: 'statementReread',
      statementId: current(state).id,
      table: makeTable(SIMPLE_ROWS.slice(1)),
      readOptions: { headerLine: 2 },
    });
    const statement = current(reread);
    expect(statement).toMatchObject({ overrides: {}, readerEdited: true, readOptions: { headerLine: 2 }, accounts: null });
    expect(statement.report.stats.totalRows).toBe(2);
    expect(statement.confirmed.amountSign).toBe(false);

    // The account the user picked for the file survives the second lookup.
    const resolved = run(reread, { type: 'accountsResolved', statementId: statement.id, resolutions: [resolution('')] });
    expect(current(resolved).accounts![0]).toMatchObject({ accountId: 1, cardId: 11, confirmed: true });
    expect(resolved.step).toBe('review');
  });
});

describe('things to check (D7, D8)', () => {
  const BAD_ROWS = [
    ['2030-02-01', 'Coffee Shop', '-4.50'],
    ['31/31/2030', 'Bad date', '-10.00'],
    ['2030-02-03', 'Bad amount', 'twelve'],
  ];

  it('blocks on unreadable rows until each is fixed or left out', () => {
    const state = readyForReview(makeTable(BAD_ROWS));
    const statement = current(state);
    expect(state.step).toBe('review');
    expect(issuesBySeverity(statement, 'blocker').map((issue) => issue.code)).toEqual(['unreadableDate', 'unreadableAmount']);
    expect(importBlockers(statement)).toEqual([{ kind: 'blockedRows', count: 2 }]);
    expect(canGoNext(state)).toBe(false);

    const fixed = run(state, { type: 'rowFixed', index: 1, patch: { date: '2030-02-02' } });
    expect(current(fixed).report.rows[1]).toMatchObject({ date: '2030-02-02', blocked: false });
    expect(importBlockers(current(fixed))).toEqual([{ kind: 'blockedRows', count: 1 }]);

    const skipped = run(fixed, { type: 'rowsSkipped', indexes: [2], skip: true });
    expect(importBlockers(current(skipped))).toEqual([]);
    // A finding whose rows are all dealt with is no longer listed.
    expect(issuesBySeverity(current(skipped), 'blocker')).toEqual([]);
    expect(run(skipped, { type: 'next' }).step).toBe('summary');
    expect(summarize(current(skipped))).toMatchObject({ totalRows: 3, toImport: 2, skipped: 1, blockedRows: 0 });
  });

  it('keeps a fix when the row is skipped and un-skipped, and undoes everything on reset', () => {
    const state = run(
      readyForReview(makeTable(BAD_ROWS)),
      { type: 'rowFixed', index: 2, patch: { amount: -12, description: 'Twelve dollars' } },
      { type: 'rowsSkipped', indexes: [2], skip: true },
      { type: 'rowsSkipped', indexes: [2], skip: false }
    );
    expect(current(state).overrides[2]).toEqual({ amount: -12, description: 'Twelve dollars' });
    expect(current(state).report.rows[2]).toMatchObject({ amount: -12, description: 'Twelve dollars', skipped: false, blocked: false });

    const reset = run(state, { type: 'rowReset', index: 2 });
    expect(current(reset).overrides).toEqual({});
    expect(current(reset).report.rows[2].blocked).toBe(true);
  });

  it('lists a total line the analysis left out, and brings it back on request', () => {
    const table = makeTable([
      ['2030-02-01', 'Coffee Shop', '-4.50'],
      ['', 'Total for February', '-4.50'],
    ]);
    const state = readyForReview(table);
    const summaryRow = () => issuesBySeverity(current(state), 'info').find((issue) => issue.code === 'summaryRow');
    expect(current(state).report.rows[1]).toMatchObject({ skipped: true, blocked: false });
    // The row is skipped, yet its finding stays listed: the user may know better.
    expect(summaryRow()?.rows).toEqual([1]);
    expect(importBlockers(current(state))).toEqual([]);
    expect(rowsToStage(current(state)).map((row) => row.rowIndex)).toEqual([0]);

    // "Import it after all" is an explicit override, not the absence of one.
    const restored = run(state, { type: 'rowsSkipped', indexes: [1], skip: false });
    expect(current(restored).overrides).toEqual({ 1: { skip: false } });
    expect(current(restored).report.rows[1]).toMatchObject({ skipped: false, blocked: true });
    expect(importBlockers(current(restored))).toEqual([{ kind: 'blockedRows', count: 1 }]);

    // Leaving it out again, by hand this time, and undoing that returns to the analysis's own verdict.
    const skippedByHand = run(restored, { type: 'rowsSkipped', indexes: [1], skip: true });
    expect(current(skippedByHand).overrides).toEqual({ 1: { skip: true } });
    expect(issuesBySeverity(current(skippedByHand), 'info').some((issue) => issue.code === 'summaryRow')).toBe(false);
    const reset = run(skippedByHand, { type: 'rowReset', index: 1 });
    expect(current(reset).report.rows[1].skipped).toBe(true);
    expect(issuesBySeverity(current(reset), 'info').map((issue) => issue.code)).toContain('summaryRow');
  });

  it('marks the staged rows stale whenever a decision changes them', () => {
    const state = staged(readyForReview());
    expect(isStagingFresh(current(state))).toBe(true);

    const changed = run(state, { type: 'rowsSkipped', indexes: [0], skip: true });
    expect(isStagingFresh(current(changed))).toBe(false);

    // An answer for the old rows arrives late: it is dropped.
    const late = run(changed, {
      type: 'staged',
      statementId: current(changed).id,
      version: current(state).rowsVersion,
      result: { tempIds: [1, 2, 3], alreadyImported: [], duplicateGroups: [] },
      rowIndexes: [0, 1, 2],
      classification: null,
    });
    expect(isStagingFresh(current(late))).toBe(false);
    expect(current(late).staging.result).toBeNull();
  });

  it('counts rows that are already stored and repeated rows the user left out', () => {
    const state = staged(readyForReview(), { alreadyImported: [1], duplicateGroups: [{ rowIndexes: [0, 2] }] });
    expect(summarize(current(state))).toMatchObject({ toImport: 2, alreadyImported: 1, skipped: 0 });
    expect(issuesBySeverity(current(state), 'info').map((issue) => [issue.code, issue.rows])).toContainEqual(['alreadyImported', [1]]);

    const excluded = run(state, { type: 'duplicateExcluded', index: 2, excluded: true });
    expect(excludedTempIds(current(excluded))).toEqual([102]);
    expect(summarize(current(excluded))).toMatchObject({ toImport: 1, alreadyImported: 1, skipped: 1, excludedDuplicates: 1 });
    // Totals follow what will actually be written: only the coffee is left.
    expect(summarize(current(excluded))).toMatchObject({ moneyIn: 0, moneyOut: 4.5, firstDate: '2030-02-01', lastDate: '2030-02-01' });

    const restored = run(excluded, { type: 'duplicateExcluded', index: 2, excluded: false });
    expect(excludedTempIds(current(restored))).toEqual([]);
  });
});

function leg(key: string, tempId: number | null, accountId: number): TransferLegSummary {
  return {
    key,
    id: tempId === null ? 900 : null,
    tempId,
    account_id: accountId,
    account_name: `Account ${accountId}`,
    date: '2030-02-02',
    amount: tempId === 100 ? -4.5 : 4.5,
    description: key,
    isNew: tempId !== null,
  };
}

function pair(pairId: string, outTempId: number | null, inTempId: number | null, recommended: boolean): TransferPairPreview {
  const out = leg(outTempId === null ? 'tx:900' : `tmp:${outTempId}`, outTempId, 1);
  const incoming = leg(inTempId === null ? 'tx:900' : `tmp:${inTempId}`, inTempId, 2);
  return {
    pairId,
    out,
    in: incoming,
    outKey: out.key,
    inKey: incoming.key,
    confidence: recommended ? 0.9 : 0.4,
    dateGapDays: 0,
    reasons: ['same amount'],
    involvesExisting: outTempId === null || inTempId === null,
    recommended,
  };
}

function decision(key: string, source: TypeDecision['source'] = 'pair'): TypeDecision {
  return { key, type: 'transfer', source, confidence: 0.9, transferGroupId: 'g', ruleId: null, pairedWithKey: null, reasons: [] };
}

describe('commit (D12, D13)', () => {
  const classification: ImportClassificationPreview = {
    pairs: [pair('a', 100, null, true), pair('b', 101, 102, false)],
    rowDecisions: [decision('tmp:102', 'inferred')],
    existingDecisions: [],
    summary: { stagedRows: 3, ruleMatches: 0, refundsInferred: 1, transfersDetected: 1, transfersWithExisting: 1, possibleTransfers: 1 },
  };

  it('starts with the recommended transfer pairs kept and lets the user change that', () => {
    const state = staged(readyForReview(), {}, classification);
    expect(keptPairs(current(state)).map((kept) => kept.pairId)).toEqual(['a']);
    expect(summarize(current(state))).toMatchObject({ transfers: 1, refunds: 1 });

    const toggled = run(state, { type: 'pairToggled', pairId: 'b', selected: true }, { type: 'pairToggled', pairId: 'a', selected: false });
    expect(keptPairs(current(toggled)).map((kept) => kept.pairId)).toEqual(['b']);
  });

  it('drops a pair when one of its rows was left out as a repeated row', () => {
    const state = run(
      staged(readyForReview(), { duplicateGroups: [{ rowIndexes: [0, 1] }] }, classification),
      { type: 'duplicateExcluded', index: 0, excluded: true }
    );
    expect(excludedTempIds(current(state))).toEqual([100]);
    expect(keptPairs(current(state))).toEqual([]);
  });

  it('builds the commit from the staged statement', () => {
    const state = run(
      staged(readyForReview(), { alreadyImported: [1], duplicateGroups: [{ rowIndexes: [0, 2] }] }, classification),
      { type: 'duplicateExcluded', index: 2, excluded: true }
    );
    const input = buildCommitInput(current(state), [decision('tmp:100'), decision('tx:900')], 7);

    expect(input).toMatchObject({
      fileName: 'statement.csv',
      format: 'delimited',
      profileId: 7,
      accountIds: [1],
      totalRows: 3,
      skippedRows: 1,
      rejectedRows: 0,
      excludedTempIds: [102],
    });
    // The decision for the excluded row does not travel; the pair's legs split by where they live.
    expect(input.stagedDecisions.map((entry) => entry.key)).toEqual(['tmp:100']);
    expect(input.existingDecisions.map((entry) => entry.key)).toEqual(['tx:900']);
    expect(input.issues).toMatchObject({
      counts: { alreadyImported: 1, accountUnknown: 1 },
      assumptions: ['dateOrder:dateOrderFallback', 'decimal:decimalFallback', 'amountSign:signAsPrinted'],
      fixedRows: 0,
    });
  });

  it('records the assumptions the user accepted and the rows they fixed', () => {
    const table = makeTable([
      ['2030-02-01', 'Coffee Shop', '-4.50'],
      ['bad', 'Bad date', '-10.00'],
    ]);
    const state = run(
      activated(withFile(table), ['', { status: 'assumed', basis: 'profile', accountId: 1, cardId: null, candidateAccountIds: [1] }]),
      { type: 'accountConfirmed', value: '' },
      { type: 'rowFixed', index: 1, patch: { date: '2030-02-02' } }
    );
    const summary = buildCommitInput(staged(state).statements[0], [], null).issues;
    expect(summary.assumptions).toContain('account:accountAssumedByProfile');
    expect(summary.fixedRows).toBe(1);
  });

  it('files a remembered format under the fingerprint a plain read gives, with the reader choices that were made', () => {
    const table = makeTable(SIMPLE_ROWS);
    const plain = current(readyForReview(table));
    expect(buildProfileInput(plain)).toMatchObject({
      name: 'statement',
      format: 'delimited',
      fingerprint: table.fingerprint,
      account_id: 1,
      config: { version: 1, layout: plain.layout },
    });
    expect(buildProfileInput(plain).config.reader).toBeUndefined();

    const reread = run(readyForReview(table), {
      type: 'statementReread',
      statementId: plain.id,
      table: makeTable(SIMPLE_ROWS, ['When', 'What', 'How much'], { fingerprint: 'delimited:when|what|how much' }),
      readOptions: { delimiter: ';' },
    });
    expect(buildProfileInput(current(reread))).toMatchObject({
      fingerprint: table.fingerprint,
      config: { reader: { delimiter: ';' } },
    });
  });

  it('moves to the next file after each commit and finishes once, after the last (D12)', () => {
    const second = makeTable(SIMPLE_ROWS.slice(0, 1));
    const loaded = run(
      withFile(),
      { type: 'fileAdded', file: { id: 'file-2', name: 'second.csv', size: 40 } },
      { type: 'fileRead', fileId: 'file-2', tables: [prepared(second, { id: 'file-2:0' })], issues: [] }
    );
    const first = activated(loaded, ['', RECOGNISED]);
    const result: StatementResult = { outcome: 'imported', batchId: 1, inserted: 3, duplicates: 0, skipped: 0, transfers: 0, refunds: 0, ruleTyped: 0, accountIds: [1], error: null };

    const importing = run(first, { type: 'importStarted' });
    expect(importing.busy).toBe('importing');
    expect(canGoNext(importing)).toBe(false);

    const next = run(importing, { type: 'statementFinished', statementId: 'file-1:0', result });
    expect(next).toMatchObject({ currentId: 'file-2:0', activating: true, step: 'account', busy: null });
    expect(next.statements[0]).toMatchObject({ status: 'done', result: { inserted: 3 } });
    // A file that is already imported cannot be removed any more.
    expect(run(next, { type: 'fileRemoved', fileId: 'file-1' }).files).toHaveLength(2);

    const last = run(next, { type: 'statementFinished', statementId: 'file-2:0', result: { ...result, inserted: 1 } });
    expect(last).toMatchObject({ currentId: null, busy: 'finishing', step: 'account' });
    const done = run(last, { type: 'finished' });
    expect(done).toMatchObject({ busy: null, step: 'done' });
    expect(hasUnsavedWork(done)).toBe(false);
  });

  it('goes straight to Done when nothing was written, and stages again after a failed commit', () => {
    const state = staged(readyForReview());
    const failed = run(state, { type: 'importStarted' }, { type: 'importFailed', error: 'disk full' });
    expect(failed).toMatchObject({ busy: null, importError: 'disk full' });
    expect(isStagingFresh(current(failed))).toBe(false);

    const nothing = run(state, {
      type: 'statementFinished',
      statementId: current(state).id,
      result: { outcome: 'nothingNew', batchId: null, inserted: 0, duplicates: 3, skipped: 0, transfers: 0, refunds: 0, ruleTyped: 0, accountIds: [1], error: null },
    });
    expect(nothing).toMatchObject({ step: 'done', busy: null });
  });

  it('starts again empty for "Import another"', () => {
    const state = run(readyForReview(), { type: 'reset', today: '2030-03-02' });
    expect(state).toMatchObject({ step: 'files', files: [], statements: [], currentId: null, today: '2030-03-02' });
    expect(state.accountFacts[1]).toBeDefined();
  });
});

describe('repeat imports (D16)', () => {
  const table = makeTable(SIMPLE_ROWS);

  it('jumps to the Summary for a known format with nothing to decide, and Import confirms the guess', () => {
    const state = activated(withFile(table, { profile: savedProfile(table) }), [
      '',
      { status: 'assumed', basis: 'profile', accountId: 1, cardId: 11, candidateAccountIds: [1] },
    ]);
    const statement = current(state);
    expect(state.step).toBe('summary');
    expect(statement).toMatchObject({ fastPath: true, layoutSource: 'profile', formatName: 'My bank' });
    expect(settingsToConfirm(statement)).toEqual([]);
    expect(importBlockers(statement)).toEqual([]);
  });

  it('opens the details on request, where the guess then needs the usual confirmation', () => {
    const fast = activated(withFile(table, { profile: savedProfile(table) }), [
      '',
      { status: 'assumed', basis: 'profile', accountId: 1, cardId: 11, candidateAccountIds: [1] },
    ]);
    const details = run(fast, { type: 'goToStep', step: 'account' });
    expect(details.step).toBe('account');
    expect(current(details).fastPath).toBe(false);
    expect(canGoNext(details)).toBe(false);

    const back = run(fast, { type: 'back' });
    expect(back.step).toBe('review');
    expect(current(back).fastPath).toBe(false);
  });

  it('walks the steps when the known format has a blocker or the account is unknown', () => {
    const bad = makeTable([['not a date', 'Coffee', '-4.50']]);
    const blocked = activated(withFile(bad, { profile: savedProfile(bad) }), ['', RECOGNISED]);
    expect(blocked.step).toBe('account');
    expect(current(blocked).fastPath).toBe(false);

    const unknown = activated(withFile(table, { profile: savedProfile(table, { account_id: null }) }), ['', {}]);
    expect(unknown.step).toBe('account');
  });

  it('applies a format saved earlier in the run to a file that is still waiting in the queue', () => {
    const waiting = withFile(table);
    expect(waiting.statements[0]).toMatchObject({ profile: null, layoutSource: 'detected' });

    const found = run(waiting, { type: 'profileFound', statementId: 'file-1:0', profiles: [savedProfile(table)], table, readOptions: {} });
    expect(found.statements[0]).toMatchObject({ layoutSource: 'profile', formatName: 'My bank', profile: { id: 7 } });
    // ...so it takes the fast path like any repeat import.
    const fast = activated(found, ['', { status: 'assumed', basis: 'profile', accountId: 1, cardId: 11, candidateAccountIds: [1] }]);
    expect(fast.step).toBe('summary');

    // A file the user already started deciding about keeps their decisions.
    const edited = run(activated(waiting, ['', RECOGNISED]), { type: 'amountSignSet', sign: 'inverted' });
    const kept = run(edited, { type: 'profileFound', statementId: 'file-1:0', profiles: [savedProfile(table)], table, readOptions: {} });
    expect(current(kept)).toMatchObject({ profile: null, layoutSource: 'detected', layout: { amountSign: 'inverted' } });
  });

  it('does not trust a format saved for another account with the direction of money', () => {
    // The checking export was saved (negative = money out). The same bank's card export has the
    // same header, and the file names the card.
    const card = { status: 'recognised', basis: 'fullNumber', accountId: 2, cardId: 22, candidateAccountIds: [2] } as const;
    const state = activated(withFile(table, { profile: savedProfile(table) }), ['', { ...card, candidateAccountIds: [2] }]);
    const statement = current(state);

    // No fast path: the columns and formats come from the saved format, the sign is inferred for a card...
    expect(state.step).toBe('account');
    expect(statement).toMatchObject({ fastPath: false, layoutSource: 'profile', profileForOtherAccount: true });
    expect(statement.layout).toMatchObject({ roles: savedProfile(table).config.layout.roles, amountSign: 'inverted' });
    expect(statement.report.rows[0].amount).toBe(4.5);
    // ...and is the one thing asked again, with the analysis's warning still on show until then.
    expect(settingsToConfirm(statement)).toEqual(['amountSign']);
    expect(issuesBySeverity(statement, 'warning').map((issue) => issue.code)).toEqual(['signAssumed']);
    expect(importBlockers(statement)).toContainEqual({ kind: 'confirm', subjects: ['amountSign'] });

    const confirmed = run(state, { type: 'settingConfirmed', subject: 'amountSign' });
    expect(settingsToConfirm(current(confirmed))).toEqual([]);
    expect(issuesBySeverity(current(confirmed), 'warning')).toEqual([]);
    // Remembered, it becomes this account's own format rather than overwriting the other one's.
    expect(buildProfileInput(current(confirmed))).toMatchObject({ account_id: 2, config: { layout: { amountSign: 'inverted' } } });

    // Picking the account the format was saved for makes it a plain repeat import again.
    const back = run(state, { type: 'accountChosen', value: '', accountId: 1, cardId: 11 });
    expect(current(back)).toMatchObject({ profileForOtherAccount: false, layout: { amountSign: 'asIs' } });
    expect(settingsToConfirm(current(back))).toEqual([]);
  });

  it('reads the file with the format saved for its account when one layout was saved for two accounts', () => {
    const checking = savedProfile(table, { id: 7, name: 'Bank checking', account_id: 1 });
    const cardLayout = { ...checking.config.layout, amountSign: 'inverted' as const };
    const card = savedProfile(table, { id: 8, name: 'Bank card', account_id: 2, config: { version: 1, layout: cardLayout } });
    const loaded = withFile(table, { profiles: [checking, card] });
    expect(loaded.statements[0]).toMatchObject({ profile: { id: 7 }, formatName: 'Bank checking' });

    const state = activated(loaded, ['', { status: 'recognised', basis: 'fullNumber', accountId: 2, cardId: 22, candidateAccountIds: [2] }]);
    expect(state.step).toBe('summary');
    expect(current(state)).toMatchObject({
      fastPath: true,
      profile: { id: 8 },
      formatName: 'Bank card',
      profileForOtherAccount: false,
      layout: { amountSign: 'inverted' },
    });
  });

  it('takes a saved format as it is for a file with several accounts', () => {
    const twoAccounts = makeTable(
      [
        ['4821', '2030-02-01', 'Coffee', '-4.50'],
        ['9034', '2030-02-02', 'Fuel', '-30.00'],
      ],
      ['Account', 'Date', 'Description', 'Amount']
    );
    const state = activated(
      withFile(twoAccounts, { profile: savedProfile(twoAccounts, { account_id: null }) }),
      ['4821', RECOGNISED],
      ['9034', { status: 'recognised', basis: 'fullNumber', accountId: 2, cardId: 22, candidateAccountIds: [2] }]
    );
    expect(state.step).toBe('summary');
    expect(current(state)).toMatchObject({ fastPath: true, profileForOtherAccount: false });
  });

  it('ignores a saved format that does not fit the columns of the file', () => {
    const stale = savedProfile(table);
    stale.config = { version: 1, layout: { ...stale.config.layout, roles: { ...stale.config.layout.roles, amount: 9 } } };
    const state = withFile(table, { profile: stale });
    expect(state.statements[0]).toMatchObject({ profile: null, layoutSource: 'detected' });
  });

  it('can only move back through the steps, never ahead', () => {
    const state = readyForReview();
    expect(run(state, { type: 'goToStep', step: 'summary' }).step).toBe('review');
    expect(run(state, { type: 'goToStep', step: 'layout' }).step).toBe('layout');
    expect(run(state, { type: 'goToStep', step: 'files' }).step).toBe('files');
    // From Files, Next returns to the statement that is being worked on.
    expect(run(state, { type: 'goToStep', step: 'files' }, { type: 'next' }).step).toBe('account');
  });
});
