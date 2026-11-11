'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  AutoAwesome,
  DeleteSweep,
  Send,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import OfflineFeatureNotice from '@/components/common/Offline/OfflineFeatureNotice';
import { useOnlineStatus } from '@/components/common/Offline/useOnlineStatus';
import { useAiToolExecutionSlice } from '@/contexts/useAiToolsSlices';
import { isCloudKind } from '@/lib/aiProviderConfig';
import { useOptionalLocale } from '@/contexts/LocaleContext';
import { useFormatters } from '@/contexts/useFormatters';
import { useAiChatRuntimeSlice } from '@/contexts/useWllamaSlices';
import { runAiChatCompletion } from '@/lib/aiChatService';
import { logger } from '@/lib/logging';
import type { AiChatMessage, AiChatTokenUsage, AiToolCallRecord } from '@/types/ai';
import type { AiConsentDecision, AiConsentRequest } from '@/types/aiTools';
import AiConsentCard from './AiConsentCard';
import AiMarkdownMessage from './AiMarkdownMessage';
import { useAiPanel } from './AiPanelProvider';
import { useAiProviderContext } from './AiProviderContext';
import { useAiToolsContext } from './AiToolsContext';
import AiToolCallBadge from './AiToolCallBadge';

const log = logger.child({ component: 'AiChat' });
const CLOUD_MIN_OUTPUT_TOKENS = 2048;

function createMessageId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createMessage(
  role: AiChatMessage['role'],
  content: string,
  tokenUsage?: AiChatTokenUsage,
  isError?: boolean
): AiChatMessage {
  return {
    id: createMessageId(),
    role,
    content,
    createdAt: new Date().toISOString(),
    tokenUsage,
    isError,
  };
}

/** Keys under `ai:chat.prompts.*`, in menu order. */
const EXAMPLE_PROMPT_IDS = ['subscriptions', 'categories', 'merchants', 'budget', 'merchantRules'] as const;

function TypingIndicatorIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 48 18"
      width="42"
      height="18"
      fill="none"
    >
      {[10, 24, 38].map((cx, index) => (
        <circle key={cx} cx={cx} cy="9" r="4" fill="currentColor">
          <animate
            attributeName="opacity"
            values="0.28;1;0.28"
            dur="1.05s"
            begin={`${index * 0.18}s`}
            repeatCount="indefinite"
          />
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0 0;0 -3;0 0"
            dur="1.05s"
            begin={`${index * 0.18}s`}
            repeatCount="indefinite"
          />
        </circle>
      ))}
    </svg>
  );
}

function AnimatedStopIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
    >
      <circle
        cx="12"
        cy="12"
        r="8.5"
        stroke="currentColor"
        strokeWidth="1.6"
        opacity="0.28"
      />
      <circle
        cx="12"
        cy="12"
        r="8.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeDasharray="14 40"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="1s"
          repeatCount="indefinite"
        />
      </circle>
      <rect x="8" y="8" width="8" height="8" rx="1.4" fill="currentColor">
        <animate
          attributeName="opacity"
          values="1;0.55;1"
          dur="0.9s"
          repeatCount="indefinite"
        />
      </rect>
    </svg>
  );
}

interface PendingConsent {
  request: AiConsentRequest;
  resolve: (decision: AiConsentDecision) => void;
}

interface AiChatProps {
  onReviewableAutomation?: () => void;
  onOpenSetup?: () => void;
}

