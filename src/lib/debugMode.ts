/** True when the app was loaded with `?debug` in the URL — gates debug-only UI like Reset App. */
export function isDebugMode(): boolean {
  return getDebugFlags().debug;
}

export interface DebugFlags {
  /** `?debug` or `?debug=true`: debug-level logging is captured and debug-only UI is shown. */
  debug: boolean;
  /** `?debug_output_console=true`: every captured log record is also echoed to the browser console. */
  debugOutputConsole: boolean;
}

function flagFromParams(params: URLSearchParams, name: string): boolean {
  if (!params.has(name)) return false;
  const value = params.get(name);
  return value === null || value === '' || !/^(0|false|off|no)$/i.test(value);
}

/** Debug-related query parameters, read fresh from the current URL each call. */
export function getDebugFlags(): DebugFlags {
  if (typeof window === 'undefined') {
    return { debug: false, debugOutputConsole: false };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    debug: flagFromParams(params, 'debug'),
    debugOutputConsole: flagFromParams(params, 'debug_output_console'),
  };
}
