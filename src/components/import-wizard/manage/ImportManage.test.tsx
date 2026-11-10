// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { formatDateOnly, formatDateTime } from '@/lib/formatting';
import { i18n } from '@/lib/i18n';
import type { ImportBatchImpact, ImportProfileInput, SavedImportProfile } from '@/lib/statementImport/types';
import type { Account, AccountIdentifier, ImportBatch } from '@/types/database';

// A tiny in-memory "database" behind the mocked slice: mutations change it and
// an undo bumps transactionVersion, the way the real provider does.
const store = {
  accounts: [] as Account[],
  batches: [] as ImportBatch[],
  profiles: [] as SavedImportProfile[],
  identifiers: [] as AccountIdentifier[],
  transactionVersion: 0,
  listeners: new Set<() => void>(),
  bumpTransactions() {
    this.transactionVersion += 1;
    this.listeners.forEach((listener) => listener());
  },
};

const IMPACT: Omit<ImportBatchImpact, 'batchId'> = {
  transactions: 1234,
  editedSinceImport: 2,
  loanPayments: 1,
  transferPairs: 3,
};

const listImportBatches = vi.fn(async (_limit?: number) => [...store.batches]);
const getImportBatchImpact = vi.fn(async (batchId: number): Promise<ImportBatchImpact> => ({ batchId, ...IMPACT }));
const undoImportBatch = vi.fn(async (batchId: number): Promise<ImportBatchImpact> => {
  store.batches = store.batches.filter((batch) => batch.id !== batchId);
  store.bumpTransactions();
  return { batchId, ...IMPACT };
});
const runSubscriptionScan = vi.fn(async () => ({}));
const listImportProfiles = vi.fn(async () => [...store.profiles]);
const saveImportProfile = vi.fn(async (input: ImportProfileInput, id?: number) => {
  store.profiles = store.profiles.map((profile) =>
    profile.id === id
      ? { ...profile, name: input.name, account_id: input.account_id ?? null, institution: input.institution ?? null }
      : profile
  );
  return id ?? 0;
});
const deleteImportProfile = vi.fn(async (id: number) => {
  store.profiles = store.profiles.filter((profile) => profile.id !== id);
});
const listAccountIdentifiers = vi.fn(async (_accountId?: number) => [...store.identifiers]);
const addAccountIdentifier = vi.fn(async () => 0);
const removeAccountIdentifier = vi.fn(async (id: number) => {
  store.identifiers = store.identifiers.filter((identifier) => identifier.id !== id);
});

vi.mock('@/contexts/useDatabaseSlices', () => ({
  useImportManageSlice: () => {
    const [, force] = React.useReducer((count: number) => count + 1, 0);
    React.useEffect(() => {
      store.listeners.add(force);
      return () => {
        store.listeners.delete(force);
      };
    }, []);
    return {
      accounts: store.accounts,
      transactionVersion: store.transactionVersion,
      listImportBatches,
      getImportBatchImpact,
      undoImportBatch,
      runSubscriptionScan,
      listImportProfiles,
      saveImportProfile,
      deleteImportProfile,
      listAccountIdentifiers,
      addAccountIdentifier,
      removeAccountIdentifier,
    };
  },
}));

import ImportManage from './ImportManage';

const FULL_ACCOUNT_NUMBER = '400012344821';

const account = (id: number, name: string): Account => ({
  id,
  name,
  type: 'checking',
  owner_user_id: 1,
  created_at: '',
  updated_at: '',
});

const batch = (overrides: Partial<ImportBatch> & Pick<ImportBatch, 'id'>): ImportBatch => ({
  imported_at: '2026-11-09 14:30:00',
  source: 'csv',
  file_name: 'checking-october.csv',
  account_ids_json: '[1]',
  total_rows: 46,
  inserted_count: 40,
  duplicate_count: 3,
  skipped_count: 2,
  rejected_count: 1,
  min_date: '2026-10-01',
  max_date: '2026-10-31',
  profile_id: 5,
  file_format: 'delimited',
  issues_json: JSON.stringify({
    counts: { signAssumed: 1, alreadyImported: 3, unreadableDate: 2, columnNotImported: 2 },
    assumptions: ['dateOrder:dateOrderAmbiguous'],
    fixedRows: 2,
  }),
  profile_name: 'First Bank checking',
  ...overrides,
});

