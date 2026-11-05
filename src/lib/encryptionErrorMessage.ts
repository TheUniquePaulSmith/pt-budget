import type { TFunction } from 'i18next';

import { getErrorCode, isEncryptionErrorCode } from './encryptionTypes';

/** The slice of i18next's `t` this helper needs; the typed-key TFunction is widened to it. */
type Translate = (key: string, options?: { defaultValue?: string }) => string;

/**
 * Translates a worker/encryption error for the UI: a known `code` maps to
 * `<prefix>.<CODE>` in the catalogs, anything else falls back to the error's
 * own (English) message, then to `fallback`.
 */
export function describeEncryptionError(
  t: TFunction<any, any>,
  prefix: 'setup:unlockErrors' | 'settings:securityErrors',
  error: unknown,
  fallback: string
): string {
  const code = getErrorCode(error);
  const message = error instanceof Error && error.message ? error.message : fallback;
  if (code && isEncryptionErrorCode(code)) {
    return (t as unknown as Translate)(`${prefix}.${code}`, { defaultValue: message });
  }
  return message;
}
