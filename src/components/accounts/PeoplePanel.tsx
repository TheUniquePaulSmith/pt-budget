'use client';

/**
 * The People side panel of the Accounts page: every user with a primary
 * star, owned / cardholder counts and add / rename / delete controls.
 */

import React from 'react';
import {
  Box,
  Button,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Typography,
} from '@mui/material';
import { Delete as DeleteIcon, Edit as EditIcon, Person as PersonIcon, PersonAdd as AddPersonIcon, Star as StarIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import type { Account, AccountCard, User } from '@/types/database';
import { countPersonAccounts } from './accountDisplay';

export interface PeoplePanelProps {
  users: User[];
  accounts: Account[];
  cardsByAccountId: Record<number, AccountCard[]>;
  onAddUser: () => void;
  onRenameUser: (user: User) => void;
  onDeleteUser: (user: User) => void;
}

export default function PeoplePanel({ users, accounts, cardsByAccountId, onAddUser, onRenameUser, onDeleteUser }: PeoplePanelProps) {
  const { t } = useTranslation(['accounts', 'common']);
  return (
    <Box data-testid="people-panel" sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="subtitle2" component="h2" sx={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {t('peoplePanel.title')}
        </Typography>
        <Button size="small" startIcon={<AddPersonIcon />} onClick={onAddUser} data-testid="add-user-button">
          {t('common:actions.add')}
        </Button>
      </Box>
      <List dense disablePadding sx={{ overflowY: 'auto' }}>
        {users.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
            {t('peoplePanel.empty')}
          </Typography>
        )}
        {users.map((user) => {
          const isPrimary = user.is_primary === 1;
          const counts = countPersonAccounts(user.id, accounts, cardsByAccountId);
          return (
            <ListItem
              key={user.id}
              divider
              data-testid={`person-row-${user.id}`}
              secondaryAction={
                <Box sx={{ display: 'flex' }}>
                  <IconButton size="small" onClick={() => onRenameUser(user)} aria-label={t('peoplePanel.rename', { name: user.display_name })} title={t('peoplePanel.editUser')}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <Tooltip title={isPrimary ? t('peoplePanel.primaryCannotDelete') : t('peoplePanel.deleteUser')}>
                    <span>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => onDeleteUser(user)}
                        disabled={isPrimary}
                        aria-label={t('peoplePanel.delete', { name: user.display_name })}
                        title={t('peoplePanel.deleteUser')}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
              }
              sx={{ pr: 10 }}
            >
              <ListItemIcon sx={{ minWidth: 32 }}>
                {isPrimary ? (
                  <StarIcon fontSize="small" color="warning" titleAccess={t('peoplePanel.primaryUser')} data-testid="primary-user-star" />
                ) : (
                  <PersonIcon fontSize="small" color="action" />
                )}
              </ListItemIcon>
              <ListItemText
                primary={user.display_name}
                secondary={t('peoplePanel.counts', { owned: counts.owned, cardholder: counts.cardholder })}
                slotProps={{ primary: { variant: 'body2', fontWeight: isPrimary ? 600 : 500, noWrap: true }, secondary: { variant: 'caption' } }}
              />
            </ListItem>
          );
        })}
      </List>
    </Box>
  );
}
