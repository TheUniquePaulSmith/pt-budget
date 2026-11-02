'use client';

import React, { useMemo, useState } from 'react';
import { Box, Button, Chip, Collapse, Stack, Typography } from '@mui/material';
import { ExpandLess, ExpandMore, Shield } from '@mui/icons-material';
import { Trans, useTranslation } from 'react-i18next';

import type { AiConsentDecision, AiConsentRequest, AiToolCrud } from '@/types/aiTools';

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
  const { t } = useTranslation('ai');
  const [showArgs, setShowArgs] = useState(true);
  const args = useMemo(() => formatArguments(request.argumentsJson), [request.argumentsJson]);
  const isDelete = request.crud === 'delete';

  return (
    <Box
      role="group"
      aria-label={t('consentCard.consentRequired', { tool: request.toolName })}
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
          <Trans
            i18nKey="consentCard.wantsToRun"
            ns="ai"
            values={{ tool: request.toolName }}
            components={{ code: <Box component="code" sx={{ fontFamily: 'monospace' }} /> }}
          />
        </Typography>
        <Chip size="small" label={t(`consentCard.crud.${request.crud}`)} color={CRUD_COLORS[request.crud]} data-testid="ai-consent-crud" />
        {request.source === 'pack' && <Chip size="small" variant="outlined" label={t('consentCard.pack')} />}
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
        {t('consentCard.arguments')}
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
          {t('consentCard.allowOnce')}
        </Button>
        <Button size="small" variant="outlined" disabled={disabled} onClick={() => onDecision('allow_session')}>
          {t('consentCard.allowSession')}
        </Button>
        <Button size="small" variant="outlined" disabled={disabled} onClick={() => onDecision('allow_always')}>
          {t('consentCard.allowAlways')}
        </Button>
        <Button size="small" color="error" variant="text" disabled={disabled} onClick={() => onDecision('deny')}>
          {t('consentCard.deny')}
        </Button>
      </Stack>
    </Box>
  );
}
