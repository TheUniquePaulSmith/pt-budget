'use client';

/**
 * Setup step right after the password: language (applies instantly, saved on
 * this device) and the household's default currency (saved in the database,
 * used for every cross-account total). Both can be changed later in
 * Settings → Preferences; "Skip for now" keeps English and US dollars.
 */

import { useCallback, useState } from 'react';

import { TuneOutlined } from '@mui/icons-material';
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
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

import CurrencySelect from '@/components/common/CurrencySelect';
import { useOptionalLocale } from '@/contexts/LocaleContext';
import { DEFAULT_CURRENCY } from '@/lib/currencies';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, type LanguageCode } from '@/lib/i18n';

interface PreferencesSetupProps {
  /** Called with the chosen default currency; the language is already applied. */
  onPreferencesConfirmed: (defaultCurrency: string) => Promise<void>;
  /** Keeps the defaults (English, USD) and continues. */
  onSkip: () => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

export function PreferencesSetup({ onPreferencesConfirmed, onSkip, isLoading, error }: PreferencesSetupProps) {
  const { t } = useTranslation('setup');
  const locale = useOptionalLocale();
  const [defaultCurrency, setDefaultCurrency] = useState(DEFAULT_CURRENCY);
  const language: LanguageCode = locale?.language ?? DEFAULT_LANGUAGE;

  const handleLanguageChange = useCallback(
    (event: SelectChangeEvent) => {
      locale?.setLanguage(event.target.value as LanguageCode);
    },
    [locale]
  );

  const handleSubmit = useCallback(async () => {
    try {
      await onPreferencesConfirmed(defaultCurrency);
    } catch {
      // Error is surfaced via the `error` prop from the parent.
    }
  }, [defaultCurrency, onPreferencesConfirmed]);

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
      <Paper sx={{ p: 4, maxWidth: 480, width: '100%' }} data-testid="preferences-setup">
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <TuneOutlined sx={{ fontSize: 56, color: 'primary.main', mb: 1.5 }} />
          <Typography variant="h5" gutterBottom fontWeight="bold">
            {t('preferences.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('preferences.description')}
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <FormControl fullWidth disabled={isLoading} sx={{ mb: 2 }}>
          <InputLabel id="preferences-language-label">{t('preferences.languageLabel')}</InputLabel>
          <Select
            labelId="preferences-language-label"
            label={t('preferences.languageLabel')}
            value={language}
            onChange={handleLanguageChange}
            inputProps={{ 'data-testid': 'preferences-language' }}
          >
            {SUPPORTED_LANGUAGES.map((option) => (
              <MenuItem key={option.code} value={option.code} lang={option.intlLocale}>
                {option.nativeLabel}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2, mt: -1 }}>
          {t('preferences.languageHelp')}
        </Typography>

        <CurrencySelect
          id="preferences-default-currency"
          label={t('preferences.currencyLabel')}
          value={defaultCurrency}
          onChange={setDefaultCurrency}
          disabled={isLoading}
          testId="preferences-default-currency"
          helperText={t('preferences.currencyHelp')}
          sx={{ mb: 3 }}
        />

        <Button
          variant="contained"
          size="large"
          fullWidth
          disabled={isLoading}
          onClick={() => void handleSubmit()}
          startIcon={isLoading ? <CircularProgress size={18} color="inherit" /> : undefined}
          sx={{ mb: 1.5 }}
          data-testid="preferences-continue"
        >
          {isLoading ? t('preferences.saving') : t('preferences.continue')}
        </Button>

        <Button
          variant="text"
          size="small"
          fullWidth
          disabled={isLoading}
          onClick={() => void onSkip()}
          data-testid="skip-preferences"
        >
          {t('preferences.skip')}
        </Button>
      </Paper>
    </Box>
  );
}
