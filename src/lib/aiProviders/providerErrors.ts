import type { AiProviderTestResult } from './types';

/** Thrown by cloud providers; carries the HTTP status when one was received. */
export class AiProviderRequestError extends Error {
  readonly status?: number;
  readonly isNetworkError: boolean;

  constructor(message: string, options: { status?: number; isNetworkError?: boolean; cause?: unknown } = {}) {
    super(message);
    this.name = 'AiProviderRequestError';
    this.status = options.status;
    this.isNetworkError = options.isNetworkError ?? false;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/**
 * A `fetch` that rejects (rather than returning a response) from a browser
 * almost always means the endpoint refused the cross-origin request, is
 * unreachable, or blocks mixed content. Surface that as a hint.
 */
export function describeNetworkFailure(baseUrl: string, options: { clientCertificate?: boolean } = {}): string {
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(baseUrl);
  const base = isLocal
    ? 'The browser could not reach the endpoint. Local servers must allow this origin: for Ollama set OLLAMA_ORIGINS to this app\'s origin, for LM Studio enable CORS in the server settings, for vLLM pass --allowed-origins.'
    : 'The browser could not reach the endpoint (network error or CORS). The server must send Access-Control-Allow-Origin for this app, and https pages cannot call http endpoints.';
  if (!options.clientCertificate) {
    return base;
  }
  return `${base} With a client certificate the server must also send Access-Control-Allow-Credentials: true and an explicit Access-Control-Allow-Origin (not *), and the PFX must be imported into your system certificate store (restart the browser afterwards). Opening the base URL in a new tab shows the certificate prompt or error that fetch hides.`;
}

export async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text) {
      return '';
    }
    try {
      const json = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
      if (typeof json.error === 'string') {
        return json.error;
      }
      if (json.error && typeof json.error === 'object' && typeof json.error.message === 'string') {
        return json.error.message;
      }
      if (typeof json.message === 'string') {
        return json.message;
      }
    } catch {
      // not JSON
    }
    return text.slice(0, 300);
  } catch {
    return '';
  }
}

export function describeHttpFailure(status: number, body: string): string {
  const detail = body ? `: ${body}` : '';
  if (status === 401 || status === 403) {
    return `Authentication failed (HTTP ${status})${detail}`;
  }
  if (status === 404) {
    return `Endpoint not found (HTTP 404)${detail}. Check the base URL and model name.`;
  }
  if (status === 429) {
    return `Rate limited (HTTP 429)${detail}`;
  }
  return `Request failed (HTTP ${status})${detail}`;
}

export function toTestResult(
  error: unknown,
  baseUrl: string,
  startedAt: number,
  options: { clientCertificate?: boolean } = {}
): AiProviderTestResult {
  const latencyMs = Math.round(performance.now() - startedAt);
  if (error instanceof AiProviderRequestError) {
    return {
      ok: false,
      message: error.message,
      hint: error.isNetworkError ? describeNetworkFailure(baseUrl, options) : undefined,
      latencyMs,
    };
  }
  if (error instanceof TypeError) {
    return {
      ok: false,
      message: 'Connection failed',
      hint: describeNetworkFailure(baseUrl, options),
      latencyMs,
    };
  }
  return {
    ok: false,
    message: error instanceof Error ? error.message : 'Connection failed',
    latencyMs,
  };
}

/** Wraps `fetch` so a rejected promise becomes an `AiProviderRequestError` with a network flag. */
export async function fetchOrThrow(fetchImpl: typeof fetch, input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(input, init);
  } catch (error) {
    if (init.signal?.aborted) {
      throw error;
    }
    throw new AiProviderRequestError('Connection failed', { isNetworkError: true, cause: error });
  }
}
