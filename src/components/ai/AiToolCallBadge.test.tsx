// @vitest-environment jsdom

import React from 'react';
import { render, screen, waitForElementToBeRemoved } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import AiToolCallBadge from './AiToolCallBadge';
import type { AiToolCallRecord } from '@/types/ai';

describe('AiToolCallBadge', () => {
  it('shows a badge for a completed tool call and expands to reveal input/output on click', async () => {
    const user = userEvent.setup();
    const toolCall: AiToolCallRecord = {
      id: 'call-1',
      name: 'query_transactions',
      argumentsJson: '{"limit":5,"merchant":"Amazon"}',
      status: 'completed',
      result: { rows: [{ id: 1, amount: -42.5 }] },
    };

    render(<AiToolCallBadge toolCall={toolCall} />);

    const badge = screen.getByText('Used query_transactions');
    expect(screen.queryByText('Input')).not.toBeInTheDocument();

    await user.click(badge);

    expect(screen.getByText('Input')).toBeInTheDocument();
    expect(screen.getByText('Output')).toBeInTheDocument();
    expect(screen.getByText(/"merchant": "Amazon"/)).toBeInTheDocument();
    expect(screen.getByText(/"amount": -42.5/)).toBeInTheDocument();

    await user.click(badge);
    await waitForElementToBeRemoved(() => screen.queryByText('Input'));
  });

  it('renders a failed tool call with an error color and shows the error message when expanded', async () => {
    const user = userEvent.setup();
    const toolCall: AiToolCallRecord = {
      id: 'call-2',
      name: 'apply_transaction_classifications',
      argumentsJson: '{}',
      status: 'failed',
      error: 'Write mode disabled',
    };

    render(<AiToolCallBadge toolCall={toolCall} />);

    await user.click(screen.getByText('Used apply_transaction_classifications'));

    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('Write mode disabled')).toBeInTheDocument();
  });
});
