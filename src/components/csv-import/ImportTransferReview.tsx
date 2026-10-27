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

import type { TransferLegSummary, TransferPairPreview } from '@/types/classification';

interface ImportTransferReviewProps {
  open: boolean;
  pairs: TransferPairPreview[];
  selectedPairIds: ReadonlySet<string>;
  onToggle: (pairId: string, selected: boolean) => void;
  onClose: () => void;
}

const CURRENCY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function confidenceColor(confidence: number): 'success' | 'warning' | 'default' {
  if (confidence >= 0.8) return 'success';
  if (confidence >= 0.6) return 'warning';
  return 'default';
}

function Leg({ leg }: { leg: TransferLegSummary }) {
  return (
    <Box>
      <Typography variant="body2" noWrap title={leg.description}>
        {leg.description}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {leg.account_name} • {leg.date}
        {!leg.isNew && ' • already in database'}
      </Typography>
    </Box>
  );
}

/**
 * The transfers the import detected between the staged rows (and rows already
 * in the database). Checked pairs are imported as transfers; recommended pairs
 * start checked, weaker possibilities start unchecked.
 */
export default function ImportTransferReview({ open, pairs, selectedPairIds, onToggle, onClose }: ImportTransferReviewProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <SwapHoriz />
          Detected Transfers
        </Box>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Each row pairs money leaving one account with the same amount arriving in another. Checked pairs
          are imported as transfers (counted as neither income nor spending); uncheck a pair to import both
          rows as ordinary expense / income instead. Hover the confidence for the evidence.
        </Typography>
        <Table size="small" data-testid="csv-transfer-review-table">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" />
              <TableCell>Money out</TableCell>
              <TableCell>Money in</TableCell>
              <TableCell align="right">Amount</TableCell>
              <TableCell align="right">Confidence</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pairs.map((pair) => {
              const checked = selectedPairIds.has(pair.pairId);
              return (
                <TableRow key={pair.pairId} hover selected={checked} data-testid="csv-transfer-review-row">
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={checked}
                      onChange={(event) => onToggle(pair.pairId, event.target.checked)}
                      inputProps={{ 'aria-label': `Import as transfer: ${pair.out.description}` }}
                    />
                  </TableCell>
                  <TableCell sx={{ maxWidth: 260 }}>
                    <Leg leg={pair.out} />
                  </TableCell>
                  <TableCell sx={{ maxWidth: 260 }}>
                    <Leg leg={pair.in} />
                  </TableCell>
                  <TableCell align="right">{CURRENCY.format(Math.abs(pair.out.amount))}</TableCell>
                  <TableCell align="right">
                    <Tooltip title={pair.reasons.join(' · ')}>
                      <Chip
                        label={`${Math.round(pair.confidence * 100)}%${pair.recommended ? '' : ' (possible)'}`}
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
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
