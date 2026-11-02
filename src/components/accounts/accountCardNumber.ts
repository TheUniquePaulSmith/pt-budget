/** Error codes the UI maps through `t('accounts:validation.<code>')`. */
export type CardNumberErrorCode = 'cardDigitsRequired';

export type ParsedCardNumber =
  | { ok: true; last_four: string; full_number: string | null }
  | { ok: false; error: CardNumberErrorCode };

// Accepts either a full account/card number or just the last 4 digits.
// Only the last 4 digits are ever shown elsewhere in the app; the full
// number (if provided) is stored solely to disambiguate cards that share
// a last_four across different accounts.
export function parseCardNumberInput(input: string): ParsedCardNumber {
  const digits = input.replace(/\D/g, '');

  if (digits.length < 4) {
    return { ok: false, error: 'cardDigitsRequired' };
  }

  if (digits.length === 4) {
    return { ok: true, last_four: digits, full_number: null };
  }

  return { ok: true, last_four: digits.slice(-4), full_number: digits };
}
