'use client';

import React, { useEffect, useState } from 'react';
import { Box, Button, Typography, useMediaQuery } from '@mui/material';
import { AccountBalanceWalletOutlined as HomeIcon, ArrowBack as BackIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import {
  describeNotFoundOrigin,
  readNotFoundBrowserContext,
  type NotFoundOriginReport,
} from '@/lib/notFoundOrigin';

import FlightRecorderCard from './FlightRecorderCard';
import FlyingMoneyLayer from './FlyingMoneyLayer';
import PixelFourOhFour from './PixelFourOhFour';
import PixelGalaxyBackground from './PixelGalaxyBackground';

const SPACE_COLOR = '#04030c';

// Anchored with top/left: an absolutely positioned span left at its static
// position inside centred text can extend the page's scrollable width.
const VISUALLY_HIDDEN = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: 1,
  height: 1,
  m: '-1px',
  p: 0,
  border: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

/**
 * The 404 page: a procedurally generated pixel Milky Way, winged money
 * drifting through it, and a "flight recorder" naming whoever (or whatever)
 * sent the visitor here. Rendered for every unmatched URL (statically as
 * `404.html`) through NotFoundLoader, so it only ever runs in the browser.
 */
export default function NotFoundExperience() {
  const { t } = useTranslation('notFound');
  const [seed] = useState(() => Math.floor(Math.random() * 0xffffffff));
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [report, setReport] = useState<NotFoundOriginReport | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    setReport(describeNotFoundOrigin(readNotFoundBrowserContext()));
    setCanGoBack(window.history.length > 1);
  }, []);

  return (
    <Box component="main" data-testid="not-found-page" sx={{ position: 'relative', minHeight: '100vh', color: '#fff' }}>
      <Box aria-hidden sx={{ position: 'fixed', inset: 0, overflow: 'hidden', bgcolor: SPACE_COLOR, zIndex: 0 }}>
        <PixelGalaxyBackground seed={seed} reducedMotion={reducedMotion} />
        {/* Soft shade behind the copy so it never fights the galactic core. */}
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(ellipse 62% 58% at 50% 54%, rgba(4, 3, 12, 0.62), rgba(4, 3, 12, 0) 78%)',
          }}
        />
      </Box>
      <FlyingMoneyLayer seed={seed} reducedMotion={reducedMotion} />

      <Box
        sx={{
          position: 'relative',
          zIndex: 2,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3,
          px: 2,
          py: 6,
          textAlign: 'center',
        }}
      >
        <PixelFourOhFour />

        <Box sx={{ maxWidth: 560 }}>
          <Typography
            variant="h4"
            component="h1"
            sx={{ color: '#fff', fontWeight: 700, textShadow: '0 2px 0 rgba(0, 0, 0, 0.55)' }}
          >
            <Box component="span" sx={VISUALLY_HIDDEN}>
              404:{' '}
            </Box>
            {t('page.headline')}
          </Typography>
          <Typography
            variant="body1"
            sx={{ mt: 1.5, color: 'rgba(255, 255, 255, 0.82)', textShadow: '0 1px 0 rgba(0, 0, 0, 0.5)' }}
          >
            {t('page.body')}
          </Typography>
        </Box>

        <FlightRecorderCard report={report} />

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, justifyContent: 'center' }}>
          <Button variant="contained" href="/" startIcon={<HomeIcon />} data-testid="not-found-home">
            {t('page.home')}
          </Button>
          {canGoBack && (
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<BackIcon />}
              onClick={() => window.history.back()}
              data-testid="not-found-back"
              sx={{ borderColor: 'rgba(255, 255, 255, 0.4)' }}
            >
              {t('page.back')}
            </Button>
          )}
        </Box>
      </Box>
    </Box>
  );
}
