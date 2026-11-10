// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountResolution, ReadResult, SavedImportProfile, StageResult, StatementTable } from '@/lib/statementImport';
import type { ImportClassificationPreview } from '@/types/classification';
import type { Account, User } from '@/types/database';

import type { ImportLeaveGuard } from '../ImportPage';

// The wizard is tested against the contract, with a small stand-in for the
// pipeline: what the readers and the interpretation detect is their own tests' business.
const pipeline = vi.hoisted(() => ({ readStatement: vi.fn() }));
vi.mock('@/lib/statementImport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/statementImport')>();
  const fake = await import('./testing/fakePipeline');
  return { ...actual, readStatement: pipeline.readStatement, proposeLayout: fake.fakePropose, analyzeStatement: fake.fakeAnalyze };
});

const database = vi.hoisted(() => ({ slice: null as unknown }));
vi.mock('@/contexts/useDatabaseSlices', () => ({ useImportWizardSlice: () => database.slice }));

// "Ask AI" has its own test; here it would need the AI providers.
vi.mock('./AiLayoutHelp', () => ({ default: () => null }));

import ImportWizard from './ImportWizard';
import { SIMPLE_ROWS, fakePropose, makeTable } from './testing/fakePipeline';

const NOW = '2030-01-01T00:00:00.000Z';
const ACCOUNTS: Account[] = [
  { id: 1, name: 'Household Checking', type: 'checking', owner_user_id: 1, owner_display_name: 'Alex', currency: 'USD', created_at: NOW, updated_at: NOW },
  { id: 2, name: 'Rewards Visa', type: 'credit', owner_user_id: 1, owner_display_name: 'Alex', currency: 'USD', created_at: NOW, updated_at: NOW },
];
const USERS = [{ id: 1, display_name: 'Alex', is_primary: 1, created_at: NOW, updated_at: NOW }] as User[];

const EMPTY_CLASSIFICATION: ImportClassificationPreview = {
  pairs: [],
  rowDecisions: [],
  existingDecisions: [],
  summary: { stagedRows: 0, ruleMatches: 0, refundsInferred: 0, transfersDetected: 0, transfersWithExisting: 0, possibleTransfers: 0 },
};

function unknown(value: string): AccountResolution {
  return { value, status: 'unknown', basis: null, accountId: null, cardId: null, candidateAccountIds: [] };
}

function makeSlice() {
  return {
    accounts: ACCOUNTS,
    users: USERS,
    defaultCurrency: 'USD',
    addAccountWithCard: vi.fn(async () => ({ accountId: 3, cardId: 33 })),
    addUser: vi.fn(async () => 2),
    getAccountCards: vi.fn(async (accountId: number) => [{ id: accountId * 11, last_four: '4821' }]),
    findImportProfiles: vi.fn(async (): Promise<SavedImportProfile[]> => []),
    saveImportProfile: vi.fn(async () => 7),
    recordImportProfileUse: vi.fn(async () => undefined),
    resolveImportAccounts: vi.fn(async (values: string[]): Promise<AccountResolution[]> => values.map(unknown)),
    addAccountIdentifier: vi.fn(async () => 1),
    getAccountImportCoverage: vi.fn(async () => []),
    stageImportRows: vi.fn(
      async (rows: Array<{ rowIndex: number }>): Promise<StageResult> => ({
        tempIds: rows.map((_, index) => 100 + index),
        alreadyImported: [],
        duplicateGroups: [],
      })
    ),
    discardStagedImport: vi.fn(async () => undefined),
    previewImportClassification: vi.fn(async () => EMPTY_CLASSIFICATION),
    decisionsForTransferPairs: vi.fn(() => []),
    commitStagedImport: vi.fn(async () => ({ batchId: 5, inserted: 3, duplicates: 0 })),
    undoImportBatch: vi.fn(),
    applyLoanRules: vi.fn(async () => ({})),
    runSubscriptionScan: vi.fn(async () => ({})),
  };
}

let slice: ReturnType<typeof makeSlice>;

function readsAs(...tables: StatementTable[]) {
  pipeline.readStatement.mockImplementation(async (): Promise<ReadResult> => ({ tables, issues: [] }));
}

function renderWizard() {
  const props = {
    onClose: vi.fn(),
    onViewTransactions: vi.fn(),
    onOpenHistory: vi.fn(),
    setLeaveGuard: vi.fn<(guard: ImportLeaveGuard | null) => void>(),
  };
  render(<ImportWizard {...props} />);
  return props;
}

function addFile(name = 'statement.csv') {
  const file = new File(['bytes'], name, { type: 'text/csv' });
  // Older jsdom builds have no Blob.arrayBuffer.
  if (typeof file.arrayBuffer !== 'function') {
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(4) });
  }
  fireEvent.change(screen.getByTestId('import-file-input'), { target: { files: [file] } });
}

