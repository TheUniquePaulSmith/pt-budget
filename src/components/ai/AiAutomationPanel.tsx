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
  MerchantRuleSuggestion,
  TransactionClassificationSuggestion,
} from '@/types/ai';
import AiClassificationReview from './AiClassificationReview';
import AiMerchantRuleReview from './AiMerchantRuleReview';

interface AiAutomationPanelProps {
  writeMode: AiWriteMode;
  onWriteModeChange: (mode: AiWriteMode) => void;
  toolCalls: AiToolCallRecord[];
  classificationSuggestions: TransactionClassificationSuggestion[];
  onClearClassifications: () => void;
  merchantRuleSuggestions: MerchantRuleSuggestion[];
  onClearMerchantRuleSuggestions: () => void;
}

export default function AiAutomationPanel({
  writeMode,
  onWriteModeChange,
  toolCalls,
  classificationSuggestions,
  onClearClassifications,
  merchantRuleSuggestions,
  onClearMerchantRuleSuggestions,
}: AiAutomationPanelProps) {
  const databaseTools = useAiDatabaseToolsSlice();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const applyClassifications = async (
    classifications: ApplyTransactionClassificationInput[]
  ) => {
    const result = await databaseTools.applyTransactionClassifications(classifications);
    setStatusMessage(`Applied ${result.appliedCount} classification${result.appliedCount === 1 ? '' : 's'}.`);
  };

  const applyMerchantRules = async (rules: MerchantRuleSuggestion[]) => {
    for (const rule of rules) {
      await databaseTools.addMerchantRule({
        pattern: rule.pattern,
        match_type: rule.match_type,
        merchant_name: rule.merchant_name,
        service_name: rule.service_name ?? null,
        default_kind: rule.default_kind,
      });
    }
    // Re-scan so the new rules take effect immediately
    await databaseTools.runSubscriptionScan();
    setStatusMessage(`Created ${rules.length} merchant rule${rules.length === 1 ? '' : 's'} and re-ran the subscription scan.`);
  };

  const hasToolCalls = toolCalls.length > 0;
  const hasSuggestions = classificationSuggestions.length > 0 || merchantRuleSuggestions.length > 0;

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

        <AiMerchantRuleReview
          suggestions={merchantRuleSuggestions}
          onApply={applyMerchantRules}
          onClear={onClearMerchantRuleSuggestions}
        />
      </Stack>
    </Box>
  );
}