const profile = (overrides: Partial<SavedImportProfile> & Pick<SavedImportProfile, 'id'>): SavedImportProfile => ({
  name: 'First Bank checking',
  format: 'delimited',
  fingerprint: 'date|description|amount',
  institution: 'First Bank',
  account_id: 1,
  use_count: 4,
  last_used_at: '2026-11-09 14:30:00',
  created_at: '2026-08-01 09:00:00',
  updated_at: '2026-11-09 14:30:00',
  account_name: 'Household Checking',
  config: {
    version: 1,
    layout: { roles: { date: 0, description: [1], amount: 2 }, dateOrder: 'DMY', decimal: ',', amountSign: 'inverted' },
    reader: { delimiter: ';' },
  },
  ...overrides,
});

const identifier = (overrides: Partial<AccountIdentifier> & Pick<AccountIdentifier, 'id'>): AccountIdentifier => ({
  account_id: 1,
  kind: 'number',
  value: FULL_ACCOUNT_NUMBER,
  last_four: '4821',
  source: 'import',
  created_at: '2026-11-09 14:30:00',
  account_name: 'Household Checking',
  ...overrides,
});

function seed() {
  store.accounts = [account(1, 'Household Checking'), account(2, 'Rewards Visa')];
  store.batches = [
    batch({ id: 12 }),
    batch({
      id: 11,
      imported_at: '2026-10-02 08:00:00',
      file_name: 'visa.qfx',
      account_ids_json: '[2, 99]',
      inserted_count: 0,
      duplicate_count: 18,
      skipped_count: 0,
      rejected_count: 0,
      min_date: null,
      max_date: null,
      profile_id: null,
      profile_name: null,
      file_format: 'ofx',
      issues_json: '{"counts":{},"assumptions":[],"fixedRows":0}',
    }),
  ];
  store.profiles = [
    profile({ id: 5 }),
    profile({
      id: 6,
      name: 'Visa QFX',
      format: 'ofx',
      institution: null,
      account_id: null,
      account_name: null,
      use_count: 0,
      last_used_at: null,
    }),
  ];
  store.identifiers = [
    identifier({ id: 31 }),
    identifier({ id: 32, kind: 'label', value: 'joint checking', last_four: null, source: 'manual' }),
    identifier({ id: 33, account_id: 2, value: '5500000000002222', last_four: '2222', account_name: 'Rewards Visa' }),
  ];
}

function renderManage() {
  const onStartImport = vi.fn();
  render(<ImportManage onStartImport={onStartImport} />);
  return { onStartImport };
}

async function historyRows() {
  await screen.findByTestId('import-history-list');
  return screen.getAllByTestId('import-history-row');
}

beforeEach(() => {
  store.transactionVersion = 0;
  store.listeners.clear();
  seed();
  // The issue texts belong to the analysis side and change with it. These
  // tests bring their own: a plain title, a plural one, one that names a
  // column the stored summary does not keep, and codes with no text at all.
  // (useFindingText.test.tsx runs every code against the catalog as it ships.)
  i18n.removeResourceBundle('en-US', 'importIssues');
  i18n.addResourceBundle('en-US', 'importIssues', {
    issues: {
      signAssumed: { title: 'Sign was assumed' },
      unreadableDate: { title_one: '{{count}} row has a bad date', title_other: '{{count}} rows have a bad date' },
      columnNotImported: { title: '“{{column}}” is not imported' },
    },
  });
});

