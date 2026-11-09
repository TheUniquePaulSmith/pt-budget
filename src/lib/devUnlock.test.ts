import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEV_UNLOCK_PRIMARY_USER_NAME, getDevUnlockMaster, getDevUnlockSecret } from './devUnlock';

const SECRET = 'dev-secret-0123456789abcdef';

describe('devUnlock', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is off outside next dev, even with a secret in the environment', () => {
    vi.stubEnv('NEXT_PUBLIC_DEV_UNLOCK_SECRET', SECRET);
    for (const env of ['test', 'production']) {
      vi.stubEnv('NODE_ENV', env);
      expect(getDevUnlockSecret()).toBeNull();
      expect(getDevUnlockMaster()).toBeNull();
    }
  });

  it('is off in next dev without a secret', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_DEV_UNLOCK_SECRET', '');
    expect(getDevUnlockSecret()).toBeNull();
  });

  it('refuses a short secret so a stray flag never becomes a weak password', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_DEV_UNLOCK_SECRET', '1');
    expect(getDevUnlockSecret()).toBeNull();
  });

  it('returns the secret as the password master secret under next dev', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_DEV_UNLOCK_SECRET', SECRET);
    expect(getDevUnlockSecret()).toBe(SECRET);
    expect(getDevUnlockMaster()).toEqual({ type: 'password', secret: SECRET });
    expect(DEV_UNLOCK_PRIMARY_USER_NAME).toBe('Developer');
  });
});
