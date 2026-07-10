'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Wllama,
  type ChatCompletionChunk,
  type ChatCompletionParams,
  type ChatCompletionResponse,
  type LoadModelParams,
  type WllamaLogger,
} from '@wllama/wllama/esm';

import type {
  AiSettingPreset,
  AiModelLoadParams,
  AiModelLoadState,
  AiModelInspectionResult,
  AiRuntimeCapabilities,
  AiSelectedModelFile,
  AiWebGpuLimits,
} from '@/types/ai';
import {
  AI_CONTEXT_SIZE_PRESETS,
  AI_OUTPUT_LIMIT_PRESETS,
} from '@/types/ai';
import { inspectGgufModelFiles } from '@/lib/aiModelFileInspection';

const WLLAMA_LOCAL_PATHS = {
  default: '/wllama/wllama.wasm',
};

const RECENT_WLLAMA_ERRORS: string[] = [];

function formatLogValue(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function recordWllamaError(args: unknown[]) {
  const message = args.map(formatLogValue).join(' ');
  if (!message) {
    return;
  }

  RECENT_WLLAMA_ERRORS.push(message);
}

function clearRecentWllamaErrors() {
  RECENT_WLLAMA_ERRORS.splice(0, RECENT_WLLAMA_ERRORS.length);
}

function getRecentWllamaErrorSummary(fallback: string) {
  const recentErrors = RECENT_WLLAMA_ERRORS;

  if (recentErrors.length === 0) {
    return fallback;
  }

  return `Model failed to load: ${recentErrors.join(' | ')}`;
}

function getRecentWllamaErrors() {
  return RECENT_WLLAMA_ERRORS.slice();
}

const WLLAMA_LOGGER: WllamaLogger = {
  debug: (...args) => console.debug('[wllama]', ...args),
  log: (...args) => console.log('[wllama]', ...args),
  warn: (...args) => console.warn('[wllama]', ...args),
  error: (...args) => {
    recordWllamaError(args);
    console.error('[wllama]', ...args);
  },
};

interface ModelLoadProgress {
  loaded: number;
  total: number;
  percent: number;
}

interface LoadedModelInfo {
  id: string;
  name: string;
  contextLength?: number;
  metadata?: Record<string, string>;
}

const EMPTY_MODEL_INSPECTION: AiModelInspectionResult = {
  status: 'idle',
  files: [],
  totalSizeBytes: 0,
  stats: {},
  issues: [],
};

interface WllamaContextValue {
  selectedModelFiles: AiSelectedModelFile[];
  selectedModelName: string;
  modelInspection: AiModelInspectionResult;
  loadState: AiModelLoadState;
  loadProgress: ModelLoadProgress | null;
  loadParams: AiModelLoadParams;
  loadedModel: LoadedModelInfo | null;
  error: string | null;
  errorDetails: string[];
  capabilities: AiRuntimeCapabilities;
  isModelLoaded: boolean;
  showTokenUsage: boolean;
  contextSizePreset: AiSettingPreset;
  contextSizeTokens: number;
  outputLimitPreset: AiSettingPreset;
  maxOutputTokens: number;
  selectModelFiles: (files: File[]) => void;
  setShowTokenUsage: React.Dispatch<React.SetStateAction<boolean>>;
  setContextSizePreset: React.Dispatch<React.SetStateAction<AiSettingPreset>>;
  setOutputLimitPreset: React.Dispatch<React.SetStateAction<AiSettingPreset>>;
  setLoadParams: React.Dispatch<React.SetStateAction<AiModelLoadParams>>;
  loadSelectedModel: (overrides?: AiModelLoadParams) => Promise<void>;
  unloadModel: () => Promise<void>;
  createChatCompletion: (params: ChatCompletionParams) => Promise<ChatCompletionResponse>;
  createChatCompletionStream: (params: ChatCompletionParams) => Promise<AsyncIterable<ChatCompletionChunk>>;
}

const WllamaContext = createContext<WllamaContextValue | null>(null);

function getDefaultLoadParams(): AiModelLoadParams {
  const hardwareThreads = typeof navigator === 'undefined'
    ? 4
    : Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8));

  return {
    n_batch: 512,
    n_threads: hardwareThreads,
    useCache: true,
  };
}

