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

export default function AiToolCallBadge({ toolCall }: AiToolCallBadgeProps) {
  const [expanded, setExpanded] = useState(false);
  const failed = toolCall.status === 'failed';

  return (
    <Box>
      <Chip
        size="small"
        variant="outlined"
        clickable
        color={failed ? 'error' : 'default'}
        onClick={() => setExpanded((current) => !current)}
        icon={expanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
        label={`Used ${toolCall.name}`}
        sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}
        aria-expanded={expanded}
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
            sx={{ display: 'block', fontWeight: 600, mb: 0.25, color: failed ? 'error.main' : 'text.primary' }}
          >
            {failed ? 'Error' : 'Output'}
          </Typography>
          <Box
            component="pre"
            sx={{
              m: 0,
              fontFamily: 'monospace',
              fontSize: '0.72rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: failed ? 'error.main' : 'text.primary',
            }}
          >
            {failed ? toolCall.error ?? 'Unknown error' : formatResult(toolCall.result)}
          </Box>
        </Box>
      </Collapse>
    </Box>
  );
}
