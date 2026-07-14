'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Drawer,
  IconButton,
  Stack,
  Tab,
  Tabs,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  Close,
  SmartToy,
} from '@mui/icons-material';

import { useAiChatRuntimeSlice } from '@/contexts/useWllamaSlices';
import type {
  AiWriteMode,
  MerchantRuleSuggestion,
  TransactionClassificationSuggestion,
} from '@/types/ai';
import AiAutomationPanel from './AiAutomationPanel';
import AiChat from './AiChat';
import AiModelSelector from './AiModelSelector';

interface AiSidePanelProps {
  open: boolean;
  onClose: () => void;
}

type AiPanelTab = 'chat' | 'automation' | 'model';

export default function AiSidePanel({ open, onClose }: AiSidePanelProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { isModelLoaded, loadedModel, contextSizeTokens, maxOutputTokens } = useAiChatRuntimeSlice();
  const [writeMode, setWriteMode] = useState<AiWriteMode>('review');
  const [activeTab, setActiveTab] = useState<AiPanelTab>('model');
  const [classificationSuggestions, setClassificationSuggestions] = useState<TransactionClassificationSuggestion[]>([]);
  const [merchantRuleSuggestions, setMerchantRuleSuggestions] = useState<MerchantRuleSuggestion[]>([]);
  const loadedModelIdRef = useRef(loadedModel?.id ?? null);

  useEffect(() => {
    const loadedModelId = loadedModel?.id ?? null;

    if (!isModelLoaded || !loadedModelId) {
      setActiveTab('model');
    } else if (loadedModelIdRef.current !== loadedModelId) {
      setActiveTab('chat');
    }

    loadedModelIdRef.current = loadedModelId;
  }, [isModelLoaded, loadedModel?.id]);

  const automationCount = classificationSuggestions.length + merchantRuleSuggestions.length;
  const numberFormatter = new Intl.NumberFormat('en-US');
  const inputTokens = numberFormatter.format(loadedModel?.contextLength ?? contextSizeTokens);
  const outputTokens = numberFormatter.format(maxOutputTokens);

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      ModalProps={{ keepMounted: true }}
      sx={{
        '& .MuiDrawer-paper': {
          width: isMobile ? '100vw' : 440,
          maxWidth: '100vw',
          boxSizing: 'border-box',
        },
      }}
    >
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}
        >
          <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
            <SmartToy color="primary" />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" fontWeight={600}>
                Local AI
              </Typography>
              {isModelLoaded && loadedModel ? (
                <>
                  <Typography
                    variant="caption"
                    title={loadedModel.name}
                    sx={{
                      display: 'block',
                      color: 'text.secondary',
                      fontSize: '0.7rem',
                      lineHeight: 1.3,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: 260,
                    }}
                  >
                    {loadedModel.name}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      display: 'block',
                      color: 'text.secondary',
                      fontSize: '0.7rem',
                      lineHeight: 1.3,
                    }}
                  >
                    Input {inputTokens} · Output {outputTokens} tokens
                  </Typography>
                </>
              ) : (
                <Typography
                  variant="caption"
                  sx={{ display: 'block', color: 'text.secondary', fontSize: '0.7rem' }}
                >
                  No model loaded
                </Typography>
              )}
            </Box>
          </Stack>
          <IconButton onClick={onClose} aria-label="Close AI panel">
            <Close />
          </IconButton>
        </Stack>

        {isModelLoaded && (
          <Tabs
            value={activeTab}
            onChange={(_, value: AiPanelTab) => setActiveTab(value)}
            variant="fullWidth"
            sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 44 }}
          >
            <Tab value="chat" label="Chat" sx={{ minHeight: 44 }} />
            <Tab
              value="automation"
              label={
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <span>Automation</span>
                  {automationCount > 0 && (
                    <Box
                      component="span"
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minWidth: 18,
                        height: 18,
                        px: 0.5,
                        borderRadius: '9px',
                        bgcolor: 'primary.main',
                        color: 'primary.contrastText',
                        fontSize: '0.65rem',
                        fontWeight: 600,
                        lineHeight: 1,
                      }}
                    >
                      {automationCount > 99 ? '99+' : automationCount}
                    </Box>
                  )}
                </Stack>
              }
              sx={{ minHeight: 44 }}
            />
            <Tab value="model" label="Model" sx={{ minHeight: 44 }} />
          </Tabs>
        )}

        {!isModelLoaded && <AiModelSelector />}

        {isModelLoaded && (
          <>
            <Box sx={{ display: activeTab === 'chat' ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
              <AiChat
                writeMode={writeMode}
                onClassificationSuggestions={(suggestions) => {
                  setClassificationSuggestions((current) => [...current, ...suggestions]);
                }}
                onMerchantRuleSuggestions={(suggestions) => {
                  setMerchantRuleSuggestions((current) => [...current, ...suggestions]);
                }}
                onReviewableAutomation={() => setActiveTab('automation')}
              />
            </Box>

            <Box sx={{ display: activeTab === 'automation' ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
              <AiAutomationPanel
                writeMode={writeMode}
                onWriteModeChange={setWriteMode}
                classificationSuggestions={classificationSuggestions}
                onClearClassifications={() => setClassificationSuggestions([])}
                merchantRuleSuggestions={merchantRuleSuggestions}
                onClearMerchantRuleSuggestions={() => setMerchantRuleSuggestions([])}
              />
            </Box>

            <Box sx={{ display: activeTab === 'model' ? 'block' : 'none' }}>
              <AiModelSelector showLoadedDetailsInline />
            </Box>
          </>
        )}
      </Box>
    </Drawer>
  );
}