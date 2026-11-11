// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LayoutProposal } from '@/lib/statementImport';

const ai = vi.hoisted(() => ({
  suggest: vi.fn(),
  context: null as unknown,
}));

vi.mock('@/lib/statementImport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/statementImport')>()),
  suggestLayoutWithAi: ai.suggest,
}));
// The provider setup belongs to the AI panel; the wizard only reads which provider is active.
vi.mock('@/components/ai/AiProviderContext', () => ({
  AiProviderContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAiProviderContext: () => ai.context,
}));

import AiLayoutHelp from './AiLayoutHelp';
import { fakePropose, makeTable } from './testing/fakePipeline';

const table = makeTable(
  [
    ['2030-02-01', 'Card 4000000000004821 Coffee', '-4.50'],
    ['2030-02-02', 'Paycheck', '1200.00'],
  ],
  ['Posted', 'Details', 'Value']
);
const proposal: LayoutProposal = { ...fakePropose(makeTable([])), confidence: 0.8 };

function provider(kind: string, label: string, ready = true) {
  const createChatCompletion = vi.fn(async () => ({ choices: [{ message: { content: '{"date":0}' } }] }));
  ai.context = {
    provider: { id: kind, kind, label, model: 'm', createChatCompletion },
    providerLabel: label,
    isLocalProvider: kind === 'local',
    isProviderReady: ready,
    isLoading: false,
  };
  return createChatCompletion;
}

beforeEach(() => {
  ai.suggest.mockReset();
});

describe('AiLayoutHelp (D11)', () => {
  it('offers nothing when no AI provider is ready', () => {
    provider('local', 'Local AI', false);
    render(<AiLayoutHelp table={table} onProposal={vi.fn()} />);
    expect(screen.queryByTestId('import-ask-ai')).toBeNull();
  });

  it('asks a remote provider only after a confirmation that names it and shows the masked sample', async () => {
    provider('anthropic', 'Anthropic (work)');
    ai.suggest.mockResolvedValue(proposal);
    const onProposal = vi.fn();
    render(<AiLayoutHelp table={table} onProposal={onProposal} />);

    fireEvent.click(screen.getByTestId('import-ask-ai'));
    // Nothing has been sent yet.
    expect(ai.suggest).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: 'Send a sample to Anthropic (work)?' });
    const sample = within(dialog).getByTestId('import-ai-sample');
    expect(sample).toHaveTextContent('Posted');
    // Exactly what would leave the device: long numbers cut to their last four digits.
    expect(sample).toHaveTextContent('Card •••4821 Coffee');
    expect(sample).not.toHaveTextContent('4000000000004821');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to Anthropic (work)' }));
    await waitFor(() => expect(onProposal).toHaveBeenCalledWith(proposal));
    expect(ai.suggest).toHaveBeenCalledTimes(1);
    expect(ai.suggest.mock.calls[0][0]).toBe(table);
    expect(await screen.findByTestId('import-ai-outcome')).toHaveTextContent("The AI's suggestion is shown below.");
  });

  it('sends nothing when the confirmation is cancelled, and asks again the next time', async () => {
    provider('openai', 'OpenAI');
    render(<AiLayoutHelp table={table} onProposal={vi.fn()} />);

    fireEvent.click(screen.getByTestId('import-ask-ai'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(ai.suggest).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('import-ask-ai'));
    expect(await screen.findByRole('dialog', { name: 'Send a sample to OpenAI?' })).toBeInTheDocument();
  });

  it('asks a model that runs locally without a confirmation, through the provider it was given', async () => {
    const createChatCompletion = provider('local', 'Local AI');
    ai.suggest.mockImplementation(async (_table, complete) => {
      await complete({ system: 'system prompt', user: 'user prompt' });
      return null;
    });
    const onProposal = vi.fn();
    render(<AiLayoutHelp table={table} onProposal={onProposal} />);

    fireEvent.click(screen.getByTestId('import-ask-ai'));
    expect(await screen.findByTestId('import-ai-outcome')).toHaveTextContent('The AI could not work out this file.');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onProposal).not.toHaveBeenCalled();
    expect(createChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: 'system', content: 'system prompt' },
          { role: 'user', content: 'user prompt' },
        ],
      })
    );
  });

  it('holds a cloud provider while offline and offers it again once back online; a local model keeps working', async () => {
    provider('anthropic', 'Anthropic (work)');
    const { unmount } = render(<AiLayoutHelp table={table} onProposal={vi.fn()} />);
    expect(screen.queryByTestId('offline-feature-cloudAi')).toBeNull();

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByTestId('import-ask-ai')).toBeDisabled();
    expect(screen.getByTestId('offline-feature-cloudAi')).toHaveTextContent(
      'Cloud AI models need an internet connection.'
    );

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.getByTestId('import-ask-ai')).toBeEnabled();
    expect(screen.queryByTestId('offline-feature-cloudAi')).toBeNull();
    unmount();

    provider('local', 'Local AI');
    render(<AiLayoutHelp table={table} onProposal={vi.fn()} />);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByTestId('import-ask-ai')).toBeEnabled();
    expect(screen.queryByTestId('offline-feature-cloudAi')).toBeNull();
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
  });

  it('says so when the provider cannot be reached', async () => {
    provider('local_endpoint', 'Ollama');
    ai.suggest.mockRejectedValue(new Error('network'));
    render(<AiLayoutHelp table={table} onProposal={vi.fn()} />);

    fireEvent.click(screen.getByTestId('import-ask-ai'));
    expect(await screen.findByTestId('import-ai-outcome')).toHaveTextContent('The AI could not be reached.');
  });
});
