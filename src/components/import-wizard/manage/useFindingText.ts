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
 * else, so the text is built from the catalog's title
 * (`importIssues:issues.<code>.title`) like this:
 *
 *   - a plural title gets the count and is complete
 *     ("3 rows have a date we cannot read");
 *   - a plain title is followed by the count when there is more than one
 *     ("Rows you have already imported: 3");
 *   - a title that names something the summary does not keep (a column, a
 *     currency) gives way to `importManage:history.findingLabels.<code>`;
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

      const labelKey = `importManage:history.findingLabels.${code}`;
      if (i18n.exists(labelKey)) return withCount(translate(labelKey));
      return withCount(code);
    },
    [i18n, number, t]
  );
}
