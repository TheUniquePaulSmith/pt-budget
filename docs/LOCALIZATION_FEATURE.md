# Localization and Multi-Currency Feature

## Overview

The app runs in nine languages and lets every account carry its own currency while all totals are expressed in one default currency.

- **Languages**: English (US, the default and fallback), Spanish, French, German, Chinese (Simplified), Japanese, Korean, Portuguese (Brazil), Italian.
- **Formatting**: numbers, money and dates follow the active language through `Intl`; MUI's DataGrid, date pickers and core components follow it through their locale packs.
- **Currencies**: each account has an ISO 4217 code (schema v6). The household's default currency is chosen during setup (skippable, USD by default) or in Settings → Preferences. Cross-account totals are converted with manually entered exchange rates; accounts whose currency has no rate are left out of totals and the dashboard says so.

## Where things live

| Concern | Files |
|---|---|
| Language list, i18next init, device preference | `src/lib/i18n.ts`, `src/contexts/LocaleContext.tsx` (`LocaleProvider`, `useLocale`) |
| Translation bundles | `src/locales/<lang>/<namespace>.json`; conventions in `src/locales/README.md`, terms in `src/locales/GLOSSARY.md`; parity test `src/locales/locales.test.ts` |
| Typed keys | `src/types/i18next.d.ts` (derived from the English JSON) |
| MUI locale packs | `src/theme/muiLocales.ts`, merged into `createTheme` by `CustomThemeProvider` |
| Formatting | `src/lib/formatting.ts` (pure), `src/contexts/useFormatters.ts` (hook) |
| Currencies | `src/lib/currencies.ts` (pure), `src/lib/databaseServicePreferences.ts` + `sqlQueriesPreferences.ts` (`databaseService.preferences`), `src/contexts/useDatabasePreferencesSlice.ts`, `usePreferencesSlices.ts` (`useCurrencyPreferencesSlice`), `CurrencyPreferencesContext.ts` |
| SQL conversion | `src/lib/sqlMoneyExpressions.ts` (`rateExpr`, `spendExpr`, `incomeExpr`) |
| Schema | `public/database-schema.js` version 6: `accounts.currency`, `exchange_rates` |
| UI | `src/components/setup/PreferencesSetup.tsx`, `src/components/settings/PreferencesSettingsTab.tsx`, `ExchangeRatesEditor.tsx`, `src/components/dashboard/MissingRatesNotice.tsx`, `src/components/common/CurrencySelect.tsx`, `LanguageMenu.tsx` |
| CSV parsing | `src/lib/dateOnly.ts` (`parseCsvDate(raw, { order })`), `src/lib/statementImport/shared/amounts.ts` (`parseCsvAmount(raw, { decimal })`) |
| AI | `src/lib/aiChatService.ts` `buildLocalePromptSection` (reply language, default currency, how to read `exchange_rates`) |

## Language

The language is a **device preference**: it is stored in `localStorage` under `budgetTracker_language`, like the theme, because the welcome, password-setup and unlock screens render before any database exists. It is never read from `navigator.language`, so the app stays in English until the user picks something — which also keeps the Playwright suite deterministic.

Where it can be changed:

1. The globe menu in the top-right corner of the welcome, password and unlock screens.
2. The **Preferences** step of first-run setup (right after the password; "Skip for now" keeps English and USD).
3. Settings → **Preferences**.

Changing the language updates `<html lang>`, the i18next bundles (other languages are lazy-loaded chunks), the date-fns locale for the pickers and the MUI locale packs in the theme. Another tab of the same browser follows through the `storage` event.

System-generated notifications store their title and body in the language active when the scan ran; the notification surfaces rebuild the text from the alert's `payload_json` in the current language when they render, so old alerts still read correctly after a language change.

## Currencies

- `accounts.currency` defaults to `USD`; the account form, the first-account setup screen and the CSV inline account dialog offer a currency picker that starts from the default currency.
- The default currency is `app_metadata` key `preferences.defaultCurrency` (absent means USD).
- `exchange_rates` holds one row per foreign currency: `rate` is how many units of the default currency one unit of that currency is worth; `NULL` means unknown. The default currency never has a row.
- Every money aggregate multiplies `transactions.amount` by the account's rate inside `spendExpr` / `incomeExpr` (a correlated subquery resolved per row). A `NULL` rate makes the row `NULL`, which `SUM` skips — so a currency without a rate drops out of totals rather than being counted at face value.
- **Per-row amounts** (a transaction, an account balance, a loan tied to an account) are shown in their own currency; **cross-account totals** (dashboard, charts, budget actuals, report footers, project/trip costs, subscription totals) are shown in the default currency with a "Totals in X" caption when more than one currency is in use.
- Budget plan amounts, income sources, and project/trip estimated and actual costs are amounts in the default currency and are never converted.
- Changing the default currency rebases every known rate in one transaction (new rate = old rate ÷ the new default's old rate; the old default gets 1 ÷ that rate). When the new default has no known rate, all rates are cleared and must be entered again.
- Transfers between accounts in different currencies are not paired automatically by the classifier (it matches negated amounts).

## CSV import

`parseCsvDate` resolves ambiguous numeric dates (`04/06/2026`) by the language's day/month order: month-first for en-US, year-first locales (zh, ja, ko) and everyone else day-first. `parseCsvAmount` understands decimal commas (`1.234,56`) when the language writes them. Unambiguous shapes (ISO, year-first, month names) parse the same in every language.

## Adding a language

1. Add the entry to `SUPPORTED_LANGUAGES` in `src/lib/i18n.ts` (code, native label, Intl locale, CSV date order, decimal separator).
2. Add the MUI packs in `src/theme/muiLocales.ts` and the date-fns loader in `src/contexts/LocaleContext.tsx`.
3. Create `src/locales/<code>/` with every namespace file. `src/locales/locales.test.ts` fails until the key set matches English.

## Testing

- Unit: `src/lib/formatting.test.ts`, `currencies.test.ts`, `i18n.test.ts`, `databaseServicePreferences.test.ts`, `sqlMoneyExpressions.test.ts`, `src/locales/locales.test.ts`, the setup-flow cases in `src/contexts/useDatabaseInitialization.test.tsx`.
- E2E: `tests/e2e/currency-preferences.spec.ts` (rates, exclusion, rebase through the real SQLite engine) and `tests/e2e/localization.spec.ts` (language menu, setup step, Settings, persistence, `<html lang>`). The shared bootstrap helper clicks `skip-preferences` after `Create Database`.
