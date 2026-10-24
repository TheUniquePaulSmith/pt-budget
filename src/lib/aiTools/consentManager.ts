import type { AiToolConsent } from '@/types/database';
import type { AiConsentDecision, AiConsentVerdict } from '@/types/aiTools';

/**
 * sessionStorage key for "allow this session" grants. `window.open` copies
 * sessionStorage into the pop-out window, so grants made in the main window
 * carry over to the pop-out for the rest of the session (intended).
 */
export const AI_CONSENT_SESSION_KEY = 'ptbudget.ai.consent.session';
export const AI_CONSENT_BYPASS_KEY = 'ptbudget.ai.consent.bypass';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ConsentManagerOptions {
  /** Defaults to `window.sessionStorage` when available; pass `null` for memory-only. */
  storage?: StorageLike | null;
}

function resolveStorage(options: ConsentManagerOptions): StorageLike | null {
  if (options.storage !== undefined) {
    return options.storage;
  }
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/**
 * Decides whether a tool call may run. Persisted per-tool policy
 * (`ai_tool_settings.consent`) is combined with in-memory session grants and
 * the global bypass switch. Pure apart from the optional storage mirror.
 */
export class ConsentManager {
  private readonly storage: StorageLike | null;
  private sessionGrants = new Set<string>();
  private bypass = false;
  private readonly listeners = new Set<() => void>();

  constructor(options: ConsentManagerOptions = {}) {
    this.storage = resolveStorage(options);
    this.restore();
  }

  private restore(): void {
    if (!this.storage) {
      return;
    }
    try {
      const raw = this.storage.getItem(AI_CONSENT_SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          this.sessionGrants = new Set(parsed.filter((item): item is string => typeof item === 'string'));
        }
      }
      this.bypass = this.storage.getItem(AI_CONSENT_BYPASS_KEY) === 'true';
    } catch {
      this.sessionGrants = new Set();
      this.bypass = false;
    }
  }

  private persist(): void {
    if (this.storage) {
      try {
        this.storage.setItem(AI_CONSENT_SESSION_KEY, JSON.stringify(Array.from(this.sessionGrants)));
        if (this.bypass) {
          this.storage.setItem(AI_CONSENT_BYPASS_KEY, 'true');
        } else {
          this.storage.removeItem(AI_CONSENT_BYPASS_KEY);
        }
      } catch {
        // Storage may be unavailable (private mode); grants stay in memory.
      }
    }
    for (const listener of this.listeners) {
      listener();
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get bypassAll(): boolean {
    return this.bypass;
  }

  setBypassAll(enabled: boolean): void {
    this.bypass = enabled;
    this.persist();
  }

  hasSessionGrant(toolName: string): boolean {
    return this.sessionGrants.has(toolName);
  }

  listSessionGrants(): string[] {
    return Array.from(this.sessionGrants);
  }

  grantSession(toolName: string): void {
    this.sessionGrants.add(toolName);
    this.persist();
  }

  revokeSession(toolName: string): void {
    this.sessionGrants.delete(toolName);
    this.persist();
  }

  clearSessionGrants(): void {
    this.sessionGrants.clear();
    this.persist();
  }

  /**
   * Policy precedence: `deny` always wins over bypass and session grants;
   * `always` runs; `ask` runs when bypass is on or a session grant exists,
   * otherwise the user is asked.
   */
  evaluate(toolName: string, policy: AiToolConsent): AiConsentVerdict {
    if (policy === 'deny') {
      return 'deny';
    }
    if (policy === 'always') {
      return 'allow';
    }
    if (this.bypass || this.sessionGrants.has(toolName)) {
      return 'allow';
    }
    return 'ask';
  }

  /**
   * Records a user decision. Returns the verdict for the pending call and,
   * for "always", the policy the caller should persist.
   */
  applyDecision(toolName: string, decision: AiConsentDecision): { verdict: 'allow' | 'deny'; persistPolicy?: AiToolConsent } {
    switch (decision) {
      case 'allow_once':
        return { verdict: 'allow' };
      case 'allow_session':
        this.grantSession(toolName);
        return { verdict: 'allow' };
      case 'allow_always':
        return { verdict: 'allow', persistPolicy: 'always' };
      case 'deny':
      default:
        return { verdict: 'deny' };
    }
  }
}
