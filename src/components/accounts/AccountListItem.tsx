'use client';

import { Box, IconButton, Typography } from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  AccountBalance as AccountIcon,
  CreditCard as CreditCardIcon,
} from '@mui/icons-material';
import { Account, AccountCard, User } from '@/types/database';
import { AccountCardChips } from './AccountCardChips';

interface AccountListItemProps {
  account: Account;
  cards: AccountCard[];
  users: User[];
  readOnly: boolean;
  currentUserId?: number;
  onEditAccount?: (account: Account) => void;
  onManageCards?: (account: Account) => void;
  onDeleteAccount?: (account: Account) => void;
}

export function AccountListItem({
  account,
  cards,
  users,
  readOnly,
  currentUserId,
  onEditAccount,
  onManageCards,
  onDeleteAccount,
}: AccountListItemProps) {
  const typeLabel = account.type.charAt(0).toUpperCase() + account.type.slice(1);
  const visibleCards = readOnly ? cards.filter((c) => c.user_id === currentUserId) : cards;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          bgcolor: 'background.paper',
          p: 2,
          borderRadius: 1,
          border: 1,
          borderColor: 'divider',
        }}
      >
        <AccountIcon sx={{ color: readOnly ? 'text.secondary' : 'primary.main' }} />
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="subtitle2" fontWeight="medium">
            {account.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {typeLabel}
            {readOnly && account.owner_display_name && ` • Owner: ${account.owner_display_name}`}
          </Typography>
        </Box>
        {!readOnly && (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <IconButton onClick={() => onEditAccount?.(account)} size="small" title="Edit Account">
              <EditIcon />
            </IconButton>
            <IconButton onClick={() => onManageCards?.(account)} size="small" title="Manage Cards">
              <CreditCardIcon />
            </IconButton>
            <IconButton onClick={() => onDeleteAccount?.(account)} size="small" color="error" title="Delete Account">
              <DeleteIcon />
            </IconButton>
          </Box>
        )}
      </Box>
      <Box sx={{ bgcolor: 'action.hover', px: 2, py: 1.5, borderRadius: 1 }}>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', fontWeight: 'medium' }}>
          {readOnly ? 'Your cards on this account:' : 'Cards on this account:'}
        </Typography>
        <AccountCardChips
          cards={visibleCards}
          users={users}
          showCardholder={!readOnly}
          emptyMessage={readOnly ? 'No cards assigned to you on this account.' : 'No cards added.'}
        />
      </Box>
    </Box>
  );
}
