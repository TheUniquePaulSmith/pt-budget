// @vitest-environment jsdom

import React, { Suspense } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getNetworkStatus } from '@/components/common/Offline/useOnlineStatus';

import PageLoadBoundary from './PageLoadBoundary';
import { retryableLazy } from './retryableLazy';

// Connect the network store before the tests fire online/offline events at the window.
getNetworkStatus();

function Page() {
  return <p>Loans page</p>;
}

function setOnline(online: boolean) {
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  });
}

function renderPage(LazyPage: React.ComponentType) {
  return render(
    <PageLoadBoundary pageId="loans">
      <Suspense fallback={<p>Loading</p>}>
        <LazyPage />
      </Suspense>
    </PageLoadBoundary>
  );
}

afterEach(() => {
  setOnline(true);
});

describe('PageLoadBoundary with retryableLazy', () => {
  it('explains a page that cannot load offline, fetches it once, and loads it by itself when back online', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const factory = vi
      .fn<() => Promise<{ default: React.ComponentType }>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module'))
      .mockResolvedValue({ default: Page });
    const LazyPage = retryableLazy(factory);

    setOnline(false);
    renderPage(LazyPage);
    const unavailable = await screen.findByTestId('page-unavailable');
    expect(unavailable).toHaveTextContent('Not available offline yet');
    expect(screen.getByTestId('page-unavailable-retry')).toBeDisabled();
    // One failed fetch, not a loop.
    expect(factory).toHaveBeenCalledTimes(1);

    setOnline(true);
    expect(await screen.findByText('Loans page')).toBeInTheDocument();
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('offers Try again when the page fails while online', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const factory = vi
      .fn<() => Promise<{ default: React.ComponentType }>>()
      .mockRejectedValueOnce(new Error('chunk 404'))
      .mockResolvedValue({ default: Page });
    renderPage(retryableLazy(factory));

    expect(await screen.findByTestId('page-unavailable')).toHaveTextContent("This page couldn't be loaded");
    fireEvent.click(screen.getByTestId('page-unavailable-retry'));
    expect(await screen.findByText('Loans page')).toBeInTheDocument();
  });

  it('tries again when the page is opened again after a failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const factory = vi
      .fn<() => Promise<{ default: React.ComponentType }>>()
      .mockRejectedValueOnce(new Error('chunk 404'))
      .mockResolvedValue({ default: Page });
    const LazyPage = retryableLazy(factory);

    const first = renderPage(LazyPage);
    await screen.findByTestId('page-unavailable');
    first.unmount();

    renderPage(LazyPage);
    expect(await screen.findByText('Loans page')).toBeInTheDocument();
  });
});
