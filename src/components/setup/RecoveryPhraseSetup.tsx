'use client';

/**
 * Generates a fresh 12-word recovery phrase, shows it (copy / print /
 * regenerate), makes the user confirm three random words, and hands the
 * decoded entropy to the parent. Used by the setup screen (recovery master)
 * and by Settings → Security when switching from a password to a phrase.
 *
 * The words are state of this component only: never logged, never sent to
 * the worker (only their 16 entropy bytes are).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ContentCopy, Print, Refresh } from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';
import { generateRecoveryPhrase, mnemonicToEntropy, normalizeMnemonic } from '@/lib/recoveryPhrase/bip39';

interface RecoveryPhraseSetupProps {
  /** Called once the user has confirmed the phrase, with its 16 entropy bytes. */
  onConfirmed: (entropy: Uint8Array) => Promise<void>;
  onBack?: () => void;
  isLoading: boolean;
  error: string | null;
  /** Label of the final button (defaults to "Continue"). */
  confirmLabel?: string;
}

const CONFIRM_WORD_COUNT = 3;

/** `count` distinct positions in [0, total), chosen with a partial Fisher–Yates shuffle. */
function pickPositions(count: number, total: number): number[] {
  const pool = Array.from({ length: total }, (_, index) => index);
  const random = crypto.getRandomValues(new Uint32Array(count));
  for (let i = 0; i < count; i += 1) {
    const j = i + (random[i] % (total - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count).sort((a, b) => a - b);
}

export function RecoveryPhraseSetup({ onConfirmed, onBack, isLoading, error, confirmLabel }: RecoveryPhraseSetupProps) {
  const { t } = useTranslation(['setup', 'common']);
  const { dateTime } = useFormatters();
  const [words, setWords] = useState<string[] | null>(null);
  const [step, setStep] = useState<'show' | 'confirm'>('show');
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [positions, setPositions] = useState<number[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [mismatch, setMismatch] = useState(false);

  const regenerate = useCallback(async () => {
    setWords(await generateRecoveryPhrase());
    setSaved(false);
    setCopied(false);
    setMismatch(false);
    setStep('show');
  }, []);

  useEffect(() => {
    void regenerate();
  }, [regenerate]);

  const startConfirm = useCallback(() => {
    const picked = pickPositions(CONFIRM_WORD_COUNT, words?.length ?? 12);
    setPositions(picked);
    setAnswers(picked.map(() => ''));
    setMismatch(false);
    setStep('confirm');
  }, [words]);

  const copy = useCallback(async () => {
    if (!words) return;
    try {
      await navigator.clipboard.writeText(words.join(' '));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard unavailable (insecure context, permissions): the words are still on screen.
    }
  }, [words]);

  const print = useCallback(() => {
    window.print();
  }, []);

  const answersMatch = useMemo(() => {
    if (!words) return false;
    return positions.every((position, index) => normalizeMnemonic(answers[index] ?? '')[0] === words[position]);
  }, [answers, positions, words]);

  const handleConfirm = useCallback(async () => {
    if (!words) return;
    if (!answersMatch) {
      setMismatch(true);
      return;
    }
    try {
      const entropy = await mnemonicToEntropy(words);
      await onConfirmed(entropy);
    } catch {
      // Error is surfaced via the `error` prop from the parent.
    }
  }, [answersMatch, onConfirmed, words]);

  if (!words) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (step === 'confirm') {
    return (
      <Stack spacing={2}>
        <Typography variant="h6" fontWeight="bold">
          {t('recoverySetup.confirmTitle')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('recoverySetup.confirmDescription')}
        </Typography>
        {(error || mismatch) && (
          <Alert severity="error">{mismatch ? t('recoverySetup.confirmMismatch') : error}</Alert>
        )}
        {positions.map((position, index) => (
          <TextField
            key={position}
            label={t('recoverySetup.wordLabel', { position: position + 1 })}
            value={answers[index] ?? ''}
            onChange={(event) => {
              setMismatch(false);
              setAnswers((current) => current.map((answer, i) => (i === index ? event.target.value : answer)));
            }}
            autoFocus={index === 0}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            disabled={isLoading}
            fullWidth
            slotProps={{ htmlInput: { 'data-testid': `recovery-confirm-input-${position + 1}` } }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && answersMatch && !isLoading) void handleConfirm();
            }}
          />
        ))}
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button variant="outlined" fullWidth onClick={() => setStep('show')} disabled={isLoading}>
            {t('common:actions.back')}
          </Button>
          <Button
            variant="contained"
            fullWidth
            onClick={() => void handleConfirm()}
            disabled={isLoading || answers.some((answer) => normalizeMnemonic(answer).length === 0)}
            startIcon={isLoading ? <CircularProgress size={18} color="inherit" /> : undefined}
            data-testid="recovery-confirm-submit"
          >
            {confirmLabel ?? t('common:actions.continue')}
          </Button>
        </Box>
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <Typography variant="h6" fontWeight="bold">
        {t('recoverySetup.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('recoverySetup.description')}
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}

      <Paper
        variant="outlined"
        className="recovery-phrase-print-area"
        sx={{
          p: 2,
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)' },
          gap: 1,
          '@media print': { boxShadow: 'none' },
        }}
      >
        {words.map((word, index) => (
          <Box key={index} sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ minWidth: 20, textAlign: 'right' }}>
              {index + 1}.
            </Typography>
            <Typography variant="body1" fontFamily="monospace" data-testid={`recovery-word-${index + 1}`}>
              {word}
            </Typography>
          </Box>
        ))}
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ gridColumn: '1 / -1', display: 'none', '@media print': { display: 'block' } }}
        >
          {t('recoverySetup.printTitle')} — {t('recoverySetup.printedOn', { date: dateTime(new Date().toISOString()) })}
        </Typography>
      </Paper>

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button size="small" startIcon={<ContentCopy />} onClick={() => void copy()} disabled={isLoading}>
          {copied ? t('recoverySetup.copied') : t('recoverySetup.copy')}
        </Button>
        <Button size="small" startIcon={<Print />} onClick={print} disabled={isLoading}>
          {t('recoverySetup.print')}
        </Button>
        <Button size="small" startIcon={<Refresh />} onClick={() => void regenerate()} disabled={isLoading} data-testid="recovery-regenerate">
          {t('recoverySetup.regenerate')}
        </Button>
      </Box>

      <FormControlLabel
        control={
          <Checkbox
            checked={saved}
            onChange={(event) => setSaved(event.target.checked)}
            disabled={isLoading}
            slotProps={{ input: { 'data-testid': 'recovery-saved-checkbox' } as never }}
          />
        }
        label={t('recoverySetup.savedCheckbox')}
      />

      <Box sx={{ display: 'flex', gap: 2 }}>
        {onBack && (
          <Button variant="outlined" fullWidth onClick={onBack} disabled={isLoading}>
            {t('common:actions.back')}
          </Button>
        )}
        <Button variant="contained" fullWidth onClick={startConfirm} disabled={!saved || isLoading} data-testid="recovery-continue">
          {t('common:actions.continue')}
        </Button>
      </Box>
    </Stack>
  );
}
