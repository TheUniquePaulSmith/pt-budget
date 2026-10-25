import type { TextFieldProps } from '@mui/material';

import { useOptionalThemePreferences } from '@/theme/theme';

/** Props that make a `TextField` sit tightly inside a ledger-style `FormGrid`. */
export const DENSE_TEXT_FIELD_PROPS = {
  size: 'small',
  margin: 'none',
  fullWidth: true,
} as const satisfies Partial<TextFieldProps>;

/**
 * The field size matching the active density: `small` under the compact
 * density (desktop by default), `medium` otherwise. Pass it to controls that
 * take a `size` prop so inline forms follow the theme.
 */
export function useDenseFieldSize(): 'small' | 'medium' {
  const preferences = useOptionalThemePreferences();
  return preferences?.density === 'comfortable' ? 'medium' : 'small';
}
