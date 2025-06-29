'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { consoleLogger } from '../lib/consoleLogger';

interface LoggingContextType {
  isLoggingEnabled: boolean;
  setLoggingEnabled: (enabled: boolean) => void;
}

const LoggingContext = createContext<LoggingContextType | undefined>(undefined);

export const LoggingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isLoggingEnabled, setIsLoggingEnabled] = useState(false);

  // Start logging automatically when the provider mounts
  useEffect(() => {
    // Always start logging when the app starts
    consoleLogger.startCapturing();
  }, []);

  // Handle loggin mode changes
  useEffect(() => {
    if (isLoggingEnabled) {
      // Ensure logging is started when logging mode is enabled
      if (!consoleLogger.isCurrentlyCapturing()) {
        consoleLogger.startCapturing();
      }
    }
    // Note: We don't stop logging when logging is disabled
    // to ensure we don't lose any important logs
  }, [isLoggingEnabled]);

  const setLoggingEnabled = (enabled: boolean) => {
    setIsLoggingEnabled(enabled);
  };

  return (
    <LoggingContext.Provider value={{
      isLoggingEnabled,
      setLoggingEnabled
    }}>
      {children}
    </LoggingContext.Provider>
  );
};

export const useLogging = () => {
  const context = useContext(LoggingContext);
  if (context === undefined) {
    throw new Error('useLogging must be used within a LoggingProvider');
  }
  return context;
};
