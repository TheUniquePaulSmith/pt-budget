// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MasterDetailLayout } from './MasterDetailLayout';

function installMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('MasterDetailLayout', () => {
  it('renders master, detail and aside side by side on desktop with a keyboard-resizable divider', () => {
    installMatchMedia(false);
    render(
      <MasterDetailLayout
        data-testid="layout"
        master={<div>master</div>}
        detail={<div>detail</div>}
        aside={<div>aside</div>}
        detailOpen
        storageKey="test_masterWidth"
        initialMasterWidth={400}
      />
    );

    expect(screen.getByTestId('layout')).toHaveAttribute('data-layout', 'desktop');
    expect(screen.getByText('master')).toBeInTheDocument();
    expect(screen.getByText('detail')).toBeInTheDocument();
    expect(screen.getByText('aside')).toBeInTheDocument();

    const divider = screen.getByRole('separator', { name: 'Resize list' });
    expect(divider).toHaveAttribute('aria-valuenow', '400');
    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    expect(divider).toHaveAttribute('aria-valuenow', '376');
    expect(window.localStorage.getItem('test_masterWidth')).toBe('376');
  });

  it('shows the empty state when there is no detail', () => {
    installMatchMedia(false);
    render(<MasterDetailLayout master={<div>master</div>} detail={null} emptyDetail={<span>pick one</span>} detailOpen={false} />);
    expect(screen.getByText('pick one')).toBeInTheDocument();
  });

  it('stacks on phones: master (with aside) or the detail with a back button', () => {
    installMatchMedia(true);
    const onCloseDetail = vi.fn();
    const { rerender } = render(
      <MasterDetailLayout
        data-testid="layout"
        master={<div>master</div>}
        detail={<div>detail</div>}
        aside={<div>aside</div>}
        detailOpen={false}
        onCloseDetail={onCloseDetail}
        detailTitle="Record"
      />
    );

    expect(screen.getByTestId('layout')).toHaveAttribute('data-layout', 'mobile-master');
    expect(screen.getByText('master')).toBeInTheDocument();
    expect(screen.getByText('aside')).toBeInTheDocument();
    expect(screen.queryByText('detail')).not.toBeInTheDocument();

    rerender(
      <MasterDetailLayout
        data-testid="layout"
        master={<div>master</div>}
        detail={<div>detail</div>}
        aside={<div>aside</div>}
        detailOpen
        onCloseDetail={onCloseDetail}
        detailTitle="Record"
      />
    );
    expect(screen.getByTestId('layout')).toHaveAttribute('data-layout', 'mobile-detail');
    expect(screen.getByText('detail')).toBeInTheDocument();
    expect(screen.queryByText('master')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Record' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }));
    expect(onCloseDetail).toHaveBeenCalled();
  });
});
