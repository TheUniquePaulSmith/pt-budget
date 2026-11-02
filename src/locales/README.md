# Translations

One folder per language (`en-US`, `es`, `fr`, `de`, `zh`, `ja`, `ko`, `pt`, `it`), one JSON file per namespace. `en-US` is the source of truth and the fallback; `src/types/i18next.d.ts` derives the typed keys from it, so `tsc` rejects a key that does not exist in English. `src/locales/locales.test.ts` checks every other language against English (same keys, same `{{placeholders}}`, no empty strings).

## Namespaces

| Namespace | Owns |
|---|---|
| `common` | Shared vocabulary: actions, field labels, statuses, enum labels (account / transaction types), generic errors, plurals. **Frozen during extraction** — a key you need that is missing goes into your own namespace. |
| `shell` | Navigation, app bar, sidebar, bottom nav, status bar, data-grid chrome, shared dialogs (`src/components/common/**` except Console). |
| `developer` | Developer Console and the Developer settings tab (`src/components/common/Console`). |
| `setup` | First-run screens (`src/components/setup`). |
| `settings` | Settings page and its tabs. |
| `dashboard`, `accounts`, `transactions`, `budget`, `loans`, `subscriptions`, `notifications`, `csvImport`, `ai`, `projects`, `trips`, `sqlQuery`, `dataManagement`, `notFound` | The matching feature folder. |

## Key convention

`<namespace>:<component>.<element>` in camelCase, component name without its suffix:

```
accounts:formDialog.addTitle
transactions:report.searchPlaceholder
settings:tabs.preferences
shell:nav.dashboard
common:actions.save
```

Enum labels: `common:accountType.checking`, `common:transactionType.refund`, `notifications:type.budget_overspend` (enum values keep their database spelling).

## Rules

1. **English values are copied verbatim** from the JSX — no rewording, no punctuation changes. About 500 Playwright locators and dozens of component tests match the English text.
2. Interpolate with `{{name}}`. Amounts, dates and counts are formatted first (`useFormatters()`) and then interpolated; never build them inside a string.
3. Plurals use i18next suffixes with `count`: `"days_one": "{{count}} day"`, `"days_other": "{{count}} days"`. Chinese, Japanese and Korean may keep only `_other`.
4. Inline markup goes through `<Trans>` with named components; keep it rare.
5. `src/lib` modules without React take a `t` function or a formatter as a parameter, or return error **codes** that the component translates. Where text must be produced outside React (the notification scan, service-thrown messages the UI shows), `import { i18n } from '@/lib/i18n'` and call `i18n.t('notifications:alerts.overdue', {...})`; the instance is initialised at import. Log messages, the Developer Console and AI tool errors stay English.
6. Keep brand names (Google Drive, OneDrive, SQLite, OPFS, GGUF), SQL keywords, file extensions and `{{placeholders}}` untranslated.
7. Put a key only in the namespace of the component that uses it. A key used by two features is a candidate for `common` (add it there after the extraction phase, not during).

## Adding a language

Add the entry to `SUPPORTED_LANGUAGES` in `src/lib/i18n.ts`, the MUI packs in `src/theme/muiLocales.ts`, the date-fns loader in `src/contexts/LocaleContext.tsx`, then create the folder with all namespace files. The test suite fails until every file exists.
