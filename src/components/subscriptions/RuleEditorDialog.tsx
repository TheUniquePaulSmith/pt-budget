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
      setError('Pattern is required');
      return;
    }
    if (!merchantName.trim()) {
      setError('Merchant is required');
      return;
    }
    const parsedPriority = Number(priority);
    if (!Number.isInteger(parsedPriority)) {
      setError('Priority must be a whole number');
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
      setError(err instanceof Error ? err.message : 'Failed to save rule');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{editingRule ? 'Edit Merchant Rule' : 'Create Merchant Rule'}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {editingRule?.source === 'community' && (
          <Alert severity="info" sx={{ mb: 2 }}>
            This is a community rule. Your edits are kept and will not be overwritten by future
            community list updates. Note: renaming the merchant later in Manage Data does not
            update this rule.
          </Alert>
        )}

        <Box display="flex" flexDirection="column" gap={2} mt={1}>
          <TextField
            label="Pattern"
            value={pattern}
            onChange={(event) => setPattern(event.target.value)}
            size="small"
            helperText={
              normalizedPattern && normalizedPattern !== pattern
                ? `Will be saved as: ${normalizedPattern}`
                : 'Matched against cleaned-up descriptions (uppercase, reference codes removed)'
            }
          />
          <TextField
            select
            label="Match type"
            value={matchType}
            onChange={(event) => setMatchType(event.target.value as MerchantRuleMatchType)}
            size="small"
          >
            <MenuItem value="prefix">Starts with</MenuItem>
            <MenuItem value="contains">Contains</MenuItem>
            <MenuItem value="exact">Exact match</MenuItem>
          </TextField>
          <Autocomplete
            freeSolo
            options={companies.map((company) => company.name)}
            value={merchantName}
            onInputChange={(_event, value) => setMerchantName(value)}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Merchant"
                size="small"
                helperText="The brand this charge belongs to (e.g. Amazon)"
              />
            )}
          />
          <TextField
            label="Service (optional)"
            value={serviceName}
            onChange={(event) => setServiceName(event.target.value)}
            size="small"
            helperText="A specific product under the merchant (e.g. Amazon Prime)"
          />
          <TextField
            select
            label="Charge type"
            value={kind}
            onChange={(event) => setKind(event.target.value as MerchantRuleKind)}
            size="small"
          >
            <MenuItem value="subscription">Subscription (fixed recurring)</MenuItem>
            <MenuItem value="bill">Recurring bill (variable recurring)</MenuItem>
            <MenuItem value="purchase">Purchase (not recurring)</MenuItem>
            <MenuItem value="unknown">Unknown</MenuItem>
          </TextField>
          <Box display="flex" gap={2} alignItems="center">
            <TextField
              label="Priority"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              size="small"
              sx={{ width: 140 }}
              helperText="Lower wins"
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
            />
            {editingRule && (
              <FormControlLabel
                control={
                  <Switch checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
                }
                label="Enabled"
              />
            )}
          </Box>
          <Typography variant="body2" color="text.secondary">
            {previewCount === null
              ? 'Enter a pattern to preview matches.'
              : `This pattern would match ${previewCount} existing transaction${previewCount === 1 ? '' : 's'}.`}
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : editingRule ? 'Save Rule' : 'Create Rule'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default RuleEditorDialog;