export default function AiChat({ onReviewableAutomation, onOpenSetup }: AiChatProps) {
  const { t } = useTranslation('ai');
  const { number, defaultCurrency } = useFormatters();
  const languageName = useOptionalLocale()?.definition.nativeLabel ?? 'English';
  const {
    messages,
    setMessages,
    clearTranscript,
    writeMode,
    addClassificationSuggestions,
    addMerchantRuleSuggestions,
  } = useAiPanel();
  const { provider, isProviderReady, isLocalProvider, providerLabel } = useAiProviderContext();
  const online = useOnlineStatus();
  const { registry, evaluateConsent, consentManager, setToolConsent, toolCallLimit } = useAiToolsContext();
  const { showTokenUsage, maxOutputTokens } = useAiChatRuntimeSlice();
  const databaseToolContext = useAiToolExecutionSlice(writeMode);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [pendingConsent, setPendingConsent] = useState<PendingConsent | null>(null);
  const [suggestionsAnchorEl, setSuggestionsAnchorEl] = useState<HTMLElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingConsentRef = useRef<PendingConsent | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const suggestionsOpen = Boolean(suggestionsAnchorEl);

  const effectiveMaxOutputTokens = useMemo(
    () => (isLocalProvider ? maxOutputTokens : Math.max(maxOutputTokens, CLOUD_MIN_OUTPUT_TOKENS)),
    [isLocalProvider, maxOutputTokens]
  );

  const getTokenCaption = (message: AiChatMessage): string | null => {
    if (message.role === 'user') {
      const promptTokens = message.tokenUsage?.promptTokens;
      return promptTokens && promptTokens > 0 ? t('chat.inputContext', { tokens: number(promptTokens) }) : null;
    }

    if (message.role === 'assistant') {
      const completionTokens = message.tokenUsage?.completionTokens;
      return completionTokens && completionTokens > 0 ? t('chat.outputTokens', { tokens: number(completionTokens) }) : null;
    }

    return null;
  };

  const updateMessage = useCallback(
    (id: string, updater: (message: AiChatMessage) => AiChatMessage) => {
      setMessages((current) => current.map((message) => (message.id === id ? updater(message) : message)));
    },
    [setMessages]
  );

  const requestConsent = useCallback(
    (request: AiConsentRequest) =>
      new Promise<AiConsentDecision>((resolve) => {
        const pending: PendingConsent = { request, resolve };
        pendingConsentRef.current = pending;
        setPendingConsent(pending);
      }),
    []
  );

  const settleConsent = useCallback(
    (decision: AiConsentDecision) => {
      const pending = pendingConsentRef.current;
      if (!pending) {
        return;
      }
      pendingConsentRef.current = null;
      setPendingConsent(null);

      const { persistPolicy } = consentManager.applyDecision(pending.request.toolName, decision);
      if (persistPolicy) {
        void Promise.resolve()
          .then(() => setToolConsent(pending.request.toolName, persistPolicy))
          .catch((err) => {
            log.error('Failed to persist consent policy', { operation: 'settleConsent', error: err });
          });
      }
      log.info('Consent decision', { operation: 'settleConsent', tool: pending.request.toolName, decision });
      pending.resolve(decision);
    },
    [consentManager, setToolConsent]
  );

  const submitPrompt = async (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed || running || cloudOffline) {
      return;
    }

    if (!isProviderReady) {
      setMessages((current) => [
        ...current,
        createMessage('assistant', t('chat.notReady'), undefined, true),
      ]);
      return;
    }

    const userMessage = createMessage('user', trimmed);
    const pendingAssistantMessage = createMessage('assistant', '...');
    const requestMessages = [...messages, userMessage];
    setMessages([...requestMessages, pendingAssistantMessage]);
    setInput('');
    setRunning(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const opLog = log.withOperation('chat');
    opLog.info('Chat turn started', { provider: provider.kind, tools: registry.enabledTools.length });

    try {
      const result = await runAiChatCompletion({
        messages: requestMessages,
        createChatCompletion: provider.createChatCompletion,
        createChatCompletionStream: provider.createChatCompletionStream,
        databaseToolContext,
        locale: { languageName, defaultCurrency },
        registry,
        evaluateConsent,
        requestConsent,
        abortSignal: abortController.signal,
        maxToolRounds: toolCallLimit,
        maxOutputTokens: effectiveMaxOutputTokens,
        onToolCallUpdate: (record: AiToolCallRecord) => {
          updateMessage(pendingAssistantMessage.id, (message) => {
            const existing = message.toolCalls ?? [];
            const index = existing.findIndex((toolCall) => toolCall.id === record.id);
            const toolCalls = index === -1
              ? [...existing, record]
              : existing.map((toolCall, position) => (position === index ? record : toolCall));
            return { ...message, toolCalls };
          });
        },
        onAssistantDelta: (delta) => {
          updateMessage(pendingAssistantMessage.id, (message) => ({
            ...message,
            content: message.content === '...' ? delta : `${message.content}${delta}`,
          }));
        },
      });

      if (result.classificationSuggestions.length > 0) {
        addClassificationSuggestions(result.classificationSuggestions);
        onReviewableAutomation?.();
      }
      if (result.merchantRuleSuggestions.length > 0) {
        addMerchantRuleSuggestions(result.merchantRuleSuggestions);
        onReviewableAutomation?.();
      }
      setMessages((current) => current.map((message) => {
        if (message.id === userMessage.id) {
          return {
            ...message,
            tokenUsage: {
              promptTokens: result.tokenUsage.promptTokens,
              totalTokens: result.tokenUsage.totalTokens,
            },
          };
        }

        if (message.id === pendingAssistantMessage.id) {
          return {
            ...message,
            content: result.assistantMessage || message.content || t('chat.done'),
            toolCalls: result.toolCalls,
            providerLabel,
            tokenUsage: {
              completionTokens: result.tokenUsage.completionTokens,
              totalTokens: result.tokenUsage.totalTokens,
            },
          };
        }

        return message;
      }));
      opLog.info('Chat turn finished', { toolCalls: result.toolCalls.length });
    } catch (err) {
      if (!abortController.signal.aborted) {
        const errorMessage = err instanceof Error ? err.message : t('chat.requestFailed');
        opLog.error('Chat turn failed', { error: err });
        updateMessage(pendingAssistantMessage.id, (message) => ({ ...message, content: t('chat.errorPrefix', { message: errorMessage }), isError: true }));
      } else {
        updateMessage(pendingAssistantMessage.id, (message) => (
          message.content === '...' ? { ...message, content: t('chat.stopped') } : message
        ));
      }
    } finally {
      setRunning(false);
      abortControllerRef.current = null;
      if (pendingConsentRef.current) {
        settleConsent('deny');
      }
    }
  };

  useEffect(() => {
    const chatScroll = chatScrollRef.current;
    if (!chatScroll || messages.length === 0) {
      return;
    }

    chatScroll.scrollTop = chatScroll.scrollHeight;
  }, [messages, pendingConsent]);

  const stopGeneration = () => {
    if (pendingConsentRef.current) {
      settleConsent('deny');
    }
    abortControllerRef.current?.abort();
  };

  const handleSuggestionSelect = (prompt: string) => {
    setSuggestionsAnchorEl(null);
    void submitPrompt(prompt);
  };

  // A cloud provider cannot answer without a connection; a model in this browser (or a local endpoint) can.
  const cloudOffline = !online && isCloudKind(provider.kind);
  const inputDisabled = !isProviderReady || running || cloudOffline;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <Box ref={chatScrollRef} sx={{ p: 2, overflowY: 'auto', overflowX: 'hidden', flex: 1, minHeight: 0 }}>
        {!isProviderReady && (
          <Alert
            severity="info"
            sx={{ mb: 2 }}
            action={onOpenSetup ? (
              <Button color="inherit" size="small" onClick={onOpenSetup}>
                {t('chat.openSetup')}
              </Button>
            ) : undefined}
          >
            {isLocalProvider ? t('chat.localNotReady') : t('chat.providerNotReady')}
          </Alert>
        )}

        <Stack spacing={1.5}>
          {messages.map((message) => {
            const tokenCaption = showTokenUsage ? getTokenCaption(message) : null;
            const isPendingAssistant = message.role === 'assistant' && message.content === '...';

            return (
              <Box
                key={message.id}
                sx={{
                  alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '88%',
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: message.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <Box
                  sx={{
                  bgcolor: message.isError
                    ? 'error.main'
                    : message.role === 'user' ? 'primary.main' : 'background.paper',
                  color: message.isError
                    ? 'error.contrastText'
                    : message.role === 'user' ? 'primary.contrastText' : 'text.primary',
                  border: 1,
                  borderColor: message.isError
                    ? 'error.main'
                    : message.role === 'user' ? 'primary.main' : 'divider',
                  borderRadius: 1,
                  px: 1.5,
                  py: 1,
                  minWidth: 0,
                  maxWidth: '100%',
                }}
              >
                {message.toolCalls && message.toolCalls.length > 0 && (
                  <Stack spacing={0.5} sx={{ mb: 1 }}>
                    {message.toolCalls.map((toolCall) => (
                      <AiToolCallBadge key={toolCall.id} toolCall={toolCall} />
                    ))}
                  </Stack>
                )}
                {isPendingAssistant ? (
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      color: 'text.secondary',
                      height: 24,
                    }}
                  >
                    <TypingIndicatorIcon />
                  </Box>
                ) : message.role === 'assistant' ? (
                  <AiMarkdownMessage content={message.content} />
                ) : (
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                    {message.content}
                  </Typography>
                )}
                </Box>
                {tokenCaption && (
                  <Typography
                    variant="caption"
                    sx={{
                      display: 'block',
                      mt: 0.35,
                      px: 0.5,
                      color: 'text.secondary',
                      fontSize: '0.68rem',
                      fontStyle: 'italic',
                      lineHeight: 1.25,
                    }}
                  >
                    {tokenCaption}
                  </Typography>
                )}
              </Box>
            );
          })}

          {pendingConsent && (
            <Box sx={{ alignSelf: 'stretch' }}>
              <AiConsentCard request={pendingConsent.request} onDecision={settleConsent} />
            </Box>
          )}
        </Stack>
      </Box>

      <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
        {cloudOffline && <OfflineFeatureNotice feature="cloudAi" sx={{ mb: 1.5 }} />}
        <Stack direction="row" spacing={1} alignItems="flex-end">
          <TextField
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submitPrompt(input);
              }
            }}
            label={t('chat.askLabel')}
            multiline
            minRows={2}
            maxRows={5}
            fullWidth
            disabled={inputDisabled}
          />
          <Stack spacing={0.5} alignItems="center">
            <Tooltip title={t('chat.suggestionsTooltip')}>
              <span>
                <IconButton
                  color="inherit"
                  onClick={(event) => setSuggestionsAnchorEl(event.currentTarget)}
                  disabled={inputDisabled}
                  aria-label={t('chat.showSuggestions')}
                  aria-controls={suggestionsOpen ? 'ai-prompt-suggestions-menu' : undefined}
                  aria-haspopup="menu"
                  aria-expanded={suggestionsOpen ? 'true' : undefined}
                  size="small"
                >
                  <AutoAwesome />
                </IconButton>
              </span>
            </Tooltip>
            {running ? (
              <IconButton color="inherit" onClick={stopGeneration} aria-label={t('chat.stop')}>
                <AnimatedStopIcon />
              </IconButton>
            ) : (
              <IconButton color="primary" onClick={() => void submitPrompt(input)} disabled={!isProviderReady || cloudOffline || !input.trim()} aria-label={t('chat.send')}>
                <Send />
              </IconButton>
            )}
          </Stack>
        </Stack>
        <Stack direction="row" justifyContent="flex-end" sx={{ mt: 0.5 }}>
          <Tooltip title={t('chat.clearTooltip')}>
            <span>
              <IconButton size="small" onClick={clearTranscript} disabled={running || messages.length === 0} aria-label={t('chat.clearConversation')}>
                <DeleteSweep fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
        <Menu
          id="ai-prompt-suggestions-menu"
          anchorEl={suggestionsAnchorEl}
          open={suggestionsOpen}
          onClose={() => setSuggestionsAnchorEl(null)}
          anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
          transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        >
          {EXAMPLE_PROMPT_IDS.map((promptId) => {
            const prompt = t(`chat.prompts.${promptId}`);
            return (
              <MenuItem key={promptId} onClick={() => handleSuggestionSelect(prompt)}>
                <ListItemIcon>
                  <AutoAwesome fontSize="small" />
                </ListItemIcon>
                <ListItemText primary={prompt} />
              </MenuItem>
            );
          })}
        </Menu>
      </Box>
    </Box>
  );
}
