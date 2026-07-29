'use client';

import { Box, Typography } from '@mui/material';
import { CreditCard as CreditCardIcon } from '@mui/icons-material';
import { AccountCard, User } from '@/types/database';

interface AccountCardChipsProps {
  cards: AccountCard[];
  users: User[];
  emptyMessage: string;
  showCardholder?: boolean;
}

export function AccountCardChips({
  cards,
  users,
  emptyMessage,
  showCardholder = true,
}: AccountCardChipsProps) {
  if (cards.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
        {emptyMessage}
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
      {cards.map((card) => (
        <Box
          key={card.id}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            bgcolor: 'background.paper',
            px: 2,
            py: 1,
            borderRadius: 1,
          }}
        >
          <CreditCardIcon sx={{ fontSize: 16, color: 'primary.main' }} />
          <Typography variant="body2">****{card.last_four}</Typography>
          {card.nickname && (
            <Typography variant="body2" color="text.secondary">
              ({card.nickname})
            </Typography>
          )}
          {showCardholder && card.user_id && (
            <Typography variant="body2" color="text.secondary">
              • {users.find((u) => u.id === card.user_id)?.display_name || 'Unknown User'}
            </Typography>
          )}
        </Box>
      ))}
    </Box>
  );
}
