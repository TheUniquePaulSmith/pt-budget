'use client';

/**
 * Settings → Preferences: language (this device), default currency (this
 * database; changing it rebases every known exchange rate) and the manual
 * exchange-rate editor for every currency in use by an account.
 */

import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  type SelectChangeEvent,
  Stack,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

import CurrencySelect from '@/components/common/CurrencySelect';
import { useOptionalLocale } from '@/contexts/LocaleContext';
import { useCurrencyPreferencesSlice } from '@/contexts/useDatabaseSlices';
import { useFormatters } from '@/contexts/useFormatters';
import { currencyDisplayName } from '@/lib/currencies';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, type LanguageCode } from '@/lib/i18n';

import ExchangeRatesEditor from './ExchangeRatesEditor';

export default function PreferencesSettingsTab() {
  const { t } = useTranslation('settings');
  const locale = useOptionalLocale();
  const { locale: localeTag } = useFormatters();
  const {
    defaultCurrency,
    exchangeRates,
    accountCurrencies,
    missingRateCurrencies,
    setDefaultCurrency,
    setExchangeRate,
    deleteExchangeRate,
  } = useCurrencyPreferencesSlice();

  const [pendingCurrency, setPendingCurrency] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const language: LanguageCode = locale?.language ?? DEFAULT_LANGUAGE;
  const pendingRateKnown = useMemo(
    () => (pendingCurrency ? exchangeRates.some((rate) => rate.currency === pendingCurrency && rate.rate !== null) : false),
    [pendingCurrency, exchangeRates]
  );

  const handleLanguageChange = (event: SelectChangeEvent) => {
    locale?.setLanguage(event.target.value as LanguageCode);
  };

  const handleConfirmDefaultCurrency = async () => {
    if (!pendingCurrency) return;
    setChanging(true);
    setError(null);
    try {
      await setDefaultCurrency(pendingCurrency);
      setPendingCurrency(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('preferences.changeFailed'));
    } finally {
      setChanging(false);
    }
  };

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5" gutterBottom>
          {t('preferences.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          {t('preferences.description')}
        </Typography>
      </Box>

      <Divider />

      <Box>
        <Typography variant="h6" gutterBottom>
          {t('preferences.languageTitle')}
        </Typography>
        <FormControl sx={{ minWidth: 260 }}>
          <InputLabel id="settings-language-label">{t('preferences.languageLabel')}</InputLabel>
          <Select
            labelId="settings-language-label"
            label={t('preferences.languageLabel')}
            value={language}
            onChange={handleLanguageChange}
            inputProps={{ 'data-testid': 'settings-language' }}
          >
            {SUPPORTED_LANGUAGES.map((option) => (
              <MenuItem key={option.code} value={option.code} lang={option.intlLocale} data-testid={`settings-language-option-${option.code}`}>
                {option.nativeLabel}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t('preferences.languageHelp')}
        </Typography>
      </Box>

      <Divider />

      <Box>
        <Typography variant="h6" gutterBottom>
          {t('preferences.currencyTitle')}
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <CurrencySelect
          id="settings-default-currency"
          label={t('preferences.defaultCurrencyLabel')}
          value={defaultCurrency}
          onChange={(code) => {
            if (code !== defaultCurrency) setPendingCurrency(code);
          }}
          extraCodes={accountCurrencies}
          fullWidth={false}
          sx={{ minWidth: 260 }}
          testId="settings-default-currency"
          disabled={changing}
        />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t('preferences.defaultCurrencyHelp')}
        </Typography>
      </Box>

      <Divider />

      <Box>
        <Typography variant="h6" gutterBottom>
          {t('preferences.ratesTitle')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('preferences.ratesDescription', { defaultCurrency })}
        </Typography>
        {missingRateCurrencies.length > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }} data-testid="settings-missing-rates">
            {t('preferences.ratesMissing', { currencies: missingRateCurrencies.join(', ') })}
          </Alert>
        )}
        <ExchangeRatesEditor
          defaultCurrency={defaultCurrency}
          exchangeRates={exchangeRates}
          accountCurrencies={accountCurrencies}
          onSetRate={setExchangeRate}
          onDeleteRate={deleteExchangeRate}
        />
      </Box>

      <Dialog open={pendingCurrency !== null} onClose={() => (changing ? undefined : setPendingCurrency(null))}>
        <DialogTitle>{t('preferences.changeDialog.title')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            {t('preferences.changeDialog.body', {
              from: defaultCurrency,
              to: pendingCurrency ?? '',
              toName: pendingCurrency ? currencyDisplayName(pendingCurrency, localeTag) : '',
            })}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {pendingRateKnown
              ? t('preferences.changeDialog.rebase', { to: pendingCurrency ?? '' })
              : t('preferences.changeDialog.forget', { to: pendingCurrency ?? '' })}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            {t('preferences.changeDialog.plansNote')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingCurrency(null)} disabled={changing}>
            {t('preferences.changeDialog.cancel')}
          </Button>
          <Button variant="contained" onClick={() => void handleConfirmDefaultCurrency()} disabled={changing} data-testid="confirm-default-currency">
            {changing ? t('preferences.changeDialog.changing') : t('preferences.changeDialog.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
