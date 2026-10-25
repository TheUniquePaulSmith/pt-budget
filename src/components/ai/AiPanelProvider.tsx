'use client';

/**
 * Owns the AI panel's window state so any part of the shell (header launcher,
 * mobile menu, the Subscriptions page) can open it without prop drilling.
 *
 * Modes:
 *   - `sidebar`   persistent right drawer on desktop that shifts the content
 *                 (drag-resizable, 440 px default) when the remaining width
 *                 still fits the shell (>= the `lg` breakpoint); an overlay
 *                 drawer below that; full-screen on mobile.
 *   - `maximized` full-viewport dialog.
 *   - `popout`    a separate window at `/ai/` (`window.open`, named
 *                 `ptbudget-ai`). It shares the SharedWorker database; a local
 *                 wllama model must be loaded again there, cloud providers
 *                 work immediately. `window.open` copies sessionStorage, so
 *                 "allow this session" consent grants carry into the pop-out.
 *
 * The transcript and Automation staging live here and mirror across windows
 * through `BroadcastChannel('ptbudget-ai')`. This provider deliberately uses
 * no database or model hooks so the shell can render it anywhere.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Box } from '@mui/material';

import { logger } from '@/lib/logging';
import type {
  AiChatMessage,
  AiWriteMode,
  MerchantRuleSuggestion,
  TransactionClassificationSuggestion,
} from '@/types/ai';
import AiSidePanel from './AiSidePanel';

const log = logger.child({ component: 'AiPanelProvider' });

export type AiPanelMode = 'sidebar' | 'maximized' | 'popout';

export const AI_BROADCAST_CHANNEL = 'ptbudget-ai';
export const AI_POPOUT_PATH = '/ai/';
export const AI_POPOUT_WINDOW_NAME = 'ptbudget-ai';
export const AI_POPOUT_WINDOW_FEATURES = 'popup,width=520,height=800';
export const AI_SIDEBAR_DEFAULT_WIDTH = 440;
export const AI_SIDEBAR_MIN_WIDTH = 320;
const AI_SIDEBAR_WIDTH_STORAGE_KEY = 'ptbudget.ai.sidebarWidth';

type TranscriptUpdater = AiChatMessage[] | ((current: AiChatMessage[]) => AiChatMessage[]);

interface BroadcastMessage {
  windowId: string;
  type: 'transcript' | 'request-transcript' | 'automation';
  messages?: AiChatMessage[];
  classificationSuggestions?: TransactionClassificationSuggestion[];
  merchantRuleSuggestions?: MerchantRuleSuggestion[];
}

export interface AiPanelContextValue {
  isOpen: boolean;
  mode: AiPanelMode;
  /** True inside the `/ai/` pop-out window itself. */
  isStandalone: boolean;
  /** True in the main window while the pop-out window is open. */
  isPopoutOpen: boolean;
  sidebarWidth: number;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  setMode: (mode: Exclude<AiPanelMode, 'popout'>) => void;
  openPopout: () => void;
  focusPopout: () => void;
  setSidebarWidth: (width: number) => void;
  messages: AiChatMessage[];
  setMessages: (update: TranscriptUpdater) => void;
  clearTranscript: () => void;
  writeMode: AiWriteMode;
  setWriteMode: (mode: AiWriteMode) => void;
  classificationSuggestions: TransactionClassificationSuggestion[];
  merchantRuleSuggestions: MerchantRuleSuggestion[];
  addClassificationSuggestions: (suggestions: TransactionClassificationSuggestion[]) => void;
  addMerchantRuleSuggestions: (suggestions: MerchantRuleSuggestion[]) => void;
  clearClassificationSuggestions: () => void;
  clearMerchantRuleSuggestions: () => void;
}

const AiPanelContext = createContext<AiPanelContextValue | null>(null);

function createWindowId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readStoredSidebarWidth(): number {
  if (typeof window === 'undefined') {
    return AI_SIDEBAR_DEFAULT_WIDTH;
  }
  try {
    const stored = Number(window.localStorage.getItem(AI_SIDEBAR_WIDTH_STORAGE_KEY));
    return Number.isFinite(stored) && stored >= AI_SIDEBAR_MIN_WIDTH ? stored : AI_SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return AI_SIDEBAR_DEFAULT_WIDTH;
  }
}

