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
import { useTranslation } from 'react-i18next';

import { useTransactionTypeActionsSlice } from '@/contexts/useDatabaseSlices';
import { useFormatters } from '@/contexts/useFormatters';
import type { Transaction } from '@/types/database';
import type { TransferCandidate } from '@/types/classification';

interface TransferLinkDialogProps {
  open: boolean;
  transaction: Transaction | null;
  onClose: () => void;
}

/**
 * Links a transaction to the other leg of a transfer by hand. Candidates are
 * opposite-direction rows in other accounts within two weeks, exact amount
 * matches first; both rows become locked transfers.
 */
export default function TransferLinkDialog({ open, transaction, onClose }: TransferLinkDialogProps) {
  const { t } = useTranslation(['transactions', 'common']);
  const { money, date } = useFormatters();
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
        if (!cancelled) setError(err instanceof Error ? err.message : t('transferLink.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, transaction, getTransferCandidates, t]);

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
  const summaryValues = {
    amount: money(Math.abs(transaction.amount), transaction.account_currency),
    account: transaction.account_name ?? t('transferLink.thisAccount'),
  };
  const gapLabel = (days: number): string => {
    if (days === 0) return t('transferLink.gapSameDay');
    const count = Math.abs(days);
    return days > 0 ? t('transferLink.gapLater', { count }) : t('transferLink.gapEarlier', { count });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TransferIcon />
          {t('transferLink.title')}
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            {t('transferLink.transaction')}
          </Typography>
          <Typography variant="body1" fontWeight="medium">
            {transaction.description}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {transaction.amount < 0 ? t('transferLink.summaryOut', summaryValues) : t('transferLink.summaryIn', summaryValues)} •{' '}
            {date(transaction.date)}
          </Typography>
        </Box>

        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            {t('transferLink.otherLeg')}
          </Typography>
          <Chip
            label={
              isLinked
                ? t('transferLink.linkedTo', { account: transaction.transfer_counterpart_account_name ?? t('transferLink.anotherAccount') })
                : t('transferLink.notLinked')
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
          {t('transferLink.help')}
        </Typography>

        {loading ? (
          <Box display="flex" justifyContent="center" py={3}>
            <CircularProgress size={28} />
          </Box>
        ) : candidates.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            {t('transferLink.noCandidates')}
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
                      {candidate.amountMatches && <Chip label={t('transferLink.sameAmount')} size="small" color="success" variant="outlined" />}
                      {candidate.transfer_group_id && candidate.id !== transaction.transfer_counterpart_id && (
                        <Chip label={t('transferLink.alreadyPaired')} size="small" color="warning" variant="outlined" />
                      )}
                    </Box>
                  }
                  secondary={t('transferLink.candidateSecondary', {
                    amount: money(Math.abs(candidate.amount), candidate.account_currency),
                    account: candidate.account_name,
                    date: date(candidate.date),
                    gap: gapLabel(candidate.dateGapDays),
                  })}
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t('common:actions.cancel')}
        </Button>
        <Button
          color="inherit"
          startIcon={<UnlinkIcon />}
          onClick={() => void runAction(() => unlinkTransfer(transaction.id), t('transferLink.unlinkFailed'))}
          disabled={saving || !isLinked}
        >
          {t('transferLink.unlink')}
        </Button>
        <Button
          variant="contained"
          onClick={() => {
            if (selectedId != null) {
              void runAction(() => linkTransfer(transaction.id, selectedId), t('transferLink.linkFailed'));
            }
          }}
          disabled={saving || selectedId == null || selectedId === transaction.transfer_counterpart_id}
        >
          {saving ? t('common:status.saving') : t('transferLink.link')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
