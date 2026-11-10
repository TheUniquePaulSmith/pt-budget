'use client';

/**
 * The guided import's controller: everything the wizard does that is not a
 * pure state change. It reads the dropped files, looks up saved formats and
 * accounts, stages the rows, commits one statement at a time (D12) and runs
 * the loan rules and the subscription scan after the last one. State lives in
 * the reducer (./wizardModel); the steps only call what this hook returns.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useOptionalLocale } from '@/contexts/LocaleContext';
import { useImportWizardSlice } from '@/contexts/useDatabaseSlices';
import { todayLocalISO } from '@/lib/dateOnly';
import { DEFAULT_LANGUAGE, csvDateOrderFor, decimalSeparatorFor } from '@/lib/i18n';
import { logger } from '@/lib/logging';
import {
  readStatement,
  type AccountResolution,
  type ImportIssue,
  type LayoutProposal,
  type ReadOptions,
  type SavedImportProfile,
  type SourceFile,
} from '@/lib/statementImport';

import {
  accountValuesOf,
  buildCommitInput,
  buildProfileInput,
  createInitialState,
  currentStatement,
  identifiersToSave,
  importBlockers,
  isStagingFresh,
  keptPairs,
  rowsToStage,
  singleAccountId,
  summarize,
  wizardReducer,
  type PreparedTable,
  type StatementResult,
  type StatementSession,
  type WizardAction,
  type WizardState,
} from './wizardModel';

const log = logger.child({ component: 'ImportWizard' });

/** How long a change to the rows may settle before they are staged again. */
const STAGING_DELAY_MS = 250;

export type ImportWizardSlice = ReturnType<typeof useImportWizardSlice>;

export interface ReadOptionsOutcome {
  ok: boolean;
  /** Why the file could not be read with these choices. */
  issues: ImportIssue[];
}

