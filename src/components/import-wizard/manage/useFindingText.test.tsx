// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { afterAll, describe, expect, it } from 'vitest';

import { changeLanguage, i18n } from '@/lib/i18n';
import { ALL_IMPORT_ISSUE_CODES } from '@/lib/statementImport/issueCodes';

import { useFindingText } from './useFindingText';

// Against the issue catalog as it ships (importIssues.json), not a stand-in:
// the history only stores a count per code, so every title has to come out
// whole from a code and a count alone.

function findingText() {
  return renderHook(() => useFindingText()).result.current;
}

afterAll(async () => {
  await changeLanguage('en-US');
});

describe('useFindingText', () => {
  it('lets a plural title carry the count, formatted', () => {
    const text = findingText();
    expect(text('unreadableDate', 1)).toBe('1 row has a date we cannot read');
    expect(text('unreadableDate', 3)).toBe('3 rows have a date we cannot read');
    expect(text('futureDate', 1234)).toBe('1,234 rows are dated in the future');
  });

  it('adds the count to a plain title only when there is more than one', () => {
    const text = findingText();
    expect(text('signAssumed', 1)).toBe('Check which amounts are money in and money out');
    expect(text('alreadyImported', 3)).toBe('Rows you have already imported: 3');
    expect(text('accountAssumedByLastFour', 2)).toBe('Account assumed from the last four digits: 2');
  });

  it('uses its own label where the title names something the stored summary does not keep', () => {
    const text = findingText();
    expect(text('columnNotImported', 2)).toBe('Columns not imported: 2');
    expect(text('columnNotImported', 1)).toBe('Columns not imported');
    expect(text('referenceNotUnique', 1)).toBe('Bank reference not used to spot duplicates');
    expect(text('currencyMismatch', 5)).toBe('Rows in a different currency from the account: 5');
  });

  it('shows a code the catalog does not know as the code', () => {
    const text = findingText();
    expect(text('retiredFinding', 1)).toBe('retiredFinding');
    expect(text('retiredFinding', 4)).toBe('retiredFinding: 4');
  });

  it.each(['en-US', 'de', 'ja'] as const)('never leaves a placeholder or a bare code for any issue code (%s)', async (language) => {
    await changeLanguage(language);
    const text = findingText();

    for (const code of ALL_IMPORT_ISSUE_CODES) {
      for (const count of [1, 2, 1234]) {
        const result = text(code, count);
        expect(result, `${language} ${code} × ${count}`).not.toContain('{{');
        expect(result, `${language} ${code} × ${count}`).not.toContain(code);
        expect(result.trim(), `${language} ${code} × ${count}`).not.toBe('');
      }
    }
  });
});
