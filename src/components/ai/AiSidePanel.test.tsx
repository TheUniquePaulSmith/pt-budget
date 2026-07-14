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

vi.mock('./AiModelSelector', () => ({
  default: () => <div data-testid="ai-model-selector-stub" />,
}));

const mockUseAiChatRuntimeSlice = vi.fn();

vi.mock('@/contexts/useWllamaSlices', () => ({
  useAiChatRuntimeSlice: () => mockUseAiChatRuntimeSlice(),
}));

import AiSidePanel from './AiSidePanel';

const theme = createTheme();

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
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
  it('shows "No model loaded" when nothing is loaded', () => {
    mockUseAiChatRuntimeSlice.mockReturnValue({
      isModelLoaded: false,
      loadedModel: null,
      contextSizeTokens: 4096,
      maxOutputTokens: 800,
    });

    renderPanel();

    expect(screen.getByText('No model loaded')).toBeInTheDocument();
  });

  it('prints model name plus input/output token sizes in small caption text, not a truncating chip', () => {
    mockUseAiChatRuntimeSlice.mockReturnValue({
      isModelLoaded: true,
      loadedModel: { id: 'model-1', name: 'gemma-4-E4B-it-Q4_K_M.gguf', contextLength: 1024 },
      contextSizeTokens: 1024,
      maxOutputTokens: 800,
    });

    renderPanel();

    const nameLabel = screen.getByTitle('gemma-4-E4B-it-Q4_K_M.gguf');
    expect(nameLabel).toBeInTheDocument();
    expect(nameLabel.tagName).not.toBe('DIV');

    expect(screen.getByText('Input 1,024 · Output 800 tokens')).toBeInTheDocument();
  });
});
