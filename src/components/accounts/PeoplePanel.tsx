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
  return (
    <Box data-testid="people-panel" sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="subtitle2" component="h2" sx={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>
          People
        </Typography>
        <Button size="small" startIcon={<AddPersonIcon />} onClick={onAddUser} data-testid="add-user-button">
          Add
        </Button>
      </Box>
      <List dense disablePadding sx={{ overflowY: 'auto' }}>
        {users.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
            No people yet.
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
                  <IconButton size="small" onClick={() => onRenameUser(user)} aria-label={`Rename ${user.display_name}`} title="Edit User">
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <Tooltip title={isPrimary ? 'The primary user cannot be deleted' : 'Delete User'}>
                    <span>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => onDeleteUser(user)}
                        disabled={isPrimary}
                        aria-label={`Delete ${user.display_name}`}
                        title="Delete User"
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
                  <StarIcon fontSize="small" color="warning" titleAccess="Primary user" data-testid="primary-user-star" />
                ) : (
                  <PersonIcon fontSize="small" color="action" />
                )}
              </ListItemIcon>
              <ListItemText
                primary={user.display_name}
                secondary={`${counts.owned} owned • ${counts.cardholder} cardholder`}
                slotProps={{ primary: { variant: 'body2', fontWeight: isPrimary ? 600 : 500, noWrap: true }, secondary: { variant: 'caption' } }}
              />
            </ListItem>
          );
        })}
      </List>
    </Box>
  );
}
