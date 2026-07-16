// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageChoice } from './StorageChoice';
import { createCloudProviderClient } from '@/lib/cloudProviderClients';

vi.mock('@/lib/cloudProviderClients', () => ({
  createCloudProviderClient: vi.fn(),
}));

const mockedCreateCloudProviderClient = vi.mocked(createCloudProviderClient);

function mockProviderConfig(configured: { gdrive: boolean; onedrive: boolean }) {
  mockedCreateCloudProviderClient.mockImplementation(
    (provider) =>
      ({
        isConfigured: () => configured[provider as 'gdrive' | 'onedrive'],
      }) as any
  );
}

function renderStorageChoice(onChoiceSelected = vi.fn().mockResolvedValue(undefined)) {
  render(
    <ThemeProvider theme={createTheme()}>
      <StorageChoice onChoiceSelected={onChoiceSelected} isLoading={false} error={null} />
    </ThemeProvider>
  );
  return onChoiceSelected;
}

describe('StorageChoice', () => {
  beforeEach(() => {
    mockedCreateCloudProviderClient.mockReset();
  });

  it('enables every option when both cloud providers are configured', () => {
    mockProviderConfig({ gdrive: true, onedrive: true });

    renderStorageChoice();

    expect(screen.getByTestId('storage-choice-local')).toBeEnabled();
    expect(screen.getByTestId('storage-choice-gdrive')).toBeEnabled();
    expect(screen.getByTestId('storage-choice-onedrive')).toBeEnabled();
  });

  it('disables Google Drive and blocks selection when it is not configured', () => {
    mockProviderConfig({ gdrive: false, onedrive: true });
    const onChoiceSelected = renderStorageChoice();

    const gdriveButton = screen.getByTestId('storage-choice-gdrive');
    expect(gdriveButton).toBeDisabled();

    fireEvent.click(gdriveButton);
    expect(onChoiceSelected).not.toHaveBeenCalled();
  });

  it('disables OneDrive and blocks selection when it is not configured', () => {
    mockProviderConfig({ gdrive: true, onedrive: false });
    const onChoiceSelected = renderStorageChoice();

    const oneDriveButton = screen.getByTestId('storage-choice-onedrive');
    expect(oneDriveButton).toBeDisabled();

    fireEvent.click(oneDriveButton);
    expect(onChoiceSelected).not.toHaveBeenCalled();
  });

  it('never disables the local option, even when no cloud provider is configured', () => {
    mockProviderConfig({ gdrive: false, onedrive: false });
    const onChoiceSelected = renderStorageChoice();

    const localButton = screen.getByTestId('storage-choice-local');
    expect(localButton).toBeEnabled();

    fireEvent.click(localButton);
    expect(onChoiceSelected).toHaveBeenCalledWith('local');
  });

  it('shows a tooltip explaining why an unconfigured provider is disabled', async () => {
    mockProviderConfig({ gdrive: false, onedrive: true });
    renderStorageChoice();

    fireEvent.mouseOver(screen.getByTestId('storage-choice-gdrive'));

    await waitFor(() => {
      expect(
        screen.getByText('Google Drive is not configured for this deployment.')
      ).toBeInTheDocument();
    });
  });
});