describe('ImportManage: empty states', () => {
  it('explains what will appear and offers to start an import when nothing has been imported', async () => {
    store.batches = [];
    store.profiles = [];
    store.identifiers = [];
    const { onStartImport } = renderManage();

    const empty = await screen.findByTestId('import-manage-empty');
    expect(within(empty).getByRole('heading', { name: 'Nothing imported yet' })).toBeTruthy();
    expect(within(empty).getByText(/^Import history: every file you imported/)).toBeTruthy();
    expect(within(empty).getByText(/^Saved formats: how each bank's file is read/)).toBeTruthy();
    expect(within(empty).getByText(/^Account numbers and names: what your files call each account/)).toBeTruthy();
    expect(screen.queryByTestId('import-history')).toBeNull();

    fireEvent.click(within(empty).getByRole('button', { name: 'Start an import' }));
    expect(onStartImport).toHaveBeenCalledTimes(1);
  });

  it('gives each empty list its own explanation next to the lists that have rows', async () => {
    store.profiles = [];
    store.identifiers = [];
    const { onStartImport } = renderManage();

    expect(await historyRows()).toHaveLength(2);
    const formatsEmpty = await screen.findByTestId('import-formats-empty');
    expect(formatsEmpty.textContent).toContain('No saved formats yet.');
    const identifiersEmpty = await screen.findByTestId('import-identifiers-empty');
    expect(identifiersEmpty.textContent).toContain('Nothing remembered yet.');

    fireEvent.click(within(formatsEmpty).getByRole('button', { name: 'Start an import' }));
    fireEvent.click(within(identifiersEmpty).getByRole('button', { name: 'Start an import' }));
    expect(onStartImport).toHaveBeenCalledTimes(2);
  });

  it('says so when a list cannot be loaded, and loads it on "Try again"', async () => {
    listImportBatches.mockRejectedValueOnce(new Error('worker timeout'));
    renderManage();

    const error = await screen.findByTestId('import-history-error');
    expect(error.textContent).toContain('This list could not be loaded.');
    // A failed list is not an empty one.
    expect(screen.queryByTestId('import-history-empty')).toBeNull();
    expect(screen.queryByTestId('import-manage-empty')).toBeNull();

    fireEvent.click(within(error).getByRole('button', { name: 'Try again' }));
    expect(await historyRows()).toHaveLength(2);
    expect(screen.queryByTestId('import-history-error')).toBeNull();
  });
});

describe('ImportManage: import history', () => {
  it('lists each import with its file, account, dates, counts, format and what the check found', async () => {
    renderManage();
    const [newest, older] = await historyRows();

    expect(listImportBatches).toHaveBeenCalledWith(200);
    expect(within(newest).getByTestId('import-history-file').textContent).toBe('checking-october.csv');
    expect(within(newest).getByTestId('import-history-when').textContent).toBe(
      formatDateTime(new Date('2026-11-09T14:30:00Z'))
    );
    expect(within(newest).getByTestId('import-history-accounts').textContent).toBe('Household Checking');
    expect(within(newest).getByTestId('import-history-range').textContent).toBe(
      `Transactions from ${formatDateOnly('2026-10-01')} to ${formatDateOnly('2026-10-31')}`
    );
    expect(within(newest).getByTestId('import-history-count-imported').textContent).toBe('40');
    expect(within(newest).getByTestId('import-history-count-duplicates').textContent).toBe('3');
    expect(within(newest).getByTestId('import-history-count-skipped').textContent).toBe('2');
    expect(within(newest).getByTestId('import-history-count-rejected').textContent).toBe('1');
    expect(within(newest).getByTestId('import-history-details').textContent).toBe(
      'Text file (CSV) · Saved format: First Bank checking'
    );
    // Most serious first. A plural title carries its count; a plain title gets one only above 1;
    // a title that needs a column name gives way to the history's own label; no text → the code.
    const findings = within(newest).getByTestId('import-history-findings');
    expect(within(findings).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '2 rows have a bad date',
      'Sign was assumed',
      'alreadyImported: 3',
      'Columns not imported: 2',
      'Assumptions confirmed: 1',
      'Rows corrected by hand: 2',
    ]);
    expect(findings.textContent).not.toContain('{{');

    // An OFX file that added nothing, into one account that still exists and one that does not.
    expect(within(older).getByTestId('import-history-file').textContent).toBe('visa.qfx');
    expect(within(older).getByTestId('import-history-accounts').textContent).toBe('Rewards Visa, Deleted account');
    expect(within(older).getByTestId('import-history-range').textContent).toBe('No transactions were added');
    expect(within(older).getByTestId('import-history-count-imported').textContent).toBe('0');
    expect(within(older).getByTestId('import-history-count-duplicates').textContent).toBe('18');
    expect(within(older).getByTestId('import-history-details').textContent).toBe('OFX / QFX file');
    expect(within(older).getByTestId('import-history-findings').textContent).toBe('Nothing needed attention');
  });

  it('shows no findings line for an import made before the analysis was recorded', async () => {
    store.batches = [batch({ id: 3, file_name: null, issues_json: null, file_format: null, profile_id: null, profile_name: null })];
    renderManage();
    const [row] = await historyRows();

    expect(within(row).getByTestId('import-history-file').textContent).toBe('Unnamed file');
    expect(within(row).queryByTestId('import-history-findings')).toBeNull();
    expect(within(row).queryByTestId('import-history-details')).toBeNull();
  });

  it('reloads when transactions change', async () => {
    renderManage();
    expect(await historyRows()).toHaveLength(2);
    expect(listImportBatches).toHaveBeenCalledTimes(1);

    store.batches = [batch({ id: 13, file_name: 'savings.csv' }), ...store.batches];
    act(() => store.bumpTransactions());

    await waitFor(() => expect(screen.getAllByTestId('import-history-row')).toHaveLength(3));
    expect(listImportBatches).toHaveBeenCalledTimes(2);
    expect(screen.getAllByTestId('import-history-file')[0].textContent).toBe('savings.csv');
  });

  it('shows the ten newest imports until asked for all of them', async () => {
    store.batches = Array.from({ length: 12 }, (_, index) => batch({ id: 100 - index, file_name: `file-${index + 1}.csv` }));
    renderManage();
    expect(await historyRows()).toHaveLength(10);

    fireEvent.click(screen.getByRole('button', { name: 'Show all imports (12)' }));
    expect(screen.getAllByTestId('import-history-row')).toHaveLength(12);

    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(screen.getAllByTestId('import-history-row')).toHaveLength(10);
  });
});

describe('ImportManage: undo an import', () => {
  async function openUndo(rowIndex = 0) {
    const rows = await historyRows();
    fireEvent.click(within(rows[rowIndex]).getByRole('button', { name: 'Undo this import' }));
    return screen.findByRole('dialog', { name: 'Undo this import?' });
  }

  it('shows what the import added and that it cannot be reversed, then undoes it and rescans subscriptions', async () => {
    renderManage();
    const dialog = await openUndo();

    expect(getImportBatchImpact).toHaveBeenCalledWith(12);
    expect(dialog.textContent).toContain(`checking-october.csv, imported ${formatDateTime(new Date('2026-11-09T14:30:00Z'))}`);
    expect((await within(dialog).findByTestId('import-undo-transactions')).textContent).toBe('1,234');
    expect(within(dialog).getByTestId('import-undo-edited').textContent).toBe('2');
    expect(within(dialog).getByTestId('import-undo-loan-payments').textContent).toBe('1');
    expect(within(dialog).getByTestId('import-undo-transfer-pairs').textContent).toBe('3');
    expect(within(dialog).getByTestId('import-undo-edited-warning').textContent).toBe(
      'Categories, notes and other changes you made to these transactions after the import will be lost.'
    );
    // What happens to the half of a transfer that this import did not bring in.
    expect(dialog.textContent).toContain(
      'The other side of each transfer stays. It goes back to income or expense, unless you set its type yourself.'
    );
    expect(within(dialog).getByTestId('import-undo-irreversible').textContent).toBe(
      'This cannot be reversed. To get the transactions back, import the file again.'
    );
    expect(undoImportBatch).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Undo import' }));

    const notice = await screen.findByTestId('import-manage-notice-undone');
    expect(notice.textContent).toContain('The import of checking-october.csv was undone. Transactions removed: 1,234.');
    expect(undoImportBatch).toHaveBeenCalledWith(12);
    expect(runSubscriptionScan).toHaveBeenCalledTimes(1);
    expect(undoImportBatch.mock.invocationCallOrder[0]).toBeLessThan(runSubscriptionScan.mock.invocationCallOrder[0]);
    expect(screen.queryByRole('dialog')).toBeNull();

    await waitFor(() => expect(screen.getAllByTestId('import-history-row')).toHaveLength(1));
    expect(screen.getByTestId('import-history-file').textContent).toBe('visa.qfx');
  });

  it('removes nothing when the confirmation is cancelled', async () => {
    renderManage();
    const dialog = await openUndo();
    await within(dialog).findByTestId('import-undo-impact');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(undoImportBatch).not.toHaveBeenCalled();
    expect(runSubscriptionScan).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('import-history-row')).toHaveLength(2);
  });

  it('leaves out the edit warning and the transfer note when neither applies', async () => {
    getImportBatchImpact.mockResolvedValueOnce({
      batchId: 12,
      transactions: 40,
      editedSinceImport: 0,
      loanPayments: 0,
      transferPairs: 0,
    });
    renderManage();
    const dialog = await openUndo();

    await within(dialog).findByTestId('import-undo-impact');
    expect(within(dialog).queryByTestId('import-undo-edited-warning')).toBeNull();
    expect(dialog.textContent).not.toContain('The other side of each transfer stays.');
    expect(within(dialog).getByTestId('import-undo-irreversible')).toBeTruthy();
  });

  it('cannot be confirmed until the impact is known, and offers to read it again when that fails', async () => {
    getImportBatchImpact.mockRejectedValueOnce(new Error('worker timeout'));
    renderManage();
    const dialog = await openUndo();

    const error = await within(dialog).findByTestId('import-undo-impact-error');
    expect(error.textContent).toContain(
      'Could not work out what this import added, so it cannot be undone right now.'
    );
    expect(within(dialog).getByRole('button', { name: 'Undo import' })).toHaveProperty('disabled', true);

    fireEvent.click(within(error).getByRole('button', { name: 'Try again' }));
    expect((await within(dialog).findByTestId('import-undo-transactions')).textContent).toBe('1,234');
    expect(within(dialog).queryByTestId('import-undo-impact-error')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Undo import' })).toHaveProperty('disabled', false);
  });

  it('says so and drops the row when the import was already undone somewhere else', async () => {
    renderManage();
    expect(await historyRows()).toHaveLength(2);
    // Another tab undid import 12 after this list was read.
    store.batches = store.batches.filter((entry) => entry.id !== 12);
    getImportBatchImpact.mockRejectedValueOnce(new Error('IMPORT_BATCH_NOT_FOUND'));

    fireEvent.click(within(screen.getAllByTestId('import-history-row')[0]).getByRole('button', { name: 'Undo this import' }));

    const notice = await screen.findByTestId('import-manage-notice-batch-missing');
    expect(notice.textContent).toContain(
      'This import is no longer in the history. It may already have been undone, for example in another tab.'
    );
    expect(notice.textContent).not.toContain('IMPORT_BATCH_NOT_FOUND');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getAllByTestId('import-history-row')).toHaveLength(1));
    expect(screen.getByTestId('import-history-file').textContent).toBe('visa.qfx');
    expect(undoImportBatch).not.toHaveBeenCalled();
    expect(runSubscriptionScan).not.toHaveBeenCalled();
  });

  it('treats an import that vanished between the confirmation and the undo the same way', async () => {
    renderManage();
    const dialog = await openUndo();
    await within(dialog).findByTestId('import-undo-impact');
    store.batches = store.batches.filter((entry) => entry.id !== 12);
    undoImportBatch.mockRejectedValueOnce(new Error('IMPORT_BATCH_NOT_FOUND'));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Undo import' }));

    expect(await screen.findByTestId('import-manage-notice-batch-missing')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getAllByTestId('import-history-row')).toHaveLength(1));
    // Nothing was undone here, so nothing is rescanned and no "undone" notice is shown.
    expect(runSubscriptionScan).not.toHaveBeenCalled();
    expect(screen.queryByTestId('import-manage-notice-undone')).toBeNull();
  });

  it('explains a failed undo in words, runs no scan and keeps the row', async () => {
    undoImportBatch.mockRejectedValueOnce(new Error('SQLITE_BUSY: database is locked'));
    renderManage();
    const dialog = await openUndo();
    await within(dialog).findByTestId('import-undo-impact');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Undo import' }));

    const error = await within(dialog).findByTestId('import-undo-error');
    expect(error.textContent).toBe(
      'The import could not be undone. Try again; if it keeps failing, the Developer Console in Settings shows what went wrong.'
    );
    expect(runSubscriptionScan).not.toHaveBeenCalled();
    expect(screen.queryByTestId('import-manage-notice-undone')).toBeNull();
    expect(screen.getAllByTestId('import-history-row')).toHaveLength(2);
    // The dialog stays open so the undo can be tried again.
    expect(within(dialog).getByRole('button', { name: 'Undo import' })).toHaveProperty('disabled', false);
  });

  it('still reports the undo when the subscription scan after it fails', async () => {
    runSubscriptionScan.mockRejectedValueOnce(new Error('scan failed'));
    renderManage();
    const dialog = await openUndo();
    await within(dialog).findByTestId('import-undo-impact');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Undo import' }));

    expect(await screen.findByTestId('import-manage-notice-undone')).toBeTruthy();
    expect(screen.getByTestId('import-manage-notice-scan-failed').textContent).toContain(
      'The import was undone, but subscriptions could not be checked again. Open Subscriptions and choose Rescan.'
    );
  });

  it('keeps the confirmation of the undo when it was the last thing on the page', async () => {
    store.batches = [batch({ id: 12 })];
    store.profiles = [];
    store.identifiers = [];
    renderManage();
    const dialog = await openUndo();
    await within(dialog).findByTestId('import-undo-impact');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Undo import' }));

    expect(await screen.findByTestId('import-manage-notice-undone')).toBeTruthy();
    expect(await screen.findByTestId('import-manage-empty')).toBeTruthy();
    expect(runSubscriptionScan).toHaveBeenCalledTimes(1);
  });
});

