'use client';

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Person as PersonIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';
import { Account, AccountCard, User } from '@/types/database';
import { AccountListItem } from './AccountListItem';

interface UserAccountsAccordionProps {
  user: User;
  ownedAccounts: Account[];
  cardholderAccounts: Account[];
  accountCardsByAccountId: Record<number, AccountCard[]>;
  users: User[];
  onEditUser: (user: User) => void;
  onDeleteUser: (user: User) => void;
  onAddAccount: (userId: number) => void;
  onEditAccount: (account: Account) => void;
  onManageCards: (account: Account) => void;
  onDeleteAccount: (account: Account) => void;
}

export function UserAccountsAccordion({
  user,
  ownedAccounts,
  cardholderAccounts,
  accountCardsByAccountId,
  users,
  onEditUser,
  onDeleteUser,
  onAddAccount,
  onEditAccount,
  onManageCards,
  onDeleteAccount,
}: UserAccountsAccordionProps) {
  return (
    <Accordion sx={{ mb: 1, '&.Mui-expanded': { bgcolor: 'action.hover' } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', pr: 2 }}>
          <PersonIcon sx={{ mr: 2, color: 'primary.main' }} />
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="subtitle1" fontWeight="medium">
              {user.display_name}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Chip
                label={`${ownedAccounts.length} owned • ${cardholderAccounts.length} cardholder`}
                size="small"
                variant="outlined"
              />
              {user.is_primary === 1 && <Chip label="Primary" size="small" color="primary" />}
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5 }} onClick={(e) => e.stopPropagation()}>
            <IconButton component="div" onClick={() => onEditUser(user)} size="small" title="Edit User">
              <EditIcon />
            </IconButton>
            <Tooltip title={user.is_primary === 1 ? 'The primary user cannot be deleted' : 'Delete User'}>
              <span>
                <IconButton
                  component="div"
                  onClick={() => onDeleteUser(user)}
                  color="error"
                  size="small"
                  disabled={user.is_primary === 1}
                  title="Delete User"
                >
                  <DeleteIcon />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="subtitle2">Owned Accounts</Typography>
          <Button size="small" startIcon={<AddIcon />} onClick={() => onAddAccount(user.id)}>
            Add Account
          </Button>
        </Box>
        {ownedAccounts.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            No owned accounts.
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {ownedAccounts.map((account) => (
              <AccountListItem
                key={account.id}
                account={account}
                cards={accountCardsByAccountId[account.id] ?? []}
                users={users}
                readOnly={false}
                onEditAccount={onEditAccount}
                onManageCards={onManageCards}
                onDeleteAccount={onDeleteAccount}
              />
            ))}
          </Box>
        )}

        <Box sx={{ mt: 3, mb: 1 }}>
          <Typography variant="subtitle2">Cardholder Accounts (Read-only)</Typography>
        </Box>
        {cardholderAccounts.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            Not a cardholder on any accounts.
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {cardholderAccounts.map((account) => (
              <AccountListItem
                key={account.id}
                account={account}
                cards={accountCardsByAccountId[account.id] ?? []}
                users={users}
                readOnly
                currentUserId={user.id}
              />
            ))}
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  );
}
