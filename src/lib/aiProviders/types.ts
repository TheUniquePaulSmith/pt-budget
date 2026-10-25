import type {
  ChatCompletionChunk,
  ChatCompletionParams,
  ChatCompletionResponse,
} from '@wllama/wllama/esm';

/**
 * `local` is the in-browser wllama runtime (never stored as a profile);
 * `local_endpoint` is an OpenAI-compatible server on the user's own machine
 * or network (Ollama, LM Studio, vLLM, ...).
 */
export type AiProviderKind = 'local' | 'local_endpoint' | 'anthropic' | 'openai' | 'openai_compatible';

export const AI_PROVIDER_KINDS: readonly AiProviderKind[] = ['local', 'local_endpoint', 'anthropic', 'openai', 'openai_compatible'];

/** Kinds that are stored as profiles (everything except the in-browser runtime). */
export type AiProfileKind = Exclude<AiProviderKind, 'local'>;

/** Profile kinds that talk to a hosted service. */
export type AiCloudProviderKind = Exclude<AiProfileKind, 'local_endpoint'>;

/**
 * A stored provider profile. Profiles (including API keys) live only in the
 * encrypted database under the `ai.provider.config` app_metadata key; they
 * are never mirrored to localStorage and must be passed through
 * `redactProfile()` before logging.
 */
export interface AiProviderProfile {
  id: string;
  kind: AiProviderKind;
  label: string;
  baseUrl?: string;
  apiKey?: string;
  model: string;
  isActive: boolean;
  /**
   * Send requests with `credentials: 'include'` so the browser presents the
   * client certificate (e.g. an imported PFX) the endpoint demands for mTLS.
   * The certificate itself stays in the system store; the app never sees it.
   */
  useClientCertificate?: boolean;
}

export interface AiProviderConfigDocument {
  version: 1;
  profiles: AiProviderProfile[];
}

export interface AiProviderTestResult {
  ok: boolean;
  message: string;
  /** Extra guidance (e.g. how to fix a CORS failure). */
  hint?: string;
  latencyMs?: number;
  /** Model ids the endpoint reports, sorted; populates the model drop-down. */
  models?: string[];
}

/** The chat-loop seam: every provider speaks the OpenAI-shaped wllama types. */
export interface AiProvider {
  id: string;
  kind: AiProviderKind;
  label: string;
  model: string;
  createChatCompletion: (params: ChatCompletionParams) => Promise<ChatCompletionResponse>;
  createChatCompletionStream: (params: ChatCompletionParams) => Promise<AsyncIterable<ChatCompletionChunk>>;
  testConnection: () => Promise<AiProviderTestResult>;
}

export type FetchLike = typeof fetch;

export const AI_PROVIDER_DEFAULT_MODELS: Record<AiProfileKind, string> = {
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-4o-mini',
  openai_compatible: '',
  local_endpoint: '',
};

export const AI_PROVIDER_DEFAULT_BASE_URLS: Record<AiProfileKind, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  openai_compatible: 'http://localhost:11434/v1',
  local_endpoint: 'http://localhost:11434/v1',
};

/** Common OpenAI-compatible local servers, offered as presets in the setup form. */
export const AI_OPENAI_COMPATIBLE_PRESETS: ReadonlyArray<{ label: string; baseUrl: string; model: string }> = [
  { label: 'Ollama', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
  { label: 'LM Studio', baseUrl: 'http://localhost:1234/v1', model: '' },
  { label: 'vLLM', baseUrl: 'http://localhost:8000/v1', model: '' },
];
