'use client';

import React, { useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from '@mui/material';

import { useAiDatabaseToolsSlice } from '@/contexts/useDatabaseSlices';
import type {
  AiToolCallRecord,
  AiWriteMode,
  ApplyTransactionClassificationInput,
  TransactionClassificationSuggestion,
} from '@/types/ai';
import AiClassificationReview from './AiClassificationReview';

interface AiAutomationPanelProps {
  writeMode: AiWriteMode;
  onWriteModeChange: (mode: AiWriteMode) => void;
  toolCalls: AiToolCallRecord[];
  classificationSuggestions: TransactionClassificationSuggestion[];
  onClearClassifications: () => void;
}

export default function AiAutomationPanel({
  writeMode,
  onWriteModeChange,
  toolCalls,
  classificationSuggestions,
  onClearClassifications,
}: AiAutomationPanelProps) {
  const databaseTools = useAiDatabaseToolsSlice();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const applyClassifications = async (
    classifications: ApplyTransactionClassificationInput[]
  ) => {
    const result = await databaseTools.applyTransactionClassifications(classifications);
    setStatusMessage(`Applied ${result.appliedCount} classification${result.appliedCount === 1 ? '' : 's'}.`);
  };

  const hasToolCalls = toolCalls.length > 0;
  const hasSuggestions = classificationSuggestions.length > 0;

  return (
    <Box sx={{ p: 2, overflow: 'auto', flex: 1 }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="subtitle1" fontWeight={600}>
            Automation
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Review tool calls and approve database changes.
          </Typography>
        </Box>

        <FormControlLabel
          control={
            <Switch
              checked={writeMode === 'autoApply'}
              onChange={(event) => onWriteModeChange(event.target.checked ? 'autoApply' : 'review')}
            />
          }
          label="Auto-apply classification writes"
        />

        {statusMessage && (
          <Alert severity="success" onClose={() => setStatusMessage(null)}>
            {statusMessage}
          </Alert>
        )}

        {!hasToolCalls && !hasSuggestions && (
          <Alert severity="info">
            Tool calls and reviewable actions will appear here when the model creates them.
          </Alert>
        )}

        {hasToolCalls && (
          <Box>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
              Recent Tool Calls
            </Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
              {toolCalls.map((toolCall) => (
                <Chip
                  key={toolCall.id}
                  size="small"
                  label={`${toolCall.name}: ${toolCall.status}`}
                  color={toolCall.status === 'failed' ? 'error' : 'default'}
                  variant="outlined"
                />
              ))}
            </Stack>
          </Box>
        )}

        <AiClassificationReview
          suggestions={classificationSuggestions}
          onApply={applyClassifications}
          onClear={onClearClassifications}
        />
      </Stack>
    </Box>
  );
}