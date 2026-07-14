// @vitest-environment jsdom

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/contexts/useDatabaseSlices', () => ({
  useAiDatabaseToolsSlice: vi.fn(() => ({})),
}));

vi.mock('@/contexts/useWllamaSlices', () => ({
  useAiChatRuntimeSlice: vi.fn(() => ({
    isModelLoaded: true,
    loadedModel: 'test-model.gguf',
    showTokenUsage: false,
    maxOutputTokens: 800,
    createChatCompletion: vi.fn(),
    createChatCompletionStream: vi.fn(),
  })),
}));

vi.mock('@/lib/aiChatService', () => ({
  runAiChatCompletion: vi.fn(),
}));

import AiChat from './AiChat';
import { runAiChatCompletion } from '@/lib/aiChatService';

const mockedRunAiChatCompletion = vi.mocked(runAiChatCompletion);

const theme = createTheme();

const renderAiChat = () => render(
  <ThemeProvider theme={theme}>
    <AiChat
      writeMode="review"
      onClassificationSuggestions={vi.fn()}
      onMerchantRuleSuggestions={vi.fn()}
      onReviewableAutomation={vi.fn()}
    />
  </ThemeProvider>
);

describe('AiChat error rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a failed model response as a red error bubble', async () => {
    mockedRunAiChatCompletion.mockRejectedValue(
      new Error('request (2001 tokens) exceeds the available context size (1024 tokens), try increasing it')
    );

    const user = userEvent.setup();
    renderAiChat();

    const textbox = screen.getByLabelText('Ask about transactions');
    await user.type(textbox, 'Show me all transactions that involve Amazon');
    await user.click(screen.getByRole('button', { name: 'Send AI prompt' }));

    const errorText = await screen.findByText(
      /Error: request \(2001 tokens\) exceeds the available context size/
    );
    expect(errorText).toBeInTheDocument();

    await waitFor(() => {
      let node: HTMLElement | null = errorText;
      let matched = false;
      while (node) {
        if (getComputedStyle(node).backgroundColor === 'rgb(211, 47, 47)') {
          matched = true;
          break;
        }
        node = node.parentElement;
      }
      expect(matched).toBe(true);
    });
  });
});

describe('AiChat tool call rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the tool calls the model made inline in the chat as an expandable action badge', async () => {
    mockedRunAiChatCompletion.mockResolvedValue({
      assistantMessage: 'Here are the Amazon transactions I found.',
      toolCalls: [
        {
          id: 'call-1',
          name: 'query_transactions',
          argumentsJson: '{"merchant":"Amazon"}',
          status: 'completed',
          result: { count: 3 },
        },
      ],
      classificationSuggestions: [],
      merchantRuleSuggestions: [],
      tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });

    const user = userEvent.setup();
    renderAiChat();

    const textbox = screen.getByLabelText('Ask about transactions');
    await user.type(textbox, 'Show me all transactions that involve Amazon');
    await user.click(screen.getByRole('button', { name: 'Send AI prompt' }));

    await screen.findByText('Here are the Amazon transactions I found.');

    const badge = screen.getByText('Used query_transactions');
    expect(badge).toBeInTheDocument();
    expect(screen.queryByText('Input')).not.toBeInTheDocument();

    await user.click(badge);

    expect(screen.getByText('Input')).toBeInTheDocument();
    expect(screen.getByText(/"merchant": "Amazon"/)).toBeInTheDocument();
    expect(screen.getByText('Output')).toBeInTheDocument();
    expect(screen.getByText(/"count": 3/)).toBeInTheDocument();
  });
});
