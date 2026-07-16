'use client';

import { LockOutlined } from '@mui/icons-material';
import {
  Box,
  CircularProgress,
  LinearProgress,
  Paper,
  Typography,
} from '@mui/material';

export type EncryptionProgressStage =
  | 'flushing'
  | 'exporting'
  | 'encrypting'
  | 'uploading'
  | 'done';

interface EncryptionProgressProps {
  stage: EncryptionProgressStage;
  /** Optional 0-100 numeric progress value (shows indeterminate bar when null). */
  progress?: number | null;
  /** 'fullscreen' (default) centers over the whole viewport, for the setup gate. 'inline' fits within a surrounding layout (e.g. a Settings panel). */
  variant?: 'fullscreen' | 'inline';
}

const STAGE_LABELS: Record<EncryptionProgressStage, string> = {
  flushing: 'Waiting for pending operations to finish…',
  exporting: 'Exporting database snapshot…',
  encrypting: 'Encrypting database…',
  uploading: 'Uploading to cloud storage…',
  done: 'Complete',
};

export function EncryptionProgress({
  stage,
  progress = null,
  variant = 'fullscreen',
}: EncryptionProgressProps) {
  const content = (
    <Paper sx={{ p: 4, maxWidth: 440, width: '100%', textAlign: 'center' }}>
      <LockOutlined sx={{ fontSize: 56, color: 'primary.main', mb: 2 }} />
      <Typography variant="h6" gutterBottom>
        Securing Your Database
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {STAGE_LABELS[stage]}
      </Typography>

      {progress !== null ? (
        <LinearProgress
          variant="determinate"
          value={progress}
          sx={{ height: 6, borderRadius: 3 }}
        />
      ) : (
        <CircularProgress size={36} />
      )}
    </Paper>
  );

  if (variant === 'inline') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>{content}</Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 2,
      }}
    >
      {content}
    </Box>
  );
}
