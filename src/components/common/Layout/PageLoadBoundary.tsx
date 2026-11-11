'use client';

/**
 * Catches a page that fails to render, most often because its code chunk
 * could not be fetched: without offline mode, a page the user has not opened
 * yet is still on the host. Offline, it says the page opens once the
 * connection is back and tries again by itself when it is; online, it offers
 * Try again. Pages are retryableLazy, so a retry fetches the chunk anew.
 * AppShell keys it by page, so navigating elsewhere starts clean.
 */

import { CloudOff, ErrorOutline } from '@mui/icons-material';
import { Alert, AlertTitle, Box, Button } from '@mui/material';
import React, { Component, type ErrorInfo, type ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useOnlineStatus } from '@/components/common/Offline/useOnlineStatus';
import { logger } from '@/lib/logging';

import { PageRetryContext } from './retryableLazy';

const log = logger.child({ component: 'PageLoadBoundary' });

interface BoundaryProps {
  pageId: string;
  children: ReactNode;
}

interface BoundaryState {
  error: Error | null;
  attempt: number;
}

// Every mount and every retry is a new attempt, so opening the page again also fetches a chunk that failed before.
let attemptCounter = 0;
const nextAttempt = () => {
  attemptCounter += 1;
  return attemptCounter;
};

export default class PageLoadBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, attempt: nextAttempt() };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    log.warn('Page failed to load', {
      operation: 'page_load',
      page: this.props.pageId,
      error,
      componentStack: info.componentStack ?? undefined,
    });
  }

  private retry = () => {
    this.setState({ error: null, attempt: nextAttempt() });
  };

  render() {
    if (this.state.error) return <PageUnavailable onRetry={this.retry} />;
    return (
      <PageRetryContext.Provider value={this.state.attempt}>
        <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>
      </PageRetryContext.Provider>
    );
  }
}

function PageUnavailable({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation('shell');
  const online = useOnlineStatus();
  const wasOnline = useRef(online);

  // Back online: the chunk can be fetched now, so try again without asking.
  useEffect(() => {
    if (online && !wasOnline.current) onRetry();
    wasOnline.current = online;
  }, [online, onRetry]);

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 720 }} data-testid="page-unavailable" data-online={online}>
      <Alert
        severity={online ? 'error' : 'info'}
        icon={online ? <ErrorOutline /> : <CloudOff />}
        action={
          <Button color="inherit" size="small" disabled={!online} onClick={onRetry} data-testid="page-unavailable-retry">
            {t('pageUnavailable.retry')}
          </Button>
        }
      >
        <AlertTitle>{online ? t('pageUnavailable.failedTitle') : t('pageUnavailable.offlineTitle')}</AlertTitle>
        {online ? t('pageUnavailable.failedBody') : t('pageUnavailable.offlineBody')}
      </Alert>
    </Box>
  );
}
