'use client';

/**
 * Setup tab: Local (the existing GGUF model selector) and Cloud (provider
 * profiles stored in the encrypted database). Profiles are saved through
 * AiProviderContext; keys are shown masked and never logged.
 */

import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add,
  CheckCircle,
  Cloud,
  Computer,
  Delete,
  Edit,
  ErrorOutline,
  Visibility,
  VisibilityOff,
} from '@mui/icons-material';

import { createDefaultProfile, kindLabel, redactApiKey, validateProfile } from '@/lib/aiProviderConfig';
import {
  AI_OPENAI_COMPATIBLE_PRESETS,
  AI_PROVIDER_DEFAULT_BASE_URLS,
  AI_PROVIDER_DEFAULT_MODELS,
  type AiProviderKind,
  type AiProviderProfile,
  type AiProviderTestResult,
} from '@/lib/aiProviders';
import AiModelSelector from './AiModelSelector';
import { useAiProviderContext } from './AiProviderContext';

type SetupTab = 'local' | 'cloud';
type CloudKind = Exclude<AiProviderKind, 'local'>;

const CLOUD_KINDS: CloudKind[] = ['anthropic', 'openai', 'openai_compatible'];

interface AiProviderSetupProps {
  activeProfileLabel: string | null;
}

interface ProfileFormProps {
  initial: AiProviderProfile;
  onCancel: () => void;
  onSave: (profile: AiProviderProfile) => Promise<void>;
  onTest: (profile: AiProviderProfile) => Promise<AiProviderTestResult>;
}

function TestStatusChip({ result, testing }: { result: AiProviderTestResult | null; testing: boolean }) {
  if (testing) {
    return <Chip size="small" icon={<CircularProgress size={12} />} label="Testing…" data-testid="ai-provider-test-status" />;
  }
  if (!result) {
    return null;
  }
  return (
    <Chip
      size="small"
      color={result.ok ? 'success' : 'error'}
      icon={result.ok ? <CheckCircle /> : <ErrorOutline />}
      label={result.ok ? `${result.message}${result.latencyMs !== undefined ? ` · ${result.latencyMs} ms` : ''}` : result.message}
      data-testid="ai-provider-test-status"
      data-ok={String(result.ok)}
      sx={{ maxWidth: '100%', '& .MuiChip-label': { whiteSpace: 'normal' }, height: 'auto', py: 0.5 }}
    />
  );
}

