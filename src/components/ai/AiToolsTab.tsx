'use client';

/**
 * Tools tab: every registered tool grouped by CRUD class with an enable
 * switch and a consent policy select, the per-question tool-call limit, pack
 * import/removal, session grants, the global consent bypass (behind a
 * confirmation) and "Reset to safe defaults".
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Delete, UploadFile } from '@mui/icons-material';

import { AiToolPackError } from '@/lib/aiTools/jsonToolPack';
import { MAX_TOOL_CALL_LIMIT, MIN_TOOL_CALL_LIMIT, normalizeToolCallLimit } from '@/lib/aiTools/toolCallLimit';
import type { AiToolConsent } from '@/types/database';
import { AI_TOOL_CRUDS, type AiResolvedTool, type AiToolCrud } from '@/types/aiTools';
import { CRUD_COLORS, CRUD_LABELS } from './AiConsentCard';
import { useAiToolsContext } from './AiToolsContext';

const CONSENT_LABELS: Record<AiToolConsent, string> = {
  ask: 'Ask',
  always: 'Always allow',
  deny: 'Deny',
};

const GROUP_DESCRIPTIONS: Record<AiToolCrud, string> = {
  read: 'Read-only lookups. Allowed by default.',
  create: 'Add new rows. Ask by default.',
  update: 'Change existing rows. Ask by default.',
  delete: 'Remove rows. Ask by default and disabled until you enable them.',
  mixed: 'Statements that both read and write. Ask by default.',
};

function ToolRow({
  tool,
  onEnabledChange,
  onConsentChange,
}: {
  tool: AiResolvedTool;
  onEnabledChange: (enabled: boolean) => void;
  onConsentChange: (consent: AiToolConsent) => void;
}) {
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      sx={{ py: 0.75 }}
      data-testid={`ai-tool-row-${tool.name}`}
    >
      <Switch
        size="small"
        checked={tool.enabled}
        onChange={(event) => onEnabledChange(event.target.checked)}
        inputProps={{ 'aria-label': `Enable ${tool.name}`, 'data-testid': `ai-tool-enabled-${tool.name}` } as React.InputHTMLAttributes<HTMLInputElement>}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.78rem' }} noWrap title={tool.name}>
            {tool.name}
          </Typography>
          {tool.source === 'pack' && <Chip size="small" variant="outlined" label={tool.group} sx={{ height: 18, fontSize: '0.65rem' }} />}
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3 }} noWrap title={tool.description}>
          {tool.description}
        </Typography>
      </Box>
      <Select
        size="small"
        value={tool.consent}
        onChange={(event) => onConsentChange(event.target.value as AiToolConsent)}
        disabled={!tool.enabled}
        inputProps={{ 'aria-label': `Consent for ${tool.name}`, 'data-testid': `ai-tool-consent-${tool.name}` }}
        sx={{ minWidth: 118, fontSize: '0.78rem' }}
      >
        {(Object.keys(CONSENT_LABELS) as AiToolConsent[]).map((consent) => (
          <MenuItem key={consent} value={consent} dense>
            {CONSENT_LABELS[consent]}
          </MenuItem>
        ))}
      </Select>
    </Stack>
  );
}

export default function AiToolsTab() {
  const tools = useAiToolsContext();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [packJson, setPackJson] = useState('');
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmBypass, setConfirmBypass] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [limitDraft, setLimitDraft] = useState(String(tools.toolCallLimit));

  useEffect(() => {
    setLimitDraft(String(tools.toolCallLimit));
  }, [tools.toolCallLimit]);

  const grouped = useMemo(() => {
    const groups = new Map<AiToolCrud, AiResolvedTool[]>();
    for (const crud of AI_TOOL_CRUDS) {
      groups.set(crud, []);
    }
    for (const tool of tools.registry.tools) {
      groups.get(tool.crud)?.push(tool);
    }
    return groups;
  }, [tools.registry.tools]);

  const run = async (action: () => Promise<void>, successMessage?: string) => {
    setBusy(true);
    setImportErrors([]);
    try {
      await action();
      if (successMessage) {
        setStatus(successMessage);
      }
    } catch (err) {
      if (err instanceof AiToolPackError) {
        setImportErrors(err.errors.map((error) => error.message));
      } else {
        setImportErrors([err instanceof Error ? err.message : 'The action failed']);
      }
    } finally {
      setBusy(false);
    }
  };

  const commitLimit = () => {
    const next = normalizeToolCallLimit(limitDraft);
    setLimitDraft(String(next));
    if (next !== tools.toolCallLimit) {
      void run(() => tools.setToolCallLimit(next));
    }
  };

  const importFromText = () => {
    const text = packJson.trim();
    if (!text) {
      setImportErrors(['Paste a pack JSON document or choose a file.']);
      return;
    }
    void run(async () => {
      await tools.importPack(text);
      setPackJson('');
    }, 'Pack imported.');
  };

  const importFromFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    const text = await file.text();
    void run(() => tools.importPack(text), `Imported ${file.name}.`);
  };

  const userPacks = tools.registry.packs.filter((pack) => pack.row.source === 'user');
  const shippedPacks = tools.registry.packs.filter((pack) => pack.row.source !== 'user');

  return (
    <Box sx={{ p: 2, overflow: 'auto', flex: 1, minHeight: 0 }} data-testid="ai-tools-tab">
      <Stack spacing={2}>
        <Box>
          <Typography variant="subtitle1" fontWeight={600}>
            Tools
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Choose which tools the assistant may call and when it has to ask first.
          </Typography>
        </Box>

        {tools.error && <Alert severity="error">{tools.error}</Alert>}
        {status && <Alert severity="success" onClose={() => setStatus(null)}>{status}</Alert>}

        <Alert severity={tools.bypassAllConsent ? 'warning' : 'info'} icon={false} data-testid="ai-consent-bypass-alert">
          <FormControlLabel
            control={(
              <Switch
                checked={tools.bypassAllConsent}
                onChange={(event) => {
                  if (event.target.checked) {
                    setConfirmBypass(true);
                  } else {
                    tools.setBypassAllConsent(false);
                  }
                }}
                inputProps={{ 'data-testid': 'ai-consent-bypass' } as React.InputHTMLAttributes<HTMLInputElement>}
              />
            )}
            label="Bypass all consent prompts"
          />
          <Typography variant="caption" sx={{ display: 'block' }}>
            {tools.bypassAllConsent
              ? 'Every enabled tool runs without asking for this session. Tools set to Deny still never run.'
              : 'Tools set to Ask pause the chat until you allow them.'}
          </Typography>
        </Alert>

        <Box data-testid="ai-tool-call-limit-setting">
          <TextField
            size="small"
            type="number"
            label="Tool-call limit"
            value={limitDraft}
            onChange={(event) => setLimitDraft(event.target.value)}
            onBlur={commitLimit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitLimit();
              }
            }}
            disabled={busy}
            inputProps={{ min: MIN_TOOL_CALL_LIMIT, max: MAX_TOOL_CALL_LIMIT, step: 1, 'data-testid': 'ai-tool-call-limit' }}
            sx={{ width: 160 }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            Rounds of tool calls the assistant may run for one question ({MIN_TOOL_CALL_LIMIT}–{MAX_TOOL_CALL_LIMIT}). A round can call several tools at once. After the last round it answers from what it found.
          </Typography>
        </Box>

        {tools.sessionGrants.length > 0 && (
          <Box>
            <Typography variant="caption" color="text.secondary">
              Allowed for this session
            </Typography>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
              {tools.sessionGrants.map((name) => (
                <Chip key={name} size="small" label={name} onDelete={() => tools.revokeSessionGrant(name)} sx={{ fontFamily: 'monospace' }} />
              ))}
            </Stack>
          </Box>
        )}

        {AI_TOOL_CRUDS.map((crud) => {
          const group = grouped.get(crud) ?? [];
          if (group.length === 0) {
            return null;
          }
          return (
            <Box key={crud} data-testid={`ai-tool-group-${crud}`}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip size="small" color={CRUD_COLORS[crud]} label={CRUD_LABELS[crud]} />
                <Typography variant="caption" color="text.secondary">
                  {GROUP_DESCRIPTIONS[crud]}
                </Typography>
              </Stack>
              <Divider sx={{ my: 0.5 }} />
              {group.map((tool) => (
                <ToolRow
                  key={tool.name}
                  tool={tool}
                  onEnabledChange={(enabled) => void run(() => tools.setToolEnabled(tool.name, enabled))}
                  onConsentChange={(consent) => void run(() => tools.setToolConsent(tool.name, consent))}
                />
              ))}
            </Box>
          );
        })}

        <Divider />

        <Box>
          <Typography variant="subtitle2" fontWeight={600}>
            Tool packs
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Declarative JSON packs add SQL-backed tools. Each tool&apos;s SQL is checked against its declared read/write class before it can be used.
          </Typography>
          <Stack spacing={0.5} sx={{ mt: 1 }}>
            {shippedPacks.map((pack) => (
              <Stack key={pack.packKey} direction="row" spacing={1} alignItems="center" data-testid={`ai-pack-${pack.packKey}`}>
                <Switch
                  size="small"
                  checked={Number(pack.row.enabled) === 1}
                  onChange={(event) => void run(() => tools.setPackEnabled(pack.packKey, event.target.checked))}
                  inputProps={{ 'aria-label': `Enable pack ${pack.document.name}` }}
                />
                <Typography variant="body2" sx={{ flex: 1 }}>
                  {pack.document.name} <Typography component="span" variant="caption" color="text.secondary">v{pack.document.version} · built in · {pack.document.tools.length} tools</Typography>
                </Typography>
              </Stack>
            ))}
            {userPacks.map((pack) => (
              <Stack key={pack.packKey} direction="row" spacing={1} alignItems="center" data-testid={`ai-pack-${pack.packKey}`}>
                <Switch
                  size="small"
                  checked={Number(pack.row.enabled) === 1}
                  onChange={(event) => void run(() => tools.setPackEnabled(pack.packKey, event.target.checked))}
                  inputProps={{ 'aria-label': `Enable pack ${pack.document.name}` }}
                />
                <Typography variant="body2" sx={{ flex: 1 }}>
                  {pack.document.name} <Typography component="span" variant="caption" color="text.secondary">v{pack.document.version}{pack.document.author ? ` · ${pack.document.author}` : ''} · {pack.document.tools.length} tools</Typography>
                </Typography>
                <Tooltip title="Remove pack">
                  <IconButton size="small" onClick={() => void run(() => tools.removePack(pack.packKey), 'Pack removed.')} aria-label={`Remove pack ${pack.document.name}`}>
                    <Delete fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            ))}
            {[...tools.registry.failedPacks, ...tools.shippedPackErrors].map((failed) => (
              <Alert key={failed.packKey} severity="warning" data-testid={`ai-pack-error-${failed.packKey}`}>
                <Typography variant="body2" fontWeight={600}>{failed.packName ?? failed.packKey} could not be loaded</Typography>
                {failed.errors.map((error, index) => (
                  <Typography key={index} variant="caption" sx={{ display: 'block' }}>{error.message}</Typography>
                ))}
              </Alert>
            ))}
          </Stack>

          <Stack spacing={1} sx={{ mt: 1.5 }}>
            <TextField
              size="small"
              label="Paste pack JSON"
              multiline
              minRows={3}
              maxRows={8}
              value={packJson}
              onChange={(event) => setPackJson(event.target.value)}
              inputProps={{ 'data-testid': 'ai-pack-json' }}
              sx={{ '& textarea': { fontFamily: 'monospace', fontSize: '0.75rem' } }}
            />
            <Stack direction="row" spacing={1}>
              <Button size="small" variant="outlined" onClick={importFromText} disabled={busy} data-testid="ai-pack-import">
                Import pack
              </Button>
              <Button size="small" startIcon={<UploadFile />} onClick={() => fileInputRef.current?.click()} disabled={busy}>
                Choose file
              </Button>
              <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => void importFromFile(event)} data-testid="ai-pack-file" />
            </Stack>
            {importErrors.length > 0 && (
              <Alert severity="error" onClose={() => setImportErrors([])} data-testid="ai-pack-import-errors">
                {importErrors.map((message, index) => (
                  <Typography key={index} variant="caption" sx={{ display: 'block' }}>{message}</Typography>
                ))}
              </Alert>
            )}
          </Stack>
        </Box>

        <Divider />

        <Button size="small" color="warning" variant="outlined" onClick={() => setConfirmReset(true)} disabled={busy} data-testid="ai-tools-reset" sx={{ alignSelf: 'flex-start' }}>
          Reset to safe defaults
        </Button>
      </Stack>

      <Dialog open={confirmBypass} onClose={() => setConfirmBypass(false)}>
        <DialogTitle>Bypass all consent prompts?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            The assistant will run every enabled create, update and delete tool without asking first, for this browser session. Tools set to Deny are still blocked. You can turn this off at any time.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmBypass(false)}>Cancel</Button>
          <Button color="warning" variant="contained" onClick={() => { tools.setBypassAllConsent(true); setConfirmBypass(false); }} data-testid="ai-consent-bypass-confirm">
            Bypass consent
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmReset} onClose={() => setConfirmReset(false)}>
        <DialogTitle>Reset tool settings?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Every tool returns to its default: reads allowed, creates and updates ask, deletes ask and are disabled. Session grants and the bypass switch are cleared. Imported packs are kept.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmReset(false)}>Cancel</Button>
          <Button color="warning" variant="contained" onClick={() => { setConfirmReset(false); void run(() => tools.resetToSafeDefaults(), 'Tool settings reset.'); }} data-testid="ai-tools-reset-confirm">
            Reset
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
