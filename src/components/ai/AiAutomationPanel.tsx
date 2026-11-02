'use client';

import React, { useState } from 'react';
import {
  Alert,
  Box,
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

import { useAiDatabaseToolsSlice } from '@/contexts/useDatabaseSlices';
import type {
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
  classificationSuggestions: TransactionClassificationSuggestion[];
  onClearClassifications: () => void;
  merchantRuleSuggestions: MerchantRuleSuggestion[];
  onClearMerchantRuleSuggestions: () => void;
}

export default function AiAutomationPanel({
  writeMode,
  onWriteModeChange,
  classificationSuggestions,
  onClearClassifications,
  merchantRuleSuggestions,
  onClearMerchantRuleSuggestions,
}: AiAutomationPanelProps) {
  const { t } = useTranslation('ai');
  const databaseTools = useAiDatabaseToolsSlice();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const applyClassifications = async (
    classifications: ApplyTransactionClassificationInput[]
  ) => {
    const result = await databaseTools.applyTransactionClassifications(classifications);
    setStatusMessage(t('automation.appliedClassifications', { count: result.appliedCount }));
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
    setStatusMessage(t('automation.createdRules', { count: rules.length }));
  };

  const hasSuggestions = classificationSuggestions.length > 0 || merchantRuleSuggestions.length > 0;

  return (
    <Box sx={{ p: 2, overflow: 'auto', flex: 1 }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="subtitle1" fontWeight={600}>
            {t('automation.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('automation.subtitle')}
          </Typography>
        </Box>

        <FormControlLabel
          control={
            <Switch
              checked={writeMode === 'autoApply'}
              onChange={(event) => onWriteModeChange(event.target.checked ? 'autoApply' : 'review')}
            />
          }
          label={t('automation.autoApply')}
        />

        {statusMessage && (
          <Alert severity="success" onClose={() => setStatusMessage(null)}>
            {statusMessage}
          </Alert>
        )}

        {!hasSuggestions && (
          <Alert severity="info">
            {t('automation.empty')}
          </Alert>
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
