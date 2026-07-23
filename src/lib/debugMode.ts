/** True when the app was loaded with `?debug` in the URL — gates debug-only UI like Reset App. */
export function isDebugMode(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('debug');
}