function ProfileForm({ initial, onCancel, onSave, onTest }: ProfileFormProps) {
  const [profile, setProfile] = useState<AiProviderProfile>(initial);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiProviderTestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const validation = validateProfile(profile);
  const showErrors = touched;

  const update = (patch: Partial<AiProviderProfile>) => {
    setProfile((current) => ({ ...current, ...patch }));
    setTestResult(null);
  };

  const changeKind = (kind: CloudKind) => {
    const defaults = createDefaultProfile(kind);
    setProfile((current) => ({
      ...current,
      kind,
      baseUrl: AI_PROVIDER_DEFAULT_BASE_URLS[kind],
      model: current.model && current.kind === kind ? current.model : defaults.model,
      label: current.label && current.label !== kindLabel(current.kind) ? current.label : defaults.label,
    }));
    setTestResult(null);
  };

  const runTest = async () => {
    setTouched(true);
    if (!validation.valid) {
      return;
    }
    setTesting(true);
    try {
      setTestResult(await onTest(profile));
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setTouched(true);
    if (!validation.valid) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({ ...profile, label: profile.label.trim(), model: profile.model.trim(), baseUrl: profile.baseUrl?.trim() });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save the profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={2} component="form" onSubmit={(event) => { event.preventDefault(); void save(); }} data-testid="ai-provider-form">
      <FormControl size="small" fullWidth>
        <InputLabel id="ai-provider-kind-label">Provider</InputLabel>
        <Select
          labelId="ai-provider-kind-label"
          label="Provider"
          value={profile.kind}
          onChange={(event) => changeKind(event.target.value as CloudKind)}
          inputProps={{ 'data-testid': 'ai-provider-kind' }}
        >
          {CLOUD_KINDS.map((kind) => (
            <MenuItem key={kind} value={kind}>
              {kindLabel(kind)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {profile.kind === 'openai_compatible' && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {AI_OPENAI_COMPATIBLE_PRESETS.map((preset) => (
            <Chip
              key={preset.label}
              size="small"
              variant="outlined"
              label={preset.label}
              onClick={() => update({ baseUrl: preset.baseUrl, model: preset.model || profile.model, label: profile.label || preset.label })}
            />
          ))}
        </Stack>
      )}

      <TextField
        size="small"
        label="Name"
        value={profile.label}
        onChange={(event) => update({ label: event.target.value })}
        error={showErrors && Boolean(validation.errors.label)}
        helperText={showErrors ? validation.errors.label : undefined}
        inputProps={{ 'data-testid': 'ai-provider-label' }}
        fullWidth
      />

      <TextField
        size="small"
        label="Base URL"
        value={profile.baseUrl ?? ''}
        onChange={(event) => update({ baseUrl: event.target.value })}
        error={showErrors && Boolean(validation.errors.baseUrl)}
        helperText={showErrors && validation.errors.baseUrl
          ? validation.errors.baseUrl
          : profile.kind === 'anthropic'
            ? 'Requests go straight from the browser to the API.'
            : 'Must end with the API version segment, e.g. …/v1. Local servers must allow this origin (CORS).'}
        inputProps={{ 'data-testid': 'ai-provider-base-url' }}
        fullWidth
      />

      <TextField
        size="small"
        label="API key"
        type={showKey ? 'text' : 'password'}
        value={profile.apiKey ?? ''}
        onChange={(event) => update({ apiKey: event.target.value })}
        error={showErrors && Boolean(validation.errors.apiKey)}
        helperText={showErrors && validation.errors.apiKey
          ? validation.errors.apiKey
          : 'Stored only inside the encrypted database.'}
        autoComplete="off"
        inputProps={{ 'data-testid': 'ai-provider-api-key' }}
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <IconButton size="small" onClick={() => setShowKey((current) => !current)} aria-label={showKey ? 'Hide API key' : 'Show API key'}>
                {showKey ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
              </IconButton>
            </InputAdornment>
          ),
        }}
        fullWidth
      />

      <TextField
        size="small"
        label="Model"
        value={profile.model}
        onChange={(event) => update({ model: event.target.value })}
        error={showErrors && Boolean(validation.errors.model)}
        helperText={showErrors && validation.errors.model
          ? validation.errors.model
          : profile.kind === 'anthropic'
            ? `Default ${AI_PROVIDER_DEFAULT_MODELS.anthropic}`
            : undefined}
        inputProps={{ 'data-testid': 'ai-provider-model' }}
        fullWidth
      />

      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Button size="small" variant="outlined" onClick={() => void runTest()} disabled={testing || saving} data-testid="ai-provider-test">
          Test connection
        </Button>
        <TestStatusChip result={testResult} testing={testing} />
      </Stack>
      {testResult && !testResult.ok && testResult.hint && (
        <Alert severity="warning" data-testid="ai-provider-test-hint">{testResult.hint}</Alert>
      )}
      {testResult && testResult.ok && testResult.hint && (
        <Alert severity="info">{testResult.hint}</Alert>
      )}
      {saveError && <Alert severity="error">{saveError}</Alert>}

      <Stack direction="row" spacing={1} justifyContent="flex-end">
        <Button size="small" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="small" variant="contained" type="submit" disabled={saving} data-testid="ai-provider-save">
          Save
        </Button>
      </Stack>
    </Stack>
  );
}

export default function AiProviderSetup({ activeProfileLabel }: AiProviderSetupProps) {
  const providers = useAiProviderContext();
  const [tab, setTab] = useState<SetupTab>(providers.activeProfile ? 'cloud' : 'local');
  const [editing, setEditing] = useState<AiProviderProfile | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const startAdd = () => {
    setEditing(createDefaultProfile('anthropic'));
  };

  const saveProfile = async (profile: AiProviderProfile) => {
    const isFirst = providers.profiles.length === 0;
    await providers.saveProfile({ ...profile, isActive: profile.isActive || isFirst });
    setEditing(null);
  };

  const runAction = async (action: () => Promise<void>) => {
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'The action failed');
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <Tabs
        value={tab}
        onChange={(_, value: SetupTab) => setTab(value)}
        variant="fullWidth"
        sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 40 }}
      >
        <Tab value="local" icon={<Computer fontSize="small" />} iconPosition="start" label="Local" sx={{ minHeight: 40 }} data-testid="ai-setup-tab-local" />
        <Tab value="cloud" icon={<Cloud fontSize="small" />} iconPosition="start" label="Cloud" sx={{ minHeight: 40 }} data-testid="ai-setup-tab-cloud" />
      </Tabs>

      {tab === 'local' && (
        <Box sx={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
          {providers.activeProfile && (
            <Alert
              severity="info"
              sx={{ m: 2, mb: 0 }}
              action={(
                <Button color="inherit" size="small" onClick={() => void runAction(() => providers.activateProfile(null))} data-testid="ai-provider-use-local">
                  Use local
                </Button>
              )}
            >
              Chat currently uses the cloud profile &quot;{activeProfileLabel}&quot;.
            </Alert>
          )}
          <AiModelSelector showLoadedDetailsInline />
        </Box>
      )}

      {tab === 'cloud' && (
        <Box sx={{ p: 2, overflow: 'auto', flex: 1, minHeight: 0 }}>
          <Stack spacing={2}>
            <Box>
              <Typography variant="subtitle1" fontWeight={600}>
                Cloud providers
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Profiles and API keys are stored in the encrypted database and sent only to the provider you configure.
              </Typography>
            </Box>

            {providers.error && <Alert severity="error">{providers.error}</Alert>}
            {actionError && <Alert severity="error" onClose={() => setActionError(null)}>{actionError}</Alert>}

            {providers.isLoading ? (
              <Stack direction="row" spacing={1} alignItems="center">
                <CircularProgress size={16} />
                <Typography variant="body2">Loading profiles…</Typography>
              </Stack>
            ) : (
              <List dense disablePadding data-testid="ai-provider-list">
                <ListItem
                  divider
                  secondaryAction={!providers.activeProfile ? (
                    <Chip size="small" color="primary" label="Active" />
                  ) : (
                    <Button size="small" onClick={() => void runAction(() => providers.activateProfile(null))}>
                      Use
                    </Button>
                  )}
                >
                  <ListItemText primary="Local AI (in-browser model)" secondary="No data leaves this device." />
                </ListItem>
                {providers.profiles.map((profile) => (
                  <ListItem
                    key={profile.id}
                    divider
                    data-testid={`ai-provider-row-${profile.id}`}
                    secondaryAction={(
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        {profile.isActive ? (
                          <Chip size="small" color="primary" label="Active" />
                        ) : (
                          <Button size="small" onClick={() => void runAction(() => providers.activateProfile(profile.id))} data-testid={`ai-provider-activate-${profile.id}`}>
                            Use
                          </Button>
                        )}
                        <Tooltip title="Edit">
                          <IconButton size="small" onClick={() => setEditing(profile)} aria-label={`Edit ${profile.label}`}>
                            <Edit fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton size="small" onClick={() => void runAction(() => providers.deleteProfile(profile.id))} aria-label={`Delete ${profile.label}`}>
                            <Delete fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    )}
                  >
                    <ListItemText
                      primary={profile.label}
                      secondary={`${kindLabel(profile.kind)} · ${profile.model || 'no model'}${profile.apiKey ? ` · key ${redactApiKey(profile.apiKey)}` : ''}`}
                      sx={{ pr: 14 }}
                    />
                  </ListItem>
                ))}
              </List>
            )}

            {editing ? (
              <>
                <Divider />
                <ProfileForm
                  key={editing.id}
                  initial={editing}
                  onCancel={() => setEditing(null)}
                  onSave={saveProfile}
                  onTest={providers.testProfile}
                />
              </>
            ) : (
              <Button startIcon={<Add />} variant="outlined" size="small" onClick={startAdd} data-testid="ai-provider-add" sx={{ alignSelf: 'flex-start' }}>
                Add cloud profile
              </Button>
            )}
          </Stack>
        </Box>
      )}
    </Box>
  );
}
