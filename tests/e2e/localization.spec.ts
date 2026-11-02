import { expect, test } from '@playwright/test';

import esSettings from '../../src/locales/es/settings.json';
import esShell from '../../src/locales/es/shell.json';
import esSetup from '../../src/locales/es/setup.json';
import { bootstrapDatabase, navigateToPage, seedBrowserCompatibility } from './helpers/bootstrap';

/**
 * Language preference: English by default (never the browser language), a
 * globe menu before any database exists, the setup Preferences step, and the
 * Settings → Preferences select; the choice survives a reload and translates
 * the navigation (accessible names) and the <html lang> attribute.
 */

const SPANISH_DASHBOARD = (esShell as { nav: { dashboard: string } }).nav.dashboard;
const SPANISH_PREFERENCES_TITLE = (esSetup as { preferences: { title: string } }).preferences.title;
const SPANISH_PREFERENCES_TAB = (esSettings as { tabs: { preferences: string } }).tabs.preferences;
const SPANISH_CLOSE_SETTINGS = (esSettings as { page: { close: string } }).page.close;

test('@smoke stays English by default even when the browser prefers another language', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'de-DE' });
  const page = await context.newPage();
  await seedBrowserCompatibility(page);
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'Create New Database' })).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  await context.close();
});

test('the globe menu on the welcome screen switches the setup flow to Spanish and the choice persists', async ({ page }) => {
  await seedBrowserCompatibility(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Create New Database' })).toBeVisible({ timeout: 120_000 });

  await page.getByTestId('language-menu-button').click();
  await page.getByTestId('language-option-es').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-ES');
  await expect(page.getByTestId('language-menu-button')).toHaveAccessibleName(/idioma/i);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-ES', { timeout: 60_000 });

  // Back to English for the rest of the suite (the preference is per browser context, but be tidy).
  await page.getByTestId('language-menu-button').click();
  await page.getByTestId('language-option-en-US').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
});

test('Settings → Preferences changes the language, translating the navigation; English restores the e2e labels', async ({ page }) => {
  await bootstrapDatabase(page, { loadSampleData: false });

  await navigateToPage(page, 'settings');
  await page.getByRole('tab', { name: 'Preferences' }).click();
  await page.getByTestId('settings-language').locator('..').click();
  await page.getByTestId('settings-language-option-es').click();

  await expect(page.locator('html')).toHaveAttribute('lang', 'es-ES');
  // The Settings page chrome follows immediately (its close control is now labelled in Spanish).
  await expect(page.getByRole('tab', { name: SPANISH_PREFERENCES_TAB })).toBeVisible();

  // Settings is full-screen (no navigation rail); leave it to see the translated nav labels.
  await page.getByRole('button', { name: SPANISH_CLOSE_SETTINGS }).click();
  await expect(page.getByTestId('nav-dashboard').first()).toHaveAccessibleName(SPANISH_DASHBOARD, { timeout: 30_000 });
  expect(await page.evaluate(() => window.localStorage.getItem('budgetTracker_language'))).toBe('es');

  // The settings page is still reachable by test id in any language; switch back to English.
  await page.getByTestId('nav-settings').first().click();
  await page.getByTestId('settings-tab-preferences').click();
  await page.getByTestId('settings-language').locator('..').click();
  await page.getByTestId('settings-language-option-en-US').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.getByTestId('nav-dashboard').first()).toHaveAccessibleName('Dashboard', { timeout: 30_000 });
});

test('the setup Preferences step applies the language immediately', async ({ page }) => {
  await seedBrowserCompatibility(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Create New Database' }).click();
  await page.getByLabel('Primary User Name').fill('Pat');
  await page.getByLabel('Password', { exact: true }).fill('TestPassword1!');
  await page.getByLabel('Confirm Password').fill('TestPassword1!');
  await page.getByRole('button', { name: 'Create Database' }).click();

  await expect(page.getByTestId('preferences-setup')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('preferences-language').locator('..').click();
  await page.getByRole('option', { name: 'Español' }).click();
  await expect(page.getByTestId('preferences-setup')).toContainText(SPANISH_PREFERENCES_TITLE);
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-ES');

  await page.getByTestId('preferences-language').locator('..').click();
  await page.getByRole('option', { name: 'English (US)' }).click();
  await expect(page.getByTestId('preferences-setup')).toContainText('Your Preferences');
});
