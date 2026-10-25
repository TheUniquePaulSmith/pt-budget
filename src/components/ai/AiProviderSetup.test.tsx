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

const localEndpoint: AiProviderProfile = {
  id: 'p-lab',
  kind: 'local_endpoint',
  label: 'Lab box',
  baseUrl: 'https://lab.internal:8443/v1',
  apiKey: '',
  model: 'qwen2.5',
  isActive: false,
  useClientCertificate: true,
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
      <AiProviderSetup activeProfileLabel={(context.activeProfile as AiProviderProfile | null)?.label ?? null} />
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

  describe('Local tab', () => {
    it('offers the in-browser GGUF model and a local endpoint as the two options', async () => {
      const user = userEvent.setup();
      renderSetup({ profiles: [], activeProfile: null, config: { version: 1, profiles: [] } });

      // Nothing active: the Local tab opens on the browser-embedded option.
      expect(screen.getByTestId('ai-local-mode-browser')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('ai-model-selector-stub')).toBeInTheDocument();
      expect(screen.queryByTestId('ai-local-endpoint-add')).not.toBeInTheDocument();

      await user.click(screen.getByTestId('ai-local-mode-endpoint'));
      expect(screen.getByTestId('ai-local-mode-endpoint')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.queryByTestId('ai-model-selector-stub')).not.toBeInTheDocument();
      expect(screen.getByTestId('ai-local-endpoint-add')).toBeInTheDocument();
      expect(screen.getByText(/No local endpoints yet/)).toBeInTheDocument();

      await user.click(screen.getByTestId('ai-local-mode-browser'));
      expect(screen.getByTestId('ai-model-selector-stub')).toBeInTheDocument();
    });

    it('opens on the local endpoint option when a local endpoint is the active provider', () => {
      renderSetup({
        profiles: [{ ...localEndpoint, isActive: true }],
        activeProfile: { ...localEndpoint, isActive: true },
      });

      expect(screen.getByTestId('ai-local-mode-endpoint')).toHaveAttribute('aria-pressed', 'true');
      const list = screen.getByTestId('ai-local-endpoint-list');
      expect(within(list).getByText('Lab box')).toBeInTheDocument();
      expect(within(list).getByText(/lab\.internal:8443\/v1 · qwen2\.5 · client certificate/)).toBeInTheDocument();
      expect(within(list).getByText('Active')).toBeInTheDocument();
    });

    it('names the local endpoint in the switch-back notice on the browser option', async () => {
      const user = userEvent.setup();
      const context = renderSetup({
        profiles: [{ ...localEndpoint, isActive: true }],
        activeProfile: { ...localEndpoint, isActive: true },
      });

      await user.click(screen.getByTestId('ai-local-mode-browser'));
      expect(screen.getByText(/Chat currently uses the local endpoint "Lab box"/)).toBeInTheDocument();
      await user.click(screen.getByTestId('ai-provider-use-local'));
      expect(context.activateProfile).toHaveBeenCalledWith(null);
    });

    it('keeps local endpoints out of the Cloud list and cloud profiles out of the Local list', async () => {
      const user = userEvent.setup();
      renderSetup({ profiles: [existingProfile, localEndpoint] });

      await user.click(screen.getByTestId('ai-setup-tab-cloud'));
      const cloudList = screen.getByTestId('ai-provider-list');
      expect(within(cloudList).getByText('Ollama at home')).toBeInTheDocument();
      expect(within(cloudList).queryByText('Lab box')).not.toBeInTheDocument();

      await user.click(screen.getByTestId('ai-setup-tab-local'));
      await user.click(screen.getByTestId('ai-local-mode-endpoint'));
      const localList = screen.getByTestId('ai-local-endpoint-list');
      expect(within(localList).getByText('Lab box')).toBeInTheDocument();
      expect(within(localList).queryByText('Ollama at home')).not.toBeInTheDocument();
    });

    it('tests an endpoint with no model, lists the models it reports, and saves the one picked with the client certificate on', async () => {
      const user = userEvent.setup();
      const testProfile = vi.fn().mockResolvedValue({ ok: true, message: 'Connected', latencyMs: 7, models: ['llama3.1', 'qwen2.5'] });
      const context = renderSetup({ profiles: [], activeProfile: null, config: { version: 1, profiles: [] }, testProfile });

      await user.click(screen.getByTestId('ai-local-mode-endpoint'));
      await user.click(screen.getByTestId('ai-local-endpoint-add'));
      // The local form has no provider picker; it is always an OpenAI-compatible endpoint.
      expect(screen.queryByTestId('ai-provider-kind')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'LM Studio' }));
      expect(screen.getByTestId('ai-provider-base-url')).toHaveValue('http://localhost:1234/v1');
      expect(screen.getByTestId('ai-provider-model')).toHaveValue('');

      await user.click(screen.getByTestId('ai-provider-test'));
      await waitFor(() => expect(screen.getByTestId('ai-provider-test-status')).toHaveAttribute('data-ok', 'true'));
      expect(testProfile).toHaveBeenCalledWith(expect.objectContaining({ kind: 'local_endpoint', model: '', baseUrl: 'http://localhost:1234/v1' }));
      // An empty model picks up the first one the server reports.
      expect(screen.getByTestId('ai-provider-model')).toHaveValue('llama3.1');
      expect(screen.getByText(/2 models available/)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Open' }));
      expect(screen.getByRole('option', { name: 'llama3.1' })).toBeInTheDocument();
      await user.click(screen.getByRole('option', { name: 'qwen2.5' }));
      expect(screen.getByTestId('ai-provider-model')).toHaveValue('qwen2.5');

      // PFX / mTLS lives under Advanced and starts collapsed.
      expect(screen.queryByTestId('ai-provider-client-cert')).not.toBeInTheDocument();
      await user.click(screen.getByTestId('ai-provider-advanced-toggle'));
      await user.click(screen.getByTestId('ai-provider-client-cert'));

      await user.click(screen.getByTestId('ai-provider-save'));
      await waitFor(() => expect(context.saveProfile).toHaveBeenCalled());
      expect(context.saveProfile.mock.calls[0][0]).toMatchObject({
        kind: 'local_endpoint',
        baseUrl: 'http://localhost:1234/v1',
        model: 'qwen2.5',
        useClientCertificate: true,
        isActive: true,
      });
    });

    it('shows a failed endpoint test with its hint and no model list', async () => {
      const user = userEvent.setup();
      renderSetup({
        profiles: [],
        activeProfile: null,
        config: { version: 1, profiles: [] },
        testProfile: vi.fn().mockResolvedValue({ ok: false, message: 'Connection failed', hint: 'Enable CORS on the server.' }),
      });

      await user.click(screen.getByTestId('ai-local-mode-endpoint'));
      await user.click(screen.getByTestId('ai-local-endpoint-add'));
      await user.click(screen.getByTestId('ai-provider-test'));

      await waitFor(() => expect(screen.getByTestId('ai-provider-test-status')).toHaveAttribute('data-ok', 'false'));
      expect(screen.getByTestId('ai-provider-test-hint')).toHaveTextContent('Enable CORS on the server.');
      expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
    });

    it('requires a model to save even though a test can run without one', async () => {
      const user = userEvent.setup();
      const context = renderSetup({ profiles: [], activeProfile: null, config: { version: 1, profiles: [] } });

      await user.click(screen.getByTestId('ai-local-mode-endpoint'));
      await user.click(screen.getByTestId('ai-local-endpoint-add'));
      await user.click(screen.getByTestId('ai-provider-save'));

      expect(context.saveProfile).not.toHaveBeenCalled();
      expect(screen.getByText('Enter the model name.')).toBeInTheDocument();
    });

    it('starts with Advanced open when editing an endpoint that already uses a client certificate', async () => {
      const user = userEvent.setup();
      renderSetup({ profiles: [localEndpoint], activeProfile: null });

      await user.click(screen.getByTestId('ai-local-mode-endpoint'));
      await user.click(screen.getByRole('button', { name: 'Edit Lab box' }));
      expect(screen.getByTestId('ai-provider-client-cert')).toBeChecked();
    });
  });

  it('keeps Advanced (client certificate) out of the cloud form', async () => {
    const user = userEvent.setup();
    renderSetup();

    await user.click(screen.getByTestId('ai-provider-add'));
    expect(screen.queryByTestId('ai-provider-advanced-toggle')).not.toBeInTheDocument();
  });
});
