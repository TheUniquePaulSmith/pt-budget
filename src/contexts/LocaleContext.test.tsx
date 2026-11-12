// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { StrictMode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, i18n } from '@/lib/i18n';

import { LocaleProvider, useLocale } from './LocaleContext';

function LanguageProbe() {
  const { language, setLanguage } = useLocale();
  return (
    <>
      <span data-testid="language">{language}</span>
      <button type="button" onClick={() => setLanguage('fr')}>
        choose fr
      </button>
    </>
  );
}

// Strict Mode as in `next dev`: React runs every mount effect twice.
function renderProvider() {
  return render(
    <StrictMode>
      <LocaleProvider>
        <LanguageProbe />
      </LocaleProvider>
    </StrictMode>,
  );
}

describe('LocaleProvider', () => {
  afterEach(async () => {
    window.localStorage.clear();
    document.documentElement.lang = '';
    await i18n.changeLanguage(DEFAULT_LANGUAGE);
  });

  it('keeps the stored language when the mount effects run twice', async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'es');
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('language')).toHaveTextContent('es'));
    expect(document.documentElement.lang).toBe('es-ES');
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('es');
  });

  it('stores the language only when one is chosen', async () => {
    renderProvider();
    expect(screen.getByTestId('language')).toHaveTextContent('en-US');
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'choose fr' }));

    await waitFor(() => expect(document.documentElement.lang).toBe('fr-FR'));
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('fr');
  });
});
