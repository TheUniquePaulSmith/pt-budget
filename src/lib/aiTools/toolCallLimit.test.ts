import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TOOL_CALL_LIMIT,
  MAX_TOOL_CALL_LIMIT,
  MIN_TOOL_CALL_LIMIT,
  normalizeToolCallLimit,
} from './toolCallLimit';

describe('normalizeToolCallLimit', () => {
  it('keeps whole numbers in range and truncates fractions', () => {
    expect(normalizeToolCallLimit(5)).toBe(5);
    expect(normalizeToolCallLimit(5.9)).toBe(5);
    expect(normalizeToolCallLimit('12')).toBe(12);
  });

  it('clamps to the allowed range', () => {
    expect(normalizeToolCallLimit(0)).toBe(MIN_TOOL_CALL_LIMIT);
    expect(normalizeToolCallLimit(-3)).toBe(MIN_TOOL_CALL_LIMIT);
    expect(normalizeToolCallLimit(1000)).toBe(MAX_TOOL_CALL_LIMIT);
  });

  it('falls back to the default for anything that is not a number', () => {
    expect(normalizeToolCallLimit(null)).toBe(DEFAULT_TOOL_CALL_LIMIT);
    expect(normalizeToolCallLimit(undefined)).toBe(DEFAULT_TOOL_CALL_LIMIT);
    expect(normalizeToolCallLimit('')).toBe(DEFAULT_TOOL_CALL_LIMIT);
    expect(normalizeToolCallLimit('lots')).toBe(DEFAULT_TOOL_CALL_LIMIT);
    expect(normalizeToolCallLimit(Number.NaN)).toBe(DEFAULT_TOOL_CALL_LIMIT);
  });
});
