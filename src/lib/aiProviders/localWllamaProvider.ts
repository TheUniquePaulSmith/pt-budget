import type {
  ChatCompletionChunk,
  ChatCompletionParams,
  ChatCompletionResponse,
} from '@wllama/wllama/esm';

import type { AiProvider, AiProviderTestResult } from './types';

export const LOCAL_PROVIDER_ID = 'local';
export const LOCAL_PROVIDER_LABEL = 'Local AI';

export interface LocalWllamaRuntime {
  isModelLoaded: boolean;
  modelName?: string | null;
  createChatCompletion: (params: ChatCompletionParams) => Promise<ChatCompletionResponse>;
  createChatCompletionStream: (params: ChatCompletionParams) => Promise<AsyncIterable<ChatCompletionChunk>>;
}

/** Wraps the in-browser wllama runtime (WllamaContext) as a provider. */
export function createLocalWllamaProvider(runtime: LocalWllamaRuntime): AiProvider {
  return {
    id: LOCAL_PROVIDER_ID,
    kind: 'local',
    label: LOCAL_PROVIDER_LABEL,
    model: runtime.modelName ?? '',
    createChatCompletion: runtime.createChatCompletion,
    createChatCompletionStream: runtime.createChatCompletionStream,
    async testConnection(): Promise<AiProviderTestResult> {
      if (runtime.isModelLoaded) {
        return { ok: true, message: `Model loaded${runtime.modelName ? ` (${runtime.modelName})` : ''}` };
      }
      return {
        ok: false,
        message: 'No local model is loaded',
        hint: 'Choose a GGUF file in the Local tab and load it. Pop-out windows must load the model again.',
      };
    },
  };
}
