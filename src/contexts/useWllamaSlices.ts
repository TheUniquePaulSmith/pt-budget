'use client';

import { useWllamaContext } from './WllamaContext';

export function useAiModelSlice() {
  const ai = useWllamaContext();

  return {
    selectedModelFiles: ai.selectedModelFiles,
    selectedModelName: ai.selectedModelName,
    loadState: ai.loadState,
    loadProgress: ai.loadProgress,
    loadParams: ai.loadParams,
    loadedModel: ai.loadedModel,
    error: ai.error,
    capabilities: ai.capabilities,
    isModelLoaded: ai.isModelLoaded,
    showTokenUsage: ai.showTokenUsage,
    contextSizePreset: ai.contextSizePreset,
    contextSizeTokens: ai.contextSizeTokens,
    outputLimitPreset: ai.outputLimitPreset,
    maxOutputTokens: ai.maxOutputTokens,
    selectModelFiles: ai.selectModelFiles,
    setShowTokenUsage: ai.setShowTokenUsage,
    setContextSizePreset: ai.setContextSizePreset,
    setOutputLimitPreset: ai.setOutputLimitPreset,
    setLoadParams: ai.setLoadParams,
    loadSelectedModel: ai.loadSelectedModel,
    unloadModel: ai.unloadModel,
  };
}

export function useAiChatRuntimeSlice() {
  const ai = useWllamaContext();

  return {
    isModelLoaded: ai.isModelLoaded,
    loadedModel: ai.loadedModel,
    showTokenUsage: ai.showTokenUsage,
    contextSizePreset: ai.contextSizePreset,
    contextSizeTokens: ai.contextSizeTokens,
    maxOutputTokens: ai.maxOutputTokens,
    createChatCompletion: ai.createChatCompletion,
    createChatCompletionStream: ai.createChatCompletionStream,
  };
}