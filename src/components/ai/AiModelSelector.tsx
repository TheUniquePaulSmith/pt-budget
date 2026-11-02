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
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';
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

/** Binary size units; the symbols are international and stay as they are. */
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB'];

function splitBytes(bytes?: number): { value: number; unit: string } | null {
  if (!bytes || bytes <= 0) {
    return null;
  }

  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return { value, unit: BYTE_UNITS[unitIndex] };
}

export default function AiModelSelector({
  showLoadedDetailsInline = false,
}: AiModelSelectorProps) {
  const { t } = useTranslation('ai');
  const { number } = useFormatters();
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

  const formatBytes = (bytes?: number): string | null => {
    const parts = splitBytes(bytes);
    if (!parts) {
      return null;
    }
    const digits = parts.unit === 'B' ? 0 : 1;
    return t('modelSelector.fileSize', {
      value: number(parts.value, { minimumFractionDigits: digits, maximumFractionDigits: digits }),
      unit: parts.unit,
    });
  };

  const formatMaybeBytes = (bytes?: number): string => formatBytes(bytes) ?? t('modelSelector.notReported');

  const formatMaybeNumber = (value?: number): string => {
    if (value === undefined || value === null) {
      return t('modelSelector.notReported');
    }
    return number(value);
  };

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

  const renderPresetOptions = (presets: typeof AI_CONTEXT_SIZE_PRESETS) => (
    AI_SETTING_PRESET_IDS.map((presetId) => {
      const preset = presets[presetId];

      return (
        <MenuItem key={preset.id} value={preset.id}>
          {t('modelSelector.presetOption', { label: t(`modelSelector.preset.${preset.id}`), tokens: number(preset.tokens) })}
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
        return <Chip size="small" label={t('modelSelector.validating')} variant="outlined" />;
      case 'valid':
        return <Chip size="small" icon={<CheckCircle />} label={t('modelSelector.valid')} color="success" variant="outlined" />;
      case 'warning':
        return <Chip size="small" icon={<WarningAmber />} label={t('modelSelector.review')} color="warning" variant="outlined" />;
      case 'invalid':
        return <Chip size="small" icon={<ErrorOutline />} label={t('modelSelector.invalid')} color="error" variant="outlined" />;
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
            {t('modelSelector.validationTitle')}
          </Typography>
          {validationChip}
        </Stack>

        {isValidatingModel ? (
          <LinearProgress />
        ) : (
          <Stack spacing={0.75}>
            {renderValidationRow(t('modelSelector.model'), modelInspection.stats.modelName)}
            {renderValidationRow(t('modelSelector.architecture'), modelInspection.stats.architecture)}
            {renderValidationRow(t('modelSelector.quantization'), modelInspection.stats.quantization)}
            {renderValidationRow(t('modelSelector.contextLength'), modelInspection.stats.contextLength)}
            {renderValidationRow(t('modelSelector.embeddingLength'), modelInspection.stats.embeddingLength)}
            {renderValidationRow(t('modelSelector.layers'), modelInspection.stats.layerCount)}
            {renderValidationRow(t('modelSelector.vocabulary'), modelInspection.stats.vocabularySize)}
            {renderValidationRow(t('modelSelector.tensors'), modelInspection.stats.tensorCount)}
            {renderValidationRow(t('modelSelector.metadataEntries'), modelInspection.stats.metadataCount)}
            {renderValidationRow(t('modelSelector.ggufVersion'), modelInspection.stats.formatVersion)}
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
          {t('modelSelector.chooseGguf')}
        </Button>
        {hasSelectedModel && (
          <Chip size="small" label={t('modelSelector.files', { count: selectedModelFiles.length })} />
        )}
      </Stack>

      {hasSelectedModel && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" fontWeight={600} sx={{ wordBreak: 'break-word' }}>
            {selectedModelName}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {selectedSize ?? t('modelSelector.sizeUnavailable')}
          </Typography>
        </Box>
      )}

      {renderModelInspection()}

      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Chip
          icon={<Memory />}
          size="small"
          label={capabilities.webGpuSupported ? t('modelSelector.webGpuAvailable') : t('modelSelector.cpuFallback')}
          color={capabilities.webGpuSupported ? 'success' : 'default'}
          variant="outlined"
        />
        <Chip
          size="small"
          label={capabilities.crossOriginIsolated ? t('modelSelector.isolated') : t('modelSelector.singleThread')}
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
              {t('modelSelector.capacityTitle')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('modelSelector.capacitySubtitle')}
            </Typography>
          </Box>
        </Button>
        <Collapse in={capacityExpanded} timeout="auto" unmountOnExit>
          <Box sx={{ pt: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              {t('modelSelector.capacityHelp')}
            </Typography>
            <Stack spacing={0.75}>
              {renderCapacityRow(t('modelSelector.cpuThreads'), formatMaybeNumber(capabilities.hardwareConcurrency))}
              {renderCapacityRow(
                t('modelSelector.deviceMemory'),
                capabilities.deviceMemoryGb
                  ? t('modelSelector.deviceMemoryGb', { gb: number(capabilities.deviceMemoryGb) })
                  : t('modelSelector.notReported')
              )}
              {renderCapacityRow(t('modelSelector.jsHeapLimit'), formatMaybeBytes(capabilities.jsHeapSizeLimitBytes))}
              {renderCapacityRow(t('modelSelector.jsHeapUsed'), formatMaybeBytes(capabilities.jsHeapUsedBytes))}
              {renderCapacityRow(
                t('modelSelector.webGpuAdapter'),
                capabilities.webGpuAdapterName
                  || capabilities.webGpuAdapterDescription
                  || capabilities.webGpuAdapterVendor
                  || (capabilities.webGpuSupported ? t('modelSelector.available') : t('modelSelector.notAvailable'))
              )}
              {renderCapacityRow(t('modelSelector.maxGpuBuffer'), formatMaybeBytes(capabilities.webGpuLimits?.maxBufferSize))}
              {renderCapacityRow(t('modelSelector.maxStorageBinding'), formatMaybeBytes(capabilities.webGpuLimits?.maxStorageBufferBindingSize))}
              {renderCapacityRow(t('modelSelector.maxUniformBinding'), formatMaybeBytes(capabilities.webGpuLimits?.maxUniformBufferBindingSize))}
              {renderCapacityRow(t('modelSelector.maxWorkgroupStorage'), formatMaybeBytes(capabilities.webGpuLimits?.maxComputeWorkgroupStorageSize))}
            </Stack>
            {capabilities.webGpuProbeError && (
              <Alert severity="warning" sx={{ mt: 1 }}>
                {capabilities.webGpuProbeError}
              </Alert>
            )}
            {selectedModelExceedsSingleBuffer && (
              <Alert severity="info" sx={{ mt: 1 }}>
                {t('modelSelector.modelExceedsBuffer')}
              </Alert>
            )}
          </Box>
        </Collapse>
      </Box>

      <Box>
          <Typography variant="subtitle1" fontWeight={600}>
            {t('modelSelector.settingsTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('modelSelector.settingsHelp')}
          </Typography>
          <Box sx={{ mt: 1, mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            {t('modelSelector.gpuLayersHint')}
          </Typography>
          </Box>
    </Box>


      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <FormControl fullWidth size="small" disabled={isLoadingModel}>
          <InputLabel>{t('modelSelector.context')}</InputLabel>
          <Select
            value={contextSizePreset}
            label={t('modelSelector.context')}
            onChange={(event) => setContextSizePreset(event.target.value as AiSettingPreset)}
          >
            {renderPresetOptions(AI_CONTEXT_SIZE_PRESETS)}
          </Select>
        </FormControl>
        <FormControl fullWidth size="small" disabled={isLoadingModel}>
          <InputLabel>{t('modelSelector.outputLimit')}</InputLabel>
          <Select
            value={outputLimitPreset}
            label={t('modelSelector.outputLimit')}
            onChange={(event) => setOutputLimitPreset(event.target.value as AiSettingPreset)}
          >
            {renderPresetOptions(AI_OUTPUT_LIMIT_PRESETS)}
          </Select>
        </FormControl>
      </Stack>


      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <TextField
          label={t('modelSelector.threads')}
          type="number"
          size="small"
          value={loadParams.n_threads ?? ''}
          onChange={(event) => updateNumberParam('n_threads', event.target.value)}
          disabled={isLoadingModel}
          fullWidth
        />
        <TextField
          label={t('modelSelector.gpuLayers')}
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
          {t('modelSelector.highSettingsWarning')}
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
        label={t('modelSelector.showTokenUsage')}
      />
      {isLoadingModel && (
        <Box sx={{ mb: 2 }}>
          <LinearProgress
            variant={loadProgress ? 'determinate' : 'indeterminate'}
            value={loadProgress?.percent ?? 0}
          />
          <Typography variant="caption" color="text.secondary">
            {loadProgress
              ? t('modelSelector.loadingPercent', { percent: number(loadProgress.percent) })
              : t('modelSelector.loadingModel')}
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
          {isModelLoaded ? t('modelSelector.reloadModel') : t('modelSelector.loadModel')}
        </Button>
        <Button
          variant="outlined"
          startIcon={<Stop />}
          onClick={() => void unloadModel()}
          disabled={!isModelLoaded && !isLoadingModel}
        >
          {t('modelSelector.unload')}
        </Button>
      </Stack>

      {loadedModel && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {loadedModel.contextLength
            ? t('modelSelector.loadedWithContext', { name: loadedModel.name, ctx: number(loadedModel.contextLength) })
            : t('modelSelector.loaded', { name: loadedModel.name })}
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
              {t('modelSelector.modelTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('modelSelector.modelSubtitle')}
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
              {t('modelSelector.modelLoaded')}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
              {loadedModel.contextLength
                ? t('modelSelector.loadedCaptionWithContext', { name: loadedModel.name, ctx: number(loadedModel.contextLength) })
                : t('modelSelector.loadedCaption', { name: loadedModel.name })}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
            <Button
              size="small"
              variant="text"
              startIcon={<Stop />}
              onClick={() => void unloadModel()}
            >
              {t('modelSelector.unload')}
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
            {t('modelSelector.enableAi')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('modelSelector.chooseHelp')}
          </Typography>
        </Box>
      </Stack>

      {!hasSelectedModel && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('modelSelector.selectFilesHint')}
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