export interface AiPanelProviderProps {
  children: React.ReactNode;
  /** Render as the pop-out page: no in-app panel, transcript mirrored from the main window. */
  standalone?: boolean;
}

export function AiPanelProvider({ children, standalone = false }: AiPanelProviderProps) {
  const [isOpen, setIsOpen] = useState(standalone);
  const [mode, setModeState] = useState<AiPanelMode>('sidebar');
  const [sidebarWidth, setSidebarWidthState] = useState<number>(() => readStoredSidebarWidth());
  const [messages, setMessagesState] = useState<AiChatMessage[]>([]);
  const [writeMode, setWriteMode] = useState<AiWriteMode>('review');
  const [classificationSuggestions, setClassificationSuggestions] = useState<TransactionClassificationSuggestion[]>([]);
  const [merchantRuleSuggestions, setMerchantRuleSuggestions] = useState<MerchantRuleSuggestion[]>([]);
  const [isPopoutOpen, setIsPopoutOpen] = useState(false);

  const windowIdRef = useRef<string>(createWindowId());
  const channelRef = useRef<BroadcastChannel | null>(null);
  const popoutRef = useRef<Window | null>(null);
  const skipBroadcastRef = useRef(false);
  const hasBroadcastRef = useRef(false);
  const messagesRef = useRef<AiChatMessage[]>([]);
  messagesRef.current = messages;

  const post = useCallback((message: Omit<BroadcastMessage, 'windowId'>) => {
    try {
      channelRef.current?.postMessage({ ...message, windowId: windowIdRef.current } satisfies BroadcastMessage);
    } catch (err) {
      log.warn('Broadcast failed', { operation: 'post', error: err });
    }
  }, []);

  // Cross-window mirroring.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') {
      return;
    }
    const channel = new BroadcastChannel(AI_BROADCAST_CHANNEL);
    channelRef.current = channel;

    channel.onmessage = (event: MessageEvent<BroadcastMessage>) => {
      const data = event.data;
      if (!data || data.windowId === windowIdRef.current) {
        return;
      }
      if (data.type === 'request-transcript') {
        if (messagesRef.current.length > 0) {
          post({ type: 'transcript', messages: messagesRef.current });
        }
        return;
      }
      if (data.type === 'transcript' && Array.isArray(data.messages)) {
        skipBroadcastRef.current = true;
        setMessagesState(data.messages);
        return;
      }
      if (data.type === 'automation') {
        if (data.classificationSuggestions) {
          setClassificationSuggestions((current) => [...current, ...data.classificationSuggestions!]);
        }
        if (data.merchantRuleSuggestions) {
          setMerchantRuleSuggestions((current) => [...current, ...data.merchantRuleSuggestions!]);
        }
      }
    };

    // A freshly opened window asks for the current transcript.
    post({ type: 'request-transcript' });

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [post]);

  useEffect(() => {
    // The mount-time (empty) transcript must not overwrite another window's.
    if (!hasBroadcastRef.current) {
      hasBroadcastRef.current = true;
      return;
    }
    if (skipBroadcastRef.current) {
      skipBroadcastRef.current = false;
      return;
    }
    post({ type: 'transcript', messages });
  }, [messages, post]);

  // Watch the pop-out window; when it closes, come back to the sidebar.
  useEffect(() => {
    if (!isPopoutOpen) {
      return;
    }
    const interval = window.setInterval(() => {
      if (!popoutRef.current || popoutRef.current.closed) {
        popoutRef.current = null;
        setIsPopoutOpen(false);
        setModeState('sidebar');
        setIsOpen(false);
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isPopoutOpen]);

  const openPanel = useCallback(() => {
    if (popoutRef.current && !popoutRef.current.closed) {
      popoutRef.current.focus();
      return;
    }
    if (popoutRef.current) {
      // The pop-out was closed since the last poll: come back in-app.
      popoutRef.current = null;
      setIsPopoutOpen(false);
    }
    setModeState((current) => (current === 'popout' ? 'sidebar' : current));
    setIsOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    if (standalone) {
      window.close();
      return;
    }
    setIsOpen(false);
  }, [standalone]);

  const togglePanel = useCallback(() => {
    setIsOpen((open) => !open);
  }, []);

  const setMode = useCallback((next: Exclude<AiPanelMode, 'popout'>) => {
    setModeState(next);
    setIsOpen(true);
  }, []);

  const openPopout = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (popoutRef.current && !popoutRef.current.closed) {
      popoutRef.current.focus();
      return;
    }
    const popout = window.open(AI_POPOUT_PATH, AI_POPOUT_WINDOW_NAME, AI_POPOUT_WINDOW_FEATURES);
    if (!popout) {
      log.warn('Pop-out window was blocked', { operation: 'openPopout' });
      setModeState('sidebar');
      setIsOpen(true);
      return;
    }
    popoutRef.current = popout;
    setIsPopoutOpen(true);
    setModeState('popout');
    setIsOpen(true);
    log.info('Opened AI pop-out window', { operation: 'openPopout' });
  }, []);

  const focusPopout = useCallback(() => {
    if (popoutRef.current && !popoutRef.current.closed) {
      popoutRef.current.focus();
      return;
    }
    openPanel();
  }, [openPanel]);

  const setSidebarWidth = useCallback((width: number) => {
    const clamped = Math.max(AI_SIDEBAR_MIN_WIDTH, Math.round(width));
    setSidebarWidthState(clamped);
    try {
      window.localStorage.setItem(AI_SIDEBAR_WIDTH_STORAGE_KEY, String(clamped));
    } catch {
      // Preference only; ignore storage failures.
    }
  }, []);

  const setMessages = useCallback((update: TranscriptUpdater) => {
    setMessagesState((current) => (typeof update === 'function' ? update(current) : update));
  }, []);

  const clearTranscript = useCallback(() => setMessagesState([]), []);

  const addClassificationSuggestions = useCallback(
    (suggestions: TransactionClassificationSuggestion[]) => {
      if (suggestions.length === 0) return;
      setClassificationSuggestions((current) => [...current, ...suggestions]);
      post({ type: 'automation', classificationSuggestions: suggestions });
    },
    [post]
  );

  const addMerchantRuleSuggestions = useCallback(
    (suggestions: MerchantRuleSuggestion[]) => {
      if (suggestions.length === 0) return;
      setMerchantRuleSuggestions((current) => [...current, ...suggestions]);
      post({ type: 'automation', merchantRuleSuggestions: suggestions });
    },
    [post]
  );

  const clearClassificationSuggestions = useCallback(() => setClassificationSuggestions([]), []);
  const clearMerchantRuleSuggestions = useCallback(() => setMerchantRuleSuggestions([]), []);

  const value = useMemo<AiPanelContextValue>(
    () => ({
      isOpen,
      mode,
      isStandalone: standalone,
      isPopoutOpen,
      sidebarWidth,
      openPanel,
      closePanel,
      togglePanel,
      setMode,
      openPopout,
      focusPopout,
      setSidebarWidth,
      messages,
      setMessages,
      clearTranscript,
      writeMode,
      setWriteMode,
      classificationSuggestions,
      merchantRuleSuggestions,
      addClassificationSuggestions,
      addMerchantRuleSuggestions,
      clearClassificationSuggestions,
      clearMerchantRuleSuggestions,
    }),
    [
      addClassificationSuggestions,
      addMerchantRuleSuggestions,
      classificationSuggestions,
      clearClassificationSuggestions,
      clearMerchantRuleSuggestions,
      clearTranscript,
      closePanel,
      focusPopout,
      isOpen,
      isPopoutOpen,
      merchantRuleSuggestions,
      messages,
      mode,
      openPanel,
      openPopout,
      setMessages,
      setMode,
      setSidebarWidth,
      sidebarWidth,
      standalone,
      togglePanel,
      writeMode,
    ]
  );

  if (standalone) {
    return <AiPanelContext.Provider value={value}>{children}</AiPanelContext.Provider>;
  }

  // The sidebar is a sibling flex item so the app content shifts instead of
  // being covered; maximized and mobile variants render through portals.
  return (
    <AiPanelContext.Provider value={value}>
      <Box sx={{ display: 'flex', alignItems: 'stretch', minHeight: '100vh' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
        <AiSidePanel open={isOpen} onClose={closePanel} />
      </Box>
    </AiPanelContext.Provider>
  );
}

export function useAiPanel(): AiPanelContextValue {
  const value = useContext(AiPanelContext);
  if (!value) {
    throw new Error('useAiPanel must be used within an AiPanelProvider');
  }
  return value;
}
