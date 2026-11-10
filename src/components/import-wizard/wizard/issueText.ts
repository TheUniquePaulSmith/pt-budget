'use client';

/**
 * The wording of a finding. The wizard never writes its own: every issue and
 * assumption is a code whose text lives in the `importIssues` namespace
 * (`issues.<code>.title` / `.detail`, `assumptions.<code>`). A code with no
 * text yet is shown as the code itself.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';
import type { Assumption, ImportIssue, IssueSeverity } from '@/lib/statementImport';

type Params = Record<string, string | number> | undefined;
/** The keys are built from codes, so they are looked up untyped. */
type LooseT = (key: string, options?: Record<string, unknown>) => string;

export interface IssueTexts {
  title: (issue: Pick<ImportIssue, 'code' | 'params'>) => string;
  /** Null when the code has no longer explanation. */
  detail: (issue: Pick<ImportIssue, 'code' | 'params'>) => string | null;
  assumption: (assumption: Pick<Assumption, 'code' | 'params'>) => string;
  severity: (severity: IssueSeverity) => string;
}

/** Params that are a period's first and last day (`yyyy-MM-dd`): shown the way the user reads dates. */
const PERIOD_PARAMS = ['from', 'to'] as const;

export function useIssueTexts(): IssueTexts {
  const { t, i18n } = useTranslation('importIssues');
  const { date } = useFormatters();
  return useMemo(() => {
    const loose = t as unknown as LooseT;
    const readable = (params: Params): Params => {
      if (!params) return params;
      const formatted = { ...params };
      for (const key of PERIOD_PARAMS) {
        const value = formatted[key];
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) formatted[key] = date(value);
      }
      return formatted;
    };
    const lookup = (key: string, params: Params): string | null =>
      i18n.exists(`importIssues:${key}`, params) ? loose(key, readable(params)) : null;
    return {
      title: (issue) => lookup(`issues.${issue.code}.title`, issue.params) ?? issue.code,
      detail: (issue) => lookup(`issues.${issue.code}.detail`, issue.params),
      assumption: (assumption) => lookup(`assumptions.${assumption.code}`, assumption.params) ?? assumption.code,
      severity: (severity) => t(`severity.${severity}`),
    };
  }, [date, i18n, t]);
}
