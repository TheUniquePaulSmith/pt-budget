'use client';

/**
 * Text field for typing a 12-word recovery phrase, with live feedback: word
 * count, words that are not in the wordlist, and the checksum result. The
 * parent gets the decoded 16 entropy bytes through `onEntropyChange` only
 * when the whole phrase checks out, so the worker is never asked to try an
 * invalid phrase.
 */

import { useEffect, useState } from 'react';

import { Visibility, VisibilityOff } from '@mui/icons-material';
import { Box, Chip, IconButton, InputAdornment, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

import {
  RECOVERY_PHRASE_WORD_COUNT,
  mnemonicToEntropy,
  normalizeMnemonic,
  validateRecoveryPhrase,
  type RecoveryPhraseValidation,
} from '@/lib/recoveryPhrase/bip39';

interface RecoveryPhraseFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** The decoded entropy when the phrase is valid, else null. */
  onEntropyChange: (entropy: Uint8Array | null) => void;
  onSubmit?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  label?: string;
  /** Hide the words by default (an unlock screen in a public place); the eye icon reveals them. */
  masked?: boolean;
  'data-testid'?: string;
}

export function RecoveryPhraseField({
  value,
  onChange,
  onEntropyChange,
  onSubmit,
  disabled = false,
  autoFocus = false,
  label,
  masked = true,
  'data-testid': testId = 'recovery-phrase-input',
}: RecoveryPhraseFieldProps) {
  const { t } = useTranslation('setup');
  const [reveal, setReveal] = useState(!masked);
  const [validation, setValidation] = useState<RecoveryPhraseValidation | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (normalizeMnemonic(value).length === 0) {
      setValidation(null);
      onEntropyChange(null);
      return;
    }
    void (async () => {
      const result = await validateRecoveryPhrase(value);
      if (cancelled) return;
      setValidation(result);
      if (result.ok) {
        const entropy = await mnemonicToEntropy(value);
        if (!cancelled) onEntropyChange(entropy);
      } else {
        onEntropyChange(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // onEntropyChange is a stable setter in every caller; re-running on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const words = normalizeMnemonic(value);
  const invalidWords = validation ? validation.invalidPositions.map((index) => words[index]).filter(Boolean) : [];
  const showChecksumError =
    validation !== null && !validation.ok && validation.code === 'INVALID_RECOVERY_PHRASE' && words.length === RECOVERY_PHRASE_WORD_COUNT;

  let helper: string;
  if (invalidWords.length > 0) {
    helper = t('recoveryEntry.invalidWords', { words: invalidWords.join(', ') });
  } else if (showChecksumError) {
    helper = t('recoveryEntry.badChecksum');
  } else {
    helper = t('recoveryEntry.wordCount', { count: words.length });
  }

  return (
    <Box>
      <TextField
        label={label ?? t('recoveryEntry.label')}
        placeholder={t('recoveryEntry.placeholder')}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        multiline
        minRows={2}
        fullWidth
        autoFocus={autoFocus}
        disabled={disabled}
        error={invalidWords.length > 0 || showChecksumError}
        helperText={helper}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (validation?.ok && !disabled) onSubmit?.();
          }
        }}
        slotProps={{
          htmlInput: {
            'data-testid': testId,
            style: reveal ? undefined : ({ WebkitTextSecurity: 'disc' } as React.CSSProperties),
          },
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  aria-label={reveal ? t('recoveryEntry.hide') : t('recoveryEntry.show')}
                  onClick={() => setReveal((current) => !current)}
                  edge="end"
                >
                  {reveal ? <VisibilityOff /> : <Visibility />}
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
      />
      {reveal && words.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }} aria-hidden>
          {words.map((word, index) => (
            <Chip
              key={`${index}-${word}`}
              size="small"
              label={`${index + 1}. ${word}`}
              color={validation?.invalidPositions.includes(index) ? 'error' : 'default'}
              variant={validation?.invalidPositions.includes(index) ? 'filled' : 'outlined'}
            />
          ))}
        </Box>
      )}
      {validation?.ok && (
        <Typography variant="caption" color="success.main" sx={{ display: 'block', mt: 0.5 }}>
          {t('recoveryEntry.valid')}
        </Typography>
      )}
    </Box>
  );
}
