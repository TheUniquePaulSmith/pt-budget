// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChangePasswordSection } from './ChangePasswordSection';

function fillPasswords(current: string, next: string, confirm: string) {
  fireEvent.change(screen.getByLabelText('Current Password'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('New Password'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: confirm } });
}

describe('ChangePasswordSection', () => {
  it('disables the submit button when the new password is shorter than 8 characters', () => {
    const changePassword = vi.fn();

    render(
      <ChangePasswordSection changePassword={changePassword} databaseSource="local" syncStage={null} />
    );

    fillPasswords('oldpassword', 'short', 'short');

    expect(screen.getByRole('button', { name: 'Change Password' })).toBeDisabled();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('disables the submit button when new and confirm passwords do not match', () => {
    const changePassword = vi.fn();

    render(
      <ChangePasswordSection changePassword={changePassword} databaseSource="local" syncStage={null} />
    );

    fillPasswords('oldpassword', 'newpassword1', 'newpassword2');

    expect(screen.getByRole('button', { name: 'Change Password' })).toBeDisabled();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('calls changePassword and shows a success message on success', async () => {
    const changePassword = vi.fn().mockResolvedValue({ syncError: null });

    render(
      <ChangePasswordSection changePassword={changePassword} databaseSource="local" syncStage={null} />
    );

    fillPasswords('oldpassword', 'newpassword1', 'newpassword1');
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

    await waitFor(() => {
      expect(changePassword).toHaveBeenCalledWith('oldpassword', 'newpassword1');
    });
    await waitFor(() => {
      expect(screen.getByText('Password updated.')).toBeInTheDocument();
    });
  });

  it('shows the incorrect-current-password error surfaced from changePassword', async () => {
    const changePassword = vi.fn().mockRejectedValue(new Error('Current password is incorrect.'));

    render(
      <ChangePasswordSection changePassword={changePassword} databaseSource="local" syncStage={null} />
    );

    fillPasswords('wrongpassword', 'newpassword1', 'newpassword1');
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

    await waitFor(() => {
      expect(screen.getByText('Current password is incorrect.')).toBeInTheDocument();
    });
  });

  it('shows a warning when the password changed but the cloud re-sync failed', async () => {
    const changePassword = vi.fn().mockResolvedValue({ syncError: 'Network error' });

    render(
      <ChangePasswordSection changePassword={changePassword} databaseSource="gdrive" syncStage={null} />
    );

    fillPasswords('oldpassword', 'newpassword1', 'newpassword1');
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

    await waitFor(() => {
      expect(screen.getByText(/could not be re-encrypted yet \(Network error\)/i)).toBeInTheDocument();
    });
  });
});
