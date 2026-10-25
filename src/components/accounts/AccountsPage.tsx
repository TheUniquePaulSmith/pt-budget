'use client';

/**
 * Accounts page: a master/detail ledger. The grid (or list on phones) on the
 * left, the selected account's form with its Cards sub-grid on the right and
 * a People panel beside it. "Add Account" opens the unchanged dialog.
 */

import React, { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Alert, Box, Button, Typography, useMediaQuery, useTheme } from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';

import { MasterDetailLayout } from '@/components/common/Form';
import { APP_BAR_HEIGHT, STATUS_BAR_HEIGHT } from '@/components/common/Layout/sidebarPreference';
import { useAccountManagementSlice } from '@/contexts/useDatabaseSlices';
import { logger } from '@/lib/logging';
import type { Account, AccountCard, User } from '@/types/database';
import { AccountFormDialog, type AccountFormValues } from './AccountFormDialog';
import { UserFormDialog } from './UserFormDialog';
import { DeleteConfirmDialog, type DeleteTargetType } from './DeleteConfirmDialog';
import AccountsGrid from './AccountsGrid';
import AccountDetailForm from './AccountDetailForm';
import PeoplePanel from './PeoplePanel';
import type { AccountCardInput } from './accountFormModel';

const log = logger.child({ component: 'AccountsPage' });

const MASTER_WIDTH_STORAGE_KEY = 'budgetTracker_accountsMasterWidth';

type DeleteTarget =
  | { type: 'user'; item: User }
  | { type: 'account'; item: Account }
  | { type: 'card'; item: AccountCard };

