// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CloudConflictDialog } from './CloudConflictDialog';
import type { DatabaseSourceConflict } from '@/lib/databaseSourceStorage';

const conflict: DatabaseSourceConflict = {
  provider: 'gdrive',
  detectedAt: '2026-07-14T12:00:00.000Z',
  remoteModifiedAt: '2026-07-14T11:00:00.000Z',
  remoteEtag: '3',
};

describe('CloudConflictDialog', () => {
  it('calls onResolve with keep-both when that action is clicked', async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <CloudConflictDialog
        open
        conflict={conflict}
        pendingChangesSince="2026-07-14T10:00:00.000Z"
        onResolve={onResolve}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Keep Both' }));

    await waitFor(() => {
      expect(onResolve).toHaveBeenCalledWith('keep-both');
    });
  });

  it('calls onResolve with overwrite when that action is clicked', async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);

    render(
      <CloudConflictDialog
        open
        conflict={conflict}
        pendingChangesSince="2026-07-14T10:00:00.000Z"
        onResolve={onResolve}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Overwrite Cloud' }));

    await waitFor(() => {
      expect(onResolve).toHaveBeenCalledWith('overwrite');
    });
  });

  it('requires an explicit confirm step before resolving with use-cloud', async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);

    render(
      <CloudConflictDialog
        open
        conflict={conflict}
        pendingChangesSince="2026-07-14T10:00:00.000Z"
        onResolve={onResolve}
        onClose={vi.fn()}
      />
    );

    // First click only reveals the warning + confirm button — it must not
    // resolve immediately, since this choice discards local changes.
    fireEvent.click(screen.getByRole('button', { name: 'Use Cloud Version' }));
    expect(onResolve).not.toHaveBeenCalled();
    expect(screen.getByText(/can't be undone/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm: Discard Local Changes' }));

    await waitFor(() => {
      expect(onResolve).toHaveBeenCalledWith('use-cloud');
    });
  });

  it('calls onClose when Not Now is clicked', () => {
    const onClose = vi.fn();

    render(
      <CloudConflictDialog
        open
        conflict={conflict}
        pendingChangesSince="2026-07-14T10:00:00.000Z"
        onResolve={vi.fn()}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Not Now' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing interactive-breaking when conflict is null', () => {
    render(
      <CloudConflictDialog
        open
        conflict={null}
        pendingChangesSince={null}
        onResolve={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByTestId('cloud-conflict-dialog')).toBeInTheDocument();
  });
});
