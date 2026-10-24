// @vitest-environment jsdom

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiChatMessage } from '@/types/ai';
import type { AiConsentDecision, AiConsentRequest } from '@/types/aiTools';

const { panelState } = vi.hoisted(() => ({
  panelState: { messages: [] as AiChatMessage[] },
}));

vi.mock('@/contexts/useAiToolsSlices', () => ({
  useAiToolExecutionSlice: vi.fn(() => ({})),
}));

vi.mock('@/contexts/useWllamaSlices', () => ({
  useAiChatRuntimeSlice: vi.fn(() => ({
    showTokenUsage: false,
    maxOutputTokens: 800,
  })),
}));

vi.mock('@/lib/aiChatService', () => ({
  runAiChatCompletion: vi.fn(),
}));

const mockSetToolConsent = vi.fn().mockResolvedValue(undefined);
const mockApplyDecision = vi.fn((_tool: string, decision: AiConsentDecision) => ({
  verdict: decision === 'deny' ? 'deny' : 'allow',
  persistPolicy: decision === 'allow_always' ? 'always' : undefined,
}));

vi.mock('./AiToolsContext', () => ({
  useAiToolsContext: () => ({
    registry: { enabledTools: [], toChatTools: () => [], getTool: () => undefined },
    evaluateConsent: () => 'ask',
    consentManager: { applyDecision: mockApplyDecision },
    setToolConsent: mockSetToolConsent,
  }),
}));

vi.mock('./AiProviderContext', () => ({
  useAiProviderContext: () => ({
    provider: {
      id: 'local',
      kind: 'local',
      label: 'Local AI',
      model: '',
      createChatCompletion: vi.fn(),
      createChatCompletionStream: vi.fn(),
      testConnection: vi.fn(),
    },
    isProviderReady: true,
    isLocalProvider: true,
    providerLabel: 'Local AI',
  }),
}));

vi.mock('./AiPanelProvider', () => ({
  useAiPanel: () => ({
    messages: panelState.messages,
    setMessages: (update: AiChatMessage[] | ((current: AiChatMessage[]) => AiChatMessage[])) => {
      panelState.messages = typeof update === 'function' ? update(panelState.messages) : update;
      rerender?.();
    },
    clearTranscript: () => { panelState.messages = []; rerender?.(); },
    writeMode: 'review',
    addClassificationSuggestions: vi.fn(),
    addMerchantRuleSuggestions: vi.fn(),
  }),
}));

import AiChat from './AiChat';
import { runAiChatCompletion } from '@/lib/aiChatService';

const mockedRunAiChatCompletion = vi.mocked(runAiChatCompletion);
const theme = createTheme();
let rerender: (() => void) | null = null;

function Harness() {
  const [, force] = React.useReducer((count: number) => count + 1, 0);
  rerender = force;
  return (
    <ThemeProvider theme={theme}>
      <AiChat />
    </ThemeProvider>
  );
}

const renderAiChat = () => render(<Harness />);

describe('AiChat error rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    panelState.messages = [];
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
    panelState.messages = [];
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

describe('AiChat consent flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetToolConsent.mockResolvedValue(undefined);
    panelState.messages = [];
  });

  it('renders the consent card while the loop waits and forwards the decision', async () => {
    const request: AiConsentRequest = {
      id: 'req-1',
      toolCallId: 'call-1',
      toolName: 'create_category',
      crud: 'create',
      description: 'Create a new income or expense category.',
      argumentsJson: '{"name":"Fuel","type":"expense"}',
      source: 'builtin',
    };
    let decision: AiConsentDecision | null = null;

    mockedRunAiChatCompletion.mockImplementation(async (options) => {
      decision = await options.requestConsent!(request);
      return {
        assistantMessage: decision === 'deny' ? 'Okay, not creating it.' : 'Created.',
        toolCalls: [],
        classificationSuggestions: [],
        merchantRuleSuggestions: [],
        tokenUsage: {},
      };
    });

    const user = userEvent.setup();
    renderAiChat();

    await user.type(screen.getByLabelText('Ask about transactions'), 'Add a Fuel category');
    await user.click(screen.getByRole('button', { name: 'Send AI prompt' }));

    const card = await screen.findByTestId('ai-consent-card');
    expect(card).toHaveTextContent('create_category');
    expect(card).toHaveTextContent('"name": "Fuel"');

    await user.click(screen.getByRole('button', { name: 'Always allow' }));

    await screen.findByText('Created.');
    expect(decision).toBe('allow_always');
    expect(mockApplyDecision).toHaveBeenCalledWith('create_category', 'allow_always');
    expect(mockSetToolConsent).toHaveBeenCalledWith('create_category', 'always');
    expect(screen.queryByTestId('ai-consent-card')).not.toBeInTheDocument();
  });
});
