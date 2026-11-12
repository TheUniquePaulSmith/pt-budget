// @vitest-environment jsdom

import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TestBrowser, type TestResults } from './TestBrowser';

const STORAGE_KEY = 'budgetApp_browserTestPassed';

class SharedWorkerMock {
  port = {
    start: vi.fn(),
    postMessage: vi.fn(),
    onmessage: null as ((event: MessageEvent) => void) | null,
  };

  onerror: ((event: ErrorEvent) => void) | null = null;
}

let lastWorker: SharedWorkerMock | null = null;

// A function, not an arrow: the component calls it with `new`.
const sharedWorkerConstructor = vi.fn(function () {
  lastWorker = new SharedWorkerMock();
  return lastWorker as unknown as SharedWorker;
});

const PASSING_RESULTS: TestResults = {
  sharedWorkerSupport: true,
  wasmSupport: true,
  sqliteSupport: true,
  vfsSupport: true,
  databaseOperationsSupport: true,
  overallCompatible: true,
};

function renderTestBrowser(onTestComplete = vi.fn()) {
  render(
    <ThemeProvider theme={createTheme()}>
      <TestBrowser onTestComplete={onTestComplete} />
    </ThemeProvider>
  );

  return onTestComplete;
}

/** Drives the mocked tester worker through connect → results. */
function deliverWorkerResults(results: TestResults) {
  act(() => {
    lastWorker?.port.onmessage?.({ data: { type: 'tester_connected' } } as MessageEvent);
  });
  expect(lastWorker?.port.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'test_compatibility' })
  );
  act(() => {
    lastWorker?.port.onmessage?.({
      data: { type: 'test_results', testResults: results, isSuccessful: results.overallCompatible },
    } as MessageEvent);
  });
}

function setDebugMode(enabled: boolean) {
  window.history.replaceState(null, '', enabled ? '/?debug' : '/');
}

/** The shared setup's matchMedia mock is reset between tests; AppLogo needs it for prefers-reduced-motion. */
function stubMatchMedia() {
  (window.matchMedia as unknown as ReturnType<typeof vi.fn>).mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe('TestBrowser', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    lastWorker = null;
    sharedWorkerConstructor.mockClear();
    stubMatchMedia();
    setDebugMode(false);
    Object.defineProperty(globalThis, 'SharedWorker', {
      configurable: true,
      writable: true,
      value: sharedWorkerConstructor,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ignores stale incompatible cached results and reruns the compatibility test', () => {
    const staleResults: TestResults = {
      sharedWorkerSupport: true,
      wasmSupport: true,
      sqliteSupport: true,
      vfsSupport: true,
      databaseOperationsSupport: false,
      overallCompatible: false,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(staleResults));

    const onTestComplete = renderTestBrowser();

    expect(sharedWorkerConstructor).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(onTestComplete).not.toHaveBeenCalled();
  });

  it('reuses a successful cached result without starting the worker again', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(PASSING_RESULTS));

    const onTestComplete = renderTestBrowser();

    expect(sharedWorkerConstructor).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(onTestComplete).toHaveBeenCalledWith(true, PASSING_RESULTS);
  });

  describe('quiet loading screen (default)', () => {
    it('shows the logo and a status line instead of the per-check panel while testing', () => {
      renderTestBrowser();

      const loadingScreen = screen.getByTestId('app-loading-screen');
      expect(loadingScreen).toBeInTheDocument();
      expect(loadingScreen).toHaveTextContent('Verifying browser compatibility…');
      expect(screen.getByTestId('app-logo')).toBeInTheDocument();
      expect(screen.queryByTestId('browser-compatibility-panel')).not.toBeInTheDocument();
      expect(screen.queryByText('Browser Compatibility Test')).not.toBeInTheDocument();
    });

    it('moves on immediately after a pass and switches the status line to initializing', () => {
      const onTestComplete = renderTestBrowser();

      deliverWorkerResults(PASSING_RESULTS);

      expect(onTestComplete).toHaveBeenCalledWith(true, PASSING_RESULTS);
      expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(PASSING_RESULTS));
      expect(screen.getByTestId('app-loading-screen')).toHaveTextContent('Initializing database...');
      expect(screen.queryByTestId('browser-compatibility-panel')).not.toBeInTheDocument();
    });

    it('shows the per-check panel when a check fails', () => {
      const failingResults: TestResults = {
        ...PASSING_RESULTS,
        vfsSupport: false,
        databaseOperationsSupport: false,
        overallCompatible: false,
        errorDetails: 'IndexedDB is unavailable in this context',
      };
      const onTestComplete = renderTestBrowser();

      deliverWorkerResults(failingResults);

      expect(onTestComplete).toHaveBeenCalledWith(false, failingResults);
      expect(screen.queryByTestId('app-loading-screen')).not.toBeInTheDocument();
      expect(screen.getByTestId('browser-compatibility-panel')).toBeInTheDocument();
      expect(screen.getByText('Browser Compatibility Test')).toBeInTheDocument();
      expect(screen.getByText('Incompatible')).toBeInTheDocument();
      expect(screen.getAllByText('Failed')).toHaveLength(2);
      expect(screen.getByText('Error details')).toBeInTheDocument();
    });

    it('shows the per-check panel when SharedWorker is missing', () => {
      Object.defineProperty(globalThis, 'SharedWorker', {
        configurable: true,
        writable: true,
        value: undefined,
      });
      const onTestComplete = renderTestBrowser();

      expect(onTestComplete).toHaveBeenCalledWith(
        false,
        expect.objectContaining({ wasmSupport: true, sharedWorkerSupport: false })
      );
      expect(screen.getByTestId('browser-compatibility-panel')).toBeInTheDocument();
      expect(screen.getByText('Incompatible')).toBeInTheDocument();
      expect(screen.queryByTestId('app-loading-screen')).not.toBeInTheDocument();
    });

    it('shows the per-check panel when the worker reports an error', () => {
      renderTestBrowser();

      act(() => {
        lastWorker?.port.onmessage?.({
          data: { type: 'error', error: 'wa-sqlite failed to load' },
        } as MessageEvent);
      });

      expect(screen.getByTestId('browser-compatibility-panel')).toBeInTheDocument();
      // The error alert sits above the incompatible-browser warning; the message repeats in the error details.
      const alerts = screen.getAllByRole('alert');
      expect(alerts).toHaveLength(2);
      expect(alerts[0]).toHaveTextContent('wa-sqlite failed to load');
      expect(screen.getByText('Incompatible')).toBeInTheDocument();
    });
  });

  describe('debug mode (?debug)', () => {
    beforeEach(() => {
      setDebugMode(true);
    });

    it('shows the per-check panel from the start', () => {
      renderTestBrowser();

      expect(screen.getByTestId('browser-compatibility-panel')).toBeInTheDocument();
      expect(screen.getByText('Browser Compatibility Test')).toBeInTheDocument();
      expect(screen.queryByTestId('app-loading-screen')).not.toBeInTheDocument();
    });

    it('keeps a passing result on screen for a while before moving on', () => {
      const onTestComplete = renderTestBrowser();

      deliverWorkerResults(PASSING_RESULTS);

      expect(screen.getByText('Compatible')).toBeInTheDocument();
      expect(onTestComplete).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(onTestComplete).toHaveBeenCalledWith(true, PASSING_RESULTS);
    });
  });
});
