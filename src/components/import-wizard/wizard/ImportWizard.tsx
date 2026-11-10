'use client';

/**
 * The guided import: six steps in one frame.
 *
 *   Files → Account → Check how we read it → Things to check → Summary → Done
 *
 * State is a pure reducer (./wizardModel), the asynchronous work is in
 * ./useImportWizard, and each step is its own file. The props are the seam
 * defined in ../ImportPage.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';
import { useTranslation } from 'react-i18next';

import type { ImportWizardProps } from '../ImportPage';

import AccountStep from './AccountStep';
import { useBlockerLine } from './blockerText';
import DoneStep from './DoneStep';
import FilesStep from './FilesStep';
import LayoutStep from './LayoutStep';
import ReviewStep from './ReviewStep';
import SummaryStep from './SummaryStep';
import { useImportWizard } from './useImportWizard';
import WizardFrame, { type FrameAction } from './WizardFrame';
import {
  canGoNext,
  hasUnsavedWork,
  importBlockers,
  isStagingFresh,
  missingParts,
  queuePosition,
  summarize,
  type WizardStep,
} from './wizardModel';

export default function ImportWizard({ onViewTransactions, onOpenHistory, setLeaveGuard }: ImportWizardProps) {
  const { t } = useTranslation(['importWizard', 'common']);
  const wizard = useImportWizard();
  const blockerLine = useBlockerLine();
  const { state, current, dispatch } = wizard;
  const { step } = state;

  // Every step, and every file of the queue, starts at its top: the one before may have been
  // scrolled to its end to reach a confirmation.
  useEffect(() => {
    const root = document.scrollingElement ?? document.documentElement;
    root.scrollTop = 0;
  }, [step, state.currentId]);

  // --- leave guard: "Discard this import?" while a file is loaded ---
  const [leaveOpen, setLeaveOpen] = useState(false);
  const leaveResolverRef = useRef<((leave: boolean) => void) | null>(null);
  const busyRef = useRef(false);
  busyRef.current = state.busy !== null;
  const unsaved = hasUnsavedWork(state);

  const answerLeave = useCallback((leave: boolean) => {
    leaveResolverRef.current?.(leave);
    leaveResolverRef.current = null;
    setLeaveOpen(false);
  }, []);

  useEffect(() => {
    if (!unsaved) {
      setLeaveGuard(null);
      return undefined;
    }
    setLeaveGuard(() => {
      // An import that is being written cannot be abandoned half-way.
      if (busyRef.current) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        leaveResolverRef.current?.(false);
        leaveResolverRef.current = resolve;
        setLeaveOpen(true);
      });
    });
    return () => setLeaveGuard(null);
  }, [setLeaveGuard, unsaved]);

  // --- what the frame shows around the step ---
  const position = queuePosition(state);
  const inStatement = step !== 'files' && step !== 'done' && current != null;
  let queueLabel: string | null = null;
  if (inStatement && position) {
    const name =
      current.tableCount > 1
        ? `${current.fileName} · ${t('files.accountPart', { index: current.tableIndex + 1, total: current.tableCount })}`
        : current.fileName;
    queueLabel =
      position.total > 1 ? t('frame.queue', { index: position.index + 1, total: position.total, name }) : t('frame.file', { name });
  }

  let busyLabel: string | null = null;
  if (state.busy === 'importing') busyLabel = t('frame.importing');
  else if (state.busy === 'finishing') busyLabel = t('frame.finishing');
  else if (state.activating || (inStatement && current.accounts === null)) busyLabel = t('frame.preparing');

  const next: FrameAction = {
    label: t('common:actions.next'),
    onClick: () => dispatch({ type: 'next' }),
    disabled: !canGoNext(state),
    testId: 'import-next',
  };
  const back = () => dispatch({ type: 'back' });
  const several = state.statements.length > 1;
  const skipFile: FrameAction | null =
    inStatement && several ? { label: t('frame.skipFile'), onClick: () => void wizard.skipCurrent(), testId: 'import-skip-file' } : null;

  let primary: FrameAction | null = null;
  let secondary: FrameAction | null = skipFile;
  let onBack: (() => void) | null = back;
  let hint: string | null = null;

  switch (step) {
    case 'files':
      primary = next;
      onBack = null;
      if (state.files.length > 0 && next.disabled) {
        hint = state.files.some((file) => file.status === 'reading') ? t('files.hintReading') : t('files.hintNoneReadable');
      }
      break;
    case 'account':
      primary = next;
      if (next.disabled && !busyLabel) hint = t('account.hint');
      break;
    case 'layout':
      primary = next;
      if (next.disabled && current && !busyLabel) {
        hint = missingParts(current.layout).length > 0 ? t('layout.hintMissing') : t('layout.hintConfirm');
      }
      break;
    case 'review':
      primary = next;
      if (next.disabled && current && !busyLabel) hint = t('review.hint');
      break;
    case 'summary': {
      if (!current) break;
      const blockers = importBlockers(current);
      const fresh = isStagingFresh(current);
      const summary = summarize(current);
      const nothingNew = fresh && blockers.length === 0 && summary.toImport === 0;
      primary = {
        label: nothingNew
          ? t('common:actions.continue')
          : fresh || blockers.length > 0
            ? t('summary.import', { count: summary.toImport })
            : t('summary.checking'),
        onClick: () => void wizard.importCurrent(),
        // D7: Import stays disabled while a blocker is unresolved.
        disabled: (blockers.length > 0 && !nothingNew) || !fresh,
        loading: !fresh && blockers.length === 0 && current.staging.status !== 'error',
        testId: 'import-run',
      };
      if (blockers.length > 0) hint = blockerLine(blockers[0]).text;
      break;
    }
    case 'done':
      onBack = null;
      primary = { label: t('done.viewTransactions'), onClick: onViewTransactions, testId: 'import-view-transactions' };
      secondary = { label: t('done.importAnother'), onClick: wizard.reset, testId: 'import-another' };
      break;
    default:
      break;
  }

  const imported = state.statements.filter((statement) => statement.result?.outcome === 'imported').length;

  return (
    <>
      <WizardFrame
        step={step}
        queueLabel={queueLabel}
        busyLabel={busyLabel}
        onBack={onBack}
        primary={primary}
        secondary={secondary}
        hint={hint}
        onStepClick={(target: WizardStep) => dispatch({ type: 'goToStep', step: target })}
      >
        {step === 'files' && <FilesStep wizard={wizard} />}
        {step === 'account' && <AccountStep wizard={wizard} />}
        {step === 'layout' && <LayoutStep wizard={wizard} />}
        {step === 'review' && <ReviewStep wizard={wizard} />}
        {step === 'summary' && <SummaryStep wizard={wizard} />}
        {step === 'done' && <DoneStep wizard={wizard} onOpenHistory={onOpenHistory} />}
      </WizardFrame>

      <Dialog open={leaveOpen} onClose={() => answerLeave(false)} data-testid="import-leave-dialog">
        <DialogTitle>{t('leave.title')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {imported > 0 ? t('leave.bodyPartly', { count: imported }) : t('leave.body')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => answerLeave(false)} data-testid="import-leave-stay">
            {t('leave.stay')}
          </Button>
          <Button color="error" onClick={() => answerLeave(true)} data-testid="import-leave-discard">
            {t('leave.discard')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
