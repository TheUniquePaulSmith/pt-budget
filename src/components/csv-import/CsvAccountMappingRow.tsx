'use client';

import React from 'react';
import {
  Alert,
  Box,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from '@mui/material';

import type { Account } from '@/types/database';
import type { CSVAccountMatch } from '@/lib/csvImportService';

/** Select values for the two non-account choices. */
export const CSV_ACCOUNT_SKIP_VALUE = 'SKIP';
export const CSV_ACCOUNT_CREATE_VALUE = 'CREATE_NEW';

export interface CsvAccountMappingRowProps {
  /** Position in the mapping list; used for stable test ids. */
  index: number;
  match: CSVAccountMatch;
  /** Every account the user has, so an unmatched value can still be linked by hand. */
  accounts: Account[];
  /** Number of CSV rows carrying this account value. */
  rowCount: number;
  onSelectAccount: (accountId: number) => void;
  onSkip: () => void;
  /** The user moved off an account without picking another one (e.g. back to "Create…"). */
  onUnresolve: () => void;
  onCreate: () => void;
}

function accountLabel(account: Account): string {
  const owner = account.owner_display_name ? `${account.owner_display_name} - ` : '';
  const institution = account.institution ? ` · ${account.institution}` : '';
  return `${owner}${account.name} (${account.type})${institution}`;
}

/**
 * One CSV account value → account decision. Card-number matches come first and
 * are flagged; text hints are flagged but never pre-selected; every other
 * account follows, then "Skip this account" and "Create new account…".
 */
export default function CsvAccountMappingRow({
  index,
  match,
  accounts,
  rowCount,
  onSelectAccount,
  onSkip,
  onUnresolve,
  onCreate,
}: CsvAccountMappingRowProps) {
  const matchedIds = new Set(match.matchingAccounts.map((account) => account.id));
  const hintedIds = new Set(match.hintedAccounts.map((account) => account.id));
  const others = accounts.filter((account) => !matchedIds.has(account.id) && !hintedIds.has(account.id));
  const ordered: Array<{ account: Account; flag: 'matched' | 'hinted' | null }> = [
    ...match.matchingAccounts.map((account) => ({ account, flag: 'matched' as const })),
    ...match.hintedAccounts.map((account) => ({ account, flag: 'hinted' as const })),
    ...others.map((account) => ({ account, flag: null })),
  ];

  const selectValue: number | string = match.selectedAccountId
    ?? (match.skipped ? CSV_ACCOUNT_SKIP_VALUE : CSV_ACCOUNT_CREATE_VALUE);
  const unresolved = !match.selectedAccountId && !match.skipped;
  const labelId = `csv-account-mapping-${index}-label`;

  const handleChange = (value: number | string) => {
    if (value === CSV_ACCOUNT_SKIP_VALUE) {
      onSkip();
      return;
    }
    if (value === CSV_ACCOUNT_CREATE_VALUE) {
      // The dialog itself opens from the item's onClick (which also fires when
      // the value is unchanged); here we only record that nothing is linked.
      onUnresolve();
      return;
    }
    onSelectAccount(Number(value));
  };

  return (
    <Box
      sx={{ mb: 2, p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}
      data-testid={`csv-account-mapping-${index}`}
    >
      <Box sx={{ mb: 1, fontWeight: 'medium', display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="body1" component="span">
          CSV Account:
        </Typography>
        <Chip label={match.csvAccountValue} size="small" />
        <Typography variant="caption" color="text.secondary" component="span">
          {rowCount} row{rowCount === 1 ? '' : 's'}
        </Typography>
      </Box>

      <FormControl fullWidth>
        <InputLabel id={labelId}>Account for {match.csvAccountValue}</InputLabel>
        <Select
          labelId={labelId}
          value={selectValue}
          label={`Account for ${match.csvAccountValue}`}
          onChange={(e) => handleChange(e.target.value as number | string)}
          SelectDisplayProps={{ 'data-testid': `csv-account-mapping-${index}-select` } as React.HTMLAttributes<HTMLDivElement>}
        >
          {ordered.map(({ account, flag }) => (
            <MenuItem key={account.id} value={account.id}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                <span>{accountLabel(account)}</span>
                {flag === 'matched' && (
                  <Chip label={`Matches ••${match.lastFourValue || '????'}`} size="small" color="success" variant="outlined" />
                )}
                {flag === 'hinted' && (
                  <Chip label="Name matches" size="small" color="info" variant="outlined" />
                )}
              </Box>
            </MenuItem>
          ))}
          <MenuItem disabled sx={{ opacity: 0.6, fontWeight: 'bold' }}>
            ──────────────
          </MenuItem>
          <MenuItem value={CSV_ACCOUNT_SKIP_VALUE}>Skip this account</MenuItem>
          <MenuItem value={CSV_ACCOUNT_CREATE_VALUE} onClick={onCreate} sx={{ fontStyle: 'italic' }}>
            Create new account…
          </MenuItem>
        </Select>
      </FormControl>

      {unresolved && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          {match.matchingAccounts.length > 1
            ? 'Several accounts share these last 4 digits; pick the right one.'
            : 'No account in the app has this card number. Choose "Create new account…" to add it, pick an existing account, or skip it.'}
          {' '}Until then its {rowCount} row{rowCount === 1 ? '' : 's'} cannot be imported.
        </Alert>
      )}
      {match.skipped && (
        <Alert severity="info" sx={{ mt: 1 }}>
          {rowCount} row{rowCount === 1 ? '' : 's'} for this account will be skipped.
        </Alert>
      )}
    </Box>
  );
}
