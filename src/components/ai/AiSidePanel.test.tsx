// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./AiChat', () => ({
  default: () => <div data-testid="ai-chat-stub" />,
}));

vi.mock('./AiAutomationPanel', () => ({
  default: () => <div data-testid="ai-automation-stub" />,
}));

vi.mock('./AiToolsTab', () => ({
  default: () => <div data-testid="ai-tools-stub" />,
}));

vi.mock('./AiProviderSetup', () => ({
  default: () => <div data-testid="ai-provider-setup-stub" />,
}));

vi.mock('./AiToolsContext', () => ({
  AiToolsContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockUseAiChatRuntimeSlice = vi.fn();
const mockProviderContext = vi.fn();
const mockPanel = vi.fn();

vi.mock('@/contexts/useWllamaSlices', () => ({
  useAiChatRuntimeSlice: () => mockUseAiChatRuntimeSlice(),
}));

vi.mock('./AiProviderContext', () => ({
  AiProviderContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAiProviderContext: () => mockProviderContext(),
}));

vi.mock('./AiPanelProvider', () => ({
  AI_SIDEBAR_MIN_WIDTH: 320,
  useAiPanel: () => mockPanel(),
}));

import AiSidePanel from './AiSidePanel';

const theme = createTheme();

function panelValue(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'sidebar',
    sidebarWidth: 440,
    setSidebarWidth: vi.fn(),
    setMode: vi.fn(),
    openPopout: vi.fn(),
    isStandalone: false,
    classificationSuggestions: [],
    merchantRuleSuggestions: [],
    writeMode: 'review',
    setWriteMode: vi.fn(),
    clearClassificationSuggestions: vi.fn(),
    clearMerchantRuleSuggestions: vi.fn(),
    ...overrides,
  };
}

function localProvider(ready: boolean) {
  return {
    provider: { id: 'local', kind: 'local', label: 'Local AI', model: '' },
    providerLabel: 'Local AI',
    isLocalProvider: true,
    isProviderReady: ready,
    activeProfile: null,
  };
}

beforeEach(() => {
  mockPanel.mockReturnValue(panelValue());
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    // Wide desktop: `min-width` queries (docking room) match, `max-width` (mobile) do not.
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('min-width'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

const renderPanel = () => render(
  <ThemeProvider theme={theme}>
    <AiSidePanel open onClose={vi.fn()} />
  </ThemeProvider>
);

describe('AiSidePanel header', () => {
  it('shows "No model loaded" for the local provider when nothing is loaded and defaults to Setup', () => {
    mockProviderContext.mockReturnValue(localProvider(false));
    mockUseAiChatRuntimeSlice.mockReturnValue({ loadedModel: null, contextSizeTokens: 4096, maxOutputTokens: 800 });

    renderPanel();

    expect(screen.getByRole('heading', { name: 'Local AI' })).toBeInTheDocument();
    expect(screen.getByText('No model loaded')).toBeInTheDocument();
    expect(screen.getByTestId('ai-tab-setup')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('ai-panel-resize-handle')).toBeInTheDocument();
  });

  it('prints model name plus input/output token sizes in small caption text', () => {
    mockProviderContext.mockReturnValue(localProvider(true));
    mockUseAiChatRuntimeSlice.mockReturnValue({
      loadedModel: { id: 'model-1', name: 'gemma-4-E4B-it-Q4_K_M.gguf', contextLength: 1024 },
      contextSizeTokens: 1024,
      maxOutputTokens: 800,
    });

    renderPanel();

    const nameLabel = screen.getByTitle('gemma-4-E4B-it-Q4_K_M.gguf');
    expect(nameLabel).toBeInTheDocument();
    expect(nameLabel.tagName).not.toBe('DIV');
    expect(screen.getByText('Input 1,024 · Output 800 tokens')).toBeInTheDocument();
    expect(screen.getByTestId('ai-tab-chat')).toHaveAttribute('aria-selected', 'true');
  });

  it('titles the panel after the active cloud profile', () => {
    mockProviderContext.mockReturnValue({
      provider: { id: 'p1', kind: 'anthropic', label: 'Claude', model: 'claude-sonnet-5-5' },
      providerLabel: 'Claude',
      isLocalProvider: false,
      isProviderReady: true,
      activeProfile: { id: 'p1', label: 'Claude' },
    });
    mockUseAiChatRuntimeSlice.mockReturnValue({ loadedModel: null, contextSizeTokens: 4096, maxOutputTokens: 800 });

    renderPanel();

    expect(screen.getByRole('heading', { name: 'Claude' })).toBeInTheDocument();
    expect(screen.getByTestId('ai-panel-caption')).toHaveTextContent('Anthropic · claude-sonnet-5-5');
  });

  it('falls back to an overlay drawer when the content would drop below lg width', () => {
    mockProviderContext.mockReturnValue(localProvider(false));
    mockUseAiChatRuntimeSlice.mockReturnValue({ loadedModel: null, contextSizeTokens: 4096, maxOutputTokens: 800 });
    (window.matchMedia as unknown as ReturnType<typeof vi.fn>).mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    renderPanel();

    expect(screen.getByTestId('ai-panel-overlay')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-panel-resize-handle')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Local AI' })).toBeInTheDocument();
  });

  it('renders a full-screen dialog in maximized mode and nothing in pop-out mode', () => {
    mockProviderContext.mockReturnValue(localProvider(false));
    mockUseAiChatRuntimeSlice.mockReturnValue({ loadedModel: null, contextSizeTokens: 4096, maxOutputTokens: 800 });

    mockPanel.mockReturnValue(panelValue({ mode: 'maximized' }));
    const { unmount } = renderPanel();
    expect(screen.getByTestId('ai-panel-maximized')).toBeInTheDocument();
    expect(screen.getByTestId('ai-mode-sidebar')).toBeInTheDocument();
    unmount();

    mockPanel.mockReturnValue(panelValue({ mode: 'popout' }));
    renderPanel();
    expect(screen.queryByTestId('ai-panel')).not.toBeInTheDocument();
  });
});
