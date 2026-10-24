'use client';

/**
 * Resolves the active AI provider for the chat loop. Cloud profiles come from
 * the encrypted database (`ai.provider.config`); when none is active the
 * in-browser wllama runtime is used. Keys never leave this document except
 * inside provider requests, and every log call goes through `redactProfile`.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useAiProviderSlice } from '@/contexts/useAiToolsSlices';
import { useAiChatRuntimeSlice } from '@/contexts/useWllamaSlices';
import {
  EMPTY_PROVIDER_CONFIG,
  getActiveProfile,
  normalizeProviderConfig,
  redactProfile,
  removeProfile,
  setActiveProfile,
  upsertProfile,
} from '@/lib/aiProviderConfig';
import {
  createProviderFromProfile,
  LOCAL_PROVIDER_LABEL,
  type AiProvider,
  type AiProviderConfigDocument,
  type AiProviderProfile,
  type AiProviderTestResult,
} from '@/lib/aiProviders';
import { logger } from '@/lib/logging';

const log = logger.child({ component: 'AiProviderContext' });

export interface AiProviderContextValue {
  config: AiProviderConfigDocument;
  profiles: AiProviderProfile[];
  activeProfile: AiProviderProfile | null;
  /** The provider the chat loop should use right now. */
  provider: AiProvider;
  isLocalProvider: boolean;
  /** True when the active provider can answer (cloud: always; local: model loaded). */
  isProviderReady: boolean;
  providerLabel: string;
  isLoading: boolean;
  error: string | null;
  saveProfile: (profile: AiProviderProfile) => Promise<void>;
  deleteProfile: (profileId: string) => Promise<void>;
  /** `null` activates the local runtime. */
  activateProfile: (profileId: string | null) => Promise<void>;
  testProfile: (profile: AiProviderProfile) => Promise<AiProviderTestResult>;
  reload: () => Promise<void>;
}

const AiProviderContext = createContext<AiProviderContextValue | null>(null);

export function AiProviderContextProvider({ children }: { children: React.ReactNode }) {
  const { isDatabaseLoaded, getAiProviderConfig, setAiProviderConfig } = useAiProviderSlice();
  const runtime = useAiChatRuntimeSlice();
  const [config, setConfig] = useState<AiProviderConfigDocument>(EMPTY_PROVIDER_CONFIG);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadRunRef = useRef(0);

  const reload = useCallback(async () => {
    if (!isDatabaseLoaded) {
      return;
    }
    const runId = loadRunRef.current + 1;
    loadRunRef.current = runId;
    setIsLoading(true);
    try {
      const stored = await getAiProviderConfig<unknown>();
      if (loadRunRef.current === runId) {
        setConfig(normalizeProviderConfig(stored));
        setError(null);
      }
    } catch (err) {
      log.error('Failed to load provider configuration', { operation: 'reload', error: err });
      if (loadRunRef.current === runId) {
        setError(err instanceof Error ? err.message : 'Failed to load provider configuration');
      }
    } finally {
      if (loadRunRef.current === runId) {
        setIsLoading(false);
      }
    }
  }, [getAiProviderConfig, isDatabaseLoaded]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const persist = useCallback(
    async (next: AiProviderConfigDocument) => {
      await setAiProviderConfig(next);
      setConfig(next);
    },
    [setAiProviderConfig]
  );

  const saveProfile = useCallback(
    async (profile: AiProviderProfile) => {
      log.info('Saving provider profile', { operation: 'saveProfile', profile: redactProfile(profile) });
      await persist(upsertProfile(config, profile));
    },
    [config, persist]
  );

  const deleteProfile = useCallback(
    async (profileId: string) => {
      log.info('Deleting provider profile', { operation: 'deleteProfile', profileId });
      await persist(removeProfile(config, profileId));
    },
    [config, persist]
  );

  const activateProfile = useCallback(
    async (profileId: string | null) => {
      log.info('Activating provider', { operation: 'activateProfile', profileId: profileId ?? 'local' });
      await persist(setActiveProfile(config, profileId));
    },
    [config, persist]
  );

  const localRuntime = useMemo(
    () => ({
      isModelLoaded: runtime.isModelLoaded,
      modelName: runtime.loadedModel?.name ?? null,
      createChatCompletion: runtime.createChatCompletion,
      createChatCompletionStream: runtime.createChatCompletionStream,
    }),
    [runtime.createChatCompletion, runtime.createChatCompletionStream, runtime.isModelLoaded, runtime.loadedModel?.name]
  );

  const testProfile = useCallback(
    async (profile: AiProviderProfile) => {
      const candidate = createProviderFromProfile(profile, { localRuntime });
      const result = await candidate.testConnection();
      log.info('Provider connection test', {
        operation: 'testProfile',
        profile: redactProfile(profile),
        ok: result.ok,
        latencyMs: result.latencyMs,
      });
      return result;
    },
    [localRuntime]
  );

  const activeProfile = useMemo(() => getActiveProfile(config), [config]);

  const provider = useMemo<AiProvider>(() => {
    if (activeProfile) {
      try {
        return createProviderFromProfile(activeProfile, { localRuntime });
      } catch (err) {
        log.error('Failed to create provider; falling back to local', { operation: 'resolveProvider', error: err });
      }
    }
    return createProviderFromProfile({ id: 'local', kind: 'local', label: LOCAL_PROVIDER_LABEL, model: '', isActive: true }, { localRuntime });
  }, [activeProfile, localRuntime]);

  const isLocalProvider = provider.kind === 'local';
  const isProviderReady = isLocalProvider ? runtime.isModelLoaded : true;

  const value = useMemo<AiProviderContextValue>(
    () => ({
      config,
      profiles: config.profiles,
      activeProfile,
      provider,
      isLocalProvider,
      isProviderReady,
      providerLabel: provider.label,
      isLoading,
      error,
      saveProfile,
      deleteProfile,
      activateProfile,
      testProfile,
      reload,
    }),
    [activateProfile, activeProfile, config, deleteProfile, error, isLoading, isLocalProvider, isProviderReady, provider, reload, saveProfile, testProfile]
  );

  return <AiProviderContext.Provider value={value}>{children}</AiProviderContext.Provider>;
}

export function useAiProviderContext(): AiProviderContextValue {
  const value = useContext(AiProviderContext);
  if (!value) {
    throw new Error('useAiProviderContext must be used within an AiProviderContextProvider');
  }
  return value;
}
