import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Chip,
  TextField,
  Stack,
  Tooltip,
  Fab,
  InputAdornment,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import {
  Close,
  ContentCopy,
  DeleteSweep,
  Download,
  ErrorOutline,
  InfoOutlined,
  KeyboardArrowDown,
  Science,
  Search,
  WarningAmberOutlined,
} from '@mui/icons-material';
import { consoleLogger, LogEntry } from '@/lib/consoleLogger';

const LOG_LEVELS: LogEntry['level'][] = ['log', 'info', 'warn', 'error', 'debug'];
const MONO_FONT =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
// Cap pretty-printed arguments so a single huge object can't stall rendering on phones
const MAX_FORMATTED_ARG_LENGTH = 10000;
const PIN_TO_BOTTOM_THRESHOLD_PX = 48;

interface FormattedLog {
  log: LogEntry;
  text: string;
  stack?: string;
  sourceLabel?: string;
  sourceFull?: string;
  searchText: string;
}

const safeStringify = (value: unknown): string => {
  const seen = new WeakSet<object>();
  try {
    const json = JSON.stringify(
      value,
      (_key, val: unknown) => {
        if (typeof val === 'bigint') return `${val}n`;
        if (typeof val === 'function') return `ƒ ${val.name || 'anonymous'}()`;
        if (typeof val === 'symbol') return val.toString();
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[Circular]';
          seen.add(val);
          if (val instanceof Map) return { '[Map]': Array.from(val.entries()) };
          if (val instanceof Set) return { '[Set]': Array.from(val.values()) };
        }
        return val;
      },
      2
    );
    return json === undefined ? String(value) : json;
  } catch {
    return '[Unserializable object]';
  }
};

const formatArg = (arg: unknown): string => {
  if (arg instanceof Error) return arg.stack || `${arg.name}: ${arg.message}`;
  if (typeof arg === 'object' && arg !== null) {
    const text = safeStringify(arg);
    return text.length > MAX_FORMATTED_ARG_LENGTH
      ? `${text.slice(0, MAX_FORMATTED_ARG_LENGTH)}\n… (truncated)`
      : text;
  }
  return String(arg);
};

// Formats once per entry and is cached by id afterwards, so the rendered text
// snapshots object arguments close to log time (they are stored by reference
// and may mutate later).
const buildFormattedLog = (log: LogEntry): FormattedLog => {
  const text = log.args.length > 0 ? log.args.map(formatArg).join(' ') : log.message;
  // Error objects already print their own stack via formatArg
  const stack = log.stack && !text.includes(log.stack) ? log.stack : undefined;
  let sourceLabel: string | undefined;
  let sourceFull: string | undefined;
  if (log.sourceFile) {
    const fileName = log.sourceFile.split(/[\\/]/).pop() || log.sourceFile;
    sourceLabel = log.sourceLine != null ? `${fileName}:${log.sourceLine}` : fileName;
    sourceFull = `${log.sourceFile}:${log.sourceLine ?? 0}:${log.sourceColumn ?? 0}`;
  }
  const searchText = `${text}\n${stack ?? ''}\n${sourceFull ?? ''}\n${log.level}`.toLowerCase();
  return { log, text, stack, sourceLabel, sourceFull, searchText };
};

const formatTime = (isoTimestamp: string): string => {
  const date = new Date(isoTimestamp);
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
};

const getLevelColor = (
  level: string
): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' => {
  switch (level) {
    case 'error': return 'error';
    case 'warn': return 'warning';
    case 'info': return 'info';
    case 'debug': return 'secondary';
    default: return 'default';
  }
};

const generateTestLogs = () => {
  console.log('DeveloperConsole: Test log message');
  console.info('DeveloperConsole: Test info message');
  console.warn('DeveloperConsole: Test warning message');
  console.error('DeveloperConsole: Test error message');
  console.debug('DeveloperConsole: Test debug message');
  console.log('DeveloperConsole: Multi-line message\nline two\nline three\n\ttabbed line four');
  console.log('DeveloperConsole: Test object:', {
    component: 'DeveloperConsole',
    timestamp: new Date(),
    userAgent: navigator.userAgent,
    url: window.location.href,
  });
  try {
    throw new Error('DeveloperConsole: Test intentional error for debugging');
  } catch (error) {
    console.error('DeveloperConsole: Caught error:', error);
  }
};

