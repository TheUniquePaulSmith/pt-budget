'use client';

import React, { useMemo, useState } from 'react';
import { Box, Button, Chip, Collapse, Stack, Typography } from '@mui/material';
import { ExpandLess, ExpandMore, Shield } from '@mui/icons-material';

import type { AiConsentDecision, AiConsentRequest, AiToolCrud } from '@/types/aiTools';

export const CRUD_LABELS: Record<AiToolCrud, string> = {
  read: 'Read',
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
  mixed: 'Mixed',
};

export const CRUD_COLORS: Record<AiToolCrud, 'default' | 'success' | 'info' | 'warning' | 'error'> = {
  read: 'success',
  create: 'info',
  update: 'warning',
  delete: 'error',
  mixed: 'warning',
};

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

export interface AiConsentCardProps {
  request: AiConsentRequest;
  onDecision: (decision: AiConsentDecision) => void;
  disabled?: boolean;
}

/**
 * Inline card shown in the chat while the loop waits for the user to allow or
 * deny a tool call that requires consent.
 */
export default function AiConsentCard({ request, onDecision, disabled = false }: AiConsentCardProps) {
  const [showArgs, setShowArgs] = useState(true);
  const args = useMemo(() => formatArguments(request.argumentsJson), [request.argumentsJson]);
  const isDelete = request.crud === 'delete';

  return (
    <Box
      role="group"
      aria-label={`Consent required for ${request.toolName}`}
      data-testid="ai-consent-card"
      sx={{
        border: 1,
        borderColor: isDelete ? 'error.main' : 'warning.main',
        borderRadius: 1,
        p: 1.5,
        bgcolor: 'background.paper',
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Shield color={isDelete ? 'error' : 'warning'} fontSize="small" />
        <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 0 }}>
          The assistant wants to run{' '}
          <Box component="code" sx={{ fontFamily: 'monospace' }}>
            {request.toolName}
          </Box>
        </Typography>
        <Chip size="small" label={CRUD_LABELS[request.crud]} color={CRUD_COLORS[request.crud]} data-testid="ai-consent-crud" />
        {request.source === 'pack' && <Chip size="small" variant="outlined" label="Pack" />}
      </Stack>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {request.description}
      </Typography>

      <Button
        size="small"
        onClick={() => setShowArgs((current) => !current)}
        endIcon={showArgs ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
        sx={{ textTransform: 'none', px: 0.5 }}
        aria-expanded={showArgs}
      >
        Arguments
      </Button>
      <Collapse in={showArgs} unmountOnExit>
        <Box
          component="pre"
          sx={{
            m: 0,
            mb: 1,
            p: 1,
            bgcolor: 'action.hover',
            borderRadius: 1,
            fontFamily: 'monospace',
            fontSize: '0.72rem',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 180,
            overflow: 'auto',
          }}
        >
          {args}
        </Box>
      </Collapse>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
        <Button size="small" variant="contained" disabled={disabled} onClick={() => onDecision('allow_once')}>
          Allow once
        </Button>
        <Button size="small" variant="outlined" disabled={disabled} onClick={() => onDecision('allow_session')}>
          Allow this session
        </Button>
        <Button size="small" variant="outlined" disabled={disabled} onClick={() => onDecision('allow_always')}>
          Always allow
        </Button>
        <Button size="small" color="error" variant="text" disabled={disabled} onClick={() => onDecision('deny')}>
          Deny
        </Button>
      </Stack>
    </Box>
  );
}