function detectCapabilities(wllama?: Wllama | null): AiRuntimeCapabilities {
  const navigatorWithMemory = globalThis.navigator as Navigator & {
    deviceMemory?: number;
    gpu?: unknown;
  };
  const performanceWithMemory = globalThis.performance as Performance & {
    memory?: {
      jsHeapSizeLimit?: number;
      totalJSHeapSize?: number;
      usedJSHeapSize?: number;
    };
  };

  return {
    webGpuSupported: wllama?.isSupportWebGPU() ?? Boolean(navigatorWithMemory.gpu),
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    sharedArrayBufferAvailable: typeof globalThis.SharedArrayBuffer !== 'undefined',
    hardwareConcurrency: navigatorWithMemory.hardwareConcurrency,
    deviceMemoryGb: navigatorWithMemory.deviceMemory,
    jsHeapSizeLimitBytes: performanceWithMemory.memory?.jsHeapSizeLimit,
    jsHeapTotalBytes: performanceWithMemory.memory?.totalJSHeapSize,
    jsHeapUsedBytes: performanceWithMemory.memory?.usedJSHeapSize,
    capabilityProbeComplete: false,
  };
}

type BrowserGpuAdapter = {
  limits?: Partial<Record<keyof AiWebGpuLimits, number>>;
  info?: {
    vendor?: string;
    architecture?: string;
    device?: string;
    description?: string;
  };
  requestAdapterInfo?: () => Promise<{
    vendor?: string;
    architecture?: string;
    device?: string;
    description?: string;
  }>;
};

type BrowserNavigatorGpu = Navigator & {
  gpu?: {
    requestAdapter: (options?: { powerPreference?: 'low-power' | 'high-performance' }) => Promise<BrowserGpuAdapter | null>;
  };
};

async function detectDetailedCapabilities(wllama?: Wllama | null): Promise<AiRuntimeCapabilities> {
  const baseCapabilities = detectCapabilities(wllama);
  const browserNavigator = globalThis.navigator as BrowserNavigatorGpu;

  if (!browserNavigator.gpu) {
    return {
      ...baseCapabilities,
      capabilityProbeComplete: true,
    };
  }

  try {
    const adapter = await browserNavigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    });

    if (!adapter) {
      return {
        ...baseCapabilities,
        webGpuProbeError: 'No WebGPU adapter was returned by the browser.',
        capabilityProbeComplete: true,
      };
    }

    const adapterInfo = adapter.info ?? await adapter.requestAdapterInfo?.();
    const limits = adapter.limits;

    return {
      ...baseCapabilities,
      webGpuAdapterName: adapterInfo?.device || adapterInfo?.description,
      webGpuAdapterVendor: adapterInfo?.vendor,
      webGpuAdapterArchitecture: adapterInfo?.architecture,
      webGpuAdapterDescription: adapterInfo?.description,
      webGpuLimits: limits
        ? {
            maxBufferSize: limits.maxBufferSize,
            maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
            maxUniformBufferBindingSize: limits.maxUniformBufferBindingSize,
            maxComputeWorkgroupStorageSize: limits.maxComputeWorkgroupStorageSize,
            maxBindGroups: limits.maxBindGroups,
          }
        : undefined,
      capabilityProbeComplete: true,
    };
  } catch (err) {
    return {
      ...baseCapabilities,
      webGpuProbeError: err instanceof Error ? err.message : 'Failed to inspect WebGPU adapter limits.',
      capabilityProbeComplete: true,
    };
  }
}

function toLoadModelParams(params: AiModelLoadParams): LoadModelParams {
  const { useCache: _useCache, ...loadParams } = params;

  return Object.fromEntries(
    Object.entries(loadParams).filter(([, value]) => value !== undefined)
  ) as LoadModelParams;
}

function sortModelFiles(files: File[]): File[] {
  return [...files].sort((left, right) => left.name.localeCompare(right.name));
}

function validateLoadedContextInfo(contextInfo: ReturnType<Wllama['getLoadedContextInfo']>) {
  if (
    !contextInfo ||
    contextInfo.n_ctx <= 0 ||
    contextInfo.n_layer <= 0 ||
    contextInfo.n_vocab <= 0
  ) {
    throw new Error(getRecentWllamaErrorSummary(
      'Model load did not produce a valid runtime context. Try a smaller model, smaller context, fewer GPU layers, or CPU-only mode.'
    ));
  }
}

