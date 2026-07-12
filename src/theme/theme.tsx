'use client';

import type {} from '@mui/x-data-grid/themeAugmentation';

import { CssBaseline } from '@mui/material';
import {
  PaletteMode,
  ThemeProvider,
  createTheme,
} from '@mui/material/styles';
import React, {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

type ThemeDensity = 'comfortable' | 'compact';

export type ThemePresetId = 'light' | 'dark' | 'compact' | 'system';

export interface ThemePresetDefinition {
  id: ThemePresetId;
  label: string;
  description: string;
  paletteMode: PaletteMode | 'system';
  density: ThemeDensity;
}

interface ThemePreferencesContextValue {
  availableThemes: ThemePresetDefinition[];
  selectedThemeId: ThemePresetId;
  setSelectedThemeId: (themeId: ThemePresetId) => void;
}

export const THEME_PREFERENCE_STORAGE_KEY = 'budgetTracker_themePreset';

const DEFAULT_THEME_PRESET_ID: ThemePresetId = 'light';
const SYSTEM_COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)';

export const BUILT_IN_THEME_PRESETS: ThemePresetDefinition[] = [
  {
    id: 'light',
    label: 'Light',
    description: 'Default spacious theme for everyday use.',
    paletteMode: 'light',
    density: 'comfortable',
  },
  {
    id: 'dark',
    label: 'Dark',
    description: 'Low-glare theme with dark surfaces and matching accents.',
    paletteMode: 'dark',
    density: 'comfortable',
  },
  {
    id: 'compact',
    label: 'Compact',
    description: 'Denser light theme that fits more information on screen.',
    paletteMode: 'light',
    density: 'compact',
  },
  {
    id: 'system',
    label: 'System',
    description: 'Follows your device light or dark appearance preference.',
    paletteMode: 'system',
    density: 'comfortable',
  },
];

const ThemePreferencesContext = createContext<ThemePreferencesContextValue | null>(
  null
);

function isThemePresetId(value: string | null): value is ThemePresetId {
  return (
    value === 'light' ||
    value === 'dark' ||
    value === 'compact' ||
    value === 'system'
  );
}

function getThemePreset(themeId: ThemePresetId): ThemePresetDefinition {
  return (
    BUILT_IN_THEME_PRESETS.find((preset) => preset.id === themeId) ??
    BUILT_IN_THEME_PRESETS[0]
  );
}

function readStoredThemePreference(): ThemePresetId {
  if (typeof window === 'undefined') {
    return DEFAULT_THEME_PRESET_ID;
  }

  try {
    const storedThemeId = window.localStorage.getItem(
      THEME_PREFERENCE_STORAGE_KEY
    );

    return isThemePresetId(storedThemeId)
      ? storedThemeId
      : DEFAULT_THEME_PRESET_ID;
  } catch {
    return DEFAULT_THEME_PRESET_ID;
  }
}

function readSystemPaletteMode(): PaletteMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }

  return window.matchMedia(SYSTEM_COLOR_SCHEME_QUERY).matches ? 'dark' : 'light';
}

