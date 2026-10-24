// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import AiConsentCard from './AiConsentCard';
import type { AiConsentRequest } from '@/types/aiTools';

const theme = createTheme();

const request: AiConsentRequest = {
  id: 'req-1',
  toolCallId: 'call-1',
  toolName: 'create_transaction',
  crud: 'create',
  description: 'Create a transaction.',
  argumentsJson: '{"accountId":1,"amount":-12.5,"description":"Coffee"}',
  source: 'builtin',
};

function renderCard(onDecision = vi.fn()) {
  render(
    <ThemeProvider theme={theme}>
      <AiConsentCard request={request} onDecision={onDecision} />
    </ThemeProvider>
  );
  return onDecision;
}

describe('AiConsentCard', () => {
  it('shows the tool, its CRUD badge, description and a formatted argument preview', () => {
    renderCard();

    expect(screen.getByRole('group', { name: 'Consent required for create_transaction' })).toBeInTheDocument();
    expect(screen.getByTestId('ai-consent-crud')).toHaveTextContent('Create');
    expect(screen.getByText('Create a transaction.')).toBeInTheDocument();
    expect(screen.getByText(/"description": "Coffee"/)).toBeInTheDocument();
  });

  it('reports each decision', async () => {
    const user = userEvent.setup();
    const onDecision = renderCard();

    await user.click(screen.getByRole('button', { name: 'Allow once' }));
    await user.click(screen.getByRole('button', { name: 'Allow this session' }));
    await user.click(screen.getByRole('button', { name: 'Always allow' }));
    await user.click(screen.getByRole('button', { name: 'Deny' }));

    expect(onDecision.mock.calls.map((call) => call[0])).toEqual(['allow_once', 'allow_session', 'allow_always', 'deny']);
  });

  it('marks delete calls and pack tools', () => {
    render(
      <ThemeProvider theme={theme}>
        <AiConsentCard request={{ ...request, crud: 'delete', source: 'pack', packKey: 'user:x' }} onDecision={vi.fn()} />
      </ThemeProvider>
    );
    expect(screen.getByTestId('ai-consent-crud')).toHaveTextContent('Delete');
    expect(screen.getByText('Pack')).toBeInTheDocument();
  });
});
