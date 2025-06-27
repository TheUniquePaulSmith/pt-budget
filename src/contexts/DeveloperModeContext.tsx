'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { consoleLogger } from '../lib/consoleLogger';

interface DeveloperModeContextType {
  isDeveloperModeEnabled: boolean;
  setDeveloperModeEnabled: (enabled: boolean) => void;
}

const DeveloperModeContext = createContext<DeveloperModeContextType | undefined>(undefined);

export const DeveloperModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isDeveloperModeEnabled, setIsDeveloperModeEnabled] = useState(false);

  // Start logging automatically when the provider mounts
  useEffect(() => {
    // Always start logging when the app starts
    consoleLogger.startCapturing();
  }, []);

  // Handle developer mode changes
  useEffect(() => {
    if (isDeveloperModeEnabled) {
      // Ensure logging is started when developer mode is enabled
      if (!consoleLogger.isCurrentlyCapturing()) {
        consoleLogger.startCapturing();
      }
    }
    // Note: We don't stop logging when developer mode is disabled
    // to ensure we don't lose any important logs
  }, [isDeveloperModeEnabled]);

  const setDeveloperModeEnabled = (enabled: boolean) => {
    setIsDeveloperModeEnabled(enabled);
  };

  return (
    <DeveloperModeContext.Provider value={{
      isDeveloperModeEnabled,
      setDeveloperModeEnabled
    }}>
      {children}
    </DeveloperModeContext.Provider>
  );
};

export const useDeveloperMode = () => {
  const context = useContext(DeveloperModeContext);
  if (context === undefined) {
    throw new Error('useDeveloperMode must be used within a DeveloperModeProvider');
  }
  return context;
};
