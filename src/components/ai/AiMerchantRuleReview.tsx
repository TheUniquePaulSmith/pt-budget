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

import type { MerchantRuleSuggestion } from '@/types/ai';

interface AiMerchantRuleReviewProps {
  suggestions: MerchantRuleSuggestion[];
  onApply: (rules: MerchantRuleSuggestion[]) => Promise<void>;
  onClear: () => void;
}

function describeSuggestion(suggestion: MerchantRuleSuggestion): string {
  const parts = [
    `Merchant: ${suggestion.merchant_name}`,
    suggestion.service_name ? `Service: ${suggestion.service_name}` : null,
    `Type: ${suggestion.default_kind}`,
    `Match: ${suggestion.match_type} "${suggestion.pattern}"`,
  ].filter(Boolean);

  return parts.join(' | ');
}

export default function AiMerchantRuleReview({
  suggestions,
  onApply,
  onClear,
}: AiMerchantRuleReviewProps) {
  const [selectedIndexes, setSelectedIndexes] = useState<number[]>([]);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedIndexes(suggestions.map((_suggestion, index) => index));
  }, [suggestions]);

  const selectedSuggestions = useMemo(
    () => suggestions.filter((_suggestion, index) => selectedIndexes.includes(index)),
    [selectedIndexes, suggestions]
  );

  if (suggestions.length === 0) {
    return null;
  }

  const toggleSuggestion = (index: number) => {
    setSelectedIndexes((current) => current.includes(index)
      ? current.filter((value) => value !== index)
      : [...current, index]);
  };

  const handleApply = async () => {
    setApplying(true);
    setError(null);

    try {
      await onApply(selectedSuggestions);
      onClear();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create merchant rules');
    } finally {
      setApplying(false);
    }
  };

  return (
    <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="subtitle2" fontWeight={600}>
          Merchant Rule Review
        </Typography>
        <Chip size="small" label={`${suggestions.length} staged`} />
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}

      <Stack spacing={1} divider={<Divider flexItem />} sx={{ mb: 2 }}>
        {suggestions.map((suggestion, index) => (
          <Box key={`${suggestion.pattern}-${index}`}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={selectedIndexes.includes(index)}
                  onChange={() => toggleSuggestion(index)}
                />
              }
              label={
                <Box>
                  <Typography variant="body2" fontWeight={600}>
                    {suggestion.pattern}
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
          Create Selected Rules
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