const step = () => screen.getByTestId('import-wizard').getAttribute('data-step');
const click = (testId: string) => fireEvent.click(screen.getByTestId(testId));
const next = () => click('import-next');

async function waitForStep(expected: string) {
  await waitFor(() => expect(step()).toBe(expected));
  await waitFor(() => expect(screen.queryByTestId('import-busy')).toBeNull());
}

async function chooseAccount(index: number, name: RegExp) {
  fireEvent.mouseDown(screen.getByTestId(`import-account-${index}-select`));
  fireEvent.click(await screen.findByRole('option', { name }));
  await waitFor(() => expect(screen.getByTestId(`import-account-${index}`)).toHaveAttribute('data-status', 'chosen'));
}

/** Files → Account (pick Household Checking) → Layout (confirm) → Review. */
async function walkToReview() {
  addFile();
  await screen.findByTestId('import-file-rows');
  next();
  await waitForStep('account');
  await chooseAccount(0, /Household Checking/);
  next();
  await waitForStep('layout');
  click('import-confirm-dateOrder');
  click('import-confirm-amountSign');
  next();
  await waitForStep('review');
}

async function walkToSummary() {
  await walkToReview();
  await waitFor(() => expect(screen.getByTestId('import-next')).toBeEnabled());
  next();
  await waitForStep('summary');
  await waitFor(() => expect(screen.getByTestId('import-run')).toBeEnabled());
}

/** Desktop width: the frame shows the stepper (mocks are reset between tests, so this is installed each time). */
function installMatchMedia(matches = false) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => {
  installMatchMedia(false);
  slice = makeSlice();
  database.slice = slice;
  pipeline.readStatement.mockReset();
  readsAs(makeTable(SIMPLE_ROWS));
});