export default function AccountsPage() {
  const {
    accounts,
    users,
    addAccountWithCard,
    deleteAccount,
    updateAccount,
    addUser,
    updateUser,
    deleteUser,
    getAccountCards,
    addAccountCard,
    deleteAccountCard,
    updateAccountCard,
  } = useAccountManagementSlice();

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [cardsByAccountId, setCardsByAccountId] = useState<Record<number, AccountCard[]>>({});
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [userDisplayName, setUserDisplayName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const sortedAccounts = useMemo(
    () => [...accounts].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [accounts]
  );
  const accountIdsKey = accounts.map((account) => account.id).join(',');

  // Preload every account's cards: the grid shows them as chips and the
  // People panel counts cardholder accounts from them.
  useEffect(() => {
    if (accounts.length === 0) {
      setCardsByAccountId({});
      return;
    }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        accounts.map(async (account) => {
          try {
            return [account.id, await getAccountCards(account.id)] as const;
          } catch (err) {
            log.warn('Failed to load cards for account', { operation: 'loadCards', accountId: account.id, error: err });
            return [account.id, [] as AccountCard[]] as const;
          }
        })
      );
      if (!cancelled) {
        setCardsByAccountId(Object.fromEntries(entries));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountIdsKey]);

  // Keep the selection valid; on desktop default to the first account so the
  // form is never empty.
  useEffect(() => {
    if (selectedAccountId != null && !accounts.some((account) => account.id === selectedAccountId)) {
      setSelectedAccountId(null);
      return;
    }
    if (selectedAccountId == null && !isMobile && sortedAccounts.length > 0) {
      setSelectedAccountId(sortedAccounts[0].id);
    }
  }, [accounts, isMobile, selectedAccountId, sortedAccounts]);

  const selectedAccount = selectedAccountId == null ? null : accounts.find((account) => account.id === selectedAccountId) ?? null;

  const refreshCardsFor = useCallback(
    async (accountId: number) => {
      const cards = await getAccountCards(accountId);
      setCardsByAccountId((previous) => ({ ...previous, [accountId]: cards }));
      return cards;
    },
    [getAccountCards]
  );

  // --- Account ---

  const handleSaveAccount = async (accountId: number, values: AccountFormValues) => {
    await updateAccount(accountId, values);
  };

  const handleAddAccount = async (values: AccountFormValues, ownerUserId: number, card: AccountCardInput) => {
    const result = await addAccountWithCard(values, ownerUserId, card);
    await refreshCardsFor(result.accountId);
    setSelectedAccountId(result.accountId);
    return result;
  };

  // --- Cards ---

  const handleAddCard = async (card: AccountCardInput) => {
    if (!selectedAccount) return;
    await addAccountCard({
      account_id: selectedAccount.id,
      last_four: card.last_four,
      full_number: card.full_number,
      nickname: card.nickname ?? undefined,
      user_id: card.user_id ?? undefined,
    });
    await refreshCardsFor(selectedAccount.id);
  };

  const handleUpdateCard = async (card: AccountCard, updates: AccountCardInput) => {
    await updateAccountCard(card.id, updates);
    await refreshCardsFor(card.account_id);
  };

  // --- People ---

  const openUserDialog = (user?: User) => {
    setEditingUser(user ?? null);
    setUserDisplayName(user?.display_name ?? '');
    setError(null);
    setUserDialogOpen(true);
  };

  const closeUserDialog = () => {
    setUserDialogOpen(false);
    setEditingUser(null);
    setUserDisplayName('');
  };

  const handleUserSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!userDisplayName.trim()) {
        throw new Error('Display name is required');
      }
      if (editingUser) {
        await updateUser(editingUser.id, { display_name: userDisplayName.trim() });
      } else {
        await addUser({ display_name: userDisplayName.trim() });
      }
      closeUserDialog();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save user');
    } finally {
      setBusy(false);
    }
  };

  // --- Delete (shared) ---

  const requestDelete = (type: DeleteTargetType, item: User | Account | AccountCard) => {
    setDeleteTarget({ type, item } as DeleteTarget);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    setError(null);
    try {
      if (deleteTarget.type === 'user') {
        await deleteUser(deleteTarget.item.id);
      } else if (deleteTarget.type === 'account') {
        await deleteAccount(deleteTarget.item.id);
        setCardsByAccountId((previous) => {
          const next = { ...previous };
          delete next[deleteTarget.item.id];
          return next;
        });
        if (selectedAccountId === deleteTarget.item.id) {
          setSelectedAccountId(null);
        }
      } else {
        await deleteAccountCard(deleteTarget.item.id);
        await refreshCardsFor(deleteTarget.item.account_id);
      }
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to delete ${deleteTarget.type}`);
    } finally {
      setBusy(false);
    }
  };

  const detail = selectedAccount ? (
    <AccountDetailForm
      key={selectedAccount.id}
      account={selectedAccount}
      users={users}
      cards={cardsByAccountId[selectedAccount.id] ?? []}
      onSave={handleSaveAccount}
      onRequestDelete={(account) => requestDelete('account', account)}
      onAddCard={handleAddCard}
      onUpdateCard={handleUpdateCard}
      onRequestDeleteCard={(card) => requestDelete('card', card)}
    />
  ) : null;

  // Page padding + toolbar row, subtracted from the viewport so the split fills the page.
  const layoutHeight = `calc(100vh - ${APP_BAR_HEIGHT + STATUS_BAR_HEIGHT + 8 + 2 * 16 + 44}px)`;

  return (
    <Box sx={{ p: { xs: 1.5, md: 2 }, display: 'flex', flexDirection: 'column', gap: 1.5 }} data-testid="accounts-page">
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, minHeight: 36 }}>
        <Typography variant="body2" color="text.secondary" data-testid="accounts-summary">
          {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'} • {users.length} {users.length === 1 ? 'person' : 'people'}
        </Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={<AddIcon />}
          onClick={() => setAccountDialogOpen(true)}
          data-testid="add-account-button"
        >
          Add Account
        </Button>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <MasterDetailLayout
        data-testid="accounts-master-detail"
        height={layoutHeight}
        storageKey={MASTER_WIDTH_STORAGE_KEY}
        initialMasterWidth={520}
        detailOpen={selectedAccountId != null}
        onCloseDetail={() => setSelectedAccountId(null)}
        detailTitle={selectedAccount?.name}
        master={
          <AccountsGrid
            accounts={sortedAccounts}
            users={users}
            cardsByAccountId={cardsByAccountId}
            selectedAccountId={selectedAccountId}
            onSelect={setSelectedAccountId}
            variant={isMobile ? 'list' : 'grid'}
          />
        }
        detail={detail}
        emptyDetail={
          <Typography variant="body2" color="text.secondary">
            {accounts.length === 0 ? 'Add an account to get started.' : 'Select an account to edit it.'}
          </Typography>
        }
        aside={
          <PeoplePanel
            users={users}
            accounts={accounts}
            cardsByAccountId={cardsByAccountId}
            onAddUser={() => openUserDialog()}
            onRenameUser={(user) => openUserDialog(user)}
            onDeleteUser={(user) => requestDelete('user', user)}
          />
        }
      />

      <AccountFormDialog
        open={accountDialogOpen}
        editingAccount={null}
        defaultOwnerUserId={users.find((user) => user.is_primary === 1)?.id ?? users[0]?.id ?? null}
        users={users}
        onClose={() => setAccountDialogOpen(false)}
        onAdd={handleAddAccount}
        onUpdate={updateAccount}
      />

      <UserFormDialog
        open={userDialogOpen}
        editing={Boolean(editingUser)}
        displayName={userDisplayName}
        loading={busy}
        onDisplayNameChange={setUserDisplayName}
        onClose={closeUserDialog}
        onSubmit={(event) => void handleUserSubmit(event)}
      />

      <DeleteConfirmDialog
        open={deleteTarget != null}
        targetType={deleteTarget?.type ?? null}
        loading={busy}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void handleDeleteConfirm()}
      />
    </Box>
  );
}
