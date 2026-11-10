'use client';

/**
 * What still stands between the user and the Import button, in words, and the
 * step where it is settled. A finding keeps its catalog text; the rest says
 * what to do next.
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useIssueTexts } from './issueText';
import type { ImportBlocker, WizardStep } from './wizardModel';

export interface BlockerLine {
  text: string;
  /** Where the user can settle it. */
  step: WizardStep;
}

export function useBlockerLine(): (blocker: ImportBlocker) => BlockerLine {
  const { t } = useTranslation('importWizard');
  const texts = useIssueTexts();
  return useCallback(
    (blocker: ImportBlocker): BlockerLine => {
      switch (blocker.kind) {
        case 'missing':
          return {
            text: t('blockers.missing', { parts: blocker.parts.map((part) => t(`layout.roles.${part}`)).join(', ') }),
            step: 'layout',
          };
        case 'issue': {
          // Rows are fixed where they are listed; anything else about the file is settled on the layout.
          const step = blocker.issue.scope === 'account' ? 'account' : blocker.issue.rows?.length ? 'review' : 'layout';
          return { text: texts.title(blocker.issue), step };
        }
        case 'blockedRows':
          return { text: t('blockers.blockedRows', { count: blocker.count }), step: 'review' };
        case 'accounts':
          return { text: t('blockers.accounts'), step: 'account' };
        case 'confirm':
          return { text: t('blockers.confirm'), step: 'layout' };
        default:
          return { text: t('blockers.noRows'), step: 'review' };
      }
    },
    [t, texts]
  );
}
