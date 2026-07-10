'use client';

import React, { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  FormControl,
  FormControlLabel,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import {
  CheckCircle,
  Download,
  ErrorOutline,
  ExpandMore,
  FolderOpen,
  Memory,
  Stop,
  WarningAmber,
} from '@mui/icons-material';

import { useAiModelSlice } from '@/contexts/useWllamaSlices';
import type { AiModelLoadParams, AiSettingPreset } from '@/types/ai';
import {
  AI_CONTEXT_SIZE_PRESETS,
  AI_HIGH_RESOURCE_PRESET_IDS,
  AI_OUTPUT_LIMIT_PRESETS,
  AI_SETTING_PRESET_IDS,
} from '@/types/ai';

interface AiModelSelectorProps {
  showLoadedDetailsInline?: boolean;
}

function formatBytes(bytes?: number): string | null {
  if (!bytes || bytes <= 0) {
    return null;
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatMaybeBytes(bytes?: number): string {
  return formatBytes(bytes) ?? 'Not reported';
}

function formatMaybeNumber(value?: number, suffix = ''): string {
  if (value === undefined || value === null) {
    return 'Not reported';
  }

  return `${new Intl.NumberFormat('en-US').format(value)}${suffix}`;
}

export default function AiModelSelector({
  showLoadedDetailsInline = false,
}: AiModelSelectorProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [capacityExpanded, setCapacityExpanded] = useState(false);
  const {
    selectedModelFiles,
    selectedModelName,
    modelInspection,
    loadState,
    loadProgress,
    loadParams,
    loadedModel,
    error,
    errorDetails,
    capabilities,
    isModelLoaded,
    showTokenUsage,
    contextSizePreset,
    outputLimitPreset,
    selectModelFiles,
    setShowTokenUsage,
    setContextSizePreset,
    setOutputLimitPreset,
    setLoadParams,
    loadSelectedModel,
    unloadModel,
  } = useAiModelSlice();

  const isLoadingModel = loadState === 'loading-model';
  const hasSelectedModel = selectedModelFiles.length > 0;
  const isValidatingModel = modelInspection.status === 'validating';
  const hasInvalidModelSelection = modelInspection.status === 'invalid';
  const selectedSize = formatBytes(selectedModelFiles.reduce((total, file) => total + (file.sizeBytes ?? 0), 0));
  const isLoaded = isModelLoaded && Boolean(loadedModel);
  const shouldWarnForHighSettings =
    AI_HIGH_RESOURCE_PRESET_IDS.includes(contextSizePreset) ||
    AI_HIGH_RESOURCE_PRESET_IDS.includes(outputLimitPreset);
  const selectedModelSizeBytes = selectedModelFiles.reduce((total, file) => total + (file.sizeBytes ?? 0), 0);
  const maxWebGpuBufferSize = capabilities.webGpuLimits?.maxBufferSize;
  const selectedModelExceedsSingleBuffer = Boolean(
    selectedModelSizeBytes > 0 &&
    maxWebGpuBufferSize &&
    selectedModelSizeBytes > maxWebGpuBufferSize
  );

  const updateNumberParam = (key: keyof AiModelLoadParams, value: string) => {
    setLoadParams((current) => ({
      ...current,
      [key]: value === '' ? undefined : Number(value),
    }));
  };

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    selectModelFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  const formatTokens = (tokens: number) => new Intl.NumberFormat('en-US').format(tokens);

  const renderPresetOptions = (presets: typeof AI_CONTEXT_SIZE_PRESETS) => (
    AI_SETTING_PRESET_IDS.map((presetId) => {
      const preset = presets[presetId];

      return (
        <MenuItem key={preset.id} value={preset.id}>
          {preset.label} ({formatTokens(preset.tokens)})
        </MenuItem>
      );
    })
  );

  const renderCapacityRow = (label: string, value: string) => (
    <Stack direction="row" spacing={1} justifyContent="space-between">
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ textAlign: 'right', wordBreak: 'break-word' }}>
        {value}
      </Typography>
    </Stack>
  );

  const renderValidationRow = (label: string, value?: string | number | null) => {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    return renderCapacityRow(label, typeof value === 'number' ? formatMaybeNumber(value) : value);
  };

  const getValidationChip = () => {
    switch (modelInspection.status) {
      case 'validating':
        return <Chip size="small" label="Validating GGUF" variant="outlined" />;
      case 'valid':
        return <Chip size="small" icon={<CheckCircle />} label="Valid GGUF" color="success" variant="outlined" />;
      case 'warning':
        return <Chip size="small" icon={<WarningAmber />} label="Review GGUF" color="warning" variant="outlined" />;
      case 'invalid':
        return <Chip size="small" icon={<ErrorOutline />} label="Invalid GGUF" color="error" variant="outlined" />;
      default:
        return null;
    }
  };

  const renderModelInspection = () => {
    if (!hasSelectedModel || modelInspection.status === 'idle') {
      return null;
    }

    const validationChip = getValidationChip();
    const issueSeverity = modelInspection.issues.some((issue) => issue.severity === 'error') ? 'error' : 'warning';

    return (
      <Box sx={{ mb: 2, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="subtitle2" fontWeight={600}>
            Model validation
          </Typography>
          {validationChip}
        </Stack>

        {isValidatingModel ? (
          <LinearProgress />
        ) : (
          <Stack spacing={0.75}>
            {renderValidationRow('Model', modelInspection.stats.modelName)}
            {renderValidationRow('Architecture', modelInspection.stats.architecture)}
            {renderValidationRow('Quantization', modelInspection.stats.quantization)}
            {renderValidationRow('Context length', modelInspection.stats.contextLength)}
            {renderValidationRow('Embedding length', modelInspection.stats.embeddingLength)}
            {renderValidationRow('Layers', modelInspection.stats.layerCount)}
            {renderValidationRow('Vocabulary', modelInspection.stats.vocabularySize)}
            {renderValidationRow('Tensors', modelInspection.stats.tensorCount)}
            {renderValidationRow('Metadata entries', modelInspection.stats.metadataCount)}
            {renderValidationRow('GGUF version', modelInspection.stats.formatVersion)}
          </Stack>
        )}

        {modelInspection.issues.length > 0 && (
          <Alert severity={issueSeverity} sx={{ mt: 1 }}>
            <Box component="ul" sx={{ pl: 2, m: 0 }}>
              {modelInspection.issues.map((issue, index) => (
                <Typography component="li" variant="caption" key={`${issue.message}-${index}`} sx={{ mb: 0.5 }}>
                  {issue.message}
                </Typography>
              ))}
            </Box>
          </Alert>
        )}
      </Box>
    );
  };

  const renderModelFields = () => (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".gguf"
        multiple
        hidden
        onChange={handleFileInputChange}
      />

      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <Button
          variant="outlined"
          startIcon={<FolderOpen />}
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoadingModel}
        >
          Choose GGUF
        </Button>
        {hasSelectedModel && (
          <Chip size="small" label={`${selectedModelFiles.length} file${selectedModelFiles.length === 1 ? '' : 's'}`} />
        )}
      </Stack>

      {hasSelectedModel && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" fontWeight={600} sx={{ wordBreak: 'break-word' }}>
            {selectedModelName}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {selectedSize ?? 'Size unavailable'}
          </Typography>
        </Box>
      )}

      {renderModelInspection()}

      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Chip
          icon={<Memory />}
          size="small"
          label={capabilities.webGpuSupported ? 'WebGPU available' : 'CPU fallback'}
          color={capabilities.webGpuSupported ? 'success' : 'default'}
          variant="outlined"
        />
        <Chip
          size="small"
          label={capabilities.crossOriginIsolated ? 'Isolated' : 'Single-thread likely'}
          color={capabilities.crossOriginIsolated ? 'success' : 'warning'}
          variant="outlined"
        />
      </Stack>

      <Box sx={{ mb: 2 }}>
        <Button
          fullWidth
          color="inherit"
          onClick={() => setCapacityExpanded((current) => !current)}
          endIcon={
            <ExpandMore
              sx={{
                transform: capacityExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: (theme) => theme.transitions.create('transform'),
              }}
            />
          }
          sx={{ justifyContent: 'space-between', px: 0, textTransform: 'none' }}
          aria-expanded={capacityExpanded}
        >
          <Box sx={{ textAlign: 'left' }}>
            <Typography variant="subtitle2" fontWeight={600}>
              Browser Capacity
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Memory signals and WebGPU limits
            </Typography>
          </Box>
        </Button>
        <Collapse in={capacityExpanded} timeout="auto" unmountOnExit>
          <Box sx={{ pt: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Browsers do not expose exact GPU VRAM. These are memory signals and WebGPU adapter limits reported by the browser.
            </Typography>
            <Stack spacing={0.75}>
              {renderCapacityRow('CPU threads', formatMaybeNumber(capabilities.hardwareConcurrency))}
              {renderCapacityRow('Device memory', capabilities.deviceMemoryGb ? `~${capabilities.deviceMemoryGb} GB` : 'Not reported')}
              {renderCapacityRow('JS heap limit', formatMaybeBytes(capabilities.jsHeapSizeLimitBytes))}
              {renderCapacityRow('JS heap used', formatMaybeBytes(capabilities.jsHeapUsedBytes))}
              {renderCapacityRow('WebGPU adapter', capabilities.webGpuAdapterName || capabilities.webGpuAdapterDescription || capabilities.webGpuAdapterVendor || (capabilities.webGpuSupported ? 'Available' : 'Not available'))}
              {renderCapacityRow('Max GPU buffer', formatMaybeBytes(capabilities.webGpuLimits?.maxBufferSize))}
              {renderCapacityRow('Max storage binding', formatMaybeBytes(capabilities.webGpuLimits?.maxStorageBufferBindingSize))}
              {renderCapacityRow('Max uniform binding', formatMaybeBytes(capabilities.webGpuLimits?.maxUniformBufferBindingSize))}
              {renderCapacityRow('Max workgroup storage', formatMaybeBytes(capabilities.webGpuLimits?.maxComputeWorkgroupStorageSize))}
            </Stack>
            {capabilities.webGpuProbeError && (
              <Alert severity="warning" sx={{ mt: 1 }}>
                {capabilities.webGpuProbeError}
              </Alert>
            )}
            {selectedModelExceedsSingleBuffer && (
              <Alert severity="info" sx={{ mt: 1 }}>
                The selected model is larger than the reported maximum single WebGPU buffer. wllama may split model data internally, but older or lower-memory GPUs can fail to load or fall back.
              </Alert>
            )}
          </Box>
        </Collapse>
      </Box>

      <Box>
          <Typography variant="subtitle1" fontWeight={600}>
            Settings
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Advanced settings for model loading and inference. Adjust these only if you understand the implications.
          </Typography>
          <Box sx={{ mt: 1, mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            -1 for GPU Layers (use all available GPU layers)
          </Typography>
          </Box>
    </Box>
     

      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <FormControl fullWidth size="small" disabled={isLoadingModel}>
          <InputLabel>Context</InputLabel>
          <Select
            value={contextSizePreset}
            label="Context"
            onChange={(event) => setContextSizePreset(event.target.value as AiSettingPreset)}
          >
            {renderPresetOptions(AI_CONTEXT_SIZE_PRESETS)}
          </Select>
        </FormControl>
        <FormControl fullWidth size="small" disabled={isLoadingModel}>
          <InputLabel>Output limit</InputLabel>
          <Select
            value={outputLimitPreset}
            label="Output limit"
            onChange={(event) => setOutputLimitPreset(event.target.value as AiSettingPreset)}
          >
            {renderPresetOptions(AI_OUTPUT_LIMIT_PRESETS)}
          </Select>
        </FormControl>
      </Stack>
      

      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <TextField
          label="Threads"
          type="number"
          size="small"
          value={loadParams.n_threads ?? ''}
          onChange={(event) => updateNumberParam('n_threads', event.target.value)}
          disabled={isLoadingModel}
          fullWidth
        />
        <TextField
          label="GPU layers"
          type="number"
          size="small"
          value={loadParams.n_gpu_layers ?? ''}
          onChange={(event) => updateNumberParam('n_gpu_layers', event.target.value)}
          disabled={isLoadingModel}
          fullWidth
        />
      </Stack>

      {shouldWarnForHighSettings && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Large and Extra Large settings may significantly slow down your browser and consume substantial memory. Use them only if your device has sufficient resources.
        </Alert>
      )}
         <FormControlLabel
        sx={{ mb: 2 }}
        control={
          <Switch
            checked={showTokenUsage}
            onChange={(event) => setShowTokenUsage(event.target.checked)}
          />
        }
        label="Show chat token usage"
      />
      {isLoadingModel && (
        <Box sx={{ mb: 2 }}>
          <LinearProgress
            variant={loadProgress ? 'determinate' : 'indeterminate'}
            value={loadProgress?.percent ?? 0}
          />
          <Typography variant="caption" color="text.secondary">
            {loadProgress ? `Loading model: ${loadProgress.percent}%` : 'Loading local model...'}
          </Typography>
        </Box>
      )}

      <Stack direction="row" spacing={1}>
        <Button
          variant="contained"
          startIcon={<Download />}
          onClick={() => void loadSelectedModel()}
          disabled={!hasSelectedModel || isLoadingModel || isValidatingModel || hasInvalidModelSelection}
        >
          {isModelLoaded ? 'Reload Model' : 'Load Model'}
        </Button>
        <Button
          variant="outlined"
          startIcon={<Stop />}
          onClick={() => void unloadModel()}
          disabled={!isModelLoaded && !isLoadingModel}
        >
          Unload
        </Button>
      </Stack>

      {loadedModel && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Loaded: {loadedModel.name}{loadedModel.contextLength ? ` (${loadedModel.contextLength} ctx)` : ''}
        </Typography>
      )}
    </>
  );

  if (isLoaded && loadedModel) {
    if (showLoadedDetailsInline) {
      return (
        <Box sx={{ p: 2 }}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle1" fontWeight={600}>
              Model
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Local GGUF file and runtime details.
            </Typography>
          </Box>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              <Typography variant="body2" sx={{ mb: errorDetails.length > 0 ? 1 : 0 }}>
                {error}
              </Typography>
              {errorDetails.length > 0 && (
                <Box component="ul" sx={{ pl: 2, m: 0 }}>
                  {errorDetails.map((detail, index) => (
                    <Typography component="li" variant="caption" key={`${detail}-${index}`} sx={{ mb: 0.5 }}>
                      {detail}
                    </Typography>
                  ))}
                </Box>
              )}
            </Alert>
          )}

          {renderModelFields()}
        </Box>
      );
    }

    return (
      <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" fontWeight={600} noWrap>
              AI model loaded
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
              {loadedModel.name}{loadedModel.contextLength ? ` | ${loadedModel.contextLength} ctx` : ''}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
            <Button
              size="small"
              variant="text"
              startIcon={<Stop />}
              onClick={() => void unloadModel()}
            >
              Unload
            </Button>
          </Stack>
        </Stack>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Box>
          <Typography variant="subtitle1" fontWeight={600}>
            Enable AI
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Choose a local GGUF model file to load with wllama.
          </Typography>
        </Box>
      </Stack>

      {!hasSelectedModel && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Select one `.gguf` file, or multiple `.gguf` shard files for a split model.
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ mb: errorDetails.length > 0 ? 1 : 0 }}>
            {error}
          </Typography>
          {errorDetails.length > 0 && (
            <Box component="ul" sx={{ pl: 2, m: 0 }}>
              {errorDetails.map((detail, index) => (
                <Typography component="li" variant="caption" key={`${detail}-${index}`} sx={{ mb: 0.5 }}>
                  {detail}
                </Typography>
              ))}
            </Box>
          )}
        </Alert>
      )}

      {renderModelFields()}
    </Box>
  );
}