describe('ImportWizard', () => {
  it('imports a new file step by step: account, how it is read, things to check, summary, done', async () => {
    const props = renderWizard();
    expect(step()).toBe('files');
    expect(screen.getByTestId('import-next')).toBeDisabled();

    // Files: the card says what was recognised.
    addFile();
    expect(await screen.findByTestId('import-file-rows')).toHaveTextContent('3 rows');
    expect(screen.getByText('Feb 1, 2030 – Feb 3, 2030')).toBeInTheDocument();
    expect(screen.getByText('New format')).toBeInTheDocument();

    // Account: the file names none, so the wizard asks and waits for the answer.
    next();
    await waitForStep('account');
    expect(screen.getByText("The file doesn't say which account it is for")).toBeInTheDocument();
    expect(screen.getByTestId('import-account-0')).toHaveAttribute('data-status', 'open');
    expect(screen.getByTestId('import-next')).toBeDisabled();
    await chooseAccount(0, /Household Checking/);

    // Check how we read it: the rows as interpreted, and the settings the wizard is not sure about.
    next();
    await waitForStep('layout');
    const rows = within(screen.getByTestId('import-interpreted-table')).getAllByTestId('import-interpreted-row');
    expect(rows[0]).toHaveTextContent('Feb 1, 2030');
    expect(rows[0]).toHaveTextContent('Coffee Shop');
    expect(rows[0]).toHaveTextContent('$4.50');
    expect(rows[1]).toHaveTextContent('$1,200.00');
    expect(screen.getByTestId('import-sign-example')).toHaveTextContent('“Coffee Shop” (-4.50) is read as money out: you paid $4.50.');
    expect(screen.getByTestId('import-date-example')).toHaveTextContent('“2030-02-01” is read as February 1, 2030.');
    expect(screen.getByTestId('import-setting-amountSign')).toHaveAttribute('data-pending', 'true');
    expect(screen.getByTestId('import-next')).toBeDisabled();
    expect(screen.getByTestId('import-hint')).toHaveTextContent('Confirm the highlighted settings to continue.');
    click('import-confirm-dateOrder');
    click('import-confirm-amountSign');
    expect(screen.getByTestId('import-setting-amountSign')).toHaveAttribute('data-pending', 'false');

    // Things to check: nothing blocks; the assumptions are listed by their codes.
    next();
    await waitForStep('review');
    await waitFor(() => expect(slice.stageImportRows).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('import-review-status')).toHaveAttribute('data-blocked', 'false');
    expect(screen.getAllByTestId('import-assumption').map((node) => node.getAttribute('data-assumption-code'))).toEqual([
      'dateOrderFallback',
      'decimalFallback',
      'signAsPrinted',
    ]);

    // Summary: counts, totals, and the format is remembered by default.
    await waitFor(() => expect(screen.getByTestId('import-next')).toBeEnabled());
    next();
    await waitForStep('summary');
    expect(screen.getByTestId('import-summary-accounts')).toHaveTextContent('Alex - Household Checking');
    await waitFor(() => expect(screen.getByTestId('import-summary-to-import')).toHaveTextContent('3'));
    expect(screen.getByTestId('import-summary-money-in')).toHaveTextContent('$1,200.00');
    expect(screen.getByTestId('import-summary-money-out')).toHaveTextContent('$67.70');
    expect(screen.getByTestId('import-remember')).toBeChecked();
    expect(screen.getByTestId('import-format-name')).toHaveValue('statement');
    expect(screen.getByTestId('import-run')).toHaveTextContent('Import 3 transactions');

    click('import-run');
    expect(await screen.findByTestId('import-done')).toHaveAttribute('data-inserted', '3');
    expect(screen.getByTestId('import-result-0')).toHaveTextContent('3 transactions imported');

    expect(slice.saveImportProfile).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'statement', format: 'delimited', fingerprint: 'delimited:date|description|amount', account_id: 1 }),
      undefined
    );
    expect(slice.commitStagedImport).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'statement.csv', format: 'delimited', profileId: 7, accountIds: [1], totalRows: 3, skippedRows: 0 })
    );
    expect(slice.stageImportRows.mock.calls.at(-1)?.[0]).toEqual([
      expect.objectContaining({ rowIndex: 0, accountId: 1, cardId: 11, date: '2030-02-01', amount: -4.5, description: 'Coffee Shop' }),
      expect.objectContaining({ rowIndex: 1, amount: 1200 }),
      expect.objectContaining({ rowIndex: 2, amount: -63.2 }),
    ]);
    expect(slice.recordImportProfileUse).toHaveBeenCalledWith(7, 1);
    // A file that names no account has nothing to remember it by.
    expect(slice.addAccountIdentifier).not.toHaveBeenCalled();
    // Loan rules claim their payments before the subscription scan sees them.
    await waitFor(() => expect(slice.runSubscriptionScan).toHaveBeenCalledTimes(1));
    expect(slice.applyLoanRules.mock.invocationCallOrder[0]).toBeLessThan(slice.runSubscriptionScan.mock.invocationCallOrder[0]);

    click('import-view-transactions');
    expect(props.onViewTransactions).toHaveBeenCalledTimes(1);
    click('import-undo');
    expect(props.onOpenHistory).toHaveBeenCalledTimes(1);
    click('import-another');
    expect(step()).toBe('files');
    expect(screen.queryByTestId('import-file-card')).toBeNull();
  });

  it('flips the sign when the user says the example is the other way round', async () => {
    renderWizard();
    addFile();
    await screen.findByTestId('import-file-rows');
    next();
    await waitForStep('account');
    await chooseAccount(0, /Household Checking/);
    next();
    await waitForStep('layout');

    click('import-flip-sign');
    expect(screen.getByTestId('import-sign-example')).toHaveTextContent('“Coffee Shop” (-4.50) is read as money in: you received $4.50.');
    // Answering is confirming: the wizard does not ask again.
    expect(screen.getByTestId('import-setting-amountSign')).toHaveAttribute('data-pending', 'false');
  });

  it('shows an assumed account with its reason and remembers the identifier once confirmed', async () => {
    readsAs(makeTable([['9034', '2030-02-02', 'Fuel', '-30.00']], ['Account', 'Date', 'Description', 'Amount']));
    slice.resolveImportAccounts.mockResolvedValue([
      { value: '9034', status: 'assumed', basis: 'lastFour', accountId: 2, cardId: 22, candidateAccountIds: [2] },
    ]);
    slice.commitStagedImport.mockResolvedValue({ batchId: 6, inserted: 1, duplicates: 0 });
    renderWizard();
    addFile();
    await screen.findByTestId('import-file-rows');
    next();
    await waitForStep('account');

    const card = screen.getByTestId('import-account-0');
    expect(card).toHaveAttribute('data-status', 'assumed');
    expect(card).toHaveTextContent('In the file: 9034');
    // The reason is the catalog's finding (shown as its code until the texts land).
    expect(card.querySelector('[data-issue-code="accountAssumedByLastFour"]')).not.toBeNull();
    expect(screen.getByTestId('import-next')).toBeDisabled();

    click('import-account-0-confirm');
    expect(screen.getByTestId('import-next')).toBeEnabled();
    next();
    await waitForStep('layout');
    click('import-confirm-dateOrder');
    click('import-confirm-amountSign');
    next();
    await waitForStep('review');
    await waitFor(() => expect(screen.getByTestId('import-next')).toBeEnabled());
    next();
    await waitForStep('summary');
    await waitFor(() => expect(screen.getByTestId('import-run')).toBeEnabled());
    click('import-run');
    await screen.findByTestId('import-done');

    expect(slice.addAccountIdentifier).toHaveBeenCalledWith({ account_id: 2, kind: 'number', value: '9034', source: 'import' });
  });

  it('keeps Import out of reach until unreadable rows are fixed or left out (D7, D8)', async () => {
    readsAs(
      makeTable([
        ['2030-02-01', 'Coffee Shop', '-4.50'],
        ['31/31/2030', 'Bad date', '-10.00'],
        ['2030-02-03', 'Bad amount', 'twelve'],
      ])
    );
    renderWizard();
    await walkToReview();

    expect(screen.getByTestId('import-review-status')).toHaveAttribute('data-blocked', 'true');
    const blockers = within(screen.getByTestId('import-review-blockers')).getAllByTestId('import-issue');
    expect(blockers.map((node) => node.getAttribute('data-issue-code'))).toEqual(['unreadableDate', 'unreadableAmount']);
    expect(blockers[0]).toHaveTextContent('Line 3');
    expect(blockers[0]).toHaveTextContent('31/31/2030');
    expect(screen.getByTestId('import-next')).toBeDisabled();

    // Fix the date in place...
    fireEvent.click(within(blockers[0]).getByTestId('import-row-fix'));
    fireEvent.change(screen.getByTestId('import-row-date'), { target: { value: '2030-02-02' } });
    click('import-row-save');
    await waitFor(() => expect(within(screen.getByTestId('import-review-blockers')).getAllByTestId('import-issue')).toHaveLength(1));
    expect(screen.getByTestId('import-next')).toBeDisabled();

    // ...and leave the other row out.
    click('import-row-skip');
    await waitFor(() => expect(screen.getByTestId('import-review-status')).toHaveAttribute('data-blocked', 'false'));
    expect(screen.queryByTestId('import-review-blockers')).toBeNull();
    const changes = within(screen.getByTestId('import-review-changes')).getAllByTestId('import-change');
    expect(changes.map((node) => node.textContent)).toEqual([
      expect.stringContaining('Line 3: fixed'),
      expect.stringContaining('Line 4: left out'),
    ]);

    await waitFor(() => expect(screen.getByTestId('import-next')).toBeEnabled());
    next();
    await waitForStep('summary');
    await waitFor(() => expect(screen.getByTestId('import-run')).toHaveTextContent('Import 2 transactions'));
    expect(screen.getByTestId('import-summary-skipped')).toHaveTextContent('1');
    expect(slice.stageImportRows.mock.calls.at(-1)?.[0]).toEqual([
      expect.objectContaining({ rowIndex: 0 }),
      expect.objectContaining({ rowIndex: 1, date: '2030-02-02', amount: -10 }),
    ]);

    // Undoing the skip brings the blocker back, and Import with it out of reach.
    fireEvent.click(screen.getByTestId('import-back'));
    await waitForStep('review');
    fireEvent.click(within(screen.getByTestId('import-review-changes')).getAllByTestId('import-change-undo')[1]);
    await waitFor(() => expect(screen.getByTestId('import-review-status')).toHaveAttribute('data-blocked', 'true'));
    expect(screen.getByTestId('import-next')).toBeDisabled();
  });

  it('lists repeated rows, detected transfers and rows already imported, and commits what the user kept', async () => {
    slice.stageImportRows.mockImplementation(async (rows) => ({
      tempIds: rows.map((_, index) => 100 + index),
      alreadyImported: [1],
      duplicateGroups: [{ rowIndexes: [0, 2] }],
    }));
    slice.previewImportClassification.mockResolvedValue({
      ...EMPTY_CLASSIFICATION,
      pairs: [
        {
          pairId: 'pair-1',
          outKey: 'tmp:100',
          inKey: 'tx:900',
          confidence: 0.92,
          dateGapDays: 1,
          reasons: ['same amount'],
          involvesExisting: true,
          recommended: true,
          out: { key: 'tmp:100', id: null, tempId: 100, account_id: 1, account_name: 'Household Checking', date: '2030-02-01', amount: -4.5, description: 'Coffee Shop', isNew: true },
          in: { key: 'tx:900', id: 900, tempId: null, account_id: 2, account_name: 'Rewards Visa', date: '2030-02-02', amount: 4.5, description: 'PAYMENT RECEIVED', isNew: false },
        },
      ],
      summary: { ...EMPTY_CLASSIFICATION.summary, refundsInferred: 1 },
    });
    slice.decisionsForTransferPairs.mockReturnValue([
      { key: 'tmp:100', type: 'transfer', source: 'pair', confidence: 0.92, transferGroupId: 'g', ruleId: null, pairedWithKey: 'tx:900', reasons: [] },
      { key: 'tx:900', type: 'transfer', source: 'pair', confidence: 0.92, transferGroupId: 'g', ruleId: null, pairedWithKey: 'tmp:100', reasons: [] },
    ] as never);
    slice.commitStagedImport.mockResolvedValue({ batchId: 8, inserted: 1, duplicates: 1 });
    renderWizard();
    await walkToReview();

    const duplicates = await screen.findByTestId('import-review-duplicates');
    expect(duplicates).toHaveTextContent('2 identical rows: Feb 1, 2030 · Coffee Shop · -$4.50');
    const transfers = screen.getByTestId('import-review-transfers');
    expect(transfers).toHaveTextContent('Rewards Visa · Feb 2, 2030 · already imported');
    expect(transfers).toHaveTextContent('1 refund detected.');
    expect(screen.getByTestId('import-transfer-0')).toBeChecked();
    expect(within(screen.getByTestId('import-review-notes')).getByTestId('import-issue')).toHaveAttribute('data-issue-code', 'alreadyImported');

    // Leave the second copy out.
    expect(screen.getByTestId('import-duplicate-0-1')).toBeChecked();
    click('import-duplicate-0-1');

    next();
    await waitForStep('summary');
    await waitFor(() => expect(screen.getByTestId('import-run')).toHaveTextContent('Import 1 transaction'));
    expect(screen.getByTestId('import-summary-already')).toHaveTextContent('1');
    expect(screen.getByTestId('import-summary-skipped')).toHaveTextContent('1');
    expect(screen.getByTestId('import-summary-transfers')).toHaveTextContent('1');

    click('import-run');
    await screen.findByTestId('import-done');
    expect(slice.commitStagedImport).toHaveBeenCalledWith(
      expect.objectContaining({
        excludedTempIds: [102],
        skippedRows: 1,
        stagedDecisions: [expect.objectContaining({ key: 'tmp:100' })],
        existingDecisions: [expect.objectContaining({ key: 'tx:900' })],
      })
    );
    const result = screen.getByTestId('import-result-0');
    expect(result).toHaveTextContent('1 transaction imported');
    expect(result).toHaveTextContent('1 row was already imported and was left out');
    expect(result).toHaveTextContent('1 transfer between your accounts');
    expect(result).toHaveTextContent('1 refund detected');
  });

  it('shows how the file lines up with what the account already has', async () => {
    slice.getAccountImportCoverage.mockResolvedValue([
      { accountId: 1, firstDate: '2029-11-03', lastDate: '2030-02-02', lastImportThrough: '2030-02-02', transactionCount: 412 },
    ] as never);
    renderWizard();
    await walkToReview();

    expect(slice.getAccountImportCoverage).toHaveBeenCalledWith([1]);
    const coverage = await screen.findByTestId('import-review-coverage');
    expect(coverage).toHaveTextContent('This account already has 412 transactions, from Nov 3, 2029 to Feb 2, 2030.');
    // The finding itself, in the catalog's words, with its period shown as the user reads dates.
    const finding = within(coverage).getByTestId('import-issue');
    expect(finding).toHaveAttribute('data-issue-code', 'overlapsExisting');
    expect(finding).toHaveTextContent('Part of this file is already in the account');
    expect(finding).toHaveTextContent('The account already has transactions between Nov 3, 2029 and Feb 2, 2030.');
    // It is information, not a reason to stop.
    expect(screen.getByTestId('import-review-status')).toHaveAttribute('data-blocked', 'false');
    await waitFor(() => expect(screen.getByTestId('import-next')).toBeEnabled());
  });

  it('lists a total line the analysis left out and brings it back when asked', async () => {
    readsAs(
      makeTable([
        ['2030-02-01', 'Coffee Shop', '-4.50'],
        ['', 'Total for February', '-4.50'],
      ])
    );
    renderWizard();
    await walkToReview();

    const notes = screen.getByTestId('import-review-notes');
    const totalLine = within(notes).getByTestId('import-issue-row');
    expect(within(notes).getByTestId('import-issue')).toHaveAttribute('data-issue-code', 'summaryRow');
    expect(within(notes).getByTestId('import-issue')).toHaveTextContent('1 total line was left out');
    expect(totalLine).toHaveAttribute('data-skipped', 'true');
    expect(totalLine).toHaveTextContent('Total for February · -4.50');
    expect(screen.getByTestId('import-review-status')).toHaveAttribute('data-blocked', 'false');

    // Brought back, it is a row like any other: without a date it has to be fixed or left out.
    fireEvent.click(within(totalLine).getByTestId('import-row-restore'));
    await waitFor(() => expect(screen.getByTestId('import-review-status')).toHaveAttribute('data-blocked', 'true'));
    expect(within(screen.getByTestId('import-review-changes')).getByTestId('import-change')).toHaveTextContent('Line 3: imported after all');
    expect(within(screen.getByTestId('import-review-blockers')).getByTestId('import-issue')).toHaveAttribute('data-issue-code', 'unreadableDate');

    click('import-change-undo');
    await waitFor(() => expect(screen.getByTestId('import-review-status')).toHaveAttribute('data-blocked', 'false'));
    expect(screen.queryByTestId('import-review-changes')).toBeNull();
  });

  it('takes a known format straight to the Summary, with the details one click away (D16)', async () => {
    const table = makeTable(SIMPLE_ROWS);
    const profile: SavedImportProfile = {
      id: 7,
      name: 'My bank',
      format: 'delimited',
      fingerprint: table.fingerprint,
      institution: null,
      account_id: 1,
      use_count: 2,
      last_used_at: NOW,
      created_at: NOW,
      updated_at: NOW,
      config: { version: 1, layout: fakePropose(table, {}).layout },
    };
    slice.findImportProfiles.mockResolvedValue([profile]);
    slice.resolveImportAccounts.mockResolvedValue([
      { value: '', status: 'assumed', basis: 'profile', accountId: 1, cardId: null, candidateAccountIds: [1] },
    ]);
    renderWizard();
    addFile();
    expect(await screen.findByTestId('import-file-saved-format')).toHaveTextContent('Same format as last time: My bank');

    next();
    await waitForStep('summary');
    expect(slice.resolveImportAccounts).toHaveBeenCalledWith([''], { profileAccountId: 1 });
    expect(screen.getByTestId('import-fast-path')).toHaveTextContent('Same format as last time (“My bank”). Nothing needs your attention.');
    // The account is a guess, and says so; pressing Import accepts it.
    expect(screen.getByTestId('import-summary-accounts')).toHaveTextContent('Alex - Household Checking');
    expect(screen.getByTestId('import-summary-assumed')).toHaveTextContent('Account assumed from last time');
    await waitFor(() => expect(screen.getByTestId('import-run')).toBeEnabled());

    // The details are one click away, and there the guess is confirmed the usual way.
    click('import-review-details');
    await waitForStep('account');
    expect(screen.getByTestId('import-account-0')).toHaveAttribute('data-status', 'assumed');
    click('import-account-0-confirm');
    next();
    await waitForStep('layout');
    expect(screen.getByTestId('import-layout-saved')).toHaveTextContent('Read the same way as last time (“My bank”).');
    // A saved format was confirmed when it was saved.
    expect(screen.getByTestId('import-next')).toBeEnabled();
    next();
    await waitForStep('review');
    await waitFor(() => expect(screen.getByTestId('import-next')).toBeEnabled());
    next();
    await waitForStep('summary');
    await waitFor(() => expect(screen.getByTestId('import-run')).toBeEnabled());

    click('import-run');
    await screen.findByTestId('import-done');
    // The saved format is updated in place, not duplicated.
    expect(slice.saveImportProfile).toHaveBeenCalledWith(expect.objectContaining({ name: 'My bank' }), 7);
    expect(slice.commitStagedImport).toHaveBeenCalledWith(expect.objectContaining({ profileId: 7 }));
  });

  it('writes no empty batch when every row is already imported', async () => {
    slice.stageImportRows.mockImplementation(async (rows) => ({
      tempIds: rows.map((_, index) => 100 + index),
      alreadyImported: rows.map((row) => row.rowIndex),
      duplicateGroups: [],
    }));
    renderWizard();
    await walkToSummary();

    expect(screen.getByTestId('import-nothing-new')).toHaveTextContent('All 3 rows in this file are already imported.');
    expect(screen.getByTestId('import-run')).toHaveTextContent('Continue');
    click('import-run');

    const done = await screen.findByTestId('import-done');
    expect(done).toHaveAttribute('data-inserted', '0');
    expect(done).toHaveAttribute('data-duplicates', '3');
    expect(screen.getByTestId('import-result-0')).toHaveAttribute('data-outcome', 'nothingNew');
    expect(slice.commitStagedImport).not.toHaveBeenCalled();
    expect(slice.saveImportProfile).not.toHaveBeenCalled();
    expect(slice.discardStagedImport).toHaveBeenCalled();
    // Nothing was written, so there is nothing to scan.
    expect(slice.applyLoanRules).not.toHaveBeenCalled();
  });

  it('imports several files one after the other and scans once at the end (D12)', async () => {
    // The format the first file saves is found again when the second file's turn comes.
    const table = makeTable(SIMPLE_ROWS);
    slice.findImportProfiles.mockImplementation(async () =>
      slice.saveImportProfile.mock.calls.length === 0
        ? []
        : [
            {
              id: 7,
              name: 'first',
              format: 'delimited',
              fingerprint: table.fingerprint,
              institution: null,
              account_id: 1,
              use_count: 1,
              last_used_at: NOW,
              created_at: NOW,
              updated_at: NOW,
              config: { version: 1, layout: fakePropose(table, {}).layout },
            },
          ]
    );
    slice.resolveImportAccounts.mockImplementation(async (values: string[], options?: { profileAccountId?: number | null }) =>
      values.map((value) =>
        options?.profileAccountId
          ? { value, status: 'assumed', basis: 'profile', accountId: options.profileAccountId, cardId: null, candidateAccountIds: [options.profileAccountId] }
          : unknown(value)
      )
    );
    renderWizard();
    addFile('first.csv');
    addFile('second.csv');
    await waitFor(() => expect(screen.getAllByTestId('import-file-rows')).toHaveLength(2));

    next();
    await waitForStep('account');
    expect(screen.getByTestId('import-queue-label')).toHaveTextContent('File 1 of 2: first.csv');
    await chooseAccount(0, /Household Checking/);
    next();
    await waitForStep('layout');
    click('import-confirm-dateOrder');
    click('import-confirm-amountSign');
    next();
    await waitForStep('review');
    await waitFor(() => expect(screen.getByTestId('import-next')).toBeEnabled());
    next();
    await waitForStep('summary');
    await waitFor(() => expect(screen.getByTestId('import-run')).toBeEnabled());
    click('import-run');

    // The first file is committed before the second is touched, and its format carries over:
    // the second file opens on the Summary.
    await waitFor(() => expect(screen.getByTestId('import-queue-label')).toHaveTextContent('File 2 of 2: second.csv'));
    await waitForStep('summary');
    expect(screen.getByTestId('import-fast-path')).toBeInTheDocument();
    expect(slice.commitStagedImport).toHaveBeenCalledTimes(1);
    expect(slice.applyLoanRules).not.toHaveBeenCalled();
    expect(slice.resolveImportAccounts).toHaveBeenLastCalledWith([''], { profileAccountId: 1 });

    await waitFor(() => expect(screen.getByTestId('import-run')).toBeEnabled());
    click('import-run');
    const done = await screen.findByTestId('import-done');
    expect(done).toHaveAttribute('data-inserted', '6');
    expect(screen.getByTestId('import-result-0')).toHaveAttribute('data-outcome', 'imported');
    expect(screen.getByTestId('import-result-1')).toHaveAttribute('data-outcome', 'imported');
    expect(slice.commitStagedImport).toHaveBeenCalledTimes(2);
    // One batch per file; the scans run once, after the last.
    expect(slice.applyLoanRules).toHaveBeenCalledTimes(1);
    expect(slice.runSubscriptionScan).toHaveBeenCalledTimes(1);
  });

  it('can skip a file of the queue and still ends with one combined result', async () => {
    renderWizard();
    addFile('first.csv');
    addFile('second.csv');
    await waitFor(() => expect(screen.getAllByTestId('import-file-rows')).toHaveLength(2));
    next();
    await waitForStep('account');

    click('import-skip-file');
    await waitFor(() => expect(screen.getByTestId('import-queue-label')).toHaveTextContent('File 2 of 2: second.csv'));
    await waitForStep('account');
    click('import-skip-file');

    const done = await screen.findByTestId('import-done');
    expect(done).toHaveAttribute('data-inserted', '0');
    expect(screen.getByTestId('import-done-total')).toHaveTextContent('No new transactions were imported.');
    expect(screen.getByTestId('import-result-0')).toHaveAttribute('data-outcome', 'skipped');
    expect(screen.getByTestId('import-result-1')).toHaveAttribute('data-outcome', 'skipped');
    expect(slice.commitStagedImport).not.toHaveBeenCalled();
    expect(slice.applyLoanRules).not.toHaveBeenCalled();
  });

  it('shows "Step n of 6" with a progress bar instead of the stepper on a phone', () => {
    installMatchMedia(true);
    renderWizard();
    expect(screen.getByTestId('import-progress')).toHaveTextContent('Step 1 of 6 · Files');
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByTestId('import-stepper')).toBeNull();
  });

  it('creates an account without leaving the import, prefilled from the file', async () => {
    readsAs(makeTable([['Huntington Checking ending 8801', '2030-02-02', 'Fuel', '-30.00']], ['Account', 'Date', 'Description', 'Amount']));
    slice.addAccountWithCard.mockImplementation(async () => {
      // The provider refreshes the accounts before it resolves.
      slice.accounts = [
        ...ACCOUNTS,
        { id: 3, name: 'Huntington Checking', type: 'checking', owner_user_id: 1, owner_display_name: 'Alex', currency: 'USD', created_at: NOW, updated_at: NOW },
      ];
      return { accountId: 3, cardId: 33 };
    });
    renderWizard();
    addFile();
    await screen.findByTestId('import-file-rows');
    next();
    await waitForStep('account');

    fireEvent.mouseDown(screen.getByTestId('import-account-0-select'));
    fireEvent.click(await screen.findByRole('option', { name: 'Create a new account…' }));
    const form = await screen.findByTestId('import-account-form');
    expect(within(form).getByLabelText(/Account Name/)).toHaveValue('Huntington Checking');
    expect(within(form).getByLabelText(/Card \/ Account Number/)).toHaveValue('8801');

    fireEvent.click(within(form).getByTestId('import-account-create'));
    await waitFor(() => expect(screen.getByTestId('import-account-0')).toHaveAttribute('data-status', 'chosen'));
    expect(slice.addAccountWithCard).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Huntington Checking', type: 'checking', currency: 'USD' }),
      1,
      expect.objectContaining({ last_four: '8801' })
    );
    expect(screen.queryByTestId('import-account-form')).toBeNull();
    expect(screen.getByTestId('import-account-0-select')).toHaveTextContent('Alex - Huntington Checking');
    expect(screen.getByTestId('import-next')).toBeEnabled();
  });

  it('reads the file again with the reader choices made under Advanced', async () => {
    renderWizard();
    addFile();
    await screen.findByTestId('import-file-rows');
    next();
    await waitForStep('account');
    await chooseAccount(0, /Household Checking/);
    next();
    await waitForStep('layout');
    click('import-confirm-amountSign');

    // The second read finds other rows: a line was mistaken for the column names.
    readsAs(makeTable(SIMPLE_ROWS.slice(1)));
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.change(screen.getByTestId('import-advanced-header-line'), { target: { value: '2' } });
    fireEvent.mouseDown(screen.getByTestId('import-advanced-delimiter'));
    fireEvent.click(await screen.findByRole('option', { name: 'Semicolon' }));
    click('import-advanced-apply');

    await waitFor(() => expect(pipeline.readStatement).toHaveBeenLastCalledWith(expect.anything(), { headerLine: 2, delimiter: ';' }));
    await waitFor(() => expect(within(screen.getByTestId('import-interpreted-table')).getAllByTestId('import-interpreted-row')).toHaveLength(2));
    // The rows changed, so what was confirmed about them is asked again.
    await waitFor(() => expect(screen.getByTestId('import-setting-amountSign')).toHaveAttribute('data-pending', 'true'));
    // The account the user picked for the file is kept.
    await waitFor(() => expect(screen.queryByTestId('import-busy')).toBeNull());

    // Choices that cannot be read leave the file as it was and say so.
    pipeline.readStatement.mockResolvedValue({ tables: [], issues: [{ code: 'noDataRows', severity: 'blocker', scope: 'file' }] });
    click('import-advanced-apply');
    expect(await screen.findByTestId('import-advanced-failure')).toHaveTextContent('No transactions in this file');
    expect(within(screen.getByTestId('import-interpreted-table')).getAllByTestId('import-interpreted-row')).toHaveLength(2);
  });

  it('says why a file cannot be read and what to export instead', async () => {
    pipeline.readStatement.mockResolvedValue({ tables: [], issues: [{ code: 'unsupportedFormat', severity: 'blocker', scope: 'file' }] });
    renderWizard();
    addFile('statement.xlsx');

    // Why, and what to do instead, in the finding's own words.
    const card = await screen.findByTestId('import-file-unreadable');
    expect(card.querySelector('[data-issue-code="unsupportedFormat"]')).not.toBeNull();
    expect(card).toHaveTextContent('This kind of file cannot be imported');
    expect(card).toHaveTextContent("On your bank's website, choose CSV or OFX when you download the statement.");
    expect(screen.getByTestId('import-next')).toBeDisabled();
    expect(screen.getByTestId('import-hint')).toHaveTextContent('Add a file that can be imported to continue.');

    // Removing it leaves a clean slate.
    click('import-file-remove');
    expect(screen.queryByTestId('import-file-card')).toBeNull();
  });

  it('asks before leaving while a file is loaded, and stops asking when the import is done', async () => {
    const props = renderWizard();
    expect(props.setLeaveGuard).toHaveBeenLastCalledWith(null);

    addFile();
    await screen.findByTestId('import-file-rows');
    const guard = props.setLeaveGuard.mock.calls.at(-1)?.[0] as ImportLeaveGuard;
    expect(guard).toBeTypeOf('function');

    let answer: Promise<boolean> = Promise.resolve(true);
    act(() => {
      answer = guard();
    });
    expect(await screen.findByText('Discard this import?')).toBeInTheDocument();
    click('import-leave-stay');
    await expect(answer).resolves.toBe(false);

    act(() => {
      answer = guard();
    });
    await screen.findByText('Discard this import?');
    click('import-leave-discard');
    await expect(answer).resolves.toBe(true);

    // Removing the file leaves nothing to lose.
    click('import-file-remove');
    await waitFor(() => expect(props.setLeaveGuard).toHaveBeenLastCalledWith(null));
  });
});
