'use client';

import React from 'react';
import { Box, Typography } from '@mui/material';
import {
  BoltOutlined as EventIcon,
  LocalOfferOutlined as CampaignIcon,
  PlaceOutlined as RequestedIcon,
  SensorsOutlined as SenderIcon,
} from '@mui/icons-material';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { NotFoundOriginReport } from '@/lib/notFoundOrigin';

interface FlightRecorderCardProps {
  /** Null until the browser has been asked (the card renders on the server too). */
  report: NotFoundOriginReport | null;
}

interface RecorderRow {
  testId: string;
  icon: React.ReactNode;
  label: string;
  value: string;
  detail?: string | null;
  monospace?: boolean;
}

function buildRows(report: NotFoundOriginReport, t: TFunction<'notFound'>): RecorderRow[] {
  const rows: RecorderRow[] = [
    {
      testId: 'not-found-requested',
      icon: <RequestedIcon fontSize="small" />,
      label: t('recorder.requested'),
      value: report.requested,
      monospace: true,
    },
    {
      testId: 'not-found-sender',
      icon: <SenderIcon fontSize="small" />,
      label: t('recorder.sender'),
      value: report.sender.label,
      detail: report.sender.detail,
    },
    {
      testId: 'not-found-event',
      icon: <EventIcon fontSize="small" />,
      label: t('recorder.event'),
      value: report.event.label,
    },
  ];
  if (report.campaign) {
    rows.push({
      testId: 'not-found-campaign',
      icon: <CampaignIcon fontSize="small" />,
      label: t('recorder.campaign'),
      value: report.campaign,
      monospace: true,
    });
  }
  return rows;
}

/**
 * The "flight recorder": what the browser can tell us about how this visitor
 * ended up on a missing page. Worked out locally; nothing leaves the device.
 */
export default function FlightRecorderCard({ report }: FlightRecorderCardProps) {
  const { t } = useTranslation('notFound');
  return (
    <Box
      component="section"
      aria-label={t('recorder.aria')}
      data-testid="not-found-flight-recorder"
      sx={{
        width: '100%',
        maxWidth: 560,
        textAlign: 'left',
        color: '#fff',
        bgcolor: 'rgba(8, 6, 28, 0.74)',
        border: '1px solid rgba(255, 255, 255, 0.16)',
        borderRadius: 2,
        backdropFilter: 'blur(6px)',
        p: { xs: 2, sm: 2.5 },
      }}
    >
      <Typography
        variant="overline"
        component="h2"
        sx={{ display: 'block', color: 'rgba(255, 216, 74, 0.95)', letterSpacing: '0.14em', lineHeight: 1.6, mb: 1 }}
      >
        {t('recorder.title')}
      </Typography>

      {!report ? (
        <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
          {t('recorder.loading')}
        </Typography>
      ) : (
        <>
          <Box component="dl" sx={{ m: 0, display: 'grid', gap: 1.5 }}>
            {buildRows(report, t).map((row) => (
              <Box key={row.testId} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                <Box aria-hidden sx={{ color: 'rgba(255, 255, 255, 0.55)', display: 'flex', pt: '2px' }}>
                  {row.icon}
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    component="dt"
                    variant="caption"
                    sx={{ display: 'block', color: 'rgba(255, 255, 255, 0.62)', letterSpacing: '0.06em' }}
                  >
                    {row.label}
                  </Typography>
                  <Typography
                    component="dd"
                    variant="body1"
                    data-testid={row.testId}
                    sx={{
                      m: 0,
                      color: '#fff',
                      overflowWrap: 'anywhere',
                      fontFamily: row.monospace ? 'var(--font-geist-mono), monospace' : undefined,
                      fontSize: row.monospace ? '0.9rem' : undefined,
                    }}
                  >
                    {row.value}
                  </Typography>
                  {row.detail && (
                    <Typography
                      variant="body2"
                      sx={{ color: 'rgba(255, 255, 255, 0.68)', overflowWrap: 'anywhere' }}
                    >
                      {row.detail}
                    </Typography>
                  )}
                </Box>
              </Box>
            ))}
          </Box>

          <Typography
            variant="body2"
            data-testid="not-found-quip"
            sx={{ mt: 2, pt: 1.5, borderTop: '1px dashed rgba(255, 255, 255, 0.2)', fontStyle: 'italic', color: 'rgba(255, 255, 255, 0.85)' }}
          >
            {report.quip}
          </Typography>
          <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'rgba(255, 255, 255, 0.5)' }}>
            {t('recorder.privacy')}
          </Typography>
        </>
      )}
    </Box>
  );
}
