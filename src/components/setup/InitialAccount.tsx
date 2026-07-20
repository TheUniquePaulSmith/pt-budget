'use client';

import { useCallback, useState } from 'react';

import { CreditCardOutlined } from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  type SelectChangeEvent,
  TextField,
  Typography,
} from '@mui/material';

import type { Account } from '@/types/database';

interface InitialAccountProps {
  /** Called after the user confirms their first account. */
  onAccountConfirmed: (
    name: string,
    type: Account['type'],
    lastFour: string
  ) => Promise<void>;
  /** Skips creating an initial account and continues setup. */
  onSkip: () => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

const LAST_FOUR_PATTERN = /^\d{4}$/;

export function InitialAccount({
  onAccountConfirmed,
  onSkip,
  isLoading,
  error,
}: InitialAccountProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<Account['type']>('checking');
  const [lastFour, setLastFour] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    setValidationError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setValidationError('Account name is required.');
      return;
    }

    if (!LAST_FOUR_PATTERN.test(lastFour)) {
      setValidationError('Last four digits must be exactly 4 numbers.');
      return;
    }

    try {
      await onAccountConfirmed(trimmedName, type, lastFour);
    } catch {
      // Error is surfaced via the `error` prop from the parent.
    }
  }, [name, type, lastFour, onAccountConfirmed]);

  const displayError = validationError ?? error;
  const canSubmit =
    !isLoading && name.trim().length > 0 && LAST_FOUR_PATTERN.test(lastFour);

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 2,
      }}
    >
      <Paper sx={{ p: 4, maxWidth: 480, width: '100%' }}>
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <CreditCardOutlined sx={{ fontSize: 56, color: 'primary.main', mb: 1.5 }} />
          <Typography variant="h5" gutterBottom fontWeight="bold">
            Add Your First Account
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Set up an account or card so your transactions have somewhere to
            go. You can add more accounts later in Settings.
          </Typography>
        </Box>

        {displayError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {displayError}
          </Alert>
        )}

        <TextField
          label="Account Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          fullWidth
          required
          autoFocus
          disabled={isLoading}
          sx={{ mb: 2 }}
        />

        <FormControl fullWidth disabled={isLoading} sx={{ mb: 2 }}>
          <InputLabel id="initial-account-type-label">Account Type</InputLabel>
          <Select
            labelId="initial-account-type-label"
            label="Account Type"
            value={type}
            onChange={(e: SelectChangeEvent) =>
              setType(e.target.value as Account['type'])
            }
          >
            <MenuItem value="checking">Checking</MenuItem>
            <MenuItem value="savings">Savings</MenuItem>
            <MenuItem value="credit">Credit Card</MenuItem>
            <MenuItem value="joint">Joint Account</MenuItem>
          </Select>
        </FormControl>

        <TextField
          label="Last Four Digits"
          value={lastFour}
          onChange={(e) => setLastFour(e.target.value.replace(/\D/g, '').slice(0, 4))}
          fullWidth
          required
          disabled={isLoading}
          slotProps={{ htmlInput: { maxLength: 4, inputMode: 'numeric', pattern: '[0-9]{4}' } }}
          sx={{ mb: 3 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) void handleSubmit();
          }}
        />

        <Button
          variant="contained"
          size="large"
          fullWidth
          disabled={!canSubmit}
          onClick={() => void handleSubmit()}
          startIcon={
            isLoading ? <CircularProgress size={18} color="inherit" /> : undefined
          }
          sx={{ mb: 1.5 }}
        >
          {isLoading ? 'Saving Account…' : 'Continue'}
        </Button>

        <Button
          variant="text"
          size="small"
          fullWidth
          disabled={isLoading}
          onClick={() => void onSkip()}
          data-testid="skip-initial-account"
        >
          Skip for now
        </Button>
      </Paper>
    </Box>
  );
}
