'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  Stack,
  Typography,
} from '@mui/material';
import { Check, Clear } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import type {
  ApplyTransactionClassificationInput,
  TransactionClassificationSuggestion,
} from '@/types/ai';

interface AiClassificationReviewProps {
  suggestions: TransactionClassificationSuggestion[];
  onApply: (classifications: ApplyTransactionClassificationInput[]) => Promise<void>;
  onClear: () => void;
}

export default function AiClassificationReview({
  suggestions,
  onApply,
  onClear,
}: AiClassificationReviewProps) {
  const { t } = useTranslation(['ai', 'common']);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedIds(suggestions.map((suggestion) => suggestion.transactionId));
  }, [suggestions]);

  const selectedSuggestions = useMemo(
    () => suggestions.filter((suggestion) => selectedIds.includes(suggestion.transactionId)),
    [selectedIds, suggestions]
  );

  if (suggestions.length === 0) {
    return null;
  }

  const describeSuggestion = (suggestion: TransactionClassificationSuggestion): string => {
    const parts = [
      suggestion.categoryName ? t('classificationReview.category', { name: suggestion.categoryName }) : null,
      suggestion.companyName ? t('classificationReview.company', { name: suggestion.companyName }) : null,
      suggestion.projectId ? t('classificationReview.project', { id: suggestion.projectId }) : null,
      suggestion.tripId ? t('classificationReview.trip', { id: suggestion.tripId }) : null,
    ].filter(Boolean);

    return parts.length > 0 ? parts.join(' | ') : t('classificationReview.noValues');
  };

  const toggleSuggestion = (transactionId: number) => {
    setSelectedIds((current) => current.includes(transactionId)
      ? current.filter((id) => id !== transactionId)
      : [...current, transactionId]);
  };

  const handleApply = async () => {
    setApplying(true);
    setError(null);

    try {
      await onApply(selectedSuggestions);
      onClear();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('classificationReview.applyFailed'));
    } finally {
      setApplying(false);
    }
  };

  return (
    <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="subtitle2" fontWeight={600}>
          {t('classificationReview.title')}
        </Typography>
        <Chip size="small" label={t('classificationReview.staged', { count: suggestions.length })} />
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}

      <Stack spacing={1} divider={<Divider flexItem />} sx={{ mb: 2 }}>
        {suggestions.map((suggestion) => (
          <Box key={suggestion.transactionId}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={selectedIds.includes(suggestion.transactionId)}
                  onChange={() => toggleSuggestion(suggestion.transactionId)}
                />
              }
              label={
                <Box>
                  <Typography variant="body2" fontWeight={600}>
                    {t('classificationReview.transactionLabel', {
                      id: suggestion.transactionId,
                      description: suggestion.transaction?.description ?? '',
                    })}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {describeSuggestion(suggestion)}
                  </Typography>
                  {suggestion.reason && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {suggestion.reason}
                    </Typography>
                  )}
                </Box>
              }
              sx={{ alignItems: 'flex-start', m: 0 }}
            />
          </Box>
        ))}
      </Stack>

      <Stack direction="row" spacing={1}>
        <Button
          variant="contained"
          size="small"
          startIcon={<Check />}
          onClick={() => void handleApply()}
          disabled={applying || selectedSuggestions.length === 0}
        >
          {t('classificationReview.applySelected')}
        </Button>
        <Button
          variant="outlined"
          size="small"
          startIcon={<Clear />}
          onClick={onClear}
          disabled={applying}
        >
          {t('common:actions.clear')}
        </Button>
      </Stack>
    </Box>
  );
}
