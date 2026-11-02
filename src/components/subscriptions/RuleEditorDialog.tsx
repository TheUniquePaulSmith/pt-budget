'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

import { normalizeDescription } from '@/lib/merchantMatchingService';
import type {
  Company,
  MerchantRule,
  MerchantRuleKind,
  MerchantRuleMatchType,
} from '@/types/database';
import type {
  MerchantRuleInput,
  MerchantRuleUpdate,
} from '@/contexts/useDatabaseSubscriptionsSlice';

export interface RuleEditorPrefill {
  pattern?: string;
  merchant_name?: string;
  service_name?: string;
  default_kind?: MerchantRuleKind;
}

interface RuleEditorDialogProps {
  open: boolean;
  editingRule: MerchantRule | null; // null = create mode
  prefill?: RuleEditorPrefill | null;
  companies: Company[];
  onClose: () => void;
  onCreate: (rule: MerchantRuleInput) => Promise<void>;
  onUpdate: (id: number, updates: MerchantRuleUpdate) => Promise<void>;
  previewMatches: (rule: {
    pattern: string;
    match_type: MerchantRuleMatchType;
  }) => Promise<number>;
}

const MATCH_TYPE_VALUES: ReadonlyArray<MerchantRuleMatchType> = ['prefix', 'contains', 'exact'];
const KIND_VALUES: ReadonlyArray<MerchantRuleKind> = ['subscription', 'bill', 'purchase', 'unknown'];

const RuleEditorDialog: React.FC<RuleEditorDialogProps> = ({
  open,
  editingRule,
  prefill,
  companies,
  onClose,
  onCreate,
  onUpdate,
  previewMatches,
}) => {
  const { t } = useTranslation('subscriptions');
  const [pattern, setPattern] = useState('');
  const [matchType, setMatchType] = useState<MerchantRuleMatchType>('prefix');
  const [merchantName, setMerchantName] = useState('');
  const [serviceName, setServiceName] = useState('');
  const [kind, setKind] = useState<MerchantRuleKind>('subscription');
  const [priority, setPriority] = useState('50');
  const [enabled, setEnabled] = useState(true);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedPattern = useMemo(() => normalizeDescription(pattern), [pattern]);

  useEffect(() => {
    if (!open) return;

    if (editingRule) {
      setPattern(editingRule.pattern);
      setMatchType(editingRule.match_type);
      setMerchantName(editingRule.merchant_name);
      setServiceName(editingRule.service_name || '');
      setKind(editingRule.default_kind);
      setPriority(String(editingRule.priority));
      setEnabled(Boolean(editingRule.enabled));
    } else {
      setPattern(prefill?.pattern || '');
      setMatchType('prefix');
      setMerchantName(prefill?.merchant_name || '');
      setServiceName(prefill?.service_name || '');
      setKind(prefill?.default_kind || 'subscription');
      setPriority('50');
      setEnabled(true);
    }
    setError(null);
    setPreviewCount(null);
  }, [open, editingRule, prefill]);

  // Live "would match N transactions" preview, debounced
  useEffect(() => {
    if (!open || !normalizedPattern) {
      setPreviewCount(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      previewMatches({ pattern: normalizedPattern, match_type: matchType })
        .then((count) => {
          if (!cancelled) setPreviewCount(count);
        })
        .catch(() => {
          if (!cancelled) setPreviewCount(null);
        });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, normalizedPattern, matchType, previewMatches]);

  const handleSave = async () => {
    if (!normalizedPattern) {
      setError(t('ruleEditorDialog.patternRequired'));
      return;
    }
    if (!merchantName.trim()) {
      setError(t('ruleEditorDialog.merchantRequired'));
      return;
    }
    const parsedPriority = Number(priority);
    if (!Number.isInteger(parsedPriority)) {
      setError(t('ruleEditorDialog.priorityWholeNumber'));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (editingRule) {
        await onUpdate(editingRule.id, {
          pattern: normalizedPattern,
          match_type: matchType,
          priority: parsedPriority,
          merchant_name: merchantName.trim(),
          service_name: serviceName.trim() || null,
          default_kind: kind,
          enabled,
          notes: editingRule.notes ?? null,
        });
      } else {
        await onCreate({
          pattern: normalizedPattern,
          match_type: matchType,
          merchant_name: merchantName.trim(),
          service_name: serviceName.trim() || null,
          default_kind: kind,
          priority: parsedPriority,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ruleEditorDialog.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{editingRule ? t('ruleEditorDialog.editTitle') : t('ruleEditorDialog.createTitle')}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {editingRule?.source === 'community' && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {t('ruleEditorDialog.communityNotice')}
          </Alert>
        )}

        <Box display="flex" flexDirection="column" gap={2} mt={1}>
          <TextField
            label={t('ruleEditorDialog.pattern')}
            value={pattern}
            onChange={(event) => setPattern(event.target.value)}
            size="small"
            helperText={
              normalizedPattern && normalizedPattern !== pattern
                ? t('ruleEditorDialog.willBeSavedAs', { pattern: normalizedPattern })
                : t('ruleEditorDialog.patternHelp')
            }
          />
          <TextField
            select
            label={t('ruleEditorDialog.matchType')}
            value={matchType}
            onChange={(event) => setMatchType(event.target.value as MerchantRuleMatchType)}
            size="small"
          >
            {MATCH_TYPE_VALUES.map((value) => (
              <MenuItem key={value} value={value}>
                {t(`matchType.${value}`)}
              </MenuItem>
            ))}
          </TextField>
          <Autocomplete
            freeSolo
            options={companies.map((company) => company.name)}
            value={merchantName}
            onInputChange={(_event, value) => setMerchantName(value)}
            renderInput={(params) => (
              <TextField
                {...params}
                label={t('ruleEditorDialog.merchant')}
                size="small"
                helperText={t('ruleEditorDialog.merchantHelp')}
              />
            )}
          />
          <TextField
            label={t('ruleEditorDialog.service')}
            value={serviceName}
            onChange={(event) => setServiceName(event.target.value)}
            size="small"
            helperText={t('ruleEditorDialog.serviceHelp')}
          />
          <TextField
            select
            label={t('ruleEditorDialog.chargeType')}
            value={kind}
            onChange={(event) => setKind(event.target.value as MerchantRuleKind)}
            size="small"
          >
            {KIND_VALUES.map((value) => (
              <MenuItem key={value} value={value}>
                {t(`ruleEditorDialog.kind.${value}`)}
              </MenuItem>
            ))}
          </TextField>
          <Box display="flex" gap={2} alignItems="center">
            <TextField
              label={t('ruleEditorDialog.priority')}
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              size="small"
              sx={{ width: 140 }}
              helperText={t('ruleEditorDialog.priorityHelp')}
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
            />
            {editingRule && (
              <FormControlLabel
                control={
                  <Switch checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
                }
                label={t('ruleEditorDialog.enabled')}
              />
            )}
          </Box>
          <Typography variant="body2" color="text.secondary">
            {previewCount === null
              ? t('ruleEditorDialog.enterPattern')
              : t('ruleEditorDialog.wouldMatch', { count: previewCount })}
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t('ruleEditorDialog.cancel')}
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? t('ruleEditorDialog.saving') : editingRule ? t('ruleEditorDialog.saveRule') : t('ruleEditorDialog.createRule')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default RuleEditorDialog;
