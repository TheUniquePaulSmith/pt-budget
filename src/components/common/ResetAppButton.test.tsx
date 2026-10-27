// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ResetAppButton } from './ResetAppButton';

function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'Reset App' }));
  return screen.getByRole('dialog');
}

function confirmButton() {
  const dialog = screen.getByRole('dialog');
  return Array.from(dialog.querySelectorAll('button')).find((button) =>
    /^(Reset App|Resetting…)$/.test(button.textContent ?? '')
  ) as HTMLButtonElement;
}

describe('ResetAppButton', () => {
  it('confirms with a single click and no password when none is required', async () => {
    const onReset = vi.fn().mockResolvedValue(undefined);
    render(<ResetAppButton onReset={onReset} />);

    openDialog();
    expect(screen.queryByLabelText('Database password')).not.toBeInTheDocument();
    fireEvent.click(confirmButton());

    await waitFor(() => expect(onReset).toHaveBeenCalledTimes(1));
  });

  it('closes the dialog silently when an unprotected reset fails', async () => {
    const onReset = vi.fn().mockRejectedValue(new Error('boom'));
    render(<ResetAppButton onReset={onReset} />);

    openDialog();
    fireEvent.click(confirmButton());

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  describe('requirePassword', () => {
    it('cannot be confirmed until a password is typed, then passes it to onReset', async () => {
      const onReset = vi.fn().mockResolvedValue(undefined);
      render(<ResetAppButton onReset={onReset} requirePassword />);

      openDialog();
      expect(confirmButton()).toBeDisabled();

      fireEvent.change(screen.getByLabelText('Database password'), { target: { value: 's3cret-pass' } });
      expect(confirmButton()).toBeEnabled();
      fireEvent.click(confirmButton());

      await waitFor(() => expect(onReset).toHaveBeenCalledWith('s3cret-pass'));
    });

    it('shows the rejection in the dialog, clears the field and stays open for another try', async () => {
      const onReset = vi.fn().mockRejectedValue(new Error('Incorrect password'));
      render(<ResetAppButton onReset={onReset} requirePassword />);

      openDialog();
      fireEvent.change(screen.getByLabelText('Database password'), { target: { value: 'wrong' } });
      fireEvent.click(confirmButton());

      expect(await screen.findByText('Incorrect password')).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByLabelText('Database password')).toHaveValue('');
      expect(confirmButton()).toBeDisabled();
    });

    it('does not keep a typed password or an old error after the dialog is cancelled', async () => {
      const onReset = vi.fn().mockRejectedValue(new Error('Incorrect password'));
      render(<ResetAppButton onReset={onReset} requirePassword />);

      openDialog();
      fireEvent.change(screen.getByLabelText('Database password'), { target: { value: 'wrong' } });
      fireEvent.click(confirmButton());
      await screen.findByText('Incorrect password');

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

      openDialog();
      expect(screen.queryByText('Incorrect password')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Database password')).toHaveValue('');
    });
  });
});
