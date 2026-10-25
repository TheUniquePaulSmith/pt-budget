/**
 * How many rounds of tool calls the assistant may run for one question. A
 * round is one model turn that asks for tools (it may request several tools at
 * once); after the last allowed round the model gets one more turn, without
 * further tool use, to answer from what it already collected.
 */

export const DEFAULT_TOOL_CALL_LIMIT = 8;
export const MIN_TOOL_CALL_LIMIT = 1;
export const MAX_TOOL_CALL_LIMIT = 25;

/** Clamps a stored or typed value to a whole number in range; anything else becomes the default. */
export function normalizeToolCallLimit(value: unknown): number {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    return DEFAULT_TOOL_CALL_LIMIT;
  }
  return Math.min(MAX_TOOL_CALL_LIMIT, Math.max(MIN_TOOL_CALL_LIMIT, Math.trunc(parsed)));
}
