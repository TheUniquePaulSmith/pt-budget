'use client';

import React from 'react';
import {
  Box,
  Typography,
  Drawer,
  Card,
  CardContent,
  Stack,
  IconButton,
  Tooltip,
  Button,
  Divider,
} from '@mui/material';
import { Close, ContentCopy } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import { SAMPLE_QUERIES } from './sampleQueries';

export interface SampleQueriesDrawerProps {
  open: boolean;
  onClose: () => void;
  onSelectQuery: (query: string) => void;
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
  }
}

export default function SampleQueriesDrawer({ open, onClose, onSelectQuery }: SampleQueriesDrawerProps) {
  const { t } = useTranslation('sqlQuery');

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: { sx: { width: { xs: '100%', sm: 420 } } },
      }}
    >
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="h6">{t('samplesDrawer.title')}</Typography>
        <IconButton onClick={onClose} aria-label={t('samplesDrawer.close')}>
          <Close />
        </IconButton>
      </Box>
      <Divider />
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
        {SAMPLE_QUERIES.map((sample) => (
          <Card key={sample.id} variant="outlined" sx={{ flexShrink: 0 }}>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                <Typography variant="subtitle2" color="primary">
                  {t(`samples.${sample.id}`)}
                </Typography>
                <Stack direction="row" spacing={1}>
                  <Tooltip title={t('samplesDrawer.copy')}>
                    <IconButton size="small" onClick={() => copyToClipboard(sample.query)}>
                      <ContentCopy fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Button
                    size="small"
                    onClick={() => {
                      onSelectQuery(sample.query);
                      onClose();
                    }}
                  >
                    {t('samplesDrawer.useQuery')}
                  </Button>
                </Stack>
              </Box>
              <Typography
                variant="body2"
                component="pre"
                sx={{
                  fontFamily: 'monospace',
                  fontSize: '0.75rem',
                  bgcolor: 'action.hover',
                  p: 1,
                  borderRadius: 1,
                  whiteSpace: 'pre-wrap',
                  overflow: 'auto',
                  m: 0,
                }}
              >
                {sample.query}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Box>
    </Drawer>
  );
}
