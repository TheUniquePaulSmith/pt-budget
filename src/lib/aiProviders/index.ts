import { createAnthropicProvider } from './anthropicProvider';
import { createLocalWllamaProvider, type LocalWllamaRuntime } from './localWllamaProvider';
import { createOpenAiCompatibleProvider } from './openAiCompatibleProvider';
import type { AiProvider, AiProviderProfile, FetchLike } from './types';

export * from './types';
export { createAnthropicProvider, ANTHROPIC_DEFAULT_MODEL } from './anthropicProvider';
export { createOpenAiCompatibleProvider } from './openAiCompatibleProvider';
export { createLocalWllamaProvider, LOCAL_PROVIDER_ID, LOCAL_PROVIDER_LABEL } from './localWllamaProvider';
export { AiProviderRequestError } from './providerErrors';

export interface CreateProviderOptions {
  fetchImpl?: FetchLike;
  /** Required to build a provider for a `local` profile. */
  localRuntime?: LocalWllamaRuntime;
}

/** Instantiates the provider a profile describes. */
export function createProviderFromProfile(
  profile: AiProviderProfile,
  options: CreateProviderOptions = {}
): AiProvider {
  switch (profile.kind) {
    case 'anthropic':
      return createAnthropicProvider(profile, { fetchImpl: options.fetchImpl });
    case 'openai':
    case 'openai_compatible':
    case 'local_endpoint':
      return createOpenAiCompatibleProvider(profile, { fetchImpl: options.fetchImpl });
    case 'local':
      if (!options.localRuntime) {
        throw new Error('A local runtime is required for the local provider');
      }
      return createLocalWllamaProvider(options.localRuntime);
    default:
      throw new Error(`Unknown AI provider kind: ${String((profile as { kind: unknown }).kind)}`);
  }
}
