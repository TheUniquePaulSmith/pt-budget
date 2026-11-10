'use client';

/**
 * The frame every step sits in: where you are (a stepper on desktop, "Step n
 * of 6" with a progress bar on phones), which file of the queue is being
 * worked on, the step itself, and Back / Next pinned to the bottom edge,
 * together at its right end.
 */

import React from 'react';
import {
  Box,
  Button,
  CircularProgress,
  LinearProgress,
  Paper,
  Step,
  StepButton,
  StepLabel,
  Stepper,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

import { WIZARD_STEPS, type WizardStep } from './wizardModel';

export interface FrameAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Shows a spinner in the button; the button is disabled while it does. */
  loading?: boolean;
  testId: string;
}

interface WizardFrameProps {
  step: WizardStep;
  /** "File 2 of 3: statement.csv", when a file of the queue is being worked on. */
  queueLabel?: string | null;
  /** Shown instead of the step while the wizard works ("Importing…"). */
  busyLabel?: string | null;
  onBack?: (() => void) | null;
  primary?: FrameAction | null;
  secondary?: FrameAction | null;
  /** Why the primary action is disabled. */
  hint?: string | null;
  onStepClick?: (step: WizardStep) => void;
  children: React.ReactNode;
}

export default function WizardFrame({
  step,
  queueLabel,
  busyLabel,
  onBack,
  primary,
  secondary,
  hint,
  onStepClick,
  children,
}: WizardFrameProps) {
  const { t } = useTranslation(['importWizard', 'common']);
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('md'));
  const activeIndex = WIZARD_STEPS.indexOf(step);
  const total = WIZARD_STEPS.length;

  return (
    <Box
      data-testid="import-wizard"
      data-step={step}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        // Fills the page below the header, so Back / Next sit at the bottom edge even on a short step.
        minHeight: { xs: 'calc(100dvh - 72px)', sm: 'calc(100dvh - 112px)' },
      }}
    >
      {compact ? (
        <Box sx={{ mb: 2 }} data-testid="import-progress">
          <Typography variant="overline" color="text.secondary" component="p" sx={{ lineHeight: 1.6, mb: 0.5 }}>
            {t('steps.progress', { step: activeIndex + 1, total })}
            {' · '}
            {t(`steps.${step}`)}
          </Typography>
          <LinearProgress
            variant="determinate"
            value={((activeIndex + 1) / total) * 100}
            aria-label={t('steps.progress', { step: activeIndex + 1, total })}
          />
        </Box>
      ) : (
        <Stepper activeStep={activeIndex} alternativeLabel aria-label={t('steps.label')} sx={{ mb: 3 }} data-testid="import-stepper">
          {WIZARD_STEPS.map((id, index) => {
            const reachable = Boolean(onStepClick) && index < activeIndex && step !== 'done';
            return (
              <Step key={id} completed={index < activeIndex || step === 'done'}>
                {reachable ? (
                  <StepButton onClick={() => onStepClick?.(id)} data-testid={`import-step-${id}`}>
                    {t(`steps.${id}`)}
                  </StepButton>
                ) : (
                  <StepLabel data-testid={`import-step-${id}`}>{t(`steps.${id}`)}</StepLabel>
                )}
              </Step>
            );
          })}
        </Stepper>
      )}

      {queueLabel && (
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5, overflowWrap: 'anywhere' }} data-testid="import-queue-label">
          {queueLabel}
        </Typography>
      )}

      <Box sx={{ minWidth: 0, pb: 2, flex: 1 }}>
        {busyLabel ? (
          <Box
            role="status"
            sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, py: 8 }}
            data-testid="import-busy"
          >
            <CircularProgress />
            <Typography color="text.secondary">{busyLabel}</Typography>
          </Box>
        ) : (
          children
        )}
      </Box>

      {(onBack || primary || secondary) && (
        <Paper
          square
          elevation={3}
          sx={{
            position: 'sticky',
            bottom: 0,
            zIndex: (muiTheme) => muiTheme.zIndex.appBar - 1,
            mx: { xs: -1, sm: -3 },
            px: { xs: 1.5, sm: 3 },
            py: 1.5,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            flexWrap: 'wrap',
          }}
          data-testid="import-actions"
        >
          {hint && (
            <Typography
              variant="body2"
              color="text.secondary"
              // On a phone the hint takes its own line above the buttons.
              sx={{ flex: { xs: '1 1 100%', sm: '1 1 160px' }, minWidth: 0 }}
              data-testid="import-hint"
            >
              {hint}
            </Typography>
          )}
          {/* Back sits beside Next rather than in the bottom-left corner, where anything docked to
              that corner of the viewport would cover it (the rail keeps its toggle out of it too). */}
          <Box sx={{ display: 'flex', gap: 1, ml: 'auto', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {onBack && (
              <Button onClick={onBack} disabled={Boolean(busyLabel)} data-testid="import-back">
                {t('common:actions.back')}
              </Button>
            )}
            {secondary && (
              <Button
                variant="outlined"
                onClick={secondary.onClick}
                disabled={secondary.disabled || secondary.loading || Boolean(busyLabel)}
                data-testid={secondary.testId}
              >
                {secondary.label}
              </Button>
            )}
            {primary && (
              <Button
                variant="contained"
                onClick={primary.onClick}
                disabled={primary.disabled || primary.loading || Boolean(busyLabel)}
                startIcon={primary.loading ? <CircularProgress size={16} color="inherit" /> : undefined}
                data-testid={primary.testId}
              >
                {primary.label}
              </Button>
            )}
          </Box>
        </Paper>
      )}
    </Box>
  );
}
