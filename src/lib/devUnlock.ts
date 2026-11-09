/**
 * Development-only automatic unlock (`npm run dev:unlocked`).
 *
 * The launcher (scripts/dev-unlocked.mjs) generates a random secret once per
 * repository clone, keeps it outside version control, and starts `next dev`
 * with it as NEXT_PUBLIC_DEV_UNLOCK_SECRET. Under that server the secret is
 * the database's password master secret: a new database is created with it
 * (the password step of setup is answered automatically) and an existing one
 * is unlocked with it on every page load, so an agent that reloads the app
 * while editing never lands on the unlock screen. Nothing else changes —
 * the worker, the key slots and the lock screen are the production ones.
 *
 * Both checks are compile-time constants for Next: `next build` forces
 * NODE_ENV=production, so the feature is dead code in every static export,
 * whatever environment the build machine has. Settings → Lock is deliberately
 * not overridden; an explicit lock still shows the unlock screen.
 */

import type { MasterSecret } from './encryptionTypes';

/** The primary user a database created under `dev:unlocked` starts with. */
export const DEV_UNLOCK_PRIMARY_USER_NAME = 'Developer';

/** Shorter values are refused so a stray `=1` can never become a weak password. */
const MIN_SECRET_LENGTH = 16;

/** The dev server's unlock secret, or null when automatic unlock is off (every non-`dev:unlocked` run). */
export function getDevUnlockSecret(): string | null {
  if (process.env.NODE_ENV !== 'development') return null;
  const secret = process.env.NEXT_PUBLIC_DEV_UNLOCK_SECRET;
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) return null;
  return secret;
}

/** The dev secret as the password master secret, or null when automatic unlock is off. */
export function getDevUnlockMaster(): MasterSecret | null {
  const secret = getDevUnlockSecret();
  return secret ? { type: 'password', secret } : null;
}
