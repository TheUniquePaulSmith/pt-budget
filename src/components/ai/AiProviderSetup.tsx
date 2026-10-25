'use client';

/**
 * Setup tab: Local (the in-browser GGUF model selector, or an OpenAI-compatible
 * server on this machine or network) and Cloud (hosted provider profiles).
 * Profiles are saved through AiProviderContext into the encrypted database;
 * keys are shown masked and never logged.
 */

import React, { useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add,
  CheckCircle,
  Cloud,
  Computer,
  Delete,
  Dns,
  Edit,
  ErrorOutline,
  ExpandMore,
  Visibility,
  VisibilityOff,
} from '@mui/icons-material';

import { createDefaultProfile, isCloudKind, kindLabel, redactApiKey, validateProfile } from '@/lib/aiProviderConfig';
import {
  AI_OPENAI_COMPATIBLE_PRESETS,
  AI_PROVIDER_DEFAULT_BASE_URLS,
  AI_PROVIDER_DEFAULT_MODELS,
  type AiCloudProviderKind,
  type AiProviderProfile,
  type AiProviderTestResult,
} from '@/lib/aiProviders';
import AiModelSelector from './AiModelSelector';
import { useAiProviderContext } from './AiProviderContext';

type SetupTab = 'local' | 'cloud';
type LocalMode = 'browser' | 'endpoint';
type ProfileScope = 'local' | 'cloud';

const CLOUD_KINDS: AiCloudProviderKind[] = ['anthropic', 'openai', 'openai_compatible'];

interface AiProviderSetupProps {
  activeProfileLabel: string | null;
}

interface ProfileFormProps {
  initial: AiProviderProfile;
  /** `local` is the local-endpoint form: no provider picker, optional key, Advanced section. */
  variant: ProfileScope;
  onCancel: () => void;
  onSave: (profile: AiProviderProfile) => Promise<void>;
  onTest: (profile: AiProviderProfile) => Promise<AiProviderTestResult>;
}

interface ProfileManagerProps {
  scope: ProfileScope;
  title: string;
  description: string;
  /** The Cloud tab lists the in-browser model as the first row so it can be switched back to. */
  showBrowserModelRow?: boolean;
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

function ProfileForm({ initial, variant, onCancel, onSave, onTest }: ProfileFormProps) {
  const [profile, setProfile] = useState<AiProviderProfile>(initial);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiProviderTestResult | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(initial.useClientCertificate));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const isLocal = variant === 'local';
  const validation = validateProfile(profile);
  // A test may run without a model: it is how the model list is discovered.
  const testValidation = validateProfile(profile, { requireModel: false });
  const showErrors = touched;
  const showPresets = isLocal || profile.kind === 'openai_compatible';

  const update = (patch: Partial<AiProviderProfile>) => {
    setProfile((current) => ({ ...current, ...patch }));
    setTestResult(null);
    if ('baseUrl' in patch || 'apiKey' in patch || 'useClientCertificate' in patch) {
      // The list belongs to the endpoint it was fetched from.
      setModels([]);
    }
  };

  const changeKind = (kind: AiCloudProviderKind) => {
    const defaults = createDefaultProfile(kind);
    setProfile((current) => ({
      ...current,
      kind,
      baseUrl: AI_PROVIDER_DEFAULT_BASE_URLS[kind],
      model: current.model && current.kind === kind ? current.model : defaults.model,
      label: current.label && current.label !== kindLabel(current.kind) ? current.label : defaults.label,
    }));
    setTestResult(null);
    setModels([]);
  };

