'use client';

import React, { useState } from 'react';

import { Warning } from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Typography,
} from '@mui/material';

import type { ConflictResolutionChoice } from '@/lib/cloudSyncService';
import type { DatabaseSourceConflict } from '@/lib/databaseSourceStorage';

interface CloudConflictDialogProps {
  open: boolean;
  conflict: DatabaseSourceConflict | null;
  pendingChangesSince: string | null;
  onResolve: (choice: ConflictResolutionChoice) => Promise<void>;
  onClose: () => void;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return 'unknown';
  return new Date(value).toLocaleString();
}

export function CloudConflictDialog({
  open,
  conflict,
  pendingChangesSince,
  onResolve,
  onClose,
}: CloudConflictDialogProps) {
  const [pendingChoice, setPendingChoice] = useState<ConflictResolutionChoice | null>(null);
  const [confirmingUseCloud, setConfirmingUseCloud] = useState(false);

  const isBusy = pendingChoice !== null;

  const handleResolve = async (choice: ConflictResolutionChoice) => {
    setPendingChoice(choice);
    try {
      await onResolve(choice);
    } finally {
      setPendingChoice(null);
      setConfirmingUseCloud(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={isBusy ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      data-testid="cloud-conflict-dialog"
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Warning color="warning" />
          Sync Conflict
        </Box>
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" sx={{ mb: 2 }}>
          Both this device and the cloud copy have changed since they were last synced. Choose how
          to resolve it — nothing is uploaded or discarded until you pick an option below.
        </Typography>

        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle2">This device</Typography>
            <Typography variant="body2" color="text.secondary">
              Changed since {formatTimestamp(pendingChangesSince)}
            </Typography>
          </Box>
          <Divider orientation="vertical" flexItem />
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle2">Cloud copy</Typography>
            <Typography variant="body2" color="text.secondary">
              Changed {formatTimestamp(conflict?.remoteModifiedAt)}
            </Typography>
          </Box>
        </Box>

        {confirmingUseCloud && (
          <Alert severity="warning" sx={{ mb: 1 }}>
            This discards the unsynced changes on this device and replaces them with the cloud
            copy. This can&apos;t be undone.
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1, p: 2 }}>
        <Button onClick={onClose} disabled={isBusy}>
          Not Now
        </Button>
        <Button onClick={() => void handleResolve('keep-both')} disabled={isBusy}>
          {pendingChoice === 'keep-both' ? 'Saving…' : 'Keep Both'}
        </Button>
        <Button onClick={() => void handleResolve('overwrite')} disabled={isBusy} color="warning">
          {pendingChoice === 'overwrite' ? 'Overwriting…' : 'Overwrite Cloud'}
        </Button>
        {confirmingUseCloud ? (
          <Button
            variant="contained"
            color="error"
            onClick={() => void handleResolve('use-cloud')}
            disabled={isBusy}
          >
            {pendingChoice === 'use-cloud' ? 'Applying…' : 'Confirm: Discard Local Changes'}
          </Button>
        ) : (
          <Button variant="contained" onClick={() => setConfirmingUseCloud(true)} disabled={isBusy}>
            Use Cloud Version
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
