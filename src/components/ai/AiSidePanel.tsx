'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Badge,
  Box,
  Chip,
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
  AiToolCallRecord,
  AiWriteMode,
  MerchantRuleSuggestion,
  TransactionClassificationSuggestion,
} from '@/types/ai';
import { AI_CONTEXT_SIZE_PRESETS } from '@/types/ai';
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
  const { isModelLoaded, loadedModel, contextSizePreset, contextSizeTokens } = useAiChatRuntimeSlice();
  const [writeMode, setWriteMode] = useState<AiWriteMode>('review');
  const [activeTab, setActiveTab] = useState<AiPanelTab>('model');
  const [toolCalls, setToolCalls] = useState<AiToolCallRecord[]>([]);
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

  const automationCount = toolCalls.length + classificationSuggestions.length + merchantRuleSuggestions.length;
  const contextPreset = AI_CONTEXT_SIZE_PRESETS[contextSizePreset];
  const headerBadgeLabel = isModelLoaded && loadedModel
    ? `${loadedModel.name} · ${contextPreset.label} ${new Intl.NumberFormat('en-US').format(loadedModel.contextLength ?? contextSizeTokens)} ctx`
    : 'No model loaded';

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
          <Stack direction="row" spacing={1} alignItems="center">
            <SmartToy color="primary" />
            <Box>
              <Typography variant="h6" fontWeight={600}>
                Local AI
              </Typography>
              <Chip
                size="small"
                variant="outlined"
                label={headerBadgeLabel}
                title={headerBadgeLabel}
                sx={{
                  maxWidth: 300,
                  '& .MuiChip-label': {
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  },
                }}
              />
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
                <Badge color="primary" badgeContent={automationCount} max={99} invisible={automationCount === 0}>
                  Automation
                </Badge>
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
                onToolCallsChange={setToolCalls}
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
                toolCalls={toolCalls}
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