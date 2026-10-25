'use client';

/**
 * Developer Console: the persisted, correlated log stream.
 *
 * Reads `ptbudgetapp-logs` newest-first (paged), follows live updates from
 * every tab and the SharedWorker, filters by level / source / page /
 * correlation id / text, and exports `logs-<date>.ndjson` plus a merged
 * human-readable `logs-<date>.txt` timeline. Clicking a row's correlation id
 * narrows the view to that request: the app row that sent it and the worker
 * rows written while handling it.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import {
  Close,
  ContentCopy,
  DeleteSweep,
  Download,
  ErrorOutline,
  ExpandLess,
  ExpandMore,
  InfoOutlined,
  Link as LinkIcon,
  Refresh,
  Science,
  Search,
  WarningAmberOutlined,
} from '@mui/icons-material';

import { databaseWorkerService } from '@/lib/databaseWorkerService';
import {
  SOURCE_TAGS,
  clearLogs,
  downloadLogExports,
  formatTimelineLine,
  logger,
  readAllLogs,
  type LogLevel,
  type LogSource,
  type StoredLogRecord,
} from '@/lib/logging';

import {
  ALL_LEVELS,
  ALL_SOURCES,
  DEFAULT_LOG_VIEW_FILTERS,
  useLogEntries,
  type LogViewFilters,
} from './useLogEntries';

const MONO_FONT =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
const PIN_TO_BOTTOM_THRESHOLD_PX = 48;
const MAX_DETAIL_LENGTH = 20_000;

const log = logger.child({ component: 'DeveloperConsole' });

const formatTime = (ts: number): string => {
  const date = new Date(ts);
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
};

const getLevelColor = (
  level: LogLevel
): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' => {
  switch (level) {
    case 'error': return 'error';
    case 'warn': return 'warning';
    case 'info': return 'info';
    case 'debug': return 'secondary';
    default: return 'default';
  }
};

const getSourceColor = (source: LogSource): 'primary' | 'success' | 'default' => {
  switch (source) {
    case 'worker': return 'success';
    case 'app': return 'primary';
    default: return 'default';
  }
};

function recordSource(record: StoredLogRecord): LogSource {
  return (record.context.source ?? 'app') as LogSource;
}

function detailText(record: StoredLogRecord): string {
  const { source: _s, tabId, sessionId, ...rest } = record.context;
  const payload = { ...rest, tabId, sessionId, id: record.id, seq: record.seq };
  let json: string;
  try {
    json = JSON.stringify(payload, null, 2);
  } catch {
    json = '[unserializable context]';
  }
  if (json.length > MAX_DETAIL_LENGTH) json = `${json.slice(0, MAX_DETAIL_LENGTH)}\n… (truncated)`;
  if (record.error) {
    json += `\n\n${record.error.stack ?? `${record.error.name}: ${record.error.message}`}`;
  }
  return json;
}

/** Emits a correlated app + worker pair so the console can be exercised without any user data. */
export async function generateTestLogs(): Promise<void> {
  const op = log.withOperation('generateTestLogs');
  op.trace('Test trace message');
  op.debug('Test debug message', { sample: { nested: true, count: 3 } });
  op.info('Test info message');
  op.warn('Test warning message');
  try {
    throw new Error('Test intentional error for debugging');
  } catch (error) {
    op.error('Test caught error', { error });
  }
  op.info('Multi-line message\nline two\nline three');
  try {
    await databaseWorkerService.ping();
    op.info('Worker ping round-trip complete');
  } catch (error) {
    op.warn('Worker ping failed', { error });
  }
}

interface LogRowProps {
  record: StoredLogRecord;
  expanded: boolean;
  onToggle: () => void;
  onSelectCorrelation: (correlationId: string) => void;
  onCopy: () => void;
}

