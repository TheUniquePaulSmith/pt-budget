// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import InstallGuideDialog from './InstallGuideDialog';

describe('InstallGuideDialog', () => {
  it('walks iPhone and iPad users through Add to Home Screen', () => {
    const onClose = vi.fn();
    render(<InstallGuideDialog open guide="ios" onClose={onClose} />);

    expect(screen.getByText('Install Budget Tracker')).toBeInTheDocument();
    const steps = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(steps).toEqual([
      'Tap the Share button in the browser toolbar.',
      'Choose “Add to Home Screen”.',
      'Tap Add.',
    ]);

    fireEvent.click(screen.getByTestId('install-guide-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('walks Mac Safari users through Add to Dock', () => {
    render(<InstallGuideDialog open guide="macSafari" onClose={() => undefined} />);
    expect(screen.getAllByRole('listitem')[1]).toHaveTextContent('Choose “Add to Dock”.');
  });

  it('renders nothing without a guide', () => {
    render(<InstallGuideDialog open guide={null} onClose={() => undefined} />);
    expect(screen.queryByTestId('install-guide')).toBeNull();
  });
});
