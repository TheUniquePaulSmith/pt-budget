// @vitest-environment jsdom

import { Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CustomThemeProvider,
  THEME_PREFERENCE_STORAGE_KEY,
} from '@/theme/theme';
import { useSettingsSlice } from '@/contexts/useDatabaseSlices';

import SettingsPage from './SettingsPage';

vi.mock('@/contexts/useDatabaseSlices', () => ({
  useSettingsSlice: vi.fn(),
}));

const mockedUseSettingsSlice = vi.mocked(useSettingsSlice);

function installMatchMediaMock(isDarkMode = false) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: isDarkMode,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function ThemeProbe() {
  const theme = useTheme();

  return (
    <Box
      data-testid="theme-probe"
      data-mode={theme.palette.mode}
      data-spacing={theme.spacing(1)}
      data-radius={String(theme.shape.borderRadius)}
    />
  );
}

function renderSettingsPage() {
  return render(
    <CustomThemeProvider>
      <ThemeProbe />
      <SettingsPage onClose={vi.fn()} />
    </CustomThemeProvider>
  );
}

function getThemeRadio(themeId: string) {
  const radio = screen
    .getAllByRole('radio')
    .find(
      (element): element is HTMLInputElement =>
        element instanceof HTMLInputElement && element.value === themeId
    );

  if (!radio) {
    throw new Error(`Theme radio not found for ${themeId}`);
  }

  return radio;
}

describe('SettingsPage theme presets', () => {
  beforeEach(() => {
    localStorage.clear();
    installMatchMediaMock(true);
    mockedUseSettingsSlice.mockReturnValue({
      exportDatabase: vi.fn().mockResolvedValue(null),
      connectCloudSource: vi.fn().mockResolvedValue(undefined),
      migrateDatabaseToCloud: vi.fn().mockResolvedValue(undefined),
      saveDatabaseToCurrentCloud: vi.fn().mockResolvedValue(undefined),
      switchToLocalSource: vi.fn(),
      isDatabaseLoaded: true,
      databaseSource: 'local',
      databaseSourceState: {
        source: 'local',
        linkedFiles: {},
        lastLocalWriteTimestamp: null,
        lastCloudSyncTimestamp: null,
        lastCloudFileTimestamp: null,
        lastSyncError: null,
      },
      error: null,
    });
  });

  it('lets users switch between built-in light, dark, compact, and system presets', async () => {
    renderSettingsPage();

    fireEvent.click(screen.getByRole('tab', { name: /display/i }));

    const lightRadio = getThemeRadio('light');
    const darkRadio = getThemeRadio('dark');
    const compactRadio = getThemeRadio('compact');
    const systemRadio = getThemeRadio('system');

    expect(lightRadio).toBeChecked();
    expect(screen.getByText(/saved locally in this browser/i)).toBeInTheDocument();

    fireEvent.click(systemRadio);

    await waitFor(() => {
      expect(systemRadio).toBeChecked();
      expect(screen.getByTestId('theme-probe')).toHaveAttribute('data-mode', 'dark');
    });

    expect(localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)).toBe('system');

    fireEvent.click(darkRadio);

    await waitFor(() => {
      expect(darkRadio).toBeChecked();
      expect(screen.getByTestId('theme-probe')).toHaveAttribute('data-mode', 'dark');
    });

    expect(localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)).toBe('dark');

    fireEvent.click(compactRadio);

    await waitFor(() => {
      expect(compactRadio).toBeChecked();
      expect(screen.getByTestId('theme-probe')).toHaveAttribute('data-spacing', '7px');
      expect(screen.getByTestId('theme-probe')).toHaveAttribute('data-radius', '6');
    });

    expect(localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)).toBe('compact');
  });
});
