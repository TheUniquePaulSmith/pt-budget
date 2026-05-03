// @vitest-environment jsdom

import React from 'react';
import { act, render } from '@testing-library/react';
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

const sharedWorkerConstructor = vi.fn(
  () => new SharedWorkerMock() as unknown as SharedWorker
);

function renderTestBrowser(onTestComplete = vi.fn()) {
  render(
    <ThemeProvider theme={createTheme()}>
      <TestBrowser onTestComplete={onTestComplete} />
    </ThemeProvider>
  );

  return onTestComplete;
}

describe('TestBrowser', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    sharedWorkerConstructor.mockClear();
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
    const cachedResults: TestResults = {
      sharedWorkerSupport: true,
      wasmSupport: true,
      sqliteSupport: true,
      vfsSupport: true,
      databaseOperationsSupport: true,
      overallCompatible: true,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedResults));

    const onTestComplete = renderTestBrowser();

    expect(sharedWorkerConstructor).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(onTestComplete).toHaveBeenCalledWith(true, cachedResults);
  });
});