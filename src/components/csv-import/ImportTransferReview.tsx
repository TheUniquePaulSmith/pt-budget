'use client';

import React from 'react';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { SwapHoriz } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';
import type { TransferLegSummary, TransferPairPreview } from '@/types/classification';
import type { Account } from '@/types/database';

interface ImportTransferReviewProps {
  open: boolean;
  pairs: TransferPairPreview[];
  selectedPairIds: ReadonlySet<string>;
  /** The user's accounts, so each leg's amount is shown in its account's currency. */
  accounts?: Account[];
  onToggle: (pairId: string, selected: boolean) => void;
  onClose: () => void;
}

function confidenceColor(confidence: number): 'success' | 'warning' | 'default' {
  if (confidence >= 0.8) return 'success';
  if (confidence >= 0.6) return 'warning';
  return 'default';
}

function Leg({ leg }: { leg: TransferLegSummary }) {
  const { t } = useTranslation('csvImport');
  const { date } = useFormatters();
  const values = { account: leg.account_name, date: date(leg.date) };
  return (
    <Box>
      <Typography variant="body2" noWrap title={leg.description}>
        {leg.description}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {leg.isNew ? t('transferReview.legCaption', values) : t('transferReview.legCaptionExisting', values)}
      </Typography>
    </Box>
  );
}

/**
 * The transfers the import detected between the staged rows (and rows already
 * in the database). Checked pairs are imported as transfers; recommended pairs
 * start checked, weaker possibilities start unchecked.
 */
export default function ImportTransferReview({
  open,
  pairs,
  selectedPairIds,
  accounts,
  onToggle,
  onClose,
}: ImportTransferReviewProps) {
  const { t } = useTranslation(['csvImport', 'common']);
  const { money, percent } = useFormatters();
  const currencyOf = (accountId: number) => accounts?.find((account) => account.id === accountId)?.currency;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <SwapHoriz />
          {t('transferReview.title')}
        </Box>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('transferReview.help')}
        </Typography>
        <Table size="small" data-testid="csv-transfer-review-table">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" />
              <TableCell>{t('transferReview.moneyOut')}</TableCell>
              <TableCell>{t('transferReview.moneyIn')}</TableCell>
              <TableCell align="right">{t('common:fields.amount')}</TableCell>
              <TableCell align="right">{t('transferReview.confidence')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pairs.map((pair) => {
              const checked = selectedPairIds.has(pair.pairId);
              const confidence = percent(pair.confidence, { maximumFractionDigits: 0 });
              return (
                <TableRow key={pair.pairId} hover selected={checked} data-testid="csv-transfer-review-row">
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={checked}
                      onChange={(event) => onToggle(pair.pairId, event.target.checked)}
                      inputProps={{ 'aria-label': t('transferReview.importAsTransfer', { description: pair.out.description }) }}
                    />
                  </TableCell>
                  <TableCell sx={{ maxWidth: 260 }}>
                    <Leg leg={pair.out} />
                  </TableCell>
                  <TableCell sx={{ maxWidth: 260 }}>
                    <Leg leg={pair.in} />
                  </TableCell>
                  <TableCell align="right">{money(Math.abs(pair.out.amount), currencyOf(pair.out.account_id))}</TableCell>
                  <TableCell align="right">
                    <Tooltip title={pair.reasons.join(' · ')}>
                      <Chip
                        label={
                          pair.recommended
                            ? t('transferReview.confidenceChip', { percent: confidence })
                            : t('transferReview.confidenceChipPossible', { percent: confidence })
                        }
                        size="small"
                        color={confidenceColor(pair.confidence)}
                        variant={pair.recommended ? 'filled' : 'outlined'}
                      />
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained">
          {t('common:actions.done')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
