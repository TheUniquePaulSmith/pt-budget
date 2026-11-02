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

import { useTranslation } from 'react-i18next';

import CurrencySelect from '@/components/common/CurrencySelect';
import type { Account } from '@/types/database';

interface InitialAccountProps {
  /** The household's default currency (chosen on the preferences step); the account starts with it. */
  defaultCurrency: string;
  /** Called after the user confirms their first account. */
  onAccountConfirmed: (
    name: string,
    type: Account['type'],
    lastFour: string,
    currency: string
  ) => Promise<void>;
  /** Skips creating an initial account and continues setup. */
  onSkip: () => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

const LAST_FOUR_PATTERN = /^\d{4}$/;

export function InitialAccount({
  defaultCurrency,
  onAccountConfirmed,
  onSkip,
  isLoading,
  error,
}: InitialAccountProps) {
  const { t } = useTranslation(['setup', 'common']);
  const [name, setName] = useState('');
  const [type, setType] = useState<Account['type']>('checking');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [lastFour, setLastFour] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    setValidationError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setValidationError(t('initialAccount.nameRequired'));
      return;
    }

    if (!LAST_FOUR_PATTERN.test(lastFour)) {
      setValidationError(t('initialAccount.lastFourInvalid'));
      return;
    }

    try {
      await onAccountConfirmed(trimmedName, type, lastFour, currency);
    } catch {
      // Error is surfaced via the `error` prop from the parent.
    }
  }, [name, type, lastFour, currency, onAccountConfirmed, t]);

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
            {t('initialAccount.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('initialAccount.description')}
          </Typography>
        </Box>

        {displayError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {displayError}
          </Alert>
        )}

        <TextField
          label={t('initialAccount.nameLabel')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          fullWidth
          required
          autoFocus
          disabled={isLoading}
          sx={{ mb: 2 }}
        />

        <FormControl fullWidth disabled={isLoading} sx={{ mb: 2 }}>
          <InputLabel id="initial-account-type-label">{t('initialAccount.typeLabel')}</InputLabel>
          <Select
            labelId="initial-account-type-label"
            label={t('initialAccount.typeLabel')}
            value={type}
            onChange={(e: SelectChangeEvent) =>
              setType(e.target.value as Account['type'])
            }
          >
            <MenuItem value="checking">{t('common:accountType.checking')}</MenuItem>
            <MenuItem value="savings">{t('common:accountType.savings')}</MenuItem>
            <MenuItem value="credit">{t('common:accountType.credit')}</MenuItem>
          </Select>
        </FormControl>

        <CurrencySelect
          id="initial-account-currency"
          label={t('initialAccount.currencyLabel')}
          value={currency}
          onChange={setCurrency}
          disabled={isLoading}
          testId="initial-account-currency"
          sx={{ mb: 2 }}
        />

        <TextField
          label={t('initialAccount.lastFourLabel')}
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
          {isLoading ? t('initialAccount.saving') : t('common:actions.continue')}
        </Button>

        <Button
          variant="text"
          size="small"
          fullWidth
          disabled={isLoading}
          onClick={() => void onSkip()}
          data-testid="skip-initial-account"
        >
          {t('common:actions.skipForNow')}
        </Button>
      </Paper>
    </Box>
  );
}
