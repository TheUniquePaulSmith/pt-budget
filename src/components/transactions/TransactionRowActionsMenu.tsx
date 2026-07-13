'use client';

import React, { useState } from 'react';
import { ListItemIcon, ListItemText, Menu, MenuItem } from '@mui/material';
import {
  Autorenew as AutorenewIcon,
  Business as BusinessIcon,
  Category as CategoryIcon,
} from '@mui/icons-material';
import { Transaction } from '@/types/database';
import CategoryPickerDialog from './CategoryPickerDialog';
import CompanyPickerDialog from './CompanyPickerDialog';
import SeriesPickerDialog from './SeriesPickerDialog';

export interface TransactionRowActionsMenuProps {
  /** Anchor of the row's "More Actions" button; null keeps the menu closed. */
  anchorEl: HTMLElement | null;
  transaction: Transaction | null;
  onClose: () => void;
}

type QuickActionKind = 'category' | 'company' | 'series';

/**
 * Shared quick-apply menu for transaction grids: set category, set company
 * (pick / search / create), or link the row to a recurring series. The menu
 * closes as soon as an action is picked and hands the transaction to the
 * matching picker dialog.
 */
export default function TransactionRowActionsMenu({
  anchorEl,
  transaction,
  onClose,
}: TransactionRowActionsMenuProps) {
  const [dialog, setDialog] = useState<{
    kind: QuickActionKind;
    transaction: Transaction;
  } | null>(null);

  const openDialog = (kind: QuickActionKind) => {
    if (transaction) {
      setDialog({ kind, transaction });
    }
    onClose();
  };

  return (
    <>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl && transaction)}
        onClose={onClose}
      >
        <MenuItem onClick={() => openDialog('category')}>
          <ListItemIcon>
            <CategoryIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Set Category…</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => openDialog('company')}>
          <ListItemIcon>
            <BusinessIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Set Company…</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => openDialog('series')}>
          <ListItemIcon>
            <AutorenewIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Subscription Link…</ListItemText>
        </MenuItem>
      </Menu>

      <CategoryPickerDialog
        open={dialog?.kind === 'category'}
        transaction={dialog?.kind === 'category' ? dialog.transaction : null}
        onClose={() => setDialog(null)}
      />
      <CompanyPickerDialog
        open={dialog?.kind === 'company'}
        transaction={dialog?.kind === 'company' ? dialog.transaction : null}
        onClose={() => setDialog(null)}
      />
      <SeriesPickerDialog
        open={dialog?.kind === 'series'}
        transaction={dialog?.kind === 'series' ? dialog.transaction : null}
        onClose={() => setDialog(null)}
      />
    </>
  );
}