  const runTest = async () => {
    if (!testValidation.valid) {
      setTouched(true);
      return;
    }
    setTesting(true);
    try {
      const result = await onTest(profile);
      setTestResult(result);
      setModels(result.models ?? []);
      const [firstModel] = result.models ?? [];
      if (result.ok && firstModel) {
        setProfile((current) => (current.model.trim() ? current : { ...current, model: firstModel }));
      }
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
      await onSave({
        ...profile,
        label: profile.label.trim(),
        model: profile.model.trim(),
        baseUrl: profile.baseUrl?.trim(),
        useClientCertificate: profile.useClientCertificate || undefined,
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save the profile');
    } finally {
      setSaving(false);
    }
  };

  const modelHelperText = (): string | undefined => {
    if (showErrors && validation.errors.model) {
      return validation.errors.model;
    }
    if (models.length > 0) {
      return `${models.length} model${models.length === 1 ? '' : 's'} available on the server. Pick one or type a name.`;
    }
    if (profile.kind === 'anthropic') {
      return `Default ${AI_PROVIDER_DEFAULT_MODELS.anthropic}`;
    }
    return 'Run Test connection to list the models the server offers.';
  };

  return (
    <Stack spacing={2} component="form" onSubmit={(event) => { event.preventDefault(); void save(); }} data-testid="ai-provider-form">
      {!isLocal && (
        <FormControl size="small" fullWidth>
          <InputLabel id="ai-provider-kind-label">Provider</InputLabel>
          <Select
            labelId="ai-provider-kind-label"
            label="Provider"
            value={profile.kind}
            onChange={(event) => changeKind(event.target.value as AiCloudProviderKind)}
            inputProps={{ 'data-testid': 'ai-provider-kind' }}
          >
            {CLOUD_KINDS.map((kind) => (
              <MenuItem key={kind} value={kind}>
                {kindLabel(kind)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}

      {showPresets && (
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
          : isLocal
            ? 'Optional: only if your server expects a bearer token. Stored only inside the encrypted database.'
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

      <Autocomplete
        freeSolo
        size="small"
        fullWidth
        options={models}
        forcePopupIcon={models.length > 0}
        inputValue={profile.model}
        onInputChange={(_, value) => update({ model: value })}
        // Show every discovered model, not just the ones matching the current text.
        filterOptions={(options) => options}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Model"
            error={showErrors && Boolean(validation.errors.model)}
            helperText={modelHelperText()}
            inputProps={{ ...params.inputProps, 'data-testid': 'ai-provider-model' }}
          />
        )}
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

      {isLocal && (
        <Box>
          <Button
            fullWidth
            color="inherit"
            onClick={() => setAdvancedOpen((current) => !current)}
            endIcon={
              <ExpandMore
                sx={{
                  transform: advancedOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: (theme) => theme.transitions.create('transform'),
                }}
              />
            }
            sx={{ justifyContent: 'space-between', px: 0, textTransform: 'none' }}
            aria-expanded={advancedOpen}
            data-testid="ai-provider-advanced-toggle"
          >
            <Box sx={{ textAlign: 'left' }}>
              <Typography variant="subtitle2" fontWeight={600}>
                Advanced
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Client certificate (PFX / mTLS)
              </Typography>
            </Box>
          </Button>
          <Collapse in={advancedOpen} timeout="auto" unmountOnExit>
            <Stack spacing={1} sx={{ pt: 1 }}>
              <FormControlLabel
                control={(
                  <Switch
                    checked={Boolean(profile.useClientCertificate)}
                    onChange={(event) => update({ useClientCertificate: event.target.checked })}
                    inputProps={{ 'data-testid': 'ai-provider-client-cert' } as React.InputHTMLAttributes<HTMLInputElement>}
                  />
                )}
                label="Present my client certificate to this endpoint"
              />
              <Typography variant="caption" color="text.secondary">
                A browser cannot read a .pfx file or attach it to a request, so the certificate has to live in your
                system certificate store. On Windows, double-click the .pfx, choose Current User, enter its password
                and keep the Personal store; then restart the browser. With this switch on, requests to the endpoint
                include credentials so the browser offers that certificate.
              </Typography>
              <Typography variant="caption" color="text.secondary">
                The server must answer CORS with Access-Control-Allow-Credentials: true and an explicit
                Access-Control-Allow-Origin (not *).
              </Typography>
            </Stack>
          </Collapse>
        </Box>
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

function useActionRunner() {
  const [actionError, setActionError] = useState<string | null>(null);

  const runAction = async (action: () => Promise<void>) => {
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'The action failed');
    }
  };

  return { actionError, clearActionError: () => setActionError(null), runAction };
}

/** The saved profiles for one tab (cloud providers or local endpoints) plus the add / edit form. */
function ProfileManager({ scope, title, description, showBrowserModelRow = false }: ProfileManagerProps) {
  const providers = useAiProviderContext();
  const [editing, setEditing] = useState<AiProviderProfile | null>(null);
  const { actionError, clearActionError, runAction } = useActionRunner();
  const isLocal = scope === 'local';
  const profiles = providers.profiles.filter((profile) => (isLocal ? profile.kind === 'local_endpoint' : isCloudKind(profile.kind)));

  const startAdd = () => {
    setEditing(createDefaultProfile(isLocal ? 'local_endpoint' : 'anthropic'));
  };

  const saveProfile = async (profile: AiProviderProfile) => {
    const isFirst = providers.profiles.length === 0;
    await providers.saveProfile({ ...profile, isActive: profile.isActive || isFirst });
    setEditing(null);
  };

  const describeProfile = (profile: AiProviderProfile) => {
    const key = profile.apiKey ? ` · key ${redactApiKey(profile.apiKey)}` : '';
    if (isLocal) {
      const certificate = profile.useClientCertificate ? ' · client certificate' : '';
      return `${profile.baseUrl || AI_PROVIDER_DEFAULT_BASE_URLS.local_endpoint} · ${profile.model || 'no model'}${certificate}${key}`;
    }
    return `${kindLabel(profile.kind)} · ${profile.model || 'no model'}${key}`;
  };

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="subtitle1" fontWeight={600}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {description}
        </Typography>
      </Box>

      {providers.error && <Alert severity="error">{providers.error}</Alert>}
      {actionError && <Alert severity="error" onClose={clearActionError}>{actionError}</Alert>}

      {providers.isLoading ? (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={16} />
          <Typography variant="body2">Loading profiles…</Typography>
        </Stack>
      ) : (
        <>
          {isLocal && profiles.length === 0 && !editing && (
            <Typography variant="body2" color="text.secondary">
              No local endpoints yet. Add one to chat with Ollama, LM Studio, vLLM or any other OpenAI-compatible server.
            </Typography>
          )}
          {(showBrowserModelRow || profiles.length > 0) && (
            <List dense disablePadding data-testid={isLocal ? 'ai-local-endpoint-list' : 'ai-provider-list'}>
              {showBrowserModelRow && (
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
              )}
              {profiles.map((profile) => (
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
                    secondary={describeProfile(profile)}
                    sx={{ pr: 14 }}
                  />
                </ListItem>
              ))}
            </List>
          )}
        </>
      )}

      {editing ? (
        <>
          <Divider />
          <ProfileForm
            key={editing.id}
            initial={editing}
            variant={scope}
            onCancel={() => setEditing(null)}
            onSave={saveProfile}
            onTest={providers.testProfile}
          />
        </>
      ) : (
        <Button
          startIcon={<Add />}
          variant="outlined"
          size="small"
          onClick={startAdd}
          data-testid={isLocal ? 'ai-local-endpoint-add' : 'ai-provider-add'}
          sx={{ alignSelf: 'flex-start' }}
        >
          {isLocal ? 'Add local endpoint' : 'Add cloud profile'}
        </Button>
      )}
    </Stack>
  );
}

/** Local tab: run the model inside the browser (wllama + GGUF) or point at a local OpenAI-compatible server. */
function LocalSetup({ activeProfileLabel }: { activeProfileLabel: string | null }) {
  const providers = useAiProviderContext();
  const [mode, setMode] = useState<LocalMode>(providers.activeProfile?.kind === 'local_endpoint' ? 'endpoint' : 'browser');
  const { actionError, clearActionError, runAction } = useActionRunner();
  const activeKind = providers.activeProfile?.kind;

  return (
    <Box sx={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
      <Box sx={{ p: 2, pb: 0 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          Where does the model run?
        </Typography>
        <ToggleButtonGroup
          exclusive
          fullWidth
          size="small"
          color="primary"
          value={mode}
          onChange={(_, value: LocalMode | null) => {
            if (value) {
              setMode(value);
            }
          }}
          sx={{ mt: 1 }}
        >
          <ToggleButton value="browser" data-testid="ai-local-mode-browser" sx={{ textTransform: 'none', gap: 0.75 }}>
            <Computer fontSize="small" />
            Browser (GGUF file)
          </ToggleButton>
          <ToggleButton value="endpoint" data-testid="ai-local-mode-endpoint" sx={{ textTransform: 'none', gap: 0.75 }}>
            <Dns fontSize="small" />
            Local endpoint
          </ToggleButton>
        </ToggleButtonGroup>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {mode === 'browser'
            ? 'Runs a GGUF model file inside this browser tab with wllama. No data leaves this device.'
            : 'Connects to an OpenAI-compatible server on your machine or network, such as Ollama, LM Studio or vLLM.'}
        </Typography>
      </Box>

      {mode === 'browser' && (
        <>
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
              Chat currently uses the {activeKind === 'local_endpoint' ? 'local endpoint' : 'cloud profile'} &quot;{activeProfileLabel}&quot;.
            </Alert>
          )}
          {actionError && <Alert severity="error" sx={{ m: 2, mb: 0 }} onClose={clearActionError}>{actionError}</Alert>}
          <AiModelSelector showLoadedDetailsInline />
        </>
      )}

      {mode === 'endpoint' && (
        <Box sx={{ p: 2 }}>
          <ProfileManager
            scope="local"
            title="Local endpoints"
            description="Profiles and API keys are stored in the encrypted database and sent only to the server you configure."
          />
        </Box>
      )}
    </Box>
  );
}

export default function AiProviderSetup({ activeProfileLabel }: AiProviderSetupProps) {
  const providers = useAiProviderContext();
  const [tab, setTab] = useState<SetupTab>(providers.activeProfile && isCloudKind(providers.activeProfile.kind) ? 'cloud' : 'local');

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

      {tab === 'local' && <LocalSetup activeProfileLabel={activeProfileLabel} />}

      {tab === 'cloud' && (
        <Box sx={{ p: 2, overflow: 'auto', flex: 1, minHeight: 0 }}>
          <ProfileManager
            scope="cloud"
            title="Cloud providers"
            description="Profiles and API keys are stored in the encrypted database and sent only to the provider you configure."
            showBrowserModelRow
          />
        </Box>
      )}
    </Box>
  );
}
