'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';
import { Add as AddIcon, Person as PersonIcon } from '@mui/icons-material';
import { useAccountManagementSlice } from '@/contexts/useDatabaseSlices';
import { Account, AccountCard, User } from '@/types/database';
import { UserAccountsAccordion } from './UserAccountsAccordion';
import { AccountFormDialog } from './AccountFormDialog';
import { UserFormDialog } from './UserFormDialog';
import { ManageCardsDialog } from './ManageCardsDialog';
import { DeleteConfirmDialog, type DeleteTargetType } from './DeleteConfirmDialog';

type DeleteTarget =
  | { type: 'user'; item: User }
  | { type: 'account'; item: Account }
  | { type: 'card'; item: AccountCard };

export default function ManageAccounts() {
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

  const [accountCardsByAccountId, setAccountCardsByAccountId] = useState<Record<number, AccountCard[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [userDisplayName, setUserDisplayName] = useState('');

  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [addAccountDefaultOwnerId, setAddAccountDefaultOwnerId] = useState<number | null>(null);

  const [cardDialogOpen, setCardDialogOpen] = useState(false);
  const [selectedAccountForCardManagement, setSelectedAccountForCardManagement] = useState<Account | null>(null);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<DeleteTarget | null>(null);

  // Preload all account cards (needed for cardholder-account detection and
  // the inline card chips on every account row).
  useEffect(() => {
    if (accounts.length === 0) return;
    let cancelled = false;

    (async () => {
      const entries = await Promise.all(
        accounts.map(async (account) => {
          try {
            const cards = await getAccountCards(account.id);
            return [account.id, cards] as const;
          } catch (err) {
            console.error(`Failed to load cards for account ${account.id}:`, err);
            return [account.id, []] as const;
          }
        })
      );
      if (!cancelled) {
        setAccountCardsByAccountId(Object.fromEntries(entries));
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.length]);

  const refreshAccountCardsFor = async (accountId: number) => {
    const cards = await getAccountCards(accountId);
    setAccountCardsByAccountId((prev) => ({ ...prev, [accountId]: cards }));
    return cards;
  };

  const getUserOwnedAccounts = (userId: number) =>
    accounts.filter((account) => account.owner_user_id === userId);

  const getUserCardholderAccounts = (userId: number) =>
    accounts.filter(
      (account) =>
        account.owner_user_id !== userId &&
        accountCardsByAccountId[account.id]?.some((c) => c.user_id === userId)
    );

  // --- User dialog ---

  const handleOpenUserDialog = (user?: User) => {
    setEditingUser(user ?? null);
    setUserDisplayName(user?.display_name ?? '');
    setError(null);
    setUserDialogOpen(true);
  };

  const handleCloseUserDialog = () => {
    setUserDialogOpen(false);
    setEditingUser(null);
    setUserDisplayName('');
    setError(null);
  };

  const handleUserSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (!userDisplayName.trim()) {
        throw new Error('Display name is required');
      }
      if (editingUser) {
        await updateUser(editingUser.id, { display_name: userDisplayName });
      } else {
        await addUser({ display_name: userDisplayName });
      }
      handleCloseUserDialog();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save user');
    } finally {
      setLoading(false);
    }
  };

  // --- Account dialog (add + edit) ---

  const handleOpenAddAccountDialog = (defaultOwnerUserId?: number) => {
    setEditingAccount(null);
    setAddAccountDefaultOwnerId(defaultOwnerUserId ?? null);
    setAccountDialogOpen(true);
  };

  const handleOpenEditAccountDialog = (account: Account) => {
    setEditingAccount(account);
    setAccountDialogOpen(true);
  };

  const handleCloseAccountDialog = () => {
    setAccountDialogOpen(false);
    setEditingAccount(null);
    setAddAccountDefaultOwnerId(null);
  };

  const handleAddAccount = async (
    account: { name: string; type: Account['type']; ownership: NonNullable<Account['ownership']> },
    ownerUserId: number,
    card: { last_four: string; full_number: string | null; nickname: string | null; user_id: number | null }
  ) => {
    const result = await addAccountWithCard(
      account,
      ownerUserId,
      {
        last_four: card.last_four,
        full_number: card.full_number,
        nickname: card.nickname,
        user_id: card.user_id,
      }
    );
    await refreshAccountCardsFor(result.accountId);
    return result;
  };

  // --- Card management dialog ---

  const handleOpenCardDialog = async (account: Account) => {
    setSelectedAccountForCardManagement(account);
    await refreshAccountCardsFor(account.id);
    setCardDialogOpen(true);
  };

  const handleCloseCardDialog = () => {
    setCardDialogOpen(false);
    setSelectedAccountForCardManagement(null);
  };

  const handleCardsMutated = async () => {
    if (selectedAccountForCardManagement) {
      await refreshAccountCardsFor(selectedAccountForCardManagement.id);
    }
  };

  // --- Delete confirmation (shared across users/accounts/cards) ---

  const handleDeleteClick = (type: DeleteTargetType, item: User | Account | AccountCard) => {
    setItemToDelete({ type, item } as DeleteTarget);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!itemToDelete) return;
    setLoading(true);
    setError(null);
    try {
      if (itemToDelete.type === 'user') {
        await deleteUser(itemToDelete.item.id);
      } else if (itemToDelete.type === 'account') {
        await deleteAccount(itemToDelete.item.id);
        setAccountCardsByAccountId((prev) => {
          const next = { ...prev };
          delete next[itemToDelete.item.id];
          return next;
        });
      } else {
        const card = itemToDelete.item;
        await deleteAccountCard(card.id);
        await refreshAccountCardsFor(card.account_id);
      }
      setDeleteDialogOpen(false);
      setItemToDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to delete ${itemToDelete.type}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" component="h1" fontWeight="bold">
          Manage Users & Accounts
        </Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button variant="outlined" startIcon={<PersonIcon />} onClick={() => handleOpenUserDialog()}>
            Add User
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpenAddAccountDialog()}>
            Add Account
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Box>
        <Typography variant="h6" gutterBottom>Users and Their Accounts</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Each account has a single owner. Users may be cardholders on the owner&apos;s account.
        </Typography>

        {users.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
            No users found. Add your first user to get started.
          </Typography>
        ) : (
          users.map((user) => (
            <UserAccountsAccordion
              key={user.id}
              user={user}
              ownedAccounts={getUserOwnedAccounts(user.id)}
              cardholderAccounts={getUserCardholderAccounts(user.id)}
              accountCardsByAccountId={accountCardsByAccountId}
              users={users}
              onEditUser={handleOpenUserDialog}
              onDeleteUser={(u) => handleDeleteClick('user', u)}
              onAddAccount={(userId) => handleOpenAddAccountDialog(userId)}
              onEditAccount={handleOpenEditAccountDialog}
              onManageCards={handleOpenCardDialog}
              onDeleteAccount={(account) => handleDeleteClick('account', account)}
            />
          ))
        )}
      </Box>

      <UserFormDialog
        open={userDialogOpen}
        editing={Boolean(editingUser)}
        displayName={userDisplayName}
        loading={loading}
        onDisplayNameChange={setUserDisplayName}
        onClose={handleCloseUserDialog}
        onSubmit={handleUserSubmit}
      />

      <AccountFormDialog
        open={accountDialogOpen}
        editingAccount={editingAccount}
        defaultOwnerUserId={addAccountDefaultOwnerId}
        users={users}
        onClose={handleCloseAccountDialog}
        onAdd={handleAddAccount}
        onUpdate={updateAccount}
      />

      <ManageCardsDialog
        open={cardDialogOpen}
        account={selectedAccountForCardManagement}
        cards={selectedAccountForCardManagement ? accountCardsByAccountId[selectedAccountForCardManagement.id] ?? [] : []}
        users={users}
        onClose={handleCloseCardDialog}
        addAccountCard={addAccountCard}
        updateAccountCard={updateAccountCard}
        onMutated={handleCardsMutated}
        onRequestDeleteCard={(card) => handleDeleteClick('card', card)}
      />

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        targetType={itemToDelete?.type ?? null}
        loading={loading}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleDeleteConfirm}
      />
    </Box>
  );
}
