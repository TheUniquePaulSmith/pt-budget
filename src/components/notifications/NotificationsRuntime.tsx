'use client';

/**
 * Headless runtime for notifications, mounted once by the app shell.
 *
 * The notifications feature puts its effects here: scan on database open,
 * rescan on `database_changed` (debounced, re-entrancy guarded), and OS
 * notifications for newly due rows. Keeping the effects here rather than in
 * the bell means they run even when the bell is not rendered.
 *
 * Foundation: no-op.
 */

export default function NotificationsRuntime(): null {
  return null;
}
