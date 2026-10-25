import type { AiToolConsent } from './database';

/** CRUD class of a tool; drives grouping, consent defaults and the enabled default. */
export type AiToolCrud = 'create' | 'read' | 'update' | 'delete' | 'mixed';

export const AI_TOOL_CRUDS: readonly AiToolCrud[] = ['read', 'create', 'update', 'delete', 'mixed'];

export type AiToolSource = 'builtin' | 'pack';

/** JSON-schema-ish object description used by every tool (OpenAI `parameters` shape). */
export interface AiToolInputSchema {
  type: 'object';
  properties: Record<string, AiToolPropertySchema>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface AiToolPropertySchema {
  type: string | string[];
  description?: string;
  enum?: Array<string | number>;
  items?: unknown;
  properties?: Record<string, AiToolPropertySchema>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

/**
 * One entry of the AI tool registry. Built-in tools are TypeScript; pack
 * tools are declarative JSON (see `AiToolPackDocument`).
 */
export interface AiToolDefinition {
  name: string;
  description: string;
  inputSchema: AiToolInputSchema;
  crud: AiToolCrud;
  /** Display group, e.g. "Transactions", "Budget", or the pack name. */
  group: string;
  /** Consent policy applied when the user has not chosen one. */
  consentDefault: AiToolConsent;
  source: AiToolSource;
  packKey?: string;
  /** Enabled when the user has not chosen; deletes default to off. */
  enabled: boolean;
}

/** Registry entry after per-tool settings have been applied. */
export interface AiResolvedTool extends AiToolDefinition {
  consent: AiToolConsent;
  /** True when the user explicitly stored a setting for this tool. */
  hasUserSetting: boolean;
}

export type AiToolPackResultMode = 'rows' | 'changes';

/** One tool inside a declarative JSON pack. */
export interface AiToolPackToolDocument {
  name: string;
  description: string;
  inputSchema: AiToolInputSchema;
  crud: AiToolCrud;
  consent?: AiToolConsent;
  /** A single SQL statement with `:param` placeholders bound from validated args. */
  sql: string;
  resultMode: AiToolPackResultMode;
}

/** Schema of `public/ai-tool-packs/*.json` and of user-imported packs. */
export interface AiToolPackDocument {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  tools: AiToolPackToolDocument[];
}

export interface AiToolPackValidationError {
  packId?: string;
  toolName?: string;
  message: string;
}

/** A pack that failed to load, surfaced in the Tools tab. */
export interface AiToolPackLoadError {
  packKey: string;
  packName?: string;
  errors: AiToolPackValidationError[];
}

export type AiConsentDecision = 'allow_once' | 'allow_session' | 'allow_always' | 'deny';

/** Outcome of evaluating a tool call against policy and session grants. */
export type AiConsentVerdict = 'allow' | 'deny' | 'ask';

/** What the chat loop hands the UI while it waits for the user. */
export interface AiConsentRequest {
  id: string;
  toolCallId: string;
  toolName: string;
  crud: AiToolCrud;
  description: string;
  argumentsJson: string;
  source: AiToolSource;
  packKey?: string;
}
