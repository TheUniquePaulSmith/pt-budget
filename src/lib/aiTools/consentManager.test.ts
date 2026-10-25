import { describe, expect, it, vi } from 'vitest';

import { AI_CONSENT_BYPASS_KEY, AI_CONSENT_SESSION_KEY, ConsentManager } from './consentManager';

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
    dump: () => Object.fromEntries(map),
  };
}

describe('ConsentManager', () => {
  it('maps persisted policies to verdicts', () => {
    const manager = new ConsentManager({ storage: null });
    expect(manager.evaluate('t', 'always')).toBe('allow');
    expect(manager.evaluate('t', 'ask')).toBe('ask');
    expect(manager.evaluate('t', 'deny')).toBe('deny');
  });

  it('turns ask into allow after a session grant, and deny always wins', () => {
    const manager = new ConsentManager({ storage: null });
    manager.grantSession('create_transaction');
    expect(manager.evaluate('create_transaction', 'ask')).toBe('allow');
    expect(manager.evaluate('other_tool', 'ask')).toBe('ask');
    expect(manager.evaluate('create_transaction', 'deny')).toBe('deny');

    manager.revokeSession('create_transaction');
    expect(manager.evaluate('create_transaction', 'ask')).toBe('ask');
  });

  it('bypass allows every ask but never a deny', () => {
    const manager = new ConsentManager({ storage: null });
    manager.setBypassAll(true);
    expect(manager.evaluate('x', 'ask')).toBe('allow');
    expect(manager.evaluate('x', 'deny')).toBe('deny');
    manager.setBypassAll(false);
    expect(manager.evaluate('x', 'ask')).toBe('ask');
  });

  it('applies user decisions', () => {
    const manager = new ConsentManager({ storage: null });
    expect(manager.applyDecision('t', 'allow_once')).toEqual({ verdict: 'allow' });
    expect(manager.hasSessionGrant('t')).toBe(false);

    expect(manager.applyDecision('t', 'allow_session')).toEqual({ verdict: 'allow' });
    expect(manager.hasSessionGrant('t')).toBe(true);

    expect(manager.applyDecision('u', 'allow_always')).toEqual({ verdict: 'allow', persistPolicy: 'always' });
    expect(manager.applyDecision('v', 'deny')).toEqual({ verdict: 'deny' });
  });

  it('mirrors session grants and bypass to storage and restores them', () => {
    const storage = memoryStorage();
    const manager = new ConsentManager({ storage });
    manager.grantSession('a');
    manager.grantSession('b');
    manager.setBypassAll(true);

    expect(JSON.parse(storage.dump()[AI_CONSENT_SESSION_KEY])).toEqual(['a', 'b']);
    expect(storage.dump()[AI_CONSENT_BYPASS_KEY]).toBe('true');

    const restored = new ConsentManager({ storage });
    expect(restored.listSessionGrants()).toEqual(['a', 'b']);
    expect(restored.bypassAll).toBe(true);

    restored.clearSessionGrants();
    restored.setBypassAll(false);
    expect(storage.dump()[AI_CONSENT_SESSION_KEY]).toBe('[]');
    expect(storage.dump()[AI_CONSENT_BYPASS_KEY]).toBeUndefined();
  });

  it('survives corrupt storage and notifies subscribers', () => {
    const storage = memoryStorage({ [AI_CONSENT_SESSION_KEY]: 'not json' });
    const manager = new ConsentManager({ storage });
    expect(manager.listSessionGrants()).toEqual([]);

    const listener = vi.fn();
    const unsubscribe = manager.subscribe(listener);
    manager.grantSession('x');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    manager.grantSession('y');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
