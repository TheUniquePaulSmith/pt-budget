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
  Link as LinkIcon,
  Rule as RuleIcon,
  SwapHoriz as TransferIcon,
  TaskAlt as ConfirmIcon,
  TrendingDown as ExpenseIcon,
  TrendingUp as IncomeIcon,
  Undo as RefundIcon,
  Visibility as IncludeIcon,
  VisibilityOff as ExcludeIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useTransactionQuickActionsSlice, useTransactionTypeActionsSlice } from '@/contexts/useDatabaseSlices';
import { useFormatters } from '@/contexts/useFormatters';
import { normalizeDescription } from '@/lib/merchantMatchingService';
import { Transaction, TransactionType } from '@/types/database';
import AddTransaction from './AddTransaction';
import CategoryPickerDialog from './CategoryPickerDialog';
import ClassificationRuleEditorDialog, { type ClassificationRulePrefill } from './ClassificationRuleEditorDialog';
import CompanyPickerDialog from './CompanyPickerDialog';
import SeriesPickerDialog from './SeriesPickerDialog';
import TransferLinkDialog from './TransferLinkDialog';
import { needsTypeReview } from './typeSourcePresentation';

export interface TransactionRowActionsMenuProps {
  /** Anchor of the row's "More Actions" button; used when no anchorPosition is given. */
  anchorEl?: HTMLElement | null;
  /** Pointer position from a right-click or long-press; takes precedence over anchorEl. */
  anchorPosition?: { top: number; left: number } | null;
  transaction: Transaction | null;
  onClose: () => void;
}

type PickerKind = 'category' | 'company' | 'series' | 'transfer';