const DeveloperConsole: React.FC = () => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState<LogEntry['level'][]>([...LOG_LEVELS]);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const formatCacheRef = useRef(new Map<string, FormattedLog>());

  useEffect(() => {
    // subscribe() immediately replays the current buffer to the listener
    return consoleLogger.subscribe(setLogs);
  }, []);

  const formattedLogs = useMemo(() => {
    const cache = formatCacheRef.current;
    const nextCache = new Map<string, FormattedLog>();
    const result = logs.map(log => {
      const entry = cache.get(log.id) ?? buildFormattedLog(log);
      nextCache.set(log.id, entry);
      return entry;
    });
    formatCacheRef.current = nextCache;
    return result;
  }, [logs]);

  const visibleLogs = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return formattedLogs.filter(
      entry =>
        levelFilter.includes(entry.log.level) &&
        (query === '' || entry.searchText.includes(query))
    );
  }, [formattedLogs, levelFilter, filter]);

  const levelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    logs.forEach(log => {
      counts[log.level] = (counts[log.level] ?? 0) + 1;
    });
    return counts;
  }, [logs]);

  // DevTools-style auto-scroll: follow new output only while the user is at the bottom
  useEffect(() => {
    if (!isPinnedToBottom) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visibleLogs, isPinnedToBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setIsPinnedToBottom(
      el.scrollHeight - el.scrollTop - el.clientHeight < PIN_TO_BOTTOM_THRESHOLD_PX
    );
  }, []);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setIsPinnedToBottom(true);
  };

  const handleLevelToggle = (level: LogEntry['level']) => {
    setLevelFilter(prev =>
      prev.includes(level) ? prev.filter(l => l !== level) : [...prev, level]
    );
  };

  const handleCopyLog = async (entry: FormattedLog) => {
    let text = `[${entry.log.timestamp}] ${entry.log.level.toUpperCase()}`;
    if (entry.sourceFull) text += ` ${entry.sourceFull}`;
    text += `\n${entry.text}`;
    if (entry.stack) text += `\n${entry.stack}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard is unavailable outside secure contexts (e.g. plain-http LAN testing)
    }
  };

  const handleExportLogs = () => {
    const logsText = consoleLogger.exportLogs();
    const blob = new Blob([logsText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `console-logs-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getLevelRowStyle = (level: LogEntry['level']) => {
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
        return {
          accent: undefined,
          bg: undefined,
          text: undefined,
          icon: <InfoOutlined sx={{ fontSize: 14, color: 'info.main' }} />,
        };
      case 'debug':
        return {
          accent: undefined,
          bg: undefined,
          text: theme.palette.text.secondary,
          icon: null,
        };
      default:
        return { accent: undefined, bg: undefined, text: undefined, icon: null };
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        bgcolor: 'background.paper',
      }}
    >
      {/* Toolbar: search, actions, level filters */}
      <Box
        sx={{
          px: 1,
          py: 0.75,
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          flexDirection: 'column',
          gap: 0.75,
        }}
      >
        <Stack direction="row" spacing={0.5} alignItems="center">
          <TextField
            size="small"
            fullWidth
            placeholder="Search logs"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search fontSize="small" />
                </InputAdornment>
              ),
              endAdornment: filter !== '' && (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setFilter('')} aria-label="Clear search">
                    <Close fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
          <Tooltip title="Generate test logs">
            <IconButton onClick={generateTestLogs} aria-label="Generate test logs">
              <Science fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Export logs">
            <span>
              <IconButton
                onClick={handleExportLogs}
                disabled={logs.length === 0}
                aria-label="Export logs"
              >
                <Download fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Clear console">
            <span>
              <IconButton
                onClick={() => consoleLogger.clearLogs()}
                disabled={logs.length === 0}
                aria-label="Clear console"
              >
                <DeleteSweep fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>

        <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
          {LOG_LEVELS.map(level => (
            <Chip
              key={level}
              label={levelCounts[level] ? `${level} (${levelCounts[level]})` : level}
              size="small"
              variant={levelFilter.includes(level) ? 'filled' : 'outlined'}
              color={getLevelColor(level)}
              onClick={() => handleLevelToggle(level)}
            />
          ))}
          <Box sx={{ flex: 1 }} />
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}
          >
            <Box
              component="span"
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: consoleLogger.isCurrentlyCapturing() ? 'success.main' : 'text.disabled',
              }}
            />
            {visibleLogs.length} / {logs.length}
          </Typography>
        </Stack>
      </Box>

      {/* Log stream */}
      <Box sx={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Box
          ref={scrollRef}
          onScroll={handleScroll}
          sx={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain' }}
        >
          {visibleLogs.length === 0 ? (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                {logs.length === 0
                  ? 'No logs captured yet. Interact with the application or generate test logs from the toolbar.'
                  : 'No logs match the current filters.'}
              </Typography>
            </Box>
          ) : (
            visibleLogs.map(entry => {
              const { log } = entry;
              const style = getLevelRowStyle(log.level);
              return (
                <Box
                  key={log.id}
                  sx={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 0.75,
                    px: 1,
                    py: 0.5,
                    borderBottom: '1px solid',
                    borderBottomColor: 'divider',
                    borderLeft: '3px solid',
                    borderLeftColor: style.accent ?? 'transparent',
                    backgroundColor: style.bg ?? 'transparent',
                  }}
                >
                  <Box
                    sx={{
                      width: 16,
                      flexShrink: 0,
                      display: 'flex',
                      justifyContent: 'center',
                      pt: '3px',
                    }}
                  >
                    {style.icon}
                  </Box>
                  <Typography
                    component="span"
                    sx={{
                      fontFamily: MONO_FONT,
                      fontSize: '0.7rem',
                      lineHeight: 1.6,
                      color: 'text.disabled',
                      flexShrink: 0,
                    }}
                  >
                    {formatTime(log.timestamp)}
                  </Typography>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      component="pre"
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
                      {entry.text || ' '}
                    </Typography>
                    {entry.stack && (
                      <Typography
                        component="pre"
                        sx={{
                          m: 0,
                          mt: 0.25,
                          fontFamily: MONO_FONT,
                          fontSize: '0.7rem',
                          lineHeight: 1.5,
                          whiteSpace: 'pre-wrap',
                          overflowWrap: 'anywhere',
                          color: isDark ? 'error.light' : 'error.dark',
                          opacity: 0.85,
                        }}
                      >
                        {entry.stack}
                      </Typography>
                    )}
                  </Box>
                  {entry.sourceLabel && (
                    <Tooltip title={entry.sourceFull ?? entry.sourceLabel}>
                      <Typography
                        noWrap
                        sx={{
                          fontFamily: MONO_FONT,
                          fontSize: '0.7rem',
                          lineHeight: 1.6,
                          color: 'text.secondary',
                          maxWidth: { xs: 90, sm: 220 },
                          flexShrink: 0,
                        }}
                      >
                        {entry.sourceLabel}
                      </Typography>
                    </Tooltip>
                  )}
                  <IconButton
                    size="small"
                    onClick={() => handleCopyLog(entry)}
                    aria-label="Copy log entry"
                    sx={{ p: 0.25, opacity: 0.4, '&:hover': { opacity: 1 } }}
                  >
                    <ContentCopy sx={{ fontSize: 14 }} />
                  </IconButton>
                </Box>
              );
            })
          )}
        </Box>
        {!isPinnedToBottom && visibleLogs.length > 0 && (
          <Fab
            size="small"
            color="primary"
            onClick={scrollToBottom}
            aria-label="Scroll to latest logs"
            sx={{ position: 'absolute', right: 16, bottom: 16 }}
          >
            <KeyboardArrowDown />
          </Fab>
        )}
      </Box>
    </Box>
  );
};

export default DeveloperConsole;
