// @vitest-environment jsdom

import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./AiModelSelector', () => ({
  default: () => <div data-testid="ai-model-selector-stub" />,
}));

const mockProviderContext = vi.fn();

vi.mock('./AiProviderContext', () => ({
  useAiProviderContext: () => mockProviderContext(),
}));

import AiProviderSetup from './AiProviderSetup';
import type { AiProviderProfile } from '@/lib/aiProviders';

const theme = createTheme();

const existingProfile: AiProviderProfile = {
  id: 'p-existing',
  kind: 'openai_compatible',
  label: 'Ollama at home',
  baseUrl: 'http://localhost:11434/v1',
  apiKey: '',
  model: 'llama3.1',
  isActive: true,
};

function renderSetup(overrides: Record<string, unknown> = {}) {
  const context = {
    config: { version: 1, profiles: [existingProfile] },
    profiles: [existingProfile],
    activeProfile: existingProfile,
    isLoading: false,
    error: null,
    saveProfile: vi.fn().mockResolvedValue(undefined),
    deleteProfile: vi.fn().mockResolvedValue(undefined),
    activateProfile: vi.fn().mockResolvedValue(undefined),
    testProfile: vi.fn().mockResolvedValue({ ok: true, message: 'Connected', latencyMs: 12 }),
    ...overrides,
  };
  mockProviderContext.mockReturnValue(context);
  render(
    <ThemeProvider theme={theme}>
      <AiProviderSetup activeProfileLabel={existingProfile.label} />
    </ThemeProvider>
  );
  return context;
}

describe('AiProviderSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists profiles on the Cloud tab and marks the active one', () => {
    renderSetup();

    const list = screen.getByTestId('ai-provider-list');
    expect(within(list).getByText('Ollama at home')).toBeInTheDocument();
    expect(within(list).getByText(/OpenAI-compatible · llama3\.1/)).toBeInTheDocument();
    expect(within(list).getAllByText('Active')).toHaveLength(1);
  });

  it('switches to the local model selector', async () => {
    const user = userEvent.setup();
    const context = renderSetup();

    await user.click(screen.getByTestId('ai-setup-tab-local'));
    expect(screen.getByTestId('ai-model-selector-stub')).toBeInTheDocument();

    await user.click(screen.getByTestId('ai-provider-use-local'));
    expect(context.activateProfile).toHaveBeenCalledWith(null);
  });

  it('adds an Anthropic profile, tests it and saves it with the key masked', async () => {
    const user = userEvent.setup();
    const context = renderSetup({ profiles: [], activeProfile: null, config: { version: 1, profiles: [] } });

    await user.click(screen.getByTestId('ai-setup-tab-cloud'));
    await user.click(screen.getByTestId('ai-provider-add'));

    const keyInput = screen.getByTestId('ai-provider-api-key') as HTMLInputElement;
    expect(keyInput.type).toBe('password');
    await user.type(keyInput, 'sk-ant-secret');
    await user.click(screen.getByRole('button', { name: 'Show API key' }));
    expect(keyInput.type).toBe('text');

    await user.clear(screen.getByTestId('ai-provider-label'));
    await user.type(screen.getByTestId('ai-provider-label'), 'Claude');

    await user.click(screen.getByTestId('ai-provider-test'));
    await waitFor(() => expect(screen.getByTestId('ai-provider-test-status')).toHaveTextContent('Connected'));
    expect(context.testProfile).toHaveBeenCalledWith(expect.objectContaining({ kind: 'anthropic', apiKey: 'sk-ant-secret', model: 'claude-sonnet-5-5' }));

    await user.click(screen.getByTestId('ai-provider-save'));
    await waitFor(() => expect(context.saveProfile).toHaveBeenCalled());
    // The first profile becomes active automatically.
    expect(context.saveProfile.mock.calls[0][0]).toMatchObject({ label: 'Claude', kind: 'anthropic', isActive: true });
  });

  it('blocks saving an invalid profile and surfaces a failed test with its hint', async () => {
    const user = userEvent.setup();
    const context = renderSetup({
      testProfile: vi.fn().mockResolvedValue({ ok: false, message: 'Connection failed', hint: 'Enable CORS on the server.' }),
    });

    await user.click(screen.getByTestId('ai-provider-add'));
    await user.click(screen.getByTestId('ai-provider-save'));
    expect(context.saveProfile).not.toHaveBeenCalled();
    expect(screen.getByText('An API key is required.')).toBeInTheDocument();

    await user.type(screen.getByTestId('ai-provider-api-key'), 'key');
    await user.click(screen.getByTestId('ai-provider-test'));
    await waitFor(() => expect(screen.getByTestId('ai-provider-test-status')).toHaveAttribute('data-ok', 'false'));
    expect(screen.getByTestId('ai-provider-test-hint')).toHaveTextContent('Enable CORS on the server.');
  });
});
