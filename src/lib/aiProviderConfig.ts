/**
 * Pure helpers for the AI provider profile document stored under the
 * `ai.provider.config` app_metadata key (encrypted database). Nothing here
 * touches localStorage; the document contains API keys.
 */
import {
  AI_PROVIDER_DEFAULT_BASE_URLS,
  AI_PROVIDER_DEFAULT_MODELS,
  AI_PROVIDER_KINDS,
  type AiProviderConfigDocument,
  type AiProviderKind,
  type AiProviderProfile,
} from './aiProviders/types';

export const EMPTY_PROVIDER_CONFIG: AiProviderConfigDocument = { version: 1, profiles: [] };

export function createProfileId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `profile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function isCloudKind(kind: AiProviderKind): kind is Exclude<AiProviderKind, 'local'> {
  return kind !== 'local';
}

export function kindLabel(kind: AiProviderKind): string {
  switch (kind) {
    case 'anthropic':
      return 'Anthropic';
    case 'openai':
      return 'OpenAI';
    case 'openai_compatible':
      return 'OpenAI-compatible';
    default:
      return 'Local';
  }
}

/** Builds a blank cloud profile with the kind's defaults filled in. */
export function createDefaultProfile(kind: Exclude<AiProviderKind, 'local'>): AiProviderProfile {
  return {
    id: createProfileId(),
    kind,
    label: kindLabel(kind),
    baseUrl: AI_PROVIDER_DEFAULT_BASE_URLS[kind],
    apiKey: '',
    model: AI_PROVIDER_DEFAULT_MODELS[kind],
    isActive: false,
  };
}

function isProfile(value: unknown): value is AiProviderProfile {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    AI_PROVIDER_KINDS.includes(record.kind as AiProviderKind) &&
    typeof record.label === 'string' &&
    typeof record.model === 'string'
  );
}

/** Accepts whatever was stored and returns a well-formed document (or empty). */
export function normalizeProviderConfig(raw: unknown): AiProviderConfigDocument {
  if (typeof raw !== 'object' || raw === null) {
    return EMPTY_PROVIDER_CONFIG;
  }
  const profilesRaw = (raw as { profiles?: unknown }).profiles;
  if (!Array.isArray(profilesRaw)) {
    return EMPTY_PROVIDER_CONFIG;
  }

  const profiles = profilesRaw.filter(isProfile).map((profile) => ({
    id: profile.id,
    kind: profile.kind,
    label: profile.label,
    baseUrl: typeof profile.baseUrl === 'string' ? profile.baseUrl : undefined,
    apiKey: typeof profile.apiKey === 'string' ? profile.apiKey : undefined,
    model: profile.model,
    isActive: profile.isActive === true,
  }));

  // At most one active profile.
  let seenActive = false;
  for (const profile of profiles) {
    if (profile.isActive) {
      if (seenActive) {
        profile.isActive = false;
      }
      seenActive = true;
    }
  }

  return { version: 1, profiles };
}

export function upsertProfile(config: AiProviderConfigDocument, profile: AiProviderProfile): AiProviderConfigDocument {
  const exists = config.profiles.some((candidate) => candidate.id === profile.id);
  const profiles = exists
    ? config.profiles.map((candidate) => (candidate.id === profile.id ? { ...profile } : candidate))
    : [...config.profiles, { ...profile }];
  const next = { version: 1 as const, profiles };
  return profile.isActive ? setActiveProfile(next, profile.id) : next;
}

export function removeProfile(config: AiProviderConfigDocument, profileId: string): AiProviderConfigDocument {
  return { version: 1, profiles: config.profiles.filter((profile) => profile.id !== profileId) };
}

/** `null` makes the local runtime active (no cloud profile selected). */
export function setActiveProfile(config: AiProviderConfigDocument, profileId: string | null): AiProviderConfigDocument {
  return {
    version: 1,
    profiles: config.profiles.map((profile) => ({ ...profile, isActive: profile.id === profileId })),
  };
}

export function getActiveProfile(config: AiProviderConfigDocument): AiProviderProfile | null {
  return config.profiles.find((profile) => profile.isActive) ?? null;
}

export function redactApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    return '';
  }
  const trimmed = apiKey.trim();
  if (trimmed.length <= 8) {
    return '••••';
  }
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

/** Safe-to-log copy of a profile (key replaced by a redacted marker). */
export function redactProfile(profile: AiProviderProfile): Omit<AiProviderProfile, 'apiKey'> & { apiKey: string } {
  return { ...profile, apiKey: profile.apiKey ? '[redacted]' : '' };
}

export interface ProfileValidationResult {
  valid: boolean;
  errors: Partial<Record<'label' | 'baseUrl' | 'apiKey' | 'model', string>>;
}

export function validateProfile(profile: AiProviderProfile): ProfileValidationResult {
  const errors: ProfileValidationResult['errors'] = {};

  if (!profile.label.trim()) {
    errors.label = 'Give the profile a name.';
  }
  if (!profile.model.trim()) {
    errors.model = 'Enter the model name.';
  }
  if (profile.kind === 'openai_compatible' || profile.kind === 'openai' || profile.kind === 'anthropic') {
    const baseUrl = (profile.baseUrl ?? '').trim();
    if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
      errors.baseUrl = 'The base URL must start with http:// or https://.';
    }
    if (profile.kind === 'openai_compatible' && !baseUrl) {
      errors.baseUrl = 'Enter the server base URL (e.g. http://localhost:11434/v1).';
    }
  }
  if ((profile.kind === 'anthropic' || profile.kind === 'openai') && !(profile.apiKey ?? '').trim()) {
    errors.apiKey = 'An API key is required.';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}