export function createAppTheme(
  themeId: ThemePresetId,
  systemPaletteMode?: PaletteMode
) {
  const preset = getThemePreset(themeId);
  const resolvedPaletteMode: PaletteMode =
    preset.paletteMode === 'system'
      ? (systemPaletteMode ?? readSystemPaletteMode())
      : preset.paletteMode;
  const isDarkMode = resolvedPaletteMode === 'dark';
  const isCompact = preset.density === 'compact';
  const borderRadius = isCompact ? 6 : 8;
  const cardBorderRadius = isCompact ? 10 : 12;
  const buttonPadding = isCompact ? '6px 16px' : '8px 24px';
  const drawerBorderColor = isDarkMode
    ? '1px solid rgba(148,163,184,0.18)'
    : '1px solid rgba(0,0,0,0.08)';
  const cardShadow = isDarkMode
    ? '0 8px 24px rgba(2,6,23,0.4)'
    : isCompact
      ? '0 2px 10px rgba(0,0,0,0.06)'
      : '0 2px 12px rgba(0,0,0,0.08)';
  const cardHoverShadow = isDarkMode
    ? '0 10px 28px rgba(2,6,23,0.5)'
    : isCompact
      ? '0 4px 16px rgba(0,0,0,0.1)'
      : '0 4px 20px rgba(0,0,0,0.12)';
  const paperElevation1 = isDarkMode
    ? '0 2px 12px rgba(2,6,23,0.35)'
    : '0 2px 8px rgba(0,0,0,0.08)';
  const paperElevation2 = isDarkMode
    ? '0 4px 16px rgba(2,6,23,0.4)'
    : '0 4px 12px rgba(0,0,0,0.1)';
  const paperElevation3 = isDarkMode
    ? '0 8px 24px rgba(2,6,23,0.45)'
    : '0 8px 20px rgba(0,0,0,0.12)';

  return createTheme({
    spacing: isCompact ? 7 : 8,
    palette: {
      mode: resolvedPaletteMode,
      primary: {
        main: '#1976d2',
        light: '#42a5f5',
        dark: '#1565c0',
      },
      secondary: {
        main: '#dc004e',
        light: '#ff5983',
        dark: '#9a0036',
      },
      background: isDarkMode
        ? {
            default: '#0f172a',
            paper: '#182235',
          }
        : {
            default: '#f5f5f5',
            paper: '#ffffff',
          },
      divider: isDarkMode ? 'rgba(148,163,184,0.22)' : 'rgba(0,0,0,0.08)',
      ...(isDarkMode
        ? {
            text: {
              primary: '#f8fafc',
              secondary: '#cbd5e1',
            },
          }
        : {}),
      success: {
        main: '#2e7d32',
        light: '#4caf50',
        dark: '#1b5e20',
      },
      error: {
        main: '#d32f2f',
        light: '#ef5350',
        dark: '#c62828',
      },
      warning: {
        main: '#ed6c02',
        light: '#ff9800',
        dark: '#e65100',
      },
      info: {
        main: '#0288d1',
        light: '#03a9f4',
        dark: '#01579b',
      },
    },
    typography: {
      fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
      h1: {
        fontSize: isCompact ? '2.25rem' : '2.5rem',
        fontWeight: 600,
        lineHeight: 1.2,
      },
      h2: {
        fontSize: isCompact ? '1.875rem' : '2rem',
        fontWeight: 600,
        lineHeight: 1.3,
      },
      h3: {
        fontSize: isCompact ? '1.625rem' : '1.75rem',
        fontWeight: 600,
        lineHeight: 1.3,
      },
      h4: {
        fontSize: isCompact ? '1.375rem' : '1.5rem',
        fontWeight: 600,
        lineHeight: 1.4,
      },
      h5: {
        fontSize: isCompact ? '1.125rem' : '1.25rem',
        fontWeight: 600,
        lineHeight: 1.4,
      },
      h6: {
        fontSize: isCompact ? '0.95rem' : '1rem',
        fontWeight: 600,
        lineHeight: 1.5,
      },
      body1: {
        fontSize: isCompact ? '0.95rem' : '1rem',
        lineHeight: isCompact ? 1.45 : 1.5,
      },
      body2: {
        fontSize: isCompact ? '0.8125rem' : '0.875rem',
        lineHeight: 1.5,
      },
    },
    shape: {
      borderRadius,
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            transition: 'background-color 120ms ease, color 120ms ease',
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 600,
            borderRadius,
            padding: buttonPadding,
            minHeight: isCompact ? 34 : 40,
          },
          contained: {
            boxShadow: isDarkMode
              ? '0 2px 10px rgba(2,6,23,0.35)'
              : '0 2px 8px rgba(0,0,0,0.1)',
            '&:hover': {
              boxShadow: isDarkMode
                ? '0 4px 14px rgba(2,6,23,0.45)'
                : '0 4px 12px rgba(0,0,0,0.15)',
            },
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            boxShadow: cardShadow,
            borderRadius: cardBorderRadius,
            '&:hover': {
              boxShadow: cardHoverShadow,
            },
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
          },
          elevation1: {
            boxShadow: paperElevation1,
          },
          elevation2: {
            boxShadow: paperElevation2,
          },
          elevation3: {
            boxShadow: paperElevation3,
          },
        },
      },
      MuiTextField: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-root': {
              borderRadius,
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: isCompact ? 12 : 16,
            fontWeight: 500,
            height: isCompact ? 24 : undefined,
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            boxShadow: isDarkMode
              ? '0 2px 12px rgba(2,6,23,0.45)'
              : '0 2px 8px rgba(0,0,0,0.1)',
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            borderRight: drawerBorderColor,
            boxShadow: 'none',
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            paddingTop: isCompact ? 6 : 8,
            paddingBottom: isCompact ? 6 : 8,
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            minHeight: isCompact ? 40 : 48,
            padding: isCompact ? '8px 12px' : undefined,
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            padding: isCompact ? '10px 12px' : undefined,
          },
        },
      },
      MuiDataGrid: {
        styleOverrides: {
          root: {
            border: 'none',
            backgroundColor: 'transparent',
          },
          columnHeaders: {
            fontWeight: 700,
          },
          columnHeaderTitle: {
            fontWeight: 700,
          },
          cell: {
            paddingTop: isCompact ? 4 : 8,
            paddingBottom: isCompact ? 4 : 8,
          },
        },
      },
    },
  });
}

