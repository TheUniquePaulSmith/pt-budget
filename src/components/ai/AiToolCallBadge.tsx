'use client';

import React, { useState } from 'react';
import { Box, Chip, Collapse, Typography } from '@mui/material';
import { ExpandLess, ExpandMore } from '@mui/icons-material';

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

function badgeLabel(toolCall: AiToolCallRecord): string {
  switch (toolCall.status) {
    case 'awaiting-consent':
      return `Waiting for consent: ${toolCall.name}`;
    case 'running':
      return `Running ${toolCall.name}`;
    case 'denied':
      return `Denied ${toolCall.name}`;
    case 'failed':
      return `Failed ${toolCall.name}`;
    default:
      return `Used ${toolCall.name}`;
  }
}

export default function AiToolCallBadge({ toolCall }: AiToolCallBadgeProps) {
  const [expanded, setExpanded] = useState(false);
  const failed = toolCall.status === 'failed';
  const denied = toolCall.status === 'denied';

  return (
    <Box>
      <Chip
        size="small"
        variant="outlined"
        clickable
        color={failed ? 'error' : denied ? 'warning' : 'default'}
        onClick={() => setExpanded((current) => !current)}
        icon={expanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
        label={badgeLabel(toolCall)}
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
            Input
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
            {failed || denied ? 'Error' : 'Output'}
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
            {failed || denied ? toolCall.error ?? 'Unknown error' : formatResult(toolCall.result)}
          </Box>
        </Box>
      </Collapse>
    </Box>
  );
}
