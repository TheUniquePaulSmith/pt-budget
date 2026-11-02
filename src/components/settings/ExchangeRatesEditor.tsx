'use client';

/**
 * The manual exchange-rate table: one row per currency in use (by an account
 * or an existing rate row) except the default, each "1 EUR = [ 1.08 ] USD",
 * plus "Add currency" for a rate entered ahead of its first account.
 */

import React, { useMemo, useState } from 'react';
import { Delete as DeleteIcon, Save as SaveIcon } from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

import CurrencySelect from '@/components/common/CurrencySelect';
import { useFormatters } from '@/contexts/useFormatters';
import { currencyDisplayName, currencyOptions } from '@/lib/currencies';
import type { ExchangeRate } from '@/types/database';

export interface ExchangeRatesEditorProps {
  defaultCurrency: string;
  exchangeRates: ExchangeRate[];
  accountCurrencies: string[];
  onSetRate: (currency: string, rate: number | null) => Promise<void>;
  onDeleteRate: (currency: string) => Promise<void>;
}

function parseRateInput(raw: string): number | null | 'invalid' {
  const trimmed = raw.trim().replace(',', '.');
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : 'invalid';
}

export default function ExchangeRatesEditor({
  defaultCurrency,
  exchangeRates,
  accountCurrencies,
  onSetRate,
  onDeleteRate,
}: ExchangeRatesEditorProps) {
  const { t } = useTranslation('settings');
  const { locale, dateTime } = useFormatters();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newCurrency, setNewCurrency] = useState<string>('');

  const rows = useMemo(() => {
    const byCurrency = new Map(exchangeRates.map((rate) => [rate.currency, rate]));
    const codes = new Set<string>([...accountCurrencies, ...exchangeRates.map((rate) => rate.currency)]);
    codes.delete(defaultCurrency);
    return [...codes].sort().map((currency) => ({
      currency,
      rate: byCurrency.get(currency)?.rate ?? null,
      updatedAt: byCurrency.get(currency)?.updated_at ?? null,
      inUse: accountCurrencies.includes(currency),
    }));
  }, [exchangeRates, accountCurrencies, defaultCurrency]);

  const addableCodes = useMemo(() => {
    const listed = new Set(rows.map((row) => row.currency));
    listed.add(defaultCurrency);
    return currencyOptions().filter((code) => !listed.has(code));
  }, [rows, defaultCurrency]);

  const draftFor = (currency: string, rate: number | null) =>
    drafts[currency] ?? (rate === null ? '' : String(rate));

  const handleSave = async (currency: string, current: number | null) => {
    const parsed = parseRateInput(draftFor(currency, current));
    if (parsed === 'invalid') {
      setError(t('preferences.rateInvalid'));
      return;
    }
    setBusy(currency);
    setError(null);
    try {
      await onSetRate(currency, parsed);
      setDrafts((previous) => {
        const next = { ...previous };
        delete next[currency];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('preferences.rateSaveFailed'));
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (currency: string) => {
    setBusy(currency);
    setError(null);
    try {
      await onDeleteRate(currency);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('preferences.rateSaveFailed'));
    } finally {
      setBusy(null);
    }
  };

  const handleAdd = async () => {
    if (!newCurrency) return;
    setBusy(newCurrency);
    setError(null);
    try {
      await onSetRate(newCurrency, null);
      setNewCurrency('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('preferences.rateSaveFailed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Stack spacing={2}>
      {error && <Alert severity="error">{error}</Alert>}

      {rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary" data-testid="exchange-rates-empty">
          {t('preferences.ratesEmpty', { defaultCurrency })}
        </Typography>
      ) : (
        <Table size="small" data-testid="exchange-rates-table">
          <TableHead>
            <TableRow>
              <TableCell>{t('preferences.ratesColumns.currency')}</TableCell>
              <TableCell>{t('preferences.ratesColumns.rate')}</TableCell>
              <TableCell>{t('preferences.ratesColumns.updated')}</TableCell>
              <TableCell align="right">{t('preferences.ratesColumns.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const dirty = drafts[row.currency] !== undefined && drafts[row.currency] !== (row.rate === null ? '' : String(row.rate));
              return (
                <TableRow key={row.currency} data-testid={`exchange-rate-${row.currency}`}>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {row.currency}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {currencyDisplayName(row.currency, locale)}
                      {row.inUse ? ` · ${t('preferences.ratesInUse')}` : ''}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2" noWrap>
                        1 {row.currency} =
                      </Typography>
                      <TextField
                        size="small"
                        type="number"
                        value={draftFor(row.currency, row.rate)}
                        onChange={(event) => setDrafts((previous) => ({ ...previous, [row.currency]: event.target.value }))}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void handleSave(row.currency, row.rate);
                        }}
                        inputProps={{ step: 0.0001, min: 0, 'data-testid': `exchange-rate-input-${row.currency}`, 'aria-label': t('preferences.rateInputLabel', { currency: row.currency, defaultCurrency }) }}
                        placeholder={t('preferences.rateUnknown')}
                        sx={{ width: 140 }}
                        disabled={busy === row.currency}
                        error={row.rate === null && !dirty}
                      />
                      <Typography variant="body2" noWrap>
                        {defaultCurrency}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {row.rate === null ? t('preferences.rateUnknown') : row.updatedAt ? dateTime(row.updatedAt) : ''}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title={t('preferences.rateSave')}>
                      <span>
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => void handleSave(row.currency, row.rate)}
                          disabled={busy === row.currency || !dirty}
                          aria-label={t('preferences.rateSaveFor', { currency: row.currency })}
                          data-testid={`exchange-rate-save-${row.currency}`}
                        >
                          <SaveIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    {!row.inUse && (
                      <Tooltip title={t('preferences.rateRemove')}>
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => void handleDelete(row.currency)}
                            disabled={busy === row.currency}
                            aria-label={t('preferences.rateRemoveFor', { currency: row.currency })}
                            data-testid={`exchange-rate-delete-${row.currency}`}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
        <CurrencySelect
          id="exchange-rate-add-currency"
          label={t('preferences.ratesAddLabel')}
          value={newCurrency}
          onChange={setNewCurrency}
          extraCodes={addableCodes}
          fullWidth={false}
          size="small"
          sx={{ minWidth: 240 }}
          testId="exchange-rate-add-currency"
        />
        <Button variant="outlined" onClick={() => void handleAdd()} disabled={!newCurrency || busy !== null} data-testid="exchange-rate-add">
          {t('preferences.ratesAdd')}
        </Button>
      </Box>
    </Stack>
  );
}
