'use client';

/**
 * ISO 4217 currency picker shared by the account form, the setup Preferences
 * step and the Settings Preferences tab. Lists SUPPORTED_CURRENCIES plus any
 * `extraCodes` already in use, each as "USD – US Dollar ($)" in the active
 * locale (the code stays first: tests and screen readers match on it).
 */

import React, { useMemo } from 'react';
import { FormControl, FormHelperText, InputLabel, MenuItem, Select, type SelectChangeEvent } from '@mui/material';

import { useOptionalLocale } from '@/contexts/LocaleContext';
import { currencyDisplayName, currencyOptions } from '@/lib/currencies';
import { currencyPickerSymbol, DEFAULT_LOCALE } from '@/lib/formatting';

export interface CurrencySelectProps {
  value: string;
  onChange: (code: string) => void;
  label: string;
  /** Codes to list even when they are not in SUPPORTED_CURRENCIES (e.g. the current value). */
  extraCodes?: Iterable<string>;
  disabled?: boolean;
  required?: boolean;
  fullWidth?: boolean;
  size?: 'small' | 'medium';
  margin?: 'none' | 'dense' | 'normal';
  helperText?: React.ReactNode;
  /** Applied to the Select's input for tests. */
  testId?: string;
  id?: string;
  sx?: React.ComponentProps<typeof FormControl>['sx'];
}

export function CurrencySelect({
  value,
  onChange,
  label,
  extraCodes,
  disabled = false,
  required = false,
  fullWidth = true,
  size = 'medium',
  margin = 'none',
  helperText,
  testId,
  id = 'currency-select',
  sx,
}: CurrencySelectProps) {
  const locale = useOptionalLocale()?.locale ?? DEFAULT_LOCALE;
  const options = useMemo(
    () =>
      currencyOptions([...(extraCodes ?? []), value]).map((code) => {
        const name = currencyDisplayName(code, locale);
        const symbol = currencyPickerSymbol(code, locale);
        return {
          code,
          text: `${code}${name !== code ? ` – ${name}` : ''}${symbol ? ` (${symbol})` : ''}`,
        };
      }),
    [extraCodes, value, locale]
  );
  const labelId = `${id}-label`;

  return (
    <FormControl fullWidth={fullWidth} disabled={disabled} required={required} size={size} margin={margin} sx={sx}>
      <InputLabel id={labelId}>{label}</InputLabel>
      <Select
        labelId={labelId}
        id={id}
        label={label}
        value={value}
        onChange={(event: SelectChangeEvent) => onChange(event.target.value)}
        inputProps={testId ? { 'data-testid': testId } : undefined}
        MenuProps={{ PaperProps: { sx: { maxHeight: 360 } } }}
      >
        {options.map((option) => (
          <MenuItem key={option.code} value={option.code} data-testid={testId ? `${testId}-option-${option.code}` : undefined}>
            {option.text}
          </MenuItem>
        ))}
      </Select>
      {helperText ? <FormHelperText>{helperText}</FormHelperText> : null}
    </FormControl>
  );
}

export default CurrencySelect;
