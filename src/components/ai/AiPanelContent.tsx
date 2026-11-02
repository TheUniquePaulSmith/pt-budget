'use client';

/**
 * The panel body shared by every window mode: header (provider + mode
 * controls) and the Chat / Automation / Tools / Setup tabs.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Box, IconButton, Stack, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import {
  AutoAwesome,
  Close,
  Fullscreen,
  FullscreenExit,
  OpenInNew,
  ViewSidebar,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';
import { useAiChatRuntimeSlice } from '@/contexts/useWllamaSlices';
import { kindLabel } from '@/lib/aiProviderConfig';
import AiAutomationPanel from './AiAutomationPanel';
import AiChat from './AiChat';
import { useAiPanel } from './AiPanelProvider';
import { useAiProviderContext } from './AiProviderContext';
import AiProviderSetup from './AiProviderSetup';
import AiToolsTab from './AiToolsTab';

export type AiPanelTab = 'chat' | 'automation' | 'tools' | 'setup';

interface AiPanelContentProps {
  onClose: () => void;
}

function CountBadge({ count }: { count: number }) {
  if (count <= 0) {
    return null;
  }
  return (
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
      {count > 99 ? '99+' : count}
    </Box>
  );
}

export default function AiPanelContent({ onClose }: AiPanelContentProps) {
  const { t } = useTranslation('ai');
  const { number } = useFormatters();
  const panel = useAiPanel();
  const { provider, providerLabel, isLocalProvider, isProviderReady, activeProfile } = useAiProviderContext();
  const { loadedModel, contextSizeTokens, maxOutputTokens } = useAiChatRuntimeSlice();
  const [activeTab, setActiveTab] = useState<AiPanelTab>(isProviderReady ? 'chat' : 'setup');
  const wasReadyRef = useRef(isProviderReady);

  useEffect(() => {
    if (isProviderReady && !wasReadyRef.current) {
      setActiveTab('chat');
    }
    wasReadyRef.current = isProviderReady;
  }, [isProviderReady]);

  const automationCount = panel.classificationSuggestions.length + panel.merchantRuleSuggestions.length;

  let caption: string;
  if (isLocalProvider) {
    caption = isProviderReady && loadedModel
      ? t('panelContent.localCaption', {
          input: number(loadedModel.contextLength ?? contextSizeTokens),
          output: number(maxOutputTokens),
        })
      : t('panelContent.noModelLoaded');
  } else {
    caption = t('panelContent.cloudCaption', { provider: kindLabel(provider.kind), model: provider.model });
  }

  const showModeControls = !panel.isStandalone;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.default', minHeight: 0 }} data-testid="ai-panel">
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ p: 2, borderBottom: 1, borderColor: 'divider', gap: 1 }}
      >
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <AutoAwesome color="primary" />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" fontWeight={600} noWrap data-testid="ai-panel-title">
              {providerLabel}
            </Typography>
            {isLocalProvider && isProviderReady && loadedModel && (
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
            )}
            <Typography
              variant="caption"
              sx={{ display: 'block', color: 'text.secondary', fontSize: '0.7rem', lineHeight: 1.3 }}
              data-testid="ai-panel-caption"
            >
              {caption}
            </Typography>
          </Box>
        </Stack>

        <Stack direction="row" spacing={0} alignItems="center">
          {showModeControls && panel.mode === 'maximized' && (
            <Tooltip title={t('panelContent.showAsSidebar')}>
              <IconButton size="small" onClick={() => panel.setMode('sidebar')} aria-label={t('panelContent.showAsSidebar')} data-testid="ai-mode-sidebar">
                <FullscreenExit fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {showModeControls && panel.mode !== 'maximized' && (
            <Tooltip title={t('panelContent.maximize')}>
              <IconButton size="small" onClick={() => panel.setMode('maximized')} aria-label={t('panelContent.maximizeAria')} data-testid="ai-mode-maximize">
                <Fullscreen fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {showModeControls && (
            <Tooltip title={t('panelContent.openNewWindow')}>
              <IconButton size="small" onClick={panel.openPopout} aria-label={t('panelContent.openNewWindowAria')} data-testid="ai-mode-popout">
                <OpenInNew fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {panel.isStandalone && (
            <Tooltip title={t('panelContent.standaloneHint')}>
              <ViewSidebar fontSize="small" color="disabled" sx={{ mx: 1 }} />
            </Tooltip>
          )}
          <IconButton onClick={onClose} aria-label={t('panelContent.close')} data-testid="ai-panel-close">
            <Close />
          </IconButton>
        </Stack>
      </Stack>

      <Tabs
        value={activeTab}
        onChange={(_, value: AiPanelTab) => setActiveTab(value)}
        variant="fullWidth"
        sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 44 }}
      >
        <Tab value="chat" label={t('panelContent.tabChat')} sx={{ minHeight: 44 }} data-testid="ai-tab-chat" />
        <Tab
          value="automation"
          label={
            <Stack direction="row" spacing={0.75} alignItems="center">
              <span>{t('panelContent.tabAutomation')}</span>
              <CountBadge count={automationCount} />
            </Stack>
          }
          sx={{ minHeight: 44 }}
          data-testid="ai-tab-automation"
        />
        <Tab value="tools" label={t('panelContent.tabTools')} sx={{ minHeight: 44 }} data-testid="ai-tab-tools" />
        <Tab value="setup" label={t('panelContent.tabSetup')} sx={{ minHeight: 44 }} data-testid="ai-tab-setup" />
      </Tabs>

      <Box sx={{ display: activeTab === 'chat' ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
        <AiChat onReviewableAutomation={() => setActiveTab('automation')} onOpenSetup={() => setActiveTab('setup')} />
      </Box>

      <Box sx={{ display: activeTab === 'automation' ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
        <AiAutomationPanel
          writeMode={panel.writeMode}
          onWriteModeChange={panel.setWriteMode}
          classificationSuggestions={panel.classificationSuggestions}
          onClearClassifications={panel.clearClassificationSuggestions}
          merchantRuleSuggestions={panel.merchantRuleSuggestions}
          onClearMerchantRuleSuggestions={panel.clearMerchantRuleSuggestions}
        />
      </Box>

      <Box sx={{ display: activeTab === 'tools' ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
        <AiToolsTab />
      </Box>

      <Box sx={{ display: activeTab === 'setup' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column', overflow: 'auto' }}>
        <AiProviderSetup activeProfileLabel={activeProfile?.label ?? null} />
      </Box>
    </Box>
  );
}
