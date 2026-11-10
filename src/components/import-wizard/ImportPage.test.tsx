// @vitest-environment jsdom

import React, { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { ImportLeaveGuard, ImportManageProps, ImportWizardProps } from './ImportPage';

// The two views are owned by other agents; the page only has to hand them the seam.
let guard: ImportLeaveGuard | null = null;
let wizardProps: ImportWizardProps | null = null;
let manageProps: ImportManageProps | null = null;

vi.mock('./wizard/ImportWizard', () => {
  function WizardStub(props: ImportWizardProps) {
    wizardProps = props;
    const { setLeaveGuard } = props;
    useEffect(() => {
      setLeaveGuard(guard);
      return () => setLeaveGuard(null);
    }, [setLeaveGuard]);
    return <div data-testid="wizard-view" />;
  }
  return { default: WizardStub };
});
vi.mock('./manage/ImportManage', () => {
  function ManageStub(props: ImportManageProps) {
    manageProps = props;
    return <div data-testid="manage-view" />;
  }
  return { default: ManageStub };
});

import ImportPage from './ImportPage';

function renderPage() {
  const onClose = vi.fn();
  const onViewTransactions = vi.fn();
  render(<ImportPage onClose={onClose} onViewTransactions={onViewTransactions} />);
  return { onClose, onViewTransactions };
}

describe('ImportPage', () => {
  it('opens on the guided import with its own header and close control', async () => {
    guard = null;
    const { onClose, onViewTransactions } = renderPage();

    expect(screen.getByRole('heading', { name: 'Import transactions' })).toBeTruthy();
    expect(screen.getByTestId('wizard-view')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Import' }).getAttribute('aria-selected')).toBe('true');

    wizardProps?.onViewTransactions();
    expect(onViewTransactions).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Close import' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('switches between the import and the history view, from the tabs or from a view', async () => {
    guard = null;
    renderPage();

    fireEvent.click(screen.getByRole('tab', { name: 'History & formats' }));
    expect(await screen.findByTestId('manage-view')).toBeTruthy();

    act(() => manageProps?.onStartImport());
    expect(await screen.findByTestId('wizard-view')).toBeTruthy();

    act(() => wizardProps?.onOpenHistory());
    expect(await screen.findByTestId('manage-view')).toBeTruthy();
  });

  it('asks the wizard before leaving while a file is loaded, and stays when it says no', async () => {
    guard = vi.fn(async () => false);
    const { onClose } = renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Close import' }));
    fireEvent.click(screen.getByRole('tab', { name: 'History & formats' }));
    await waitFor(() => expect(guard).toHaveBeenCalledTimes(2));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('wizard-view')).toBeTruthy();
    expect(screen.queryByTestId('manage-view')).toBeNull();
  });

  it('leaves once the wizard agrees', async () => {
    guard = vi.fn(async () => true);
    const { onClose } = renderPage();

    fireEvent.click(screen.getByRole('tab', { name: 'History & formats' }));
    expect(await screen.findByTestId('manage-view')).toBeTruthy();

    // The history view holds nothing unsaved: closing from it never asks.
    fireEvent.click(screen.getByRole('button', { name: 'Close import' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(guard).toHaveBeenCalledTimes(1);
  });
});
