// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSetToolCallLimit = vi.fn().mockResolvedValue(undefined);

vi.mock('./AiToolsContext', () => ({
  useAiToolsContext: () => ({
    registry: { tools: [], packs: [], failedPacks: [] },
    shippedPackErrors: [],
    error: null,
    bypassAllConsent: false,
    sessionGrants: [],
    toolCallLimit: 8,
    setToolCallLimit: mockSetToolCallLimit,
  }),
}));

import AiToolsTab from './AiToolsTab';

function renderTab() {
  return render(
    <ThemeProvider theme={createTheme()}>
      <AiToolsTab />
    </ThemeProvider>
  );
}

describe('AiToolsTab tool-call limit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the stored limit', () => {
    renderTab();

    expect(screen.getByTestId('ai-tool-call-limit')).toHaveValue(8);
  });

  it('saves a new limit when the field loses focus', async () => {
    const user = userEvent.setup();
    renderTab();

    const input = screen.getByTestId('ai-tool-call-limit');
    await user.clear(input);
    await user.type(input, '12');
    await user.tab();

    expect(mockSetToolCallLimit).toHaveBeenCalledWith(12);
  });

  it('clamps an out-of-range value instead of saving it as typed', async () => {
    const user = userEvent.setup();
    renderTab();

    const input = screen.getByTestId('ai-tool-call-limit');
    await user.clear(input);
    await user.type(input, '999');
    await user.tab();

    expect(mockSetToolCallLimit).toHaveBeenCalledWith(25);
    expect(input).toHaveValue(25);
  });

  it('does not save when the value is unchanged', async () => {
    const user = userEvent.setup();
    renderTab();

    const input = screen.getByTestId('ai-tool-call-limit');
    await user.click(input);
    await user.tab();

    expect(mockSetToolCallLimit).not.toHaveBeenCalled();
  });
});
