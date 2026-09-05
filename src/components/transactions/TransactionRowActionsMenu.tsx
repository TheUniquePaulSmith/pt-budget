'use client';

import React, { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Snackbar,
  Typography,
} from '@mui/material';
import {
  Autorenew as AutorenewIcon,
  Business as BusinessIcon,
  Category as CategoryIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Flag as FlagIcon,
  FlagOutlined as FlagOutlinedIcon,
  SwapHoriz as TransferIcon,
  TrendingDown as ExpenseIcon,
  TrendingUp as IncomeIcon,
  Undo as RefundIcon,
  Visibility as IncludeIcon,
  VisibilityOff as ExcludeIcon,
} from '@mui/icons-material';
import { useTransactionQuickActionsSlice } from '@/contexts/useDatabaseSlices';
import { Transaction, TransactionType } from '@/types/database';
import AddTransaction from './AddTransaction';
import CategoryPickerDialog from './CategoryPickerDialog';
import CompanyPickerDialog from './CompanyPickerDialog';
import SeriesPickerDialog from './SeriesPickerDialog';

export interface TransactionRowActionsMenuProps {
  /** Anchor of the row's "More Actions" button; used when no anchorPosition is given. */
  anchorEl?: HTMLElement | null;
  /** Pointer position from a right-click or long-press; takes precedence over anchorEl. */
  anchorPosition?: { top: number; left: number } | null;
  transaction: Transaction | null;
  onClose: () => void;
}

type PickerKind = 'category' | 'company' | 'series';

// Re-typing never changes the amount, so only types compatible with the row's
// sign are offered: money out can be an expense or a transfer, money in can be
// income, a refund or a transfer.
const TYPE_OPTIONS: Array<{
  type: TransactionType;
  label: string;
  icon: React.ReactElement;
  allowed: (amount: number) => boolean;
}> = [
  { type: 'expense', label: 'Mark as Expense', icon: <ExpenseIcon fontSize="small" />, allowed: (amount) => amount <= 0 },
  { type: 'income', label: 'Mark as Income', icon: <IncomeIcon fontSize="small" />, allowed: (amount) => amount >= 0 },
  { type: 'refund', label: 'Mark as Refund', icon: <RefundIcon fontSize="small" />, allowed: (amount) => amount >= 0 },
  { type: 'transfer', label: 'Mark as Transfer', icon: <TransferIcon fontSize="small" />, allowed: () => true },
];

const CURRENCY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/**
 * The one action menu for a transaction row. Opens from the row's kebab
 * button, from a right-click (anchorPosition), or from a long-press on touch.
 * Edit, delete, flag, exclude and re-type act directly; category, company and
 * series hand off to their picker dialogs.
 */
