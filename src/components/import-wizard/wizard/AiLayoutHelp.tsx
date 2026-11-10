'use client';

/**
 * "Ask AI" for a file the built-in detection could not work out (D11). A
 * button, never automatic, shown only when an AI provider is ready. A remote
 * provider is asked for consent every time, with the provider's name and the
 * exact sample that would leave the device; a model running locally needs
 * none. The answer is a proposed layout: it goes through the same preview and
 * analysis as a detected one and the user confirms it like any other.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { AutoAwesome } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import { AiProviderContextProvider, useAiProviderContext } from '@/components/ai/AiProviderContext';
import { isCloudKind } from '@/lib/aiProviderConfig';
import { logger } from '@/lib/logging';
import {
  buildAiLayoutSample,
  suggestLayoutWithAi,
  type AiComplete,
  type LayoutProposal,
  type StatementTable,
} from '@/lib/statementImport';

const log = logger.child({ component: 'ImportWizardAi' });

interface AiLayoutHelpProps {
  table: StatementTable;
  onProposal: (proposal: LayoutProposal) => void;
}

/** The provider setup lives in the AI panel; the wizard only reads which provider is active. */
export default function AiLayoutHelp(props: AiLayoutHelpProps) {
  return (
    <AiProviderContextProvider>
      <AiLayoutHelpButton {...props} />
    </AiProviderContextProvider>
  );
}

function AiLayoutHelpButton({ table, onProposal }: AiLayoutHelpProps) {
  const { t } = useTranslation(['importWizard', 'common']);
  const { provider, providerLabel, isProviderReady, isLoading } = useAiProviderContext();
  const [consentOpen, setConsentOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [outcome, setOutcome] = useState<'applied' | 'noAnswer' | 'failed' | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sample = useMemo(() => buildAiLayoutSample(table), [table]);
  const remote = isCloudKind(provider.kind);

  useEffect(() => () => abortRef.current?.abort(), []);

  const ask = useCallback(async () => {
    setConsentOpen(false);
    setWorking(true);
    setOutcome(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const complete: AiComplete = async (prompt, signal) => {
      const response = await provider.createChatCompletion({
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        temperature: 0,
        max_tokens: 1024,
        abortSignal: signal,
      });
      const content = response.choices[0]?.message?.content;
      return typeof content === 'string' ? content : '';
    };
    try {
      const proposal = await suggestLayoutWithAi(table, complete, controller.signal);
      if (controller.signal.aborted) return;
      if (proposal) {
        onProposal(proposal);
        setOutcome('applied');
      } else {
        setOutcome('noAnswer');
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      log.warn('AI layout suggestion failed', { operation: 'askAi', error });
      setOutcome('failed');
    } finally {
      setWorking(false);
    }
  }, [onProposal, provider, table]);

  if (isLoading || !isProviderReady) return null;

  return (
    <Box data-testid="import-ai-help">
      <Alert
        severity="info"
        icon={<AutoAwesome fontSize="inherit" />}
        action={
          <Button
            color="inherit"
            size="small"
            disabled={working}
            startIcon={working ? <CircularProgress size={14} color="inherit" /> : undefined}
            onClick={() => (remote ? setConsentOpen(true) : void ask())}
            data-testid="import-ask-ai"
          >
            {working ? t('ai.working') : t('ai.ask')}
          </Button>
        }
      >
        {t('ai.offer', { provider: providerLabel })}
      </Alert>
      {outcome && (
        <Alert severity={outcome === 'applied' ? 'success' : 'warning'} sx={{ mt: 1 }} data-testid="import-ai-outcome">
          {t(`ai.outcome.${outcome}`)}
        </Alert>
      )}

      <Dialog open={consentOpen} onClose={() => setConsentOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{t('ai.consentTitle', { provider: providerLabel })}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {t('ai.consentBody', { provider: providerLabel })}
          </Typography>
          <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1, maxHeight: 320 }}>
            <Table size="small" stickyHeader data-testid="import-ai-sample">
              <TableHead>
                <TableRow>
                  {sample.headers.map((header, index) => (
                    <TableCell key={index}>{header}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {sample.rows.map((cells, rowIndex) => (
                  <TableRow key={rowIndex}>
                    {cells.map((value, index) => (
                      <TableCell key={index} sx={{ whiteSpace: 'nowrap' }}>
                        {value}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConsentOpen(false)}>{t('common:actions.cancel')}</Button>
          <Button variant="contained" onClick={() => void ask()} data-testid="import-ai-consent">
            {t('ai.consentSend', { provider: providerLabel })}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