// Re-typing never changes the amount, so only types compatible with the row's
// sign are offered: money out can be an expense or a transfer, money in can be
// income, a refund or a transfer. Labels resolve through `t` at render time
// (`rowActions.markAs.<type>`).
const TYPE_OPTIONS: Array<{
  type: TransactionType;
  icon: React.ReactElement;
  allowed: (amount: number) => boolean;
}> = [
  { type: 'expense', icon: <ExpenseIcon fontSize="small" />, allowed: (amount) => amount <= 0 },
  { type: 'income', icon: <IncomeIcon fontSize="small" />, allowed: (amount) => amount >= 0 },
  { type: 'refund', icon: <RefundIcon fontSize="small" />, allowed: (amount) => amount >= 0 },
  { type: 'transfer', icon: <TransferIcon fontSize="small" />, allowed: () => true },
];

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
  const { t } = useTranslation(['transactions', 'common']);
  const { money, date } = useFormatters();
  const { deleteTransaction, setTransactionFlag, setTransactionExcluded, setTransactionType } =
    useTransactionQuickActionsSlice();
  const { accounts, confirmTransactionType, addClassificationRule, previewClassificationRuleMatches } =
    useTransactionTypeActionsSlice();

  const [picker, setPicker] = useState<{ kind: PickerKind; transaction: Transaction } | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const [rulePrefill, setRulePrefill] = useState<ClassificationRulePrefill | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = Boolean(transaction && (anchorPosition || anchorEl));

  const openPicker = (kind: PickerKind) => {
    if (transaction) setPicker({ kind, transaction });
    onClose();
  };

  // A rule started from a row carries its cleaned-up description and current
  // type, so "make every PYMT BY FUNDS TRANSFER a transfer" is two clicks.
  const openRuleFromRow = () => {
    if (transaction) {
      setRulePrefill({
        pattern: normalizeDescription(transaction.description),
        type: transaction.type,
        account_id: null,
        counterpart_account_id: null,
      });
    }
    onClose();
  };

  const runAction = async (action: () => Promise<void>) => {
    onClose();
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('rowActions.changeFailed'));
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
      setError(err instanceof Error ? err.message : t('rowActions.deleteFailed'));
    } finally {
      setBusy(false);
    }
  };

  const isFlagged = Boolean(transaction?.is_flagged);
  const isExcluded = Boolean(transaction?.is_excluded);
  const unconfirmedType = transaction ? needsTypeReview(transaction) : false;
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
          <ListItemText>{t('rowActions.edit')}</ListItemText>
        </MenuItem>
        <MenuItem
          disabled={busy}
          onClick={() => transaction && void runAction(() => setTransactionFlag(transaction.id, !isFlagged))}
        >
          <ListItemIcon>{isFlagged ? <FlagOutlinedIcon fontSize="small" /> : <FlagIcon fontSize="small" />}</ListItemIcon>
          <ListItemText>{isFlagged ? t('rowActions.removeFlag') : t('rowActions.flagForReview')}</ListItemText>
        </MenuItem>
        <MenuItem
          disabled={busy}
          onClick={() => transaction && void runAction(() => setTransactionExcluded(transaction.id, !isExcluded))}
        >
          <ListItemIcon>{isExcluded ? <IncludeIcon fontSize="small" /> : <ExcludeIcon fontSize="small" />}</ListItemIcon>
          <ListItemText>{isExcluded ? t('rowActions.includeInReports') : t('rowActions.excludeFromReports')}</ListItemText>
        </MenuItem>

        <Divider />
        {unconfirmedType && transaction && (
          <MenuItem
            disabled={busy}
            onClick={() => void runAction(() => confirmTransactionType(transaction.id))}
            data-testid="row-action-confirm-type"
          >
            <ListItemIcon><ConfirmIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t('rowActions.confirmAs', { type: t(`common:transactionType.${transaction.type}`) })}</ListItemText>
          </MenuItem>
        )}
        {typeOptions.map((option) => (
          <MenuItem
            key={option.type}
            disabled={busy}
            onClick={() => transaction && void runAction(() => setTransactionType(transaction.id, option.type))}
          >
            <ListItemIcon>{option.icon}</ListItemIcon>
            <ListItemText>{t(`rowActions.markAs.${option.type}`)}</ListItemText>
          </MenuItem>
        ))}
        <MenuItem onClick={() => openPicker('transfer')} data-testid="row-action-link-transfer">
          <ListItemIcon><LinkIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{transaction?.transfer_counterpart_id ? t('rowActions.transferLink') : t('rowActions.linkTransfer')}</ListItemText>
        </MenuItem>
        <MenuItem onClick={openRuleFromRow} data-testid="row-action-create-type-rule">
          <ListItemIcon><RuleIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t('rowActions.createTypeRule')}</ListItemText>
        </MenuItem>

        <Divider />
        <MenuItem onClick={() => openPicker('category')}>
          <ListItemIcon><CategoryIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t('rowActions.setCategory')}</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => openPicker('company')}>
          <ListItemIcon><BusinessIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t('rowActions.setCompany')}</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => openPicker('series')}>
          <ListItemIcon><AutorenewIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t('rowActions.subscriptionLink')}</ListItemText>
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
          <ListItemText>{t('rowActions.delete')}</ListItemText>
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
      <TransferLinkDialog
        open={picker?.kind === 'transfer'}
        transaction={picker?.kind === 'transfer' ? picker.transaction : null}
        onClose={() => setPicker(null)}
      />
      <ClassificationRuleEditorDialog
        open={rulePrefill !== null}
        editingRule={null}
        prefill={rulePrefill}
        accounts={accounts}
        onClose={() => setRulePrefill(null)}
        onCreate={async (rule) => {
          await addClassificationRule(rule);
        }}
        onUpdate={async () => undefined}
        previewMatches={previewClassificationRuleMatches}
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
        <DialogTitle>{t('rowActions.deleteTitle')}</DialogTitle>
        <DialogContent>
          {deleting && (
            <>
              <Typography fontWeight={600}>{deleting.description}</Typography>
              <Typography variant="body2" color="text.secondary">
                {money(deleting.amount, deleting.account_currency)} · {date(deleting.date)}
                {deleting.account_name ? ` · ${deleting.account_name}` : ''}
              </Typography>
              <Typography variant="body2" sx={{ mt: 2 }}>
                {t('rowActions.deleteWarning')}
              </Typography>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)} disabled={busy}>{t('common:actions.cancel')}</Button>
          <Button color="error" variant="contained" onClick={() => void confirmDelete()} disabled={busy}>
            {busy ? t('common:status.deleting') : t('common:actions.delete')}
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