const LogRow = React.memo(function LogRow({ record, expanded, onToggle, onSelectCorrelation, onCopy }: LogRowProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const source = recordSource(record);
  const { level } = record;

  const style = (() => {
    switch (level) {
      case 'error':
        return {
          accent: theme.palette.error.main,
          bg: alpha(theme.palette.error.main, isDark ? 0.14 : 0.07),
          text: isDark ? theme.palette.error.light : theme.palette.error.dark,
          icon: <ErrorOutline sx={{ fontSize: 14, color: 'error.main' }} />,
        };
      case 'warn':
        return {
          accent: theme.palette.warning.main,
          bg: alpha(theme.palette.warning.main, isDark ? 0.12 : 0.09),
          text: isDark ? theme.palette.warning.light : theme.palette.warning.dark,
          icon: <WarningAmberOutlined sx={{ fontSize: 14, color: 'warning.main' }} />,
        };
      case 'info':
        return { accent: undefined, bg: undefined, text: undefined, icon: <InfoOutlined sx={{ fontSize: 14, color: 'info.main' }} /> };
      default:
        return { accent: undefined, bg: undefined, text: theme.palette.text.secondary, icon: null };
    }
  })();

  const correlationId = record.context.correlationId;
  const where = [record.context.component, record.context.operation ?? record.context.process]
    .filter(Boolean)
    .join(' · ');

  return (
    <Box
      data-testid="log-row"
      data-source={source}
      data-level={level}
      data-correlation-id={correlationId ?? ''}
      data-seq={record.seq}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        px: 1,
        py: 0.5,
        borderBottom: '1px solid',
        borderBottomColor: 'divider',
        borderLeft: '3px solid',
        borderLeftColor: style.accent ?? 'transparent',
        backgroundColor: style.bg ?? 'transparent',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
        <Box sx={{ width: 16, flexShrink: 0, display: 'flex', justifyContent: 'center', pt: '3px' }}>{style.icon}</Box>
        <Typography
          component="span"
          sx={{ fontFamily: MONO_FONT, fontSize: '0.7rem', lineHeight: 1.6, color: 'text.disabled', flexShrink: 0 }}
        >
          {formatTime(record.ts)}
        </Typography>
        <Chip
          label={SOURCE_TAGS[source].replace(/[[\]]/g, '')}
          size="small"
          variant="outlined"
          color={getSourceColor(source)}
          data-testid="log-source-tag"
          sx={{ height: 18, fontSize: '0.65rem', fontFamily: MONO_FONT, flexShrink: 0 }}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            component="pre"
            data-testid="log-message"
            sx={{
              m: 0,
              fontFamily: MONO_FONT,
              fontSize: '0.75rem',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              color: style.text ?? 'text.primary',
            }}
          >
            {record.message || ' '}
          </Typography>
          <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.25 }}>
            {where && (
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: MONO_FONT }} noWrap>
                {where}
              </Typography>
            )}
            {record.context.page && (
              <Chip label={record.context.page} size="small" sx={{ height: 18, fontSize: '0.65rem' }} />
            )}
            {record.context.element && (
              <Tooltip title={`Last interaction: ${record.context.element}`}>
                <Chip
                  label={record.context.element}
                  size="small"
                  variant="outlined"
                  sx={{ height: 18, fontSize: '0.65rem', maxWidth: 200 }}
                />
              </Tooltip>
            )}
            {correlationId && (
              <Tooltip title="Show every app and worker row for this request">
                <Chip
                  icon={<LinkIcon sx={{ fontSize: 12 }} />}
                  label={correlationId}
                  size="small"
                  variant="outlined"
                  color="primary"
                  onClick={() => onSelectCorrelation(correlationId)}
                  data-testid="log-correlation-chip"
                  sx={{ height: 18, fontSize: '0.65rem', fontFamily: MONO_FONT }}
                />
              </Tooltip>
            )}
            {record.error && !expanded && (
              <Typography variant="caption" sx={{ fontFamily: MONO_FONT, color: isDark ? 'error.light' : 'error.dark' }} noWrap>
                {record.error.name}: {record.error.message}
              </Typography>
            )}
          </Stack>
        </Box>
        <IconButton
          size="small"
          onClick={onToggle}
          aria-label={expanded ? 'Hide details' : 'Show details'}
          sx={{ p: 0.25, opacity: 0.6, '&:hover': { opacity: 1 } }}
        >
          {expanded ? <ExpandLess sx={{ fontSize: 16 }} /> : <ExpandMore sx={{ fontSize: 16 }} />}
        </IconButton>
        <IconButton
          size="small"
          onClick={onCopy}
          aria-label="Copy log entry"
          sx={{ p: 0.25, opacity: 0.4, '&:hover': { opacity: 1 } }}
        >
          <ContentCopy sx={{ fontSize: 14 }} />
        </IconButton>
      </Box>
      {expanded && (
        <Typography
          component="pre"
          data-testid="log-details"
          sx={{
            m: 0,
            mt: 0.5,
            ml: '22px',
            p: 1,
            borderRadius: 1,
            bgcolor: alpha(theme.palette.text.primary, isDark ? 0.08 : 0.04),
            fontFamily: MONO_FONT,
            fontSize: '0.7rem',
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            color: 'text.secondary',
          }}
        >
          {detailText(record)}
        </Typography>
      )}
    </Box>
  );
});

