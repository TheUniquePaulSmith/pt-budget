'use client';

// Page-facing slices for the AI feature's tool registry and provider setup.
// Re-exported from useDatabaseSlices.ts (the hub); owned by the AI agent.

import { useDatabaseAiTools, useDatabaseStatus } from './DatabaseContext';

/** Tools tab: packs and per-tool enable/consent settings. */
export function useAiToolsSlice() {
  const aiTools = useDatabaseAiTools();

  return {
    listToolPacks: aiTools.listToolPacks,
    getToolPack: aiTools.getToolPack,
    upsertToolPack: aiTools.upsertToolPack,
    setToolPackEnabled: aiTools.setToolPackEnabled,
    deleteToolPack: aiTools.deleteToolPack,
    listToolSettings: aiTools.listToolSettings,
    upsertToolSetting: aiTools.upsertToolSetting,
    deleteToolSetting: aiTools.deleteToolSetting,
  };
}

/** Provider setup (Local / Cloud): the encrypted-DB-backed profile document. */
export function useAiProviderSlice() {
  const aiTools = useDatabaseAiTools();
  const status = useDatabaseStatus();

  return {
    isDatabaseLoaded: status.isDatabaseLoaded,
    getAiProviderConfig: aiTools.getAiProviderConfig,
    setAiProviderConfig: aiTools.setAiProviderConfig,
    clearAiProviderConfig: aiTools.clearAiProviderConfig,
  };
}
