/**
 * Remembers which key slot type last opened the database on this device, so
 * the lock screen can lead with it (and, right after Settings → Lock,
 * start the passkey prompt without a click). A device preference like the
 * language: localStorage, never part of the database.
 */

import type { SlotType } from './encryptionTypes';

export const LAST_UNLOCK_METHOD_STORAGE_KEY = 'budgetTracker_lastUnlockMethod';

const KNOWN: readonly SlotType[] = ['password', 'recovery', 'passkey', 'cloud'];

export function readLastUnlockMethod(): SlotType | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(LAST_UNLOCK_METHOD_STORAGE_KEY);
    return value && (KNOWN as readonly string[]).includes(value) ? (value as SlotType) : null;
  } catch {
    return null;
  }
}

export function rememberLastUnlockMethod(type: SlotType): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LAST_UNLOCK_METHOD_STORAGE_KEY, type);
  } catch {
    // Storage may be unavailable (private mode quotas); the preference is a nicety.
  }
}
