import type { Category, Transaction } from './database';

export type AiWriteMode = 'review' | 'autoApply';

export const AI_SETTING_PRESET_IDS = [
  'extra-small',
  'small',
  'medium',
  'large',
  'extra-large',
] as const;

export type AiSettingPreset = (typeof AI_SETTING_PRESET_IDS)[number];

export interface AiTokenPreset {
  id: AiSettingPreset;
  label: string;
  tokens: number;
}

export const AI_CONTEXT_SIZE_PRESETS: Record<AiSettingPreset, AiTokenPreset> = {
  'extra-small': { id: 'extra-small', label: 'Extra Small', tokens: 1024 },
  small: { id: 'small', label: 'Small', tokens: 2048 },
  medium: { id: 'medium', label: 'Medium', tokens: 4096 },
  large: { id: 'large', label: 'Large', tokens: 8192 },
  'extra-large': { id: 'extra-large', label: 'Extra Large', tokens: 16384 },
};

export const AI_OUTPUT_LIMIT_PRESETS: Record<AiSettingPreset, AiTokenPreset> = {
  'extra-small': { id: 'extra-small', label: 'Extra Small', tokens: 256 },
  small: { id: 'small', label: 'Small', tokens: 512 },
  medium: { id: 'medium', label: 'Medium', tokens: 800 },
  large: { id: 'large', label: 'Large', tokens: 1200 },
  'extra-large': { id: 'extra-large', label: 'Extra Large', tokens: 2000 },
};

export const AI_HIGH_RESOURCE_PRESET_IDS: readonly AiSettingPreset[] = [
  'large',
  'extra-large',
] as const;

export interface AiModelLoadParams {
  n_ctx?: number;
  n_batch?: number;
  n_gpu_layers?: number;
  n_threads?: number;
  useCache?: boolean;
}

export interface AiSelectedModelFile {
  name: string;
  sizeBytes?: number;
  lastModified?: number;
}

export type AiModelLoadState =
  | 'idle'
  | 'loading-model'
  | 'loaded'
  | 'error';

export interface AiRuntimeCapabilities {
  webGpuSupported: boolean;
  crossOriginIsolated: boolean;
  sharedArrayBufferAvailable: boolean;
  hardwareConcurrency?: number;
  deviceMemoryGb?: number;
  jsHeapSizeLimitBytes?: number;
  jsHeapTotalBytes?: number;
  jsHeapUsedBytes?: number;
  webGpuAdapterName?: string;
  webGpuAdapterVendor?: string;
  webGpuAdapterArchitecture?: string;
  webGpuAdapterDescription?: string;
  webGpuLimits?: AiWebGpuLimits;
  webGpuProbeError?: string;
  capabilityProbeComplete?: boolean;
}

export interface AiWebGpuLimits {
  maxBufferSize?: number;
  maxStorageBufferBindingSize?: number;
  maxUniformBufferBindingSize?: number;
  maxComputeWorkgroupStorageSize?: number;
  maxBindGroups?: number;
}

export type AiChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AiChatMessage {
  id: string;
  role: AiChatRole;
  content: string;
  createdAt: string;
  tokenUsage?: AiChatTokenUsage;
}

export interface AiChatTokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface AiToolCallRecord {
  id: string;
  name: string;
  argumentsJson: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
}

export interface AiChatRunResult {
  assistantMessage: string;
  toolCalls: AiToolCallRecord[];
  classificationSuggestions: TransactionClassificationSuggestion[];
  tokenUsage: AiChatTokenUsage;
}

export interface TransactionClassificationSuggestion {
  transactionId: number;
  categoryId?: number | null;
  categoryName?: string | null;
  categoryType?: Category['type'];
  companyId?: number | null;
  companyName?: string | null;
  projectId?: number | null;
  tripId?: number | null;
  confidence?: number;
  reason?: string;
  transaction?: Pick<Transaction, 'id' | 'date' | 'amount' | 'description' | 'category_name' | 'company_name' | 'project_name' | 'trip_name'>;
}

export interface ApplyTransactionClassificationInput {
  transactionId: number;
  categoryId?: number | null;
  categoryName?: string | null;
  categoryType?: Category['type'];
  companyId?: number | null;
  companyName?: string | null;
  projectId?: number | null;
  tripId?: number | null;
}

export interface ApplyTransactionClassificationsResult {
  appliedCount: number;
  transactionIds: number[];
}