'use client';

import React, { useState } from 'react';
import { Box, Chip, Collapse, Typography } from '@mui/material';
import { ExpandLess, ExpandMore } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import type { AiToolCallRecord } from '@/types/ai';

function formatArguments(argumentsJson: string): string {
  if (!argumentsJson.trim()) {
    return '{}';
  }

  try {
    return JSON.stringify(JSON.parse(argumentsJson), null, 2);
  } catch {
    return argumentsJson;
  }
}

function formatResult(result: unknown): string {
  if (result === undefined) {
    return '—';
  }

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

interface AiToolCallBadgeProps {
  toolCall: AiToolCallRecord;
}

export default function AiToolCallBadge({ toolCall }: AiToolCallBadgeProps) {
  const { t } = useTranslation(['ai', 'common']);
  const [expanded, setExpanded] = useState(false);
  const failed = toolCall.status === 'failed';
  const denied = toolCall.status === 'denied';

  const badgeLabel = (): string => {
    switch (toolCall.status) {
      case 'awaiting-consent':
        return t('toolCallBadge.awaitingConsent', { name: toolCall.name });
      case 'running':
        return t('toolCallBadge.running', { name: toolCall.name });
      case 'denied':
        return t('toolCallBadge.denied', { name: toolCall.name });
      case 'failed':
        return t('toolCallBadge.failed', { name: toolCall.name });
      default:
        return t('toolCallBadge.used', { name: toolCall.name });
    }
  };

  return (
    <Box>
      <Chip
        size="small"
        variant="outlined"
        clickable
        color={failed ? 'error' : denied ? 'warning' : 'default'}
        onClick={() => setExpanded((current) => !current)}
        icon={expanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
        label={badgeLabel()}
        sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}
        aria-expanded={expanded}
        data-testid={`ai-tool-call-${toolCall.name}`}
        data-status={toolCall.status}
      />
      <Collapse in={expanded} unmountOnExit>
        <Box
          sx={{
            mt: 0.75,
            p: 1,
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            bgcolor: 'action.hover',
          }}
        >
          <Typography variant="caption" sx={{ display: 'block', fontWeight: 600, mb: 0.25 }}>
            {t('toolCallBadge.input')}
          </Typography>
          <Box
            component="pre"
            sx={{ m: 0, mb: 1, fontFamily: 'monospace', fontSize: '0.72rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          >
            {formatArguments(toolCall.argumentsJson)}
          </Box>
          <Typography
            variant="caption"
            sx={{ display: 'block', fontWeight: 600, mb: 0.25, color: failed || denied ? 'error.main' : 'text.primary' }}
          >
            {failed || denied ? t('common:status.error') : t('toolCallBadge.output')}
          </Typography>
          <Box
            component="pre"
            sx={{
              m: 0,
              fontFamily: 'monospace',
              fontSize: '0.72rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: failed || denied ? 'error.main' : 'text.primary',
            }}
          >
            {failed || denied ? toolCall.error ?? t('toolCallBadge.unknownError') : formatResult(toolCall.result)}
          </Box>
        </Box>
      </Collapse>
    </Box>
  );
}