describe('ImportManage: saved formats', () => {
  async function formatRows() {
    await screen.findByTestId('import-formats-list');
    return screen.getAllByTestId('import-format-row');
  }

  it('lists each format with its bank, file type, account and use', async () => {
    renderManage();
    const [used, unused] = await formatRows();

    expect(within(used).getByTestId('import-format-name').textContent).toBe('First Bank checking');
    expect(used.textContent).toContain('First Bank · Text file (CSV)');
    expect(within(used).getByTestId('import-format-account').textContent).toBe('Goes into: Household Checking');
    expect(within(used).getByTestId('import-format-usage').textContent).toBe(
      `Last used: ${formatDateOnly(new Date('2026-11-09T14:30:00Z'))} · Times used: 4`
    );

    expect(within(unused).getByTestId('import-format-name').textContent).toBe('Visa QFX');
    expect(unused.textContent).toContain('OFX / QFX file');
    expect(within(unused).getByTestId('import-format-account').textContent).toBe('Asks which account each time');
    expect(within(unused).getByTestId('import-format-usage').textContent).toBe('Not used yet · Times used: 0');
  });

  it('renames a format and moves it to another account without touching how the file is read', async () => {
    renderManage();
    const [row] = await formatRows();
    fireEvent.click(within(row).getByRole('button', { name: 'Edit format First Bank checking' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit saved format' });

    fireEvent.change(within(dialog).getByLabelText('Format name'), { target: { value: '  Joint account export ' } });
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: /Account/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Rewards Visa' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const original = profile({ id: 5 });
    expect(saveImportProfile).toHaveBeenCalledWith(
      {
        name: 'Joint account export',
        format: 'delimited',
        fingerprint: original.fingerprint,
        institution: 'First Bank',
        account_id: 2,
        config: original.config,
      },
      5
    );
    await waitFor(() =>
      expect(screen.getAllByTestId('import-format-name').map((name) => name.textContent)).toContain('Joint account export')
    );
    expect(screen.getAllByTestId('import-format-account')[0].textContent).toBe('Goes into: Rewards Visa');
    // History rows show the format's name, so they are read again too.
    expect(listImportBatches).toHaveBeenCalledTimes(2);
  });

  it('clears the account so the next import asks', async () => {
    renderManage();
    const [row] = await formatRows();
    fireEvent.click(within(row).getByRole('button', { name: 'Edit format First Bank checking' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit saved format' });

    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: /Account/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Ask each time' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saveImportProfile).toHaveBeenCalledTimes(1));
    expect(saveImportProfile.mock.calls[0][0]).toMatchObject({ name: 'First Bank checking', account_id: null });
    await waitFor(() =>
      expect(screen.getAllByTestId('import-format-account')[0].textContent).toBe('Asks which account each time')
    );
  });

  it('does not save a format without a name, and says why a save failed', async () => {
    renderManage();
    const [row] = await formatRows();
    fireEvent.click(within(row).getByRole('button', { name: 'Edit format First Bank checking' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit saved format' });

    fireEvent.change(within(dialog).getByLabelText('Format name'), { target: { value: '   ' } });
    expect(within(dialog).getByText('Enter a name for this format.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);

    saveImportProfile.mockRejectedValueOnce(new Error('disk full'));
    fireEvent.change(within(dialog).getByLabelText('Format name'), { target: { value: 'Renamed' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByText('The format could not be saved. Try again.')).toBeTruthy();
    expect(screen.getAllByTestId('import-format-name')[0].textContent).toBe('First Bank checking');
  });

  it('deletes a format after saying that the next import of that file will ask again', async () => {
    renderManage();
    const [row] = await formatRows();
    fireEvent.click(within(row).getByRole('button', { name: 'Delete format First Bank checking' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this saved format?' });

    expect(dialog.textContent).toContain(
      '"First Bank checking" will be forgotten. The next time you import a file like this, the import will ask how to read it again.'
    );
    expect(dialog.textContent).toContain('Transactions you already imported are not affected.');
    expect(deleteImportProfile).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete format' }));

    await waitFor(() => expect(screen.getAllByTestId('import-format-row')).toHaveLength(1));
    expect(deleteImportProfile).toHaveBeenCalledWith(5);
    expect(screen.getByTestId('import-format-name').textContent).toBe('Visa QFX');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps two formats of one file shape apart: each shows its account, and a change to one leaves the other alone', async () => {
    // One bank's checking and card exports share a header, so the wizard saved the layout once per
    // account, under the same name, with a different direction of money.
    const cardConfig: SavedImportProfile['config'] = {
      version: 1,
      layout: { roles: { date: 0, description: [1], amount: 2 }, dateOrder: 'DMY', decimal: ',', amountSign: 'asIs' },
    };
    store.profiles = [
      profile({ id: 5 }),
      profile({ id: 7, account_id: 2, account_name: 'Rewards Visa', use_count: 1, config: cardConfig }),
    ];
    const checkingBefore = store.profiles[0];
    renderManage();
    const [checking, card] = await formatRows();

    expect(screen.getAllByTestId('import-format-name').map((name) => name.textContent)).toEqual([
      'First Bank checking',
      'First Bank checking',
    ]);
    expect(within(checking).getByTestId('import-format-account').textContent).toBe('Goes into: Household Checking');
    expect(within(card).getByTestId('import-format-account').textContent).toBe('Goes into: Rewards Visa');
    // The two Edit buttons have the same name; each is described by its own account line.
    const editCard = within(card).getByRole('button', { name: 'Edit format First Bank checking' });
    const editChecking = within(checking).getByRole('button', { name: 'Edit format First Bank checking' });
    expect(document.getElementById(editCard.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Goes into: Rewards Visa');
    expect(document.getElementById(editChecking.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Goes into: Household Checking'
    );

    // Rename the card's format: only that one is saved, with its own layout.
    fireEvent.click(editCard);
    const editDialog = await screen.findByRole('dialog', { name: 'Edit saved format' });
    fireEvent.change(within(editDialog).getByLabelText('Format name'), { target: { value: 'First Bank card' } });
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(saveImportProfile).toHaveBeenCalledTimes(1);
    expect(saveImportProfile).toHaveBeenCalledWith(
      {
        name: 'First Bank card',
        format: 'delimited',
        fingerprint: checkingBefore.fingerprint,
        institution: 'First Bank',
        account_id: 2,
        config: cardConfig,
      },
      7
    );
    await waitFor(() =>
      expect(screen.getAllByTestId('import-format-name').map((name) => name.textContent)).toEqual([
        'First Bank checking',
        'First Bank card',
      ])
    );
    expect(store.profiles[0]).toEqual(checkingBefore);

    // Delete the checking format: the confirmation says which one, and the card's stays.
    fireEvent.click(
      within(screen.getAllByTestId('import-format-row')[0]).getByRole('button', { name: 'Delete format First Bank checking' })
    );
    const deleteDialog = await screen.findByRole('dialog', { name: 'Delete this saved format?' });
    expect(within(deleteDialog).getByTestId('import-format-delete-account').textContent).toBe('Goes into: Household Checking');
    fireEvent.click(within(deleteDialog).getByRole('button', { name: 'Delete format' }));

    await waitFor(() => expect(screen.getAllByTestId('import-format-row')).toHaveLength(1));
    expect(deleteImportProfile).toHaveBeenCalledTimes(1);
    expect(deleteImportProfile).toHaveBeenCalledWith(5);
    expect(screen.getByTestId('import-format-name').textContent).toBe('First Bank card');
    expect(screen.getByTestId('import-format-account').textContent).toBe('Goes into: Rewards Visa');
  });

  it('moves one of two same-shape formats to another account without changing its sibling', async () => {
    store.accounts = [...store.accounts, account(3, 'Rainy Day Savings')];
    store.profiles = [profile({ id: 5 }), profile({ id: 7, account_id: 2, account_name: 'Rewards Visa' })];
    renderManage();
    const [checking] = await formatRows();

    fireEvent.click(within(checking).getByRole('button', { name: 'Edit format First Bank checking' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit saved format' });
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: /Account/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Rainy Day Savings' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saveImportProfile).toHaveBeenCalledTimes(1));
    expect(saveImportProfile.mock.calls[0][1]).toBe(5);
    expect(saveImportProfile.mock.calls[0][0]).toMatchObject({ account_id: 3 });
    await waitFor(() =>
      expect(screen.getAllByTestId('import-format-account').map((line) => line.textContent)).toEqual([
        'Goes into: Rainy Day Savings',
        'Goes into: Rewards Visa',
      ])
    );
  });

  it('keeps the format when the delete is cancelled or fails', async () => {
    renderManage();
    const [row] = await formatRows();
    fireEvent.click(within(row).getByRole('button', { name: 'Delete format First Bank checking' }));
    let dialog = await screen.findByRole('dialog', { name: 'Delete this saved format?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(deleteImportProfile).not.toHaveBeenCalled();

    deleteImportProfile.mockRejectedValueOnce(new Error('locked'));
    fireEvent.click(within(row).getByRole('button', { name: 'Delete format First Bank checking' }));
    dialog = await screen.findByRole('dialog', { name: 'Delete this saved format?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete format' }));

    expect(await within(dialog).findByText('The format could not be deleted. Try again.')).toBeTruthy();
    expect(screen.getAllByTestId('import-format-row')).toHaveLength(2);
  });
});

describe('ImportManage: account identifiers', () => {
  async function identifierGroups() {
    await screen.findAllByTestId('import-identifier-group');
    return screen.getAllByTestId('import-identifier-group');
  }

  it('groups identifiers by account and never shows a full account number', async () => {
    renderManage();
    const [checking, visa] = await identifierGroups();

    expect(within(checking).getByRole('heading', { name: 'Household Checking' })).toBeTruthy();
    expect(within(checking).getAllByTestId('import-identifier-text').map((text) => text.textContent)).toEqual([
      'Number ending in 4821',
      'Name in the file: "joint checking"',
    ]);
    const added = formatDateOnly(new Date('2026-11-09T14:30:00Z'));
    expect(checking.textContent).toContain(`Remembered from an import on ${added}`);
    expect(checking.textContent).toContain(`Added by hand on ${added}`);

    expect(within(visa).getByRole('heading', { name: 'Rewards Visa' })).toBeTruthy();
    expect(within(visa).getByTestId('import-identifier-text').textContent).toBe('Number ending in 2222');

    // Not in the text, not in a label, tooltip or attribute.
    expect(document.body.innerHTML).not.toContain(FULL_ACCOUNT_NUMBER);
    expect(document.body.innerHTML).not.toContain('5500000000002222');
    expect(screen.getByText('Card numbers are kept with each account on the Accounts page.')).toBeTruthy();
  });

  it('removes an identifier after a confirmation that still hides the number', async () => {
    renderManage();
    const [checking] = await identifierGroups();
    fireEvent.click(
      within(checking).getByRole('button', { name: 'Remove Number ending in 4821 from Household Checking' })
    );
    const dialog = await screen.findByRole('dialog', { name: 'Remove from Household Checking?' });

    expect(dialog.textContent).toContain(
      'Number ending in 4821 will no longer point to Household Checking. The next file that uses it will ask which account it belongs to.'
    );
    expect(document.body.innerHTML).not.toContain(FULL_ACCOUNT_NUMBER);
    expect(removeAccountIdentifier).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(screen.getAllByTestId('import-identifier-row')).toHaveLength(2));
    expect(removeAccountIdentifier).toHaveBeenCalledWith(31);
    expect(screen.queryByText('Number ending in 4821')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the identifier when removing it fails', async () => {
    removeAccountIdentifier.mockRejectedValueOnce(new Error('locked'));
    renderManage();
    const [checking] = await identifierGroups();
    fireEvent.click(within(checking).getByRole('button', { name: 'Remove Name in the file: "joint checking" from Household Checking' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove from Household Checking?' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

    expect(await within(dialog).findByText('It could not be removed. Try again.')).toBeTruthy();
    expect(screen.getAllByTestId('import-identifier-row')).toHaveLength(3);
  });

  it('hides a number too short to have a last four', async () => {
    store.identifiers = [identifier({ id: 40, value: '123', last_four: null })];
    renderManage();
    const [group] = await identifierGroups();

    expect(within(group).getByTestId('import-identifier-text').textContent).toBe('Short number (hidden)');
    expect(group.textContent).not.toContain('123');
  });
});