interface CustomThemeProviderProps {
  children: ReactNode;
}

export function useThemePreferences() {
  const context = useContext(ThemePreferencesContext);

  if (!context) {
    throw new Error('useThemePreferences must be used within CustomThemeProvider');
  }

  return context;
}

export function useOptionalThemePreferences() {
  return useContext(ThemePreferencesContext);
}

export const CustomThemeProvider: React.FC<CustomThemeProviderProps> = ({
  children,
}) => {
  const [selectedThemeId, setSelectedThemeId] = useState<ThemePresetId>(
    readStoredThemePreference
  );
  const [systemPaletteMode, setSystemPaletteMode] = useState<PaletteMode>(
    readSystemPaletteMode
  );

  useEffect(() => {
    const storedThemeId = readStoredThemePreference();

    setSelectedThemeId((currentThemeId) =>
      currentThemeId === storedThemeId ? currentThemeId : storedThemeId
    );
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(
        THEME_PREFERENCE_STORAGE_KEY,
        selectedThemeId
      );
    } catch {
      // Ignore persistence failures so theme selection remains usable.
    }
  }, [selectedThemeId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== THEME_PREFERENCE_STORAGE_KEY) {
        return;
      }

      const nextThemeId = isThemePresetId(event.newValue)
        ? event.newValue
        : DEFAULT_THEME_PRESET_ID;

      setSelectedThemeId((currentThemeId) =>
        currentThemeId === nextThemeId ? currentThemeId : nextThemeId
      );
    };

    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function' ||
      selectedThemeId !== 'system'
    ) {
      return undefined;
    }

    const mediaQueryList = window.matchMedia(SYSTEM_COLOR_SCHEME_QUERY);
    const handleSystemThemeChange = (event: MediaQueryListEvent) => {
      setSystemPaletteMode(event.matches ? 'dark' : 'light');
    };

    setSystemPaletteMode(mediaQueryList.matches ? 'dark' : 'light');
    mediaQueryList.addEventListener('change', handleSystemThemeChange);

    return () => {
      mediaQueryList.removeEventListener('change', handleSystemThemeChange);
    };
  }, [selectedThemeId]);

  const theme = useMemo(
    () => createAppTheme(selectedThemeId, systemPaletteMode),
    [selectedThemeId, systemPaletteMode]
  );

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.documentElement.style.colorScheme = theme.palette.mode;
  }, [theme]);

  return (
    <ThemePreferencesContext.Provider
      value={{
        availableThemes: BUILT_IN_THEME_PRESETS,
        selectedThemeId,
        setSelectedThemeId,
      }}
    >
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemePreferencesContext.Provider>
  );
};

const defaultTheme = createAppTheme(DEFAULT_THEME_PRESET_ID);

export default defaultTheme;
