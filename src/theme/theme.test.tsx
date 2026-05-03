// @vitest-environment jsdom

import { Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import React, { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BUILT_IN_THEME_PRESETS,
  CustomThemeProvider,
  THEME_PREFERENCE_STORAGE_KEY,
  createAppTheme,
  useThemePreferences,
} from './theme';

function installMatchMediaMock(initialMode: 'light' | 'dark' = 'light') {
  let currentMode = initialMode;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: currentMode === 'dark',
      media: query,
      onchange: null,
      addEventListener: (_eventName: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_eventName: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
      addListener: (listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeListener: (listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
      dispatchEvent: () => true,
    })),
  });

  return {
    setMode(nextMode: 'light' | 'dark') {
      currentMode = nextMode;
      const event = {
        matches: nextMode === 'dark',
        media: '(prefers-color-scheme: dark)',
      } as MediaQueryListEvent;

      listeners.forEach((listener) => listener(event));
    },
  };
}

function ThemeWrapper({ children }: PropsWithChildren) {
  return <CustomThemeProvider>{children}</CustomThemeProvider>;
}

function ThemeProbe() {
  const theme = useTheme();

  return <Box data-testid="theme-probe" data-mode={theme.palette.mode} />;
}

describe('createAppTheme', () => {
  it('builds the dark preset with dark palette mode', () => {
    const theme = createAppTheme('dark');

    expect(theme.palette.mode).toBe('dark');
    expect(theme.palette.background.default).toBe('#0f172a');
  });

  it('builds the compact preset with denser spacing tokens', () => {
    const compactTheme = createAppTheme('compact');
    const lightTheme = createAppTheme('light');

    expect(compactTheme.spacing(1)).toBe('7px');
    expect(lightTheme.spacing(1)).toBe('8px');
    expect(compactTheme.shape.borderRadius).toBe(6);
    expect(lightTheme.shape.borderRadius).toBe(8);
  });

  it('builds the system preset from the resolved palette mode', () => {
    const theme = createAppTheme('system', 'dark');

    expect(theme.palette.mode).toBe('dark');
    expect(theme.palette.background.default).toBe('#0f172a');
  });
});

describe('CustomThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    installMatchMediaMock('light');
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('exposes the four built-in presets and defaults to light', () => {
    const { result } = renderHook(() => useThemePreferences(), {
      wrapper: ThemeWrapper,
    });

    expect(result.current.availableThemes).toEqual(BUILT_IN_THEME_PRESETS);
    expect(result.current.selectedThemeId).toBe('light');
  });

  it('reads the stored preference and persists later updates', async () => {
    localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, 'compact');

    const { result } = renderHook(() => useThemePreferences(), {
      wrapper: ThemeWrapper,
    });

    await waitFor(() => {
      expect(result.current.selectedThemeId).toBe('compact');
    });

    act(() => {
      result.current.setSelectedThemeId('dark');
    });

    await waitFor(() => {
      expect(localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)).toBe('dark');
    });
  });

  it('falls back to light for invalid stored values and responds to storage sync', async () => {
    localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, 'unexpected');

    const { result } = renderHook(() => useThemePreferences(), {
      wrapper: ThemeWrapper,
    });

    await waitFor(() => {
      expect(result.current.selectedThemeId).toBe('light');
    });

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: THEME_PREFERENCE_STORAGE_KEY,
          newValue: 'compact',
        })
      );
    });

    await waitFor(() => {
      expect(result.current.selectedThemeId).toBe('compact');
    });
  });

  it('follows system color-scheme changes when the system preset is selected', async () => {
    const matchMediaController = installMatchMediaMock('light');

    render(
      <CustomThemeProvider>
        <ThemeProbe />
      </CustomThemeProvider>
    );

    expect(screen.getByTestId('theme-probe')).toHaveAttribute('data-mode', 'light');

    localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, 'system');

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: THEME_PREFERENCE_STORAGE_KEY,
          newValue: 'system',
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('theme-probe')).toHaveAttribute('data-mode', 'light');
    });

    act(() => {
      matchMediaController.setMode('dark');
    });

    await waitFor(() => {
      expect(screen.getByTestId('theme-probe')).toHaveAttribute('data-mode', 'dark');
    });
  });
});
