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

import type {
  ApplyTransactionClassificationInput,
  TransactionClassificationSuggestion,
} from '@/types/ai';

interface AiClassificationReviewProps {
  suggestions: TransactionClassificationSuggestion[];
  onApply: (classifications: ApplyTransactionClassificationInput[]) => Promise<void>;
  onClear: () => void;
}

function describeSuggestion(suggestion: TransactionClassificationSuggestion): string {
  const parts = [
    suggestion.categoryName ? `Category: ${suggestion.categoryName}` : null,
    suggestion.companyName ? `Company: ${suggestion.companyName}` : null,
    suggestion.projectId ? `Project #${suggestion.projectId}` : null,
    suggestion.tripId ? `Trip #${suggestion.tripId}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' | ') : 'No classification values proposed';
}

export default function AiClassificationReview({
  suggestions,
  onApply,
  onClear,
}: AiClassificationReviewProps) {
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
      setError(err instanceof Error ? err.message : 'Failed to apply classifications');
    } finally {
      setApplying(false);
    }
  };

  return (
    <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="subtitle2" fontWeight={600}>
          Classification Review
        </Typography>
        <Chip size="small" label={`${suggestions.length} staged`} />
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
                    #{suggestion.transactionId} {suggestion.transaction?.description ?? ''}
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
          Apply Selected
        </Button>
        <Button
          variant="outlined"
          size="small"
          startIcon={<Clear />}
          onClick={onClear}
          disabled={applying}
        >
          Clear
        </Button>
      </Stack>
    </Box>
  );
}