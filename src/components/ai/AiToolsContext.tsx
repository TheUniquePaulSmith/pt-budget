'use client';

/**
 * Owns the tool registry the chat loop sees: built-in tools, shipped packs
 * (public/ai-tool-packs), user-imported packs (ai_tool_packs) and the
 * per-tool settings (ai_tool_settings), plus the consent manager that holds
 * session grants and the global bypass switch.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { useAiToolsSlice } from '@/contexts/useAiToolsSlices';
import { AiToolPackError, parseToolPack } from '@/lib/aiTools/jsonToolPack';
import { ConsentManager } from '@/lib/aiTools/consentManager';
import { composeToolRegistry, type AiToolRegistry } from '@/lib/aiTools/toolRegistry';
import { logger } from '@/lib/logging';
import type { AiToolConsent, AiToolPack, AiToolSetting } from '@/types/database';
import type { AiConsentVerdict, AiResolvedTool, AiToolPackLoadError } from '@/types/aiTools';

const log = logger.child({ component: 'AiToolsContext' });

export const SHIPPED_PACKS_INDEX_URL = '/ai-tool-packs/index.json';

export interface AiToolsContextValue {
  registry: AiToolRegistry;
  settings: AiToolSetting[];
  shippedPackErrors: AiToolPackLoadError[];
  isLoading: boolean;
  error: string | null;
  consentManager: ConsentManager;
  bypassAllConsent: boolean;
  sessionGrants: string[];
  evaluateConsent: (tool: AiResolvedTool) => AiConsentVerdict;
  setToolEnabled: (toolName: string, enabled: boolean) => Promise<void>;
  setToolConsent: (toolName: string, consent: AiToolConsent) => Promise<void>;
  importPack: (json: string) => Promise<void>;
  removePack: (packKey: string) => Promise<void>;
  setPackEnabled: (packKey: string, enabled: boolean) => Promise<void>;
  resetToSafeDefaults: () => Promise<void>;
  setBypassAllConsent: (enabled: boolean) => void;
  revokeSessionGrant: (toolName: string) => void;
  reload: () => Promise<void>;
}

const AiToolsContext = createContext<AiToolsContextValue | null>(null);

/** Builds a synthetic row so shipped packs flow through the same registry path as imports. */
function shippedPackRow(packKey: string, name: string, version: string, definitionJson: string): AiToolPack {
  return {
    id: -1,
    pack_key: packKey,
    name,
    version,
    source: 'builtin',
    enabled: 1,
    definition_json: definitionJson,
    created_at: '',
    updated_at: '',
  };
}

async function fetchShippedPacks(): Promise<{ rows: AiToolPack[]; errors: AiToolPackLoadError[] }> {
  const rows: AiToolPack[] = [];
  const errors: AiToolPackLoadError[] = [];

  if (typeof fetch !== 'function') {
    return { rows, errors };
  }

  let files: string[] = [];
  try {
    const response = await fetch(SHIPPED_PACKS_INDEX_URL, { cache: 'no-cache' });
    if (!response.ok) {
      return { rows, errors };
    }
    const index = (await response.json()) as { packs?: unknown };
    files = Array.isArray(index.packs) ? index.packs.filter((item): item is string => typeof item === 'string') : [];
  } catch (err) {
    log.warn('Shipped tool pack index unavailable', { operation: 'fetchShippedPacks', error: err });
    return { rows, errors };
  }

  for (const file of files) {
    const packKey = `shipped:${file.replace(/\.json$/i, '')}`;
    try {
      const response = await fetch(`/ai-tool-packs/${file}`, { cache: 'no-cache' });
      if (!response.ok) {
        errors.push({ packKey, errors: [{ message: `Could not load ${file} (HTTP ${response.status})` }] });
        continue;
      }
      const text = await response.text();
      const document = parseToolPack(text);
      rows.push(shippedPackRow(packKey, document.name, document.version, text));
    } catch (err) {
      errors.push({
        packKey,
        errors: err instanceof AiToolPackError ? err.errors : [{ message: err instanceof Error ? err.message : 'Invalid pack' }],
      });
    }
  }

  return { rows, errors };
}

