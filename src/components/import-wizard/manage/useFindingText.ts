'use client';

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';

/** `t` for keys the typed catalog cannot check (they are built from a stored issue code). */
type LooseTranslate = (key: string, options?: Record<string, unknown>) => string;

const UNFILLED_PLACEHOLDER = /\{\{[^}]*\}\}/;

/**
 * One finding of an import as the history shows it: what the analysis found
 * and how often. The stored summary keeps a count per issue code and nothing
 * else, so the text comes from the issue catalog (`importIssues:issues.<code>`)
 * like this:
 *
 *   - a code with a `summary` uses it: the catalog's wording for a place that
 *     has a count and nothing else, written for titles that name a column or
 *     a currency, or that only make sense while the import is still open
 *     ("Columns not imported: 2");
 *   - a plural `title` gets the count and is complete
 *     ("3 rows have a date we cannot read");
 *   - a plain `title` is followed by the count when there is more than one
 *     ("Rows you have already imported: 3");
 *   - a code with no text (a stored summary can outlive its code) is shown
 *     as the code itself.
 */
export function useFindingText(): (code: string, count: number) => string {
  const { t, i18n } = useTranslation(['importManage', 'importIssues']);
  const { number } = useFormatters();

  return useCallback(
    (code: string, count: number) => {
      const translate = t as unknown as LooseTranslate;
      const withCount = (title: string) =>
        count > 1 ? translate('importManage:history.finding', { title, count: number(count) }) : title;

      const summaryKey = `importIssues:issues.${code}.summary`;
      if (i18n.exists(summaryKey)) return withCount(translate(summaryKey));

      const titleKey = `importIssues:issues.${code}.title`;
      if (i18n.exists(titleKey, { count })) {
        // `count` picks the plural form; what is printed is the formatted number.
        const title = translate(titleKey, { count, replace: { count: number(count) } });
        if (!UNFILLED_PLACEHOLDER.test(title)) {
          // Only plural forms exist under this key: the count is part of the sentence.
          const countIsInTitle = !i18n.exists(titleKey);
          return countIsInTitle ? title : withCount(title);
        }
      }

      return withCount(code);
    },
    [i18n, number, t]
  );
}
