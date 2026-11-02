// @vitest-environment jsdom

import React from 'react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/databaseWorkerService', () => ({
  databaseWorkerService: {},
}));

import DatabaseStatusBar from './DatabaseStatusBar';

const status = {
  isWorkerAlive: true,
  isConnected: true,
  dbStatus: 'connected' as const,
  version: '1.0.0',
  lastHeartbeat: 0,
};

function renderBar(mode: 'light' | 'dark') {
  const theme = createTheme({
    palette: {
      mode,
      background:
        mode === 'dark'
          ? { default: '#0f172a', paper: '#182235' }
          : { default: '#f5f5f5', paper: '#ffffff' },
    },
  });
  render(
    <ThemeProvider theme={theme}>
      <DatabaseStatusBar status={status} />
    </ThemeProvider>
  );
  // The bar's root is the Paper that wraps the connection label.
  return screen.getByTestId('database-status').parentElement!.parentElement!.parentElement!;
}

describe('DatabaseStatusBar theming', () => {
  it('takes its surface from the theme in dark mode instead of a hard-coded light grey', () => {
    const bar = renderBar('dark');

    expect(getComputedStyle(bar).backgroundColor).toBe('rgb(15, 23, 42)');
  });

  it('keeps the light grey surface in light mode', () => {
    const bar = renderBar('light');

    expect(getComputedStyle(bar).backgroundColor).toBe('rgb(245, 245, 245)');
  });
});
