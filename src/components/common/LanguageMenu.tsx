'use client';

/**
 * Compact language picker (globe icon + menu) for the screens shown before a
 * database exists: welcome, password setup, unlock. Settings has the full
 * select on its Preferences tab.
 */

import { useState } from 'react';

import { Language as LanguageIcon } from '@mui/icons-material';
import { IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip } from '@mui/material';
import { Check as CheckIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import { useOptionalLocale } from '@/contexts/LocaleContext';
import { SUPPORTED_LANGUAGES, type LanguageCode } from '@/lib/i18n';

interface LanguageMenuProps {
  size?: 'small' | 'medium';
}

export function LanguageMenu({ size = 'medium' }: LanguageMenuProps) {
  const { t } = useTranslation('common');
  const locale = useOptionalLocale();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  if (!locale) return null;

  const handleSelect = (code: LanguageCode) => {
    locale.setLanguage(code);
    setAnchorEl(null);
  };

  const label = t('language.menuLabel');

  return (
    <>
      <Tooltip title={label}>
        <IconButton
          size={size}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={anchorEl ? 'true' : undefined}
          onClick={(event) => setAnchorEl(event.currentTarget)}
          data-testid="language-menu-button"
        >
          <LanguageIcon fontSize={size === 'small' ? 'small' : 'medium'} />
        </IconButton>
      </Tooltip>
      <Menu open={Boolean(anchorEl)} anchorEl={anchorEl} onClose={() => setAnchorEl(null)}>
        {SUPPORTED_LANGUAGES.map((language) => {
          const selected = language.code === locale.language;
          return (
            <MenuItem
              key={language.code}
              selected={selected}
              onClick={() => handleSelect(language.code)}
              lang={language.intlLocale}
              data-testid={`language-option-${language.code}`}
            >
              <ListItemIcon sx={{ minWidth: 28 }}>
                {selected ? <CheckIcon fontSize="small" /> : null}
              </ListItemIcon>
              <ListItemText primary={language.nativeLabel} />
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}

export default LanguageMenu;