export function AiToolsContextProvider({ children }: { children: React.ReactNode }) {
  const slice = useAiToolsSlice();
  const { isDatabaseLoaded } = slice;
  const consentManager = useMemo(() => new ConsentManager(), []);
  const [packRows, setPackRows] = useState<AiToolPack[]>([]);
  const [shippedRows, setShippedRows] = useState<AiToolPack[]>([]);
  const [shippedPackErrors, setShippedPackErrors] = useState<AiToolPackLoadError[]>([]);
  const [settings, setSettings] = useState<AiToolSetting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadRunRef = useRef(0);
  const shippedLoadedRef = useRef(false);

  const consentVersion = useSyncExternalStore(
    useCallback((listener: () => void) => consentManager.subscribe(listener), [consentManager]),
    () => `${consentManager.bypassAll}|${consentManager.listSessionGrants().join(',')}`,
    () => ''
  );

  const reload = useCallback(async () => {
    if (!isDatabaseLoaded) {
      return;
    }
    const runId = loadRunRef.current + 1;
    loadRunRef.current = runId;
    setIsLoading(true);
    try {
      const [rows, storedSettings] = await Promise.all([slice.listToolPacks(), slice.listToolSettings()]);
      if (!shippedLoadedRef.current) {
        const shipped = await fetchShippedPacks();
        if (loadRunRef.current === runId) {
          setShippedRows(shipped.rows);
          setShippedPackErrors(shipped.errors);
          shippedLoadedRef.current = true;
        }
      }
      if (loadRunRef.current === runId) {
        setPackRows(rows);
        setSettings(storedSettings);
        setError(null);
      }
    } catch (err) {
      log.error('Failed to load tool registry', { operation: 'reload', error: err });
      if (loadRunRef.current === runId) {
        setError(err instanceof Error ? err.message : 'Failed to load the tool registry');
      }
    } finally {
      if (loadRunRef.current === runId) {
        setIsLoading(false);
      }
    }
  }, [isDatabaseLoaded, slice]);

  useEffect(() => {
    void reload();
    // The slice object is recreated each render; reload only when the database becomes available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDatabaseLoaded]);

  const registry = useMemo(
    () => composeToolRegistry({ packRows: [...shippedRows, ...packRows], settings }),
    [packRows, settings, shippedRows]
  );

  const upsertSetting = useCallback(
    async (toolName: string, patch: Partial<Pick<AiToolSetting, 'enabled' | 'consent'>>) => {
      const tool = registry.getTool(toolName);
      if (!tool) {
        throw new Error(`Unknown tool: ${toolName}`);
      }
      const next: AiToolSetting = {
        tool_name: toolName,
        pack_key: tool.packKey ?? null,
        enabled: patch.enabled ?? (tool.enabled ? 1 : 0),
        consent: patch.consent ?? tool.consent,
      };
      await slice.upsertToolSetting(next);
      setSettings((current) => [...current.filter((setting) => setting.tool_name !== toolName), next]);
    },
    [registry, slice]
  );

  const setToolEnabled = useCallback(
    async (toolName: string, enabled: boolean) => {
      log.info('Tool enabled changed', { operation: 'setToolEnabled', tool: toolName, enabled });
      await upsertSetting(toolName, { enabled: enabled ? 1 : 0 });
    },
    [upsertSetting]
  );

  const setToolConsent = useCallback(
    async (toolName: string, consent: AiToolConsent) => {
      log.info('Tool consent changed', { operation: 'setToolConsent', tool: toolName, consent });
      await upsertSetting(toolName, { consent });
    },
    [upsertSetting]
  );

  const importPack = useCallback(
    async (json: string) => {
      const document = parseToolPack(json);
      const packKey = `user:${document.id}`;
      const collisions = document.tools.filter((tool) => {
        const existing = registry.getTool(tool.name);
        return existing && existing.packKey !== packKey;
      });
      if (collisions.length > 0) {
        throw new AiToolPackError(
          collisions.map((tool) => ({ packId: document.id, toolName: tool.name, message: `${tool.name}: a tool with this name already exists` }))
        );
      }
      await slice.upsertToolPack({
        pack_key: packKey,
        name: document.name,
        version: document.version,
        source: 'user',
        enabled: true,
        definition_json: JSON.stringify(document),
      });
      log.info('Imported tool pack', { operation: 'importPack', packKey, tools: document.tools.length });
      setPackRows(await slice.listToolPacks());
    },
    [registry, slice]
  );

  const removePack = useCallback(
    async (packKey: string) => {
      await slice.deleteToolPack(packKey);
      log.info('Removed tool pack', { operation: 'removePack', packKey });
      setPackRows((current) => current.filter((row) => row.pack_key !== packKey));
      setSettings((current) => current.filter((setting) => setting.pack_key !== packKey));
    },
    [slice]
  );

  const setPackEnabled = useCallback(
    async (packKey: string, enabled: boolean) => {
      if (packKey.startsWith('shipped:')) {
        setShippedRows((current) => current.map((row) => (row.pack_key === packKey ? { ...row, enabled: enabled ? 1 : 0 } : row)));
        return;
      }
      await slice.setToolPackEnabled(packKey, enabled);
      setPackRows((current) => current.map((row) => (row.pack_key === packKey ? { ...row, enabled: enabled ? 1 : 0 } : row)));
    },
    [slice]
  );

  const resetToSafeDefaults = useCallback(async () => {
    for (const setting of settings) {
      await slice.deleteToolSetting(setting.tool_name);
    }
    setSettings([]);
    consentManager.clearSessionGrants();
    consentManager.setBypassAll(false);
    log.info('Tool settings reset to safe defaults', { operation: 'resetToSafeDefaults' });
  }, [consentManager, settings, slice]);

  const evaluateConsent = useCallback(
    (tool: AiResolvedTool) => consentManager.evaluate(tool.name, tool.consent),
    [consentManager]
  );

  const setBypassAllConsent = useCallback(
    (enabled: boolean) => {
      log.warn('Consent bypass changed', { operation: 'setBypassAllConsent', enabled });
      consentManager.setBypassAll(enabled);
    },
    [consentManager]
  );

  const revokeSessionGrant = useCallback(
    (toolName: string) => consentManager.revokeSession(toolName),
    [consentManager]
  );

  const value = useMemo<AiToolsContextValue>(
    () => ({
      registry,
      settings,
      shippedPackErrors,
      isLoading,
      error,
      consentManager,
      bypassAllConsent: consentManager.bypassAll,
      sessionGrants: consentManager.listSessionGrants(),
      evaluateConsent,
      setToolEnabled,
      setToolConsent,
      importPack,
      removePack,
      setPackEnabled,
      resetToSafeDefaults,
      setBypassAllConsent,
      revokeSessionGrant,
      reload,
    }),
    // consentVersion changes whenever the manager's state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [consentManager, consentVersion, error, evaluateConsent, importPack, isLoading, registry, reload, removePack, resetToSafeDefaults, setBypassAllConsent, setPackEnabled, setToolConsent, setToolEnabled, settings, shippedPackErrors, revokeSessionGrant]
  );

  return <AiToolsContext.Provider value={value}>{children}</AiToolsContext.Provider>;
}

export function useAiToolsContext(): AiToolsContextValue {
  const value = useContext(AiToolsContext);
  if (!value) {
    throw new Error('useAiToolsContext must be used within an AiToolsContextProvider');
  }
  return value;
}
