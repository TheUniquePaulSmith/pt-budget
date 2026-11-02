'use client';

/**
 * Dashboard notice shown while any active account uses a currency with no
 * exchange rate into the default currency: those accounts drop out of every
 * total until a rate is entered in Settings → Preferences.
 */

import { Alert, Button } from '@mui/material';
import { useTranslation } from 'react-i18next';

import { useCurrencyPreferencesSlice } from '@/contexts/useDatabaseSlices';

interface MissingRatesNoticeProps {
  onOpenPreferences?: () => void;
}

export default function MissingRatesNotice({ onOpenPreferences }: MissingRatesNoticeProps) {
  const { t } = useTranslation('dashboard');
  const { defaultCurrency, missingRateCurrencies } = useCurrencyPreferencesSlice();

  if (missingRateCurrencies.length === 0) return null;

  return (
    <Alert
      severity="warning"
      sx={{ mb: 2 }}
      data-testid="missing-rates-notice"
      action={
        onOpenPreferences ? (
          <Button color="inherit" size="small" onClick={onOpenPreferences} data-testid="missing-rates-open-settings">
            {t('missingRates.action')}
          </Button>
        ) : undefined
      }
    >
      {t('missingRates.message', {
        count: missingRateCurrencies.length,
        currencies: missingRateCurrencies.join(', '),
        defaultCurrency,
      })}
    </Alert>
  );
}