export default function TransactionRowActionsMenu({
  anchorEl = null,
  anchorPosition = null,
  transaction,
  onClose,
}: TransactionRowActionsMenuProps) {
  const { deleteTransaction, setTransactionFlag, setTransactionExcluded, setTransactionType } =
    useTransactionQuickActionsSlice();

  const [picker, setPicker] = useState<{ kind: PickerKind; transaction: Transaction } | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = Boolean(transaction && (anchorPosition || anchorEl));

  const openPicker = (kind: PickerKind) => {
    if (transaction) setPicker({ kind, transaction });
    onClose();
  };

  const runAction = async (action: () => Promise<void>) => {
    onClose();
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The change could not be saved');
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteTransaction(deleting.id);
      setDeleting(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The transaction could not be deleted');
    } finally {
      setBusy(false);
    }
  };

  const isFlagged = Boolean(transaction?.is_flagged);
  const isExcluded = Boolean(transaction?.is_excluded);
  const typeOptions = transaction
    ? TYPE_OPTIONS.filter((option) => option.type !== transaction.type && option.allowed(transaction.amount))
    : [];

  return (
    <>
      <Menu
        open={open}
        onClose={onClose}
        anchorEl={anchorPosition ? undefined : anchorEl ?? undefined}
        anchorReference={anchorPosition ? 'anchorPosition' : 'anchorEl'}
        anchorPosition={anchorPosition ?? undefined}
      >
        <MenuItem
          onClick={() => {
            if (transaction) setEditing(transaction);
            onClose();
          }}
        >
          <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Edit…</ListItemText>
        </MenuItem>
        <MenuItem
          disabled={busy}
          onClick={() => transaction && void runAction(() => setTransactionFlag(transaction.id, !isFlagged))}
        >
          <ListItemIcon>{isFlagged ? <FlagOutlinedIcon fontSize="small" /> : <FlagIcon fontSize="small" />}</ListItemIcon>
          <ListItemText>{isFlagged ? 'Remove flag' : 'Flag for review'}</ListItemText>
        </MenuItem>
        <MenuItem
          disabled={busy}
          onClick={() => transaction && void runAction(() => setTransactionExcluded(transaction.id, !isExcluded))}
        >
          <ListItemIcon>{isExcluded ? <IncludeIcon fontSize="small" /> : <ExcludeIcon fontSize="small" />}</ListItemIcon>
          <ListItemText>{isExcluded ? 'Include in reports' : 'Exclude from reports'}</ListItemText>
        </MenuItem>

        {typeOptions.length > 0 && <Divider />}
        {typeOptions.map((option) => (
          <MenuItem
            key={option.type}
            disabled={busy}
            onClick={() => transaction && void runAction(() => setTransactionType(transaction.id, option.type))}
          >
            <ListItemIcon>{option.icon}</ListItemIcon>
            <ListItemText>{option.label}</ListItemText>
          </MenuItem>
        ))}

        <Divider />
        <MenuItem onClick={() => openPicker('category')}>
          <ListItemIcon><CategoryIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Set Category…</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => openPicker('company')}>
          <ListItemIcon><BusinessIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Set Company…</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => openPicker('series')}>
          <ListItemIcon><AutorenewIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Subscription Link…</ListItemText>
        </MenuItem>

        <Divider />
        <MenuItem
          onClick={() => {
            if (transaction) setDeleting(transaction);
            onClose();
          }}
          sx={{ color: 'error.main' }}
        >
          <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>
          <ListItemText>Delete…</ListItemText>
        </MenuItem>
      </Menu>

      <CategoryPickerDialog
        open={picker?.kind === 'category'}
        transaction={picker?.kind === 'category' ? picker.transaction : null}
        onClose={() => setPicker(null)}
      />
      <CompanyPickerDialog
        open={picker?.kind === 'company'}
        transaction={picker?.kind === 'company' ? picker.transaction : null}
        onClose={() => setPicker(null)}
      />
      <SeriesPickerDialog
        open={picker?.kind === 'series'}
        transaction={picker?.kind === 'series' ? picker.transaction : null}
        onClose={() => setPicker(null)}
      />

      {editing && (
        <AddTransaction
          open
          mode="edit"
          transaction={editing}
          onClose={() => setEditing(null)}
          onSuccess={() => setEditing(null)}
        />
      )}

      <Dialog open={deleting !== null} onClose={() => (busy ? undefined : setDeleting(null))} maxWidth="xs" fullWidth>
        <DialogTitle>Delete transaction?</DialogTitle>
        <DialogContent>
          {deleting && (
            <>
              <Typography fontWeight={600}>{deleting.description}</Typography>
              <Typography variant="body2" color="text.secondary">
                {CURRENCY.format(deleting.amount)} · {deleting.date}
                {deleting.account_name ? ` · ${deleting.account_name}` : ''}
              </Typography>
              <Typography variant="body2" sx={{ mt: 2 }}>
                This removes the row from every report and total. If the same row is in a later bank export,
                the import will bring it back.
              </Typography>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)} disabled={busy}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => void confirmDelete()} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={error !== null} autoHideDuration={6000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)} variant="filled">
          {error}
        </Alert>
      </Snackbar>
    </>
  );
}
