'use client';

import React, { useEffect, useState } from 'react';

import { InsertDriveFileOutlined } from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
} from '@mui/material';

import type { CloudLinkedFile, CloudProvider } from '@/lib/databaseSourceStorage';

interface CloudFilePickerDialogProps {
  open: boolean;
  provider: CloudProvider | null;
  files: CloudLinkedFile[];
  isLoading: boolean;
  error: string | null;
  onSelect: (file: CloudLinkedFile) => Promise<void>;
  onClose: () => void;
}

function providerLabel(provider: CloudProvider | null): string {
  if (provider === 'gdrive') return 'Google Drive';
  if (provider === 'onedrive') return 'OneDrive';
  return 'cloud storage';
}

function formatFileSubtitle(file: CloudLinkedFile): string {
  const parts: string[] = [];
  if (file.modifiedAt) {
    parts.push(new Date(file.modifiedAt).toLocaleString());
  }
  if (file.size !== null) {
    parts.push(`${(file.size / 1024).toFixed(0)} KB`);
  }
  return parts.join(' • ');
}

export function CloudFilePickerDialog({
  open,
  provider,
  files,
  isLoading,
  error,
  onSelect,
  onClose,
}: CloudFilePickerDialogProps) {
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedFileId(files[0]?.fileId ?? null);
    }
  }, [open, files]);

  const selectedFile = files.find((file) => file.fileId === selectedFileId) ?? null;
  const isBusy = isLoading || isConfirming;

  const handleConfirm = async () => {
    if (!selectedFile) {
      return;
    }
    setIsConfirming(true);
    try {
      await onSelect(selectedFile);
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <Dialog open={open} onClose={isBusy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Open from {providerLabel(provider)}</DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {isLoading && files.length === 0 && !error && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={32} />
          </Box>
        )}

        {!isLoading && files.length === 0 && !error && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            No backup archives were found in {providerLabel(provider)}.
          </Typography>
        )}

        {files.length > 0 && (
          <List disablePadding data-testid="cloud-file-picker-list">
            {files.map((file) => (
              <ListItemButton
                key={file.fileId}
                selected={file.fileId === selectedFileId}
                onClick={() => setSelectedFileId(file.fileId)}
                disabled={isBusy}
              >
                <ListItemIcon>
                  <InsertDriveFileOutlined />
                </ListItemIcon>
                <ListItemText primary={file.fileName} secondary={formatFileSubtitle(file)} />
              </ListItemButton>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isBusy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => void handleConfirm()}
          disabled={!selectedFile || isBusy}
          startIcon={isConfirming ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {isConfirming ? 'Opening…' : 'Open'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