const DeveloperConsole: React.FC = () => {
  const [filters, setFilters] = useState<LogViewFilters>(DEFAULT_LOG_VIEW_FILTERS);
  const [follow, setFollow] = useState(true);
  const [expandedSeq, setExpandedSeq] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isPinnedToTop, setIsPinnedToTop] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { entries, hasMore, isLoading, pendingCount, total, refresh, loadOlder } = useLogEntries({ filters, follow });

  const knownPages = useMemo(() => {
    const pages = new Set<string>();
    for (const entry of entries) if (entry.context.page) pages.add(entry.context.page);
    if (filters.page) pages.add(filters.page);
    return [...pages].sort();
  }, [entries, filters.page]);

  const levelCounts = useMemo(() => {
    const counts: Partial<Record<LogLevel, number>> = {};
    for (const entry of entries) counts[entry.level] = (counts[entry.level] ?? 0) + 1;
    return counts;
  }, [entries]);

  // Newest-first list: keep the top in view while following unless the user scrolled down.
  useEffect(() => {
    if (!follow || !isPinnedToTop) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
  }, [entries, follow, isPinnedToTop]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setIsPinnedToTop(el.scrollTop < PIN_TO_BOTTOM_THRESHOLD_PX);
  }, []);

  const toggleLevel = (level: LogLevel) => {
    setFilters((current) => ({
      ...current,
      levels: current.levels.includes(level)
        ? current.levels.filter((item) => item !== level)
        : [...current.levels, level],
    }));
  };

  const toggleSource = (source: LogSource) => {
    setFilters((current) => ({
      ...current,
      sources: current.sources.includes(source)
        ? current.sources.filter((item) => item !== source)
        : [...current.sources, source],
    }));
  };

  const selectCorrelation = useCallback((correlationId: string) => {
    setFilters((current) => ({ ...current, correlationId }));
    setFollow(false);
  }, []);

  const handleCopy = useCallback(async (record: StoredLogRecord) => {
    const text = `${formatTimelineLine(record, record.context.correlationId?.length ?? 1)}\n${detailText(record)}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard is unavailable outside secure contexts (e.g. plain-http LAN testing)
    }
  }, []);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const records = await readAllLogs();
      const names = downloadLogExports(records);
      log.info('Exported diagnostic logs', { operation: 'exportLogs', count: records.length, files: [names.ndjson, names.txt] });
    } catch (error) {
      log.error('Failed to export diagnostic logs', { operation: 'exportLogs', error });
    } finally {
      setIsExporting(false);
    }
  };

  const handleClear = async () => {
    setIsClearing(true);
    try {
      await clearLogs();
      log.info('Diagnostic logs cleared from the console', { operation: 'clearLogs' });
    } catch (error) {
      log.error('Failed to clear diagnostic logs', { operation: 'clearLogs', error });
    } finally {
      setIsClearing(false);
      refresh();
    }
  };

  const activeFilterCount =
    (filters.levels.length !== ALL_LEVELS.length ? 1 : 0) +
    (filters.sources.length !== ALL_SOURCES.length ? 1 : 0) +
    (filters.page ? 1 : 0) +
    (filters.correlationId ? 1 : 0) +
    (filters.text.trim() ? 1 : 0);

  return (
    <Box
      data-testid="developer-console"
      sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, bgcolor: 'background.paper' }}
    >
      {/* Toolbar */}
      <Box sx={{ px: 1, py: 0.75, borderBottom: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Stack direction="row" spacing={0.5} alignItems="center">
          <TextField
            size="small"
            fullWidth
            placeholder="Search logs"
            value={filters.text}
            onChange={(e) => setFilters((current) => ({ ...current, text: e.target.value }))}
            inputProps={{ 'data-testid': 'log-search-input' }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search fontSize="small" />
                </InputAdornment>
              ),
              endAdornment: filters.text !== '' && (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    onClick={() => setFilters((current) => ({ ...current, text: '' }))}
                    aria-label="Clear search"
                  >
                    <Close fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
          <Tooltip title={follow ? 'Following new entries' : 'Paused — new entries are counted'}>
            <FormControlLabel
              sx={{ mr: 0, ml: 0, whiteSpace: 'nowrap' }}
              control={
                <Switch
                  size="small"
                  checked={follow}
                  onChange={(e) => setFollow(e.target.checked)}
                  inputProps={{ 'aria-label': 'Follow new entries', 'data-testid': 'log-follow-toggle' } as React.InputHTMLAttributes<HTMLInputElement>}
                />
              }
              label={<Typography variant="caption">Follow</Typography>}
            />
          </Tooltip>
          <Tooltip title="Refresh">
            <IconButton onClick={refresh} aria-label="Refresh logs" data-testid="log-refresh">
              <Refresh fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Generate test logs (app + worker pair)">
            <IconButton onClick={() => void generateTestLogs()} aria-label="Generate test logs" data-testid="log-generate-test">
              <Science fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Export logs (.ndjson + .txt timeline)">
            <span>
              <IconButton
                onClick={() => void handleExport()}
                disabled={isExporting || total === 0}
                aria-label="Export logs"
                data-testid="log-export"
              >
                {isExporting ? <CircularProgress size={18} /> : <Download fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Clear all stored logs">
            <span>
              <IconButton
                onClick={() => void handleClear()}
                disabled={isClearing || total === 0}
                aria-label="Clear logs"
                data-testid="log-clear"
              >
                <DeleteSweep fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>

        <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
          {ALL_LEVELS.map((level) => (
            <Chip
              key={level}
              label={levelCounts[level] ? `${level} (${levelCounts[level]})` : level}
              size="small"
              variant={filters.levels.includes(level) ? 'filled' : 'outlined'}
              color={getLevelColor(level)}
              onClick={() => toggleLevel(level)}
              data-testid={`log-level-${level}`}
            />
          ))}
          <Box sx={{ width: 8 }} />
          {ALL_SOURCES.map((source) => (
            <Chip
              key={source}
              label={SOURCE_TAGS[source]}
              size="small"
              variant={filters.sources.includes(source) ? 'filled' : 'outlined'}
              color={getSourceColor(source)}
              onClick={() => toggleSource(source)}
              data-testid={`log-source-${source}`}
              sx={{ fontFamily: MONO_FONT }}
            />
          ))}
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel id="log-page-filter-label">Page</InputLabel>
            <Select
              labelId="log-page-filter-label"
              label="Page"
              value={filters.page}
              onChange={(e) => setFilters((current) => ({ ...current, page: String(e.target.value) }))}
              data-testid="log-page-filter"
              sx={{ fontSize: '0.8rem' }}
            >
              <MenuItem value="">
                <em>All pages</em>
              </MenuItem>
              {knownPages.map((page) => (
                <MenuItem key={page} value={page}>
                  {page}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            size="small"
            label="Correlation id"
            value={filters.correlationId}
            onChange={(e) => setFilters((current) => ({ ...current, correlationId: e.target.value }))}
            inputProps={{ 'data-testid': 'log-correlation-filter', style: { fontFamily: MONO_FONT, fontSize: '0.8rem' } }}
            sx={{ minWidth: 160 }}
            InputProps={{
              endAdornment: filters.correlationId !== '' && (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    onClick={() => setFilters((current) => ({ ...current, correlationId: '' }))}
                    aria-label="Clear correlation filter"
                  >
                    <Close fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
          {activeFilterCount > 0 && (
            <Button size="small" onClick={() => setFilters(DEFAULT_LOG_VIEW_FILTERS)} data-testid="log-reset-filters">
              Reset filters
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          {!follow && pendingCount > 0 && (
            <Chip
              label={`${pendingCount} new`}
              size="small"
              color="primary"
              onClick={refresh}
              data-testid="log-pending-count"
            />
          )}
          <Typography variant="caption" color="text.secondary" noWrap data-testid="log-counts">
            {entries.length} shown / {total} stored
          </Typography>
        </Stack>
      </Box>

      {/* Log stream (newest first) */}
      <Box sx={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Box ref={scrollRef} onScroll={handleScroll} sx={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain' }}>
          {entries.length === 0 ? (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              {isLoading ? (
                <CircularProgress size={20} />
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {total === 0
                    ? 'No logs stored yet. Interact with the application or generate test logs from the toolbar.'
                    : 'No logs match the current filters.'}
                </Typography>
              )}
            </Box>
          ) : (
            <>
              {entries.map((record) => (
                <LogRow
                  key={record.seq}
                  record={record}
                  expanded={expandedSeq === record.seq}
                  onToggle={() => setExpandedSeq((current) => (current === record.seq ? null : record.seq))}
                  onSelectCorrelation={selectCorrelation}
                  onCopy={() => void handleCopy(record)}
                />
              ))}
              {hasMore && (
                <Box sx={{ p: 1, textAlign: 'center' }}>
                  <Button size="small" onClick={loadOlder} disabled={isLoading} data-testid="log-load-older">
                    {isLoading ? 'Loading…' : 'Load older entries'}
                  </Button>
                </Box>
              )}
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default DeveloperConsole;
