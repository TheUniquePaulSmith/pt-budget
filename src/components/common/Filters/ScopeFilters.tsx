'use client';

/**
 * Account/user scope shared by the report pages (Dashboard, Subscriptions).
 * The selection lives in the shell (`ScopeFiltersProvider` in AppShell), so it
 * carries over when the user moves between those pages. Each page shows it as
 * a section of its Filter panel (`ScopeFilterSection`) and, while active, as
 * removable chips in the status bar (`ScopeFilterChips`).
 */

import React, { createContext, useContext, useMemo, useState } from 'react';
import { Chip, FormControl, InputLabel, MenuItem, Select, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { PageActions } from '@/components/common/Layout/slots/PageActionsSlot';
import type { Account, TransactionScopeFilters, User } from '@/types/database';

interface ScopeFiltersValue {
  scopeFilters: TransactionScopeFilters;
  setScopeFilters: (filters: TransactionScopeFilters) => void;
}

const ScopeFiltersContext = createContext<ScopeFiltersValue | null>(null);

export function ScopeFiltersProvider({ children }: { children: React.ReactNode }) {
  const [scopeFilters, setScopeFilters] = useState<TransactionScopeFilters>({});
  const value = useMemo(() => ({ scopeFilters, setScopeFilters }), [scopeFilters]);
  return <ScopeFiltersContext.Provider value={value}>{children}</ScopeFiltersContext.Provider>;
}

/** The shared selection; a page rendered outside the shell keeps its own. */
export function useScopeFilters(): ScopeFiltersValue {
  const shared = useContext(ScopeFiltersContext);
  const [scopeFilters, setScopeFilters] = useState<TransactionScopeFilters>({});
  return shared ?? { scopeFilters, setScopeFilters };
}

/** Account or user filters are set. */
export function hasActiveScopeFilters(scopeFilters: TransactionScopeFilters): boolean {
  return Boolean(scopeFilters.accountIds?.length || scopeFilters.userIds?.length);
}

interface ScopeFilterSectionProps {
  accounts: Account[];
  users: User[];
  scopeFilters: TransactionScopeFilters;
  onChange: (filters: TransactionScopeFilters) => void;
}

/** The "Accounts and users" section of a Filter panel. */
export function ScopeFilterSection({ accounts, users, scopeFilters, onChange }: ScopeFilterSectionProps) {
  const { t } = useTranslation('common');
  const renderSelectedCount = (selected: number[]) =>
    selected.length === 0 ? t('fields.all') : t('scopeFilter.selectedCount', { count: selected.length });

  return (
    <>
      <Typography variant="overline" color="text.secondary" component="h3" sx={{ display: 'block', mt: 2.5 }}>
        {t('scopeFilter.heading')}
      </Typography>
      <Stack spacing={2} sx={{ mt: 1 }}>
        <FormControl size="small" fullWidth>
          <InputLabel id="scope-filter-accounts-label" shrink>{t('scopeFilter.accounts')}</InputLabel>
          <Select
            multiple
            notched
            labelId="scope-filter-accounts-label"
            value={scopeFilters.accountIds ?? []}
            label={t('scopeFilter.accounts')}
            onChange={(event) => onChange({ ...scopeFilters, accountIds: event.target.value as number[] })}
            renderValue={renderSelectedCount}
            displayEmpty
          >
            {accounts.map((account) => (
              <MenuItem key={account.id} value={account.id}>{account.name}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" fullWidth>
          <InputLabel id="scope-filter-users-label" shrink>{t('scopeFilter.users')}</InputLabel>
          <Select
            multiple
            notched
            labelId="scope-filter-users-label"
            value={scopeFilters.userIds ?? []}
            label={t('scopeFilter.users')}
            onChange={(event) => onChange({ ...scopeFilters, userIds: event.target.value as number[] })}
            renderValue={renderSelectedCount}
            displayEmpty
          >
            {users.map((user) => (
              <MenuItem key={user.id} value={user.id}>{user.display_name}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>
    </>
  );
}

/** Active account/user filters as removable chips in the status bar footer. */
export function ScopeFilterChips({
  scopeFilters,
  onChange,
}: {
  scopeFilters: TransactionScopeFilters;
  onChange: (filters: TransactionScopeFilters) => void;
}) {
  const { t } = useTranslation('common');
  const accountCount = scopeFilters.accountIds?.length ?? 0;
  const userCount = scopeFilters.userIds?.length ?? 0;
  if (accountCount === 0 && userCount === 0) return null;

  return (
    <PageActions slot="statusBar">
      <Stack direction="row" spacing={1} sx={{ minWidth: 0, overflow: 'hidden' }} data-testid="scope-filter-chips">
        {accountCount > 0 && (
          <Chip
            size="small"
            label={t('scopeFilter.accountsChip', { count: accountCount })}
            onDelete={() => onChange({ ...scopeFilters, accountIds: [] })}
          />
        )}
        {userCount > 0 && (
          <Chip
            size="small"
            label={t('scopeFilter.usersChip', { count: userCount })}
            onDelete={() => onChange({ ...scopeFilters, userIds: [] })}
          />
        )}
      </Stack>
    </PageActions>
  );
}