export function WllamaProvider({ children }: { children: React.ReactNode }) {
  const wllamaRef = useRef<Wllama | null>(null);
  const selectedModelFileRefs = useRef<File[]>([]);
  const modelInspectionRunRef = useRef(0);
  const [selectedModelFiles, setSelectedModelFiles] = useState<AiSelectedModelFile[]>([]);
  const [modelInspection, setModelInspection] = useState<AiModelInspectionResult>(EMPTY_MODEL_INSPECTION);
  const [loadState, setLoadState] = useState<AiModelLoadState>('idle');
  const [loadProgress, setLoadProgress] = useState<ModelLoadProgress | null>(null);
  const [loadParams, setLoadParams] = useState<AiModelLoadParams>(() => getDefaultLoadParams());
  const [loadedModel, setLoadedModel] = useState<LoadedModelInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string[]>([]);
  const [capabilities, setCapabilities] = useState<AiRuntimeCapabilities>(() => detectCapabilities());
  const [showTokenUsage, setShowTokenUsage] = useState(true);
  const [contextSizePreset, setContextSizePreset] = useState<AiSettingPreset>('medium');
  const [outputLimitPreset, setOutputLimitPreset] = useState<AiSettingPreset>('medium');

  const getWllama = useCallback(() => {
    if (!wllamaRef.current) {
      wllamaRef.current = new Wllama(WLLAMA_LOCAL_PATHS, {
        logger: WLLAMA_LOGGER,
        suppressNativeLog: false,
        allowOffline: true,
        parallelDownloads: 3,
      });
      setCapabilities(detectCapabilities(wllamaRef.current));
      void detectDetailedCapabilities(wllamaRef.current).then(setCapabilities);
    }

    return wllamaRef.current;
  }, []);

  useEffect(() => {
    void detectDetailedCapabilities(wllamaRef.current).then(setCapabilities);
  }, []);

  useEffect(() => () => {
    void wllamaRef.current?.exit();
  }, []);

  const selectedModelName = selectedModelFiles.map((file) => file.name).join(', ');
  const isModelLoaded = loadState === 'loaded' && Boolean(loadedModel);
  const contextSizeTokens = AI_CONTEXT_SIZE_PRESETS[contextSizePreset].tokens;
  const maxOutputTokens = AI_OUTPUT_LIMIT_PRESETS[outputLimitPreset].tokens;

  const selectModelFiles = useCallback((files: File[]) => {
    const ggufFiles = files.filter((file) => file.name.toLowerCase().endsWith('.gguf'));

    if (ggufFiles.length !== files.length) {
      setError('Only GGUF model files can be selected.');
      return;
    }

    const sortedFiles = sortModelFiles(ggufFiles);
    const inspectionRunId = modelInspectionRunRef.current + 1;
    modelInspectionRunRef.current = inspectionRunId;
    selectedModelFileRefs.current = sortedFiles;
    setSelectedModelFiles(sortedFiles.map((file) => ({
      name: file.name,
      sizeBytes: file.size,
      lastModified: file.lastModified,
    })));
    setModelInspection({
      status: sortedFiles.length > 0 ? 'validating' : 'idle',
      files: sortedFiles.map((file) => ({ name: file.name, sizeBytes: file.size })),
      totalSizeBytes: sortedFiles.reduce((total, file) => total + file.size, 0),
      stats: {},
      issues: [],
    });
    setLoadedModel(null);
    setLoadProgress(null);
    setLoadState('idle');
    setError(null);
    setErrorDetails([]);

    void inspectGgufModelFiles(sortedFiles)
      .then((inspection) => {
        if (modelInspectionRunRef.current === inspectionRunId) {
          setModelInspection(inspection);
        }
      })
      .catch((err) => {
        if (modelInspectionRunRef.current === inspectionRunId) {
          setModelInspection({
            status: 'invalid',
            files: sortedFiles.map((file) => ({ name: file.name, sizeBytes: file.size })),
            totalSizeBytes: sortedFiles.reduce((total, file) => total + file.size, 0),
            stats: {},
            issues: [{
              severity: 'error',
              message: err instanceof Error ? err.message : 'Unable to inspect the selected GGUF model file.',
            }],
          });
        }
      });
  }, []);

  const unloadModel = useCallback(async () => {
    if (wllamaRef.current) {
      await wllamaRef.current.exit();
    }

    setLoadedModel(null);
    setLoadProgress(null);
    setLoadState('idle');
  }, []);

  const loadSelectedModel = useCallback(async (overrides: AiModelLoadParams = {}) => {
    const files = selectedModelFileRefs.current;
    if (files.length === 0) {
      throw new Error('Choose a local GGUF model file before loading.');
    }

    if (modelInspection.status === 'validating') {
      throw new Error('Wait for model validation to finish before loading.');
    }

    if (modelInspection.status === 'invalid') {
      throw new Error('Resolve the selected model validation errors before loading.');
    }

    const wllama = getWllama();
    setLoadState('loading-model');
    setLoadProgress(null);
    setError(null);
    setErrorDetails([]);
    setLoadedModel(null);
    clearRecentWllamaErrors();

    try {
      if (wllama.isModelLoaded()) {
        await wllama.exit();
      }

      const params = toLoadModelParams({
        ...loadParams,
        ...overrides,
        n_ctx: contextSizeTokens,
      });

      await wllama.loadModel(files, params);

      const contextInfo = wllama.getLoadedContextInfo();
      validateLoadedContextInfo(contextInfo);
      setLoadedModel({
        id: files.map((file) => `${file.name}-${file.lastModified}`).join('|'),
        name: files.length === 1 ? files[0].name : `${files.length} GGUF files`,
        contextLength: contextInfo.n_ctx,
        metadata: contextInfo.metadata,
      });
      setCapabilities(detectCapabilities(wllama));
      void detectDetailedCapabilities(wllama).then(setCapabilities);
      setLoadState('loaded');
    } catch (err) {
      try {
        await wllama.exit();
      } catch {
        // Ignore cleanup failures after a failed native load.
      }
      setLoadedModel(null);
      setLoadState('error');
      setError(err instanceof Error
        ? getRecentWllamaErrorSummary(err.message)
        : getRecentWllamaErrorSummary('Failed to load AI model'));
      setErrorDetails(getRecentWllamaErrors());
      throw err;
    }
  }, [contextSizeTokens, getWllama, loadParams, modelInspection.status]);

  const createChatCompletion = useCallback(async (
    params: ChatCompletionParams
  ): Promise<ChatCompletionResponse> => {
    const wllama = wllamaRef.current;
    if (!wllama || !wllama.isModelLoaded()) {
      throw new Error('Load an AI model before asking questions.');
    }

    return wllama.createChatCompletion({
      ...params,
      stream: false,
    });
  }, []);

  const createChatCompletionStream = useCallback(async (
    params: ChatCompletionParams
  ): Promise<AsyncIterable<ChatCompletionChunk>> => {
    const wllama = wllamaRef.current;
    if (!wllama || !wllama.isModelLoaded()) {
      throw new Error('Load an AI model before asking questions.');
    }

    return wllama.createChatCompletion({
      ...params,
      stream: true,
    });
  }, []);

  const value = useMemo<WllamaContextValue>(() => ({
    selectedModelFiles,
    selectedModelName,
    modelInspection,
    loadState,
    loadProgress,
    loadParams,
    loadedModel,
    error,
    errorDetails,
    capabilities,
    isModelLoaded,
    showTokenUsage,
    contextSizePreset,
    contextSizeTokens,
    outputLimitPreset,
    maxOutputTokens,
    selectModelFiles,
    setShowTokenUsage,
    setContextSizePreset,
    setOutputLimitPreset,
    setLoadParams,
    loadSelectedModel,
    unloadModel,
    createChatCompletion,
    createChatCompletionStream,
  }), [
    selectedModelFiles,
    selectedModelName,
    modelInspection,
    loadState,
    loadProgress,
    loadParams,
    loadedModel,
    error,
    errorDetails,
    capabilities,
    isModelLoaded,
    showTokenUsage,
    contextSizePreset,
    contextSizeTokens,
    outputLimitPreset,
    maxOutputTokens,
    selectModelFiles,
    loadSelectedModel,
    unloadModel,
    createChatCompletion,
    createChatCompletionStream,
  ]);

  return (
    <WllamaContext.Provider value={value}>
      {children}
    </WllamaContext.Provider>
  );
}

export function useWllamaContext(): WllamaContextValue {
  const context = useContext(WllamaContext);
  if (!context) {
    throw new Error('useWllamaContext must be used within a WllamaProvider');
  }

  return context;
}