function todayDateOnly(): string {
  return todayLocalISO();
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useImportWizard() {
  const slice = useImportWizardSlice();
  const language = useOptionalLocale()?.language ?? DEFAULT_LANGUAGE;

  // The reducer runs outside React's queue so the async flows below can read
  // the state they just produced (a staged statement, the next in the queue).
  const [state, setState] = useState<WizardState>(() =>
    createInitialState({
      today: todayDateOnly(),
      // D6: the UI language is only the last-resort fallback for a file with no evidence.
      fallbackDateOrder: csvDateOrderFor(language),
      fallbackDecimal: decimalSeparatorFor(language),
    })
  );
  const stateRef = useRef(state);
  const dispatch = useCallback((action: WizardAction) => {
    const next = wizardReducer(stateRef.current, action);
    stateRef.current = next;
    setState(next);
  }, []);

  const sliceRef = useRef(slice);
  sliceRef.current = slice;

  /** The bytes of every dropped file, for a second read with other reader choices. */
  const sourcesRef = useRef(new Map<string, SourceFile>());
  const nextFileIdRef = useRef(1);
  /** One staging table: everything that touches it runs one after the other. */
  const stagingQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const cardCacheRef = useRef(new Map<number, Array<{ id: number; last_four: string }>>());
  const scansOwedRef = useRef(false);

  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = stagingQueueRef.current.then(task, task);
    stagingQueueRef.current = run.catch(() => undefined);
    return run;
  }, []);

  const current = currentStatement(state);

  // --- accounts -----------------------------------------------------------

  useEffect(() => {
    cardCacheRef.current.clear();
    dispatch({
      type: 'accountFactsLoaded',
      accounts: slice.accounts.map((account) => ({ id: account.id, type: account.type, currency: account.currency ?? null })),
    });
  }, [dispatch, slice.accounts]);

  /** The card rows attach to: the one whose last four the file names, else the account's first. */
  const cardFor = useCallback(async (accountId: number, value: string): Promise<number | null> => {
    let cards = cardCacheRef.current.get(accountId);
    if (!cards) {
      try {
        cards = (await sliceRef.current.getAccountCards(accountId)).map((card) => ({
          id: Number(card.id),
          last_four: String(card.last_four ?? ''),
        }));
      } catch (error) {
        log.warn('Could not load the cards of an account', { operation: 'cardFor', accountId, error });
        cards = [];
      }
      cardCacheRef.current.set(accountId, cards);
    }
    const lastFour = value.replace(/\D/g, '').slice(-4);
    return (cards.find((card) => lastFour.length === 4 && card.last_four === lastFour) ?? cards[0])?.id ?? null;
  }, []);

  const resolveKey = current && current.status === 'pending' && current.accounts === null ? current.id : null;
  const resolveTable = current?.table;
  const resolveAccountColumn = current?.layout.roles.account;
  useEffect(() => {
    if (!resolveKey) return undefined;
    const queued = stateRef.current.statements.find((candidate) => candidate.id === resolveKey);
    if (!queued) return undefined;
    let cancelled = false;
    void (async () => {
      let statement = queued;
      // A file earlier in this run may have saved the format this one uses (twelve monthly
      // statements from one bank): look again, so this file can take the fast path too.
      if (stateRef.current.activating && !statement.profile && !statement.layoutEdited && !statement.readerEdited) {
        try {
          const profiles = await sliceRef.current.findImportProfiles(statement.detectedFingerprint);
          const profile = profiles[0];
          if (profile && !cancelled) {
            let table = statement.table;
            let readOptions = statement.readOptions;
            const source = sourcesRef.current.get(statement.fileId);
            const reader = profile.config.reader;
            if (reader && source && table.format === 'delimited' && statement.tableCount === 1) {
              const again = await readStatement(source, reader);
              if (again.tables.length === 1) {
                table = again.tables[0];
                readOptions = reader;
              }
            }
            if (cancelled) return;
            dispatch({ type: 'profileFound', statementId: statement.id, profiles, table, readOptions });
            statement = stateRef.current.statements.find((candidate) => candidate.id === resolveKey) ?? statement;
          }
        } catch (error) {
          log.warn('Could not look up saved formats', { operation: 'resolveAccounts', error });
        }
      }
      if (cancelled) return;
      const values = accountValuesOf(statement).map((entry) => entry.value);
      let resolutions: AccountResolution[] = [];
      try {
        resolutions = await sliceRef.current.resolveImportAccounts(values, {
          profileAccountId: statement.profile?.account_id ?? null,
        });
        resolutions = await Promise.all(
          resolutions.map(async (resolution) =>
            resolution.accountId != null && resolution.cardId == null
              ? { ...resolution, cardId: await cardFor(resolution.accountId, resolution.value) }
              : resolution
          )
        );
      } catch (error) {
        // Every value then counts as unknown and the user picks the account.
        log.error('Account lookup failed', { operation: 'resolveAccounts', error });
        resolutions = [];
      }
      if (!cancelled) dispatch({ type: 'accountsResolved', statementId: statement.id, resolutions });
    })();
    return () => {
      cancelled = true;
    };
  }, [cardFor, dispatch, resolveAccountColumn, resolveKey, resolveTable]);

  const coverageStatementId = current?.status === 'pending' ? current.id : null;
  const coverageAccountId = current ? singleAccountId(current) : null;
  useEffect(() => {
    if (!coverageStatementId || coverageAccountId == null) return undefined;
    let cancelled = false;
    sliceRef.current
      .getAccountImportCoverage([coverageAccountId])
      .then((coverage) => {
        if (cancelled) return;
        dispatch({
          type: 'coverageLoaded',
          statementId: coverageStatementId,
          accountId: coverageAccountId,
          coverage: coverage.find((entry) => entry.accountId === coverageAccountId) ?? null,
        });
      })
      .catch((error) => log.warn('Could not load what is already imported', { operation: 'coverage', error }));
    return () => {
      cancelled = true;
    };
  }, [coverageAccountId, coverageStatementId, dispatch]);

  // --- files ---------------------------------------------------------------

  const prepareFile = useCallback(
    async (fileId: string, file: File) => {
      try {
        const source: SourceFile = { name: file.name, size: file.size, bytes: new Uint8Array(await file.arrayBuffer()) };
        sourcesRef.current.set(fileId, source);
        const read = await readStatement(source);
        const tables: PreparedTable[] = [];
        for (const [index, detected] of read.tables.entries()) {
          let table = detected;
          let readOptions: ReadOptions = {};
          let profiles: SavedImportProfile[] = [];
          try {
            // Most recently used first.
            profiles = await sliceRef.current.findImportProfiles(detected.fingerprint);
          } catch (error) {
            log.warn('Could not look up saved formats', { operation: 'prepareFile', error });
          }
          // A saved format remembers the reader choices the user made under Advanced.
          const reader = profiles[0]?.config.reader;
          if (reader && detected.format === 'delimited' && read.tables.length === 1) {
            const again = await readStatement(source, reader);
            if (again.tables.length === 1) {
              table = again.tables[0];
              readOptions = reader;
            }
          }
          tables.push({ id: `${fileId}:${index}`, table, detectedFingerprint: detected.fingerprint, readOptions, profiles });
        }
        dispatch({ type: 'fileRead', fileId, tables, issues: read.issues });
      } catch (error) {
        log.error('Could not read a statement file', { operation: 'prepareFile', error });
        dispatch({ type: 'fileRead', fileId, tables: [], issues: [] });
      }
    },
    [dispatch]
  );

  const addFiles = useCallback(
    (files: File[]) => {
      for (const file of files) {
        const id = `file-${nextFileIdRef.current}`;
        nextFileIdRef.current += 1;
        dispatch({ type: 'fileAdded', file: { id, name: file.name, size: file.size } });
        void prepareFile(id, file);
      }
    },
    [dispatch, prepareFile]
  );

  const removeFile = useCallback(
    (fileId: string) => {
      const wasCurrent = currentStatement(stateRef.current)?.fileId === fileId;
      dispatch({ type: 'fileRemoved', fileId });
      if (!stateRef.current.files.some((file) => file.id === fileId)) {
        sourcesRef.current.delete(fileId);
        if (wasCurrent) void enqueue(() => sliceRef.current.discardStagedImport()).catch(() => undefined);
      }
    },
    [dispatch, enqueue]
  );

  /** Reads the current file again with other reader choices (Advanced). */
  const applyReadOptions = useCallback(
    async (options: ReadOptions): Promise<ReadOptionsOutcome> => {
      const statement = currentStatement(stateRef.current);
      const source = statement ? sourcesRef.current.get(statement.fileId) : undefined;
      if (!statement || !source) return { ok: false, issues: [] };
      try {
        const read = await readStatement(source, options);
        const table = read.tables[statement.tableIndex] ?? read.tables[0];
        if (!table) return { ok: false, issues: read.issues };
        dispatch({ type: 'statementReread', statementId: statement.id, table, readOptions: options });
        return { ok: true, issues: [] };
      } catch (error) {
        log.error('Could not read the file with other reader choices', { operation: 'applyReadOptions', error });
        return { ok: false, issues: [] };
      }
    },
    [dispatch]
  );

  // --- staging -------------------------------------------------------------

  const stageNow = useCallback(
    async (statementId: string) => {
      const statement = stateRef.current.statements.find((candidate) => candidate.id === statementId);
      if (!statement || statement.status !== 'pending') return;
      const version = statement.rowsVersion;
      const rows = rowsToStage(statement);
      dispatch({ type: 'stagingStarted', statementId, version });
      try {
        const result = await sliceRef.current.stageImportRows(rows);
        let classification = null;
        if (rows.length > 0) {
          try {
            // Transfers between the user's accounts, refunds and type rules among the staged rows.
            classification = await sliceRef.current.previewImportClassification();
          } catch (error) {
            log.warn('Could not detect transfers in the staged rows', { operation: 'stage', error });
          }
        }
        dispatch({
          type: 'staged',
          statementId,
          version,
          result,
          rowIndexes: rows.map((row) => row.rowIndex),
          classification,
        });
      } catch (error) {
        log.error('Could not stage the rows of a statement', { operation: 'stage', error });
        dispatch({ type: 'stagingFailed', statementId, version, error: errorText(error) });
      }
    },
    [dispatch]
  );

  const stagingSettled =
    current != null &&
    (isStagingFresh(current) ||
      ((current.staging.status === 'working' || current.staging.status === 'error') &&
        current.staging.version === current.rowsVersion));
  const stagingWanted =
    current != null &&
    current.status === 'pending' &&
    current.accounts !== null &&
    (state.step === 'review' || state.step === 'summary') &&
    !state.busy &&
    !state.activating &&
    !stagingSettled;
  const stagingStatementId = current?.id ?? null;
  const stagingVersion = current?.rowsVersion ?? 0;
  useEffect(() => {
    if (!stagingWanted || !stagingStatementId) return undefined;
    const timer = setTimeout(() => {
      void enqueue(() => stageNow(stagingStatementId));
    }, STAGING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [enqueue, stageNow, stagingStatementId, stagingVersion, stagingWanted]);

  const retryStaging = useCallback(() => {
    const statement = currentStatement(stateRef.current);
    if (statement) void enqueue(() => stageNow(statement.id));
  }, [enqueue, stageNow]);

  // --- import --------------------------------------------------------------

  /**
   * The saved format to overwrite: the one for this account (or, for a file with several accounts,
   * the one saved for several). The same layout used for another account gets its own entry, so
   * each account keeps its own direction of money.
   */
  const profileToUpdate = useCallback(async (statement: StatementSession): Promise<number | undefined> => {
    const accountId = singleAccountId(statement);
    const matched = statement.profile;
    if (!matched) return undefined;
    if (matched.account_id === accountId) return matched.id;
    const others = await sliceRef.current.findImportProfiles(statement.detectedFingerprint);
    return others.find((profile) => profile.account_id === accountId)?.id;
  }, []);

  const importCurrent = useCallback(
    () =>
      enqueue(async () => {
        let statement = currentStatement(stateRef.current);
        if (!statement || stateRef.current.busy || importBlockers(statement).length > 0) return;
        const statementId = statement.id;
        const operation = log.withOperation('importStatement');
        dispatch({ type: 'importStarted' });
        try {
          if (!isStagingFresh(statement)) {
            await stageNow(statementId);
            statement = currentStatement(stateRef.current);
            if (!statement || !isStagingFresh(statement)) {
              throw new Error(statement?.staging.error ?? 'IMPORT_STAGING_FAILED');
            }
          }
          const summary = summarize(statement);
          const base: Omit<StatementResult, 'outcome' | 'batchId' | 'inserted'> = {
            duplicates: summary.alreadyImported,
            skipped: summary.skipped,
            transfers: 0,
            refunds: 0,
            ruleTyped: 0,
            accountIds: summary.accountIds,
            error: null,
          };

          if (summary.toImport === 0) {
            // Everything is already stored (or left out): no empty batch is written.
            await sliceRef.current.discardStagedImport();
            dispatch({
              type: 'statementFinished',
              statementId,
              result: { ...base, outcome: summary.alreadyImported > 0 ? 'nothingNew' : 'skipped', batchId: null, inserted: 0 },
            });
            return;
          }

          // A format saved for another account is not what this batch was read with.
          let profileId = statement.profileForOtherAccount ? null : (statement.profile?.id ?? null);
          if (statement.rememberFormat) {
            try {
              profileId = await sliceRef.current.saveImportProfile(
                buildProfileInput(statement),
                await profileToUpdate(statement)
              );
            } catch (error) {
              // The import itself does not depend on remembering the format.
              operation.warn('Could not save the import format', { error });
            }
          }

          const pairs = keptPairs(statement);
          const pairDecisions = pairs.length > 0 ? sliceRef.current.decisionsForTransferPairs(pairs) : [];
          const committed = await sliceRef.current.commitStagedImport(buildCommitInput(statement, pairDecisions, profileId));
          if (committed.inserted > 0) scansOwedRef.current = true;

          // D10: confirming an account remembers what this file calls it.
          for (const identifier of identifiersToSave(statement)) {
            try {
              await sliceRef.current.addAccountIdentifier({ ...identifier, source: 'import' });
            } catch (error) {
              operation.warn('Could not remember an account identifier', { error });
            }
          }
          if (profileId != null) {
            try {
              await sliceRef.current.recordImportProfileUse(profileId, singleAccountId(statement));
            } catch (error) {
              operation.warn('Could not record the use of an import format', { error });
            }
          }

          operation.info('Imported a statement', {
            batchId: committed.batchId,
            inserted: committed.inserted,
            duplicates: committed.duplicates,
            format: statement.table.format,
            transfers: pairs.length,
          });
          dispatch({
            type: 'statementFinished',
            statementId,
            result: {
              ...base,
              outcome: 'imported',
              batchId: committed.batchId,
              inserted: committed.inserted,
              duplicates: committed.duplicates,
              transfers: pairs.length,
              refunds: summary.refunds,
              ruleTyped: summary.ruleTyped,
            },
          });
        } catch (error) {
          operation.error('Import failed', { error });
          dispatch({ type: 'importFailed', error: errorText(error) });
        }
      }),
    [dispatch, enqueue, profileToUpdate, stageNow]
  );

  /** Leaves the current file out of this run and moves on to the next one. */
  const skipCurrent = useCallback(
    () =>
      enqueue(async () => {
        const statement = currentStatement(stateRef.current);
        if (!statement || stateRef.current.busy) return;
        await sliceRef.current.discardStagedImport().catch(() => undefined);
        dispatch({
          type: 'statementFinished',
          statementId: statement.id,
          result: {
            outcome: 'skipped',
            batchId: null,
            inserted: 0,
            duplicates: 0,
            skipped: statement.report.stats.totalRows,
            transfers: 0,
            refunds: 0,
            ruleTyped: 0,
            accountIds: [],
            error: null,
          },
        });
      }),
    [dispatch, enqueue]
  );

  /** Loan rules claim their payments first, so the subscription scan never turns them into a series. */
  const runScans = useCallback(async () => {
    scansOwedRef.current = false;
    try {
      await sliceRef.current.applyLoanRules();
    } catch (error) {
      log.warn('Post-import loan rule scan failed', { operation: 'runScans', error });
    }
    try {
      await sliceRef.current.runSubscriptionScan();
    } catch (error) {
      log.warn('Post-import subscription scan failed', { operation: 'runScans', error });
    }
  }, []);

  const finishing = state.busy === 'finishing';
  const finishingStartedRef = useRef(false);
  useEffect(() => {
    if (!finishing || finishingStartedRef.current) return;
    finishingStartedRef.current = true;
    void runScans().finally(() => {
      finishingStartedRef.current = false;
      dispatch({ type: 'finished' });
    });
  }, [dispatch, finishing, runScans]);

  // Leaving with rows still staged empties the staging table; leaving after
  // some files were imported (but before the last) still runs the scans.
  useEffect(
    () => () => {
      void enqueue(() => sliceRef.current.discardStagedImport()).catch(() => undefined);
      if (scansOwedRef.current) void runScans();
    },
    [enqueue, runScans]
  );

  const reset = useCallback(() => {
    sourcesRef.current.clear();
    dispatch({ type: 'reset', today: todayDateOnly() });
  }, [dispatch]);

  const chooseAccount = useCallback(
    async (value: string, accountId: number, cardId?: number | null) => {
      const resolvedCardId = cardId ?? (await cardFor(accountId, value));
      dispatch({ type: 'accountChosen', value, accountId, cardId: resolvedCardId });
    },
    [cardFor, dispatch]
  );

  const applyAiProposal = useCallback(
    (proposal: LayoutProposal) => dispatch({ type: 'aiProposalApplied', proposal }),
    [dispatch]
  );

  return useMemo(
    () => ({
      state,
      current,
      slice,
      dispatch,
      addFiles,
      removeFile,
      applyReadOptions,
      chooseAccount,
      applyAiProposal,
      retryStaging,
      importCurrent,
      skipCurrent,
      reset,
      /** The rows are being staged (or are about to be): duplicates and transfers are not known yet. */
      stagingPending: current != null && !isStagingFresh(current) && current.staging.status !== 'error',
    }),
    [
      addFiles,
      applyAiProposal,
      applyReadOptions,
      chooseAccount,
      current,
      dispatch,
      importCurrent,
      removeFile,
      reset,
      retryStaging,
      skipCurrent,
      slice,
      state,
    ]
  );
}

export type ImportWizardController = ReturnType<typeof useImportWizard>;
