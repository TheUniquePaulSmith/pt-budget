'use client';

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Radio,
  Typography,
} from '@mui/material';
import { LinkOff as UnlinkIcon, SwapHoriz as TransferIcon } from '@mui/icons-material';

import { useTransactionTypeActionsSlice } from '@/contexts/useDatabaseSlices';
import type { Transaction } from '@/types/database';
import type { TransferCandidate } from '@/types/classification';

interface TransferLinkDialogProps {
  open: boolean;
  transaction: Transaction | null;
  onClose: () => void;
}

const CURRENCY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function gapLabel(days: number): string {
  if (days === 0) return 'same day';
  const abs = Math.abs(days);
  return `${abs} day${abs === 1 ? '' : 's'} ${days > 0 ? 'later' : 'earlier'}`;
}

/**
 * Links a transaction to the other leg of a transfer by hand. Candidates are
 * opposite-direction rows in other accounts within two weeks, exact amount
 * matches first; both rows become locked transfers.
 */
export default function TransferLinkDialog({ open, transaction, onClose }: TransferLinkDialogProps) {
  const { getTransferCandidates, linkTransfer, unlinkTransfer } = useTransactionTypeActionsSlice();

  const [candidates, setCandidates] = useState<TransferCandidate[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !transaction) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedId(transaction.transfer_counterpart_id ?? null);
    getTransferCandidates(transaction.id)
      .then((rows) => {
        if (!cancelled) setCandidates(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load candidates');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, transaction, getTransferCandidates]);

  const runAction = async (action: () => Promise<void>, failureMessage: string) => {
    setSaving(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : failureMessage);
    } finally {
      setSaving(false);
    }
  };

  if (!transaction) return null;

  const isLinked = transaction.transfer_counterpart_id != null;
  const direction = transaction.amount < 0 ? 'out of' : 'into';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TransferIcon />
          Link Transfer
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Transaction
          </Typography>
          <Typography variant="body1" fontWeight="medium">
            {transaction.description}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {CURRENCY.format(Math.abs(transaction.amount))} {direction} {transaction.account_name ?? 'this account'} •{' '}
            {transaction.date}
          </Typography>
        </Box>

        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Other leg
          </Typography>
          <Chip
            label={
              isLinked
                ? `Linked to ${transaction.transfer_counterpart_account_name ?? 'another account'}`
                : 'Not linked'
            }
            color={isLinked ? 'info' : 'default'}
            variant="outlined"
            size="small"
          />
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Pick the row in another account that is the other side of this transfer. Both rows become transfers
          and count as neither income nor spending.
        </Typography>

        {loading ? (
          <Box display="flex" justifyContent="center" py={3}>
            <CircularProgress size={28} />
          </Box>
        ) : candidates.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            No opposite-direction rows in other accounts within two weeks of this date. Import the other
            account&apos;s statement first, or mark this row as a transfer on its own.
          </Typography>
        ) : (
          <List dense disablePadding sx={{ maxHeight: 320, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
            {candidates.map((candidate) => (
              <ListItemButton
                key={candidate.id}
                selected={selectedId === candidate.id}
                onClick={() => setSelectedId(candidate.id)}
                data-testid={`transfer-candidate-${candidate.id}`}
              >
                <Radio edge="start" checked={selectedId === candidate.id} tabIndex={-1} size="small" />
                <ListItemText
                  primary={
                    <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                      <span>{candidate.description}</span>
                      {candidate.amountMatches && <Chip label="Same amount" size="small" color="success" variant="outlined" />}
                      {candidate.transfer_group_id && candidate.id !== transaction.transfer_counterpart_id && (
                        <Chip label="Already paired elsewhere" size="small" color="warning" variant="outlined" />
                      )}
                    </Box>
                  }
                  secondary={`${CURRENCY.format(Math.abs(candidate.amount))} • ${candidate.account_name} • ${candidate.date} (${gapLabel(candidate.dateGapDays)})`}
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          color="inherit"
          startIcon={<UnlinkIcon />}
          onClick={() => void runAction(() => unlinkTransfer(transaction.id), 'Failed to unlink transfer')}
          disabled={saving || !isLinked}
        >
          Unlink
        </Button>
        <Button
          variant="contained"
          onClick={() => {
            if (selectedId != null) {
              void runAction(() => linkTransfer(transaction.id, selectedId), 'Failed to link transfer');
            }
          }}
          disabled={saving || selectedId == null || selectedId === transaction.transfer_counterpart_id}
        >
          {saving ? 'Saving…' : 'Link'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
