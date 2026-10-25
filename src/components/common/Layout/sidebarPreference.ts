/**
 * Remembers whether the desktop navigation rail is expanded (240 px with
 * labels) or collapsed (64 px icon rail), following the pattern of
 * `THEME_PREFERENCE_STORAGE_KEY` in `src/theme/theme.tsx`.
 */
export const SIDEBAR_EXPANDED_STORAGE_KEY = 'budgetTracker_sidebarExpanded';

export const RAIL_WIDTH_EXPANDED = 240;
export const RAIL_WIDTH_COLLAPSED = 64;
export const APP_BAR_HEIGHT = 48;
export const BOTTOM_NAV_HEIGHT = 56;
/** Height of `DatabaseStatusBar` (fixed, bottom): 32 px content + padding + border. */
export const STATUS_BAR_HEIGHT = 41;

export const DEFAULT_SIDEBAR_EXPANDED = true;

export function readStoredSidebarExpanded(): boolean {
  if (typeof window === 'undefined') {
    return DEFAULT_SIDEBAR_EXPANDED;
  }
  try {
    const stored = window.localStorage.getItem(SIDEBAR_EXPANDED_STORAGE_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
    return DEFAULT_SIDEBAR_EXPANDED;
  } catch {
    return DEFAULT_SIDEBAR_EXPANDED;
  }
}

export function writeStoredSidebarExpanded(expanded: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(SIDEBAR_EXPANDED_STORAGE_KEY, expanded ? 'true' : 'false');
  } catch {
    // Persistence is a convenience; the rail still toggles for this session.
  }
}
