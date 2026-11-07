'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { useTranslation } from 'react-i18next';

import AppLoadingScreen from '@/components/setup/AppLoadingScreen';

/** Shown while the shell chunk downloads; the setup gate then shows the same screen. */
function ShellLoading() {
  const { t } = useTranslation('setup');
  return <AppLoadingScreen message={t('loadingScreen.loadingApp')} />;
}

// Dynamically import the main app content to prevent SSR issues
const AppContent = dynamic(() => import('../../components/common/Layout/AppContent'), {
  ssr: false,
  loading: () => <ShellLoading />,
});

export default function Home() {
  return <AppContent />;
}
