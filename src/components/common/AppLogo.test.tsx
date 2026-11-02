// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AppLogo from './AppLogo';

function stubReducedMotion(prefersReduced: boolean) {
  (window.matchMedia as unknown as ReturnType<typeof vi.fn>).mockImplementation((query: string) => ({
    matches: prefersReduced && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function visibleFrames(svg: HTMLElement): number {
  return svg.querySelectorAll('g[visibility="visible"]').length;
}

describe('AppLogo', () => {
  // The shared setup's matchMedia mock is reset between tests, so stub it each time.
  beforeEach(() => stubReducedMotion(false));

  it('flaps and bobs by default', () => {
    render(<AppLogo />);

    const logo = screen.getByTestId('app-logo');
    expect(logo).toHaveAttribute('data-animated', 'true');
    // One flap animation per wing frame (up, mid, down) plus the bob.
    expect(logo.querySelectorAll('animate')).toHaveLength(3);
    expect(logo.querySelectorAll('animateTransform')).toHaveLength(1);
  });

  it('holds still on one wing frame when animation is turned off', () => {
    render(<AppLogo animated={false} />);

    const logo = screen.getByTestId('app-logo');
    expect(logo).toHaveAttribute('data-animated', 'false');
    expect(logo.querySelectorAll('animate, animateTransform')).toHaveLength(0);
    expect(visibleFrames(logo as unknown as HTMLElement)).toBe(1);
  });

  it('calms the motion for a visitor preferring reduced motion without freezing the logo', () => {
    stubReducedMotion(true);
    render(<AppLogo />);

    const logo = screen.getByTestId('app-logo');
    expect(logo).toHaveAttribute('data-animated', 'true');
    // Still flaps, but no bob.
    expect(logo.querySelectorAll('animate')).toHaveLength(3);
    expect(logo.querySelectorAll('animateTransform')).toHaveLength(0);
  });

  it('scales in whole sprite pixels', () => {
    render(<AppLogo scale={3} />);

    const logo = screen.getByTestId('app-logo');
    expect(logo).toHaveAttribute('width', String(16 * 3));
    expect(logo).toHaveAttribute('height', String(14 * 3));
  });

  it('is decorative unless it is given a title', () => {
    const { rerender } = render(<AppLogo />);
    expect(screen.getByTestId('app-logo')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    rerender(<AppLogo title="Budget Tracker logo" />);
    expect(screen.getByRole('img', { name: 'Budget Tracker logo' })).toBeInTheDocument();
  });
});
