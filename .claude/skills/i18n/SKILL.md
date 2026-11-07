---
name: i18n
description: Adds, changes, translates and audits user-facing text in budgetApp-v2's nine-language i18next setup (en-US source plus es, fr, de, zh, ja, ko, pt, it). Use it whenever a change adds or edits any visible string, label, tooltip, error message, DataGrid header, notification text or plural; creates a component, page or feature folder (new namespace); formats money, numbers or dates; or when the user asks to translate, check translations, fix locales.test.ts or tsc key errors, or find hard-coded strings. Every UI change in this repo needs it, even if nobody mentions translation.
argument-hint: "[add | translate | namespace | audit]"
---

# i18n and formatting

Read `src/locales/README.md` (key convention, namespaces, rules) and `src/locales/GLOSSARY.md` (fixed terms) the first
time in a session. Here is what the tooling enforces, and why:
- `src/types/i18next.d.ts` derives the key types from the **English** JSON, so `tsc` rejects a key missing from `en-US`.
- `src/locales/locales.test.ts` checks every language against English: same keys, same `{{placeholders}}`, no empty
  strings, same plural forms (zh/ja/ko may have only `_other`). A value identical to English fails unless it matches the
  allowed list (codes, brand names, punctuation).
- Around 500 Playwright locators and many component tests match **English** text, so English values are copied
  verbatim from the JSX. Don't reword them while extracting.

## A. Add or change strings (the common case)

1. Pick the namespace of the component's feature folder (README table), with the key `<component>.<element>` in camelCase:
   `loans:paymentDialog.amountLabel`. Enum labels keep the database spelling: `common:transactionType.refund`.
2. Add the English value to `src/locales/en-US/<ns>.json`.
3. In the component: `const { t } = useTranslation('<ns>')`. To also use `common:` keys, the **array form** is
   required for typing: `useTranslation(['<ns>', 'common'])`, then `t('common:actions.save')`.
   - Interpolation: `t('summary.paid', { amount: money(total) })`. Format first with `useFormatters()`, then interpolate.
     Never concatenate translated fragments.
   - Plurals: `"payments_one": "{{count}} payment"`, `"payments_other": "{{count}} payments"` with `t('payments', { count })`.
     Cross-namespace plural: `t('plurals.months', { ns: 'common', count })`.
   - Inline markup: `<Trans>` with named components. Keep it rare.
   - Nav labels: `getPageLabel(page, t)` reads `shell:nav.<id>`.
4. Add the **same key** to the other eight languages (section C). Ship all nine together, because the test fails otherwise.
5. Text produced outside React: in `src/lib`, take `t` or a formatter as a parameter, or return an error **code** that the
   component maps (`t('<ns>:errors.<CODE>')`). Where that's impossible (the notification scan, service messages the UI
   displays), `import { i18n } from '@/lib/i18n'` and call `i18n.t('<ns>:…')`. Log messages, the Developer Console and AI
   tool errors stay English.

## B. New namespace (a new feature folder)

1. Add `src/locales/en-US/<ns>.json`.
2. In `src/lib/i18n.ts`: `import en<Ns> from '@/locales/en-US/<ns>.json'`, add it to `EN_US_RESOURCES`, and add `'<ns>'` to `NAMESPACES`.
3. Create `src/locales/<lang>/<ns>.json` for all eight other languages (other languages are code-split and loaded on demand).
4. Add a row to the namespace table in `src/locales/README.md`.

## C. Translate

- Translate the new keys yourself into es, fr, de, zh (zh-CN, Simplified), ja, ko, pt (pt-BR) and it. Use the glossary
  term in each language: consistency beats a slightly better synonym.
- Keep `{{placeholders}}`, brand names (Google Drive, OneDrive, SQLite, OPFS, GGUF), SQL keywords and file extensions
  unchanged. Match the English plural keys (`_one`/`_other`; zh/ja/ko can use `_other` only).
- Keep the tone of a consumer finance app: short, and in the formal register where the language has one (Sie, vous, usted).
- Large batches (hundreds of keys): split the work across parallel subagents, **one per language**, each owning only
  `src/locales/<lang>/`. Give each one the English files, GLOSSARY.md and these rules. Then run the test once at the end.
- Translations written by Claude still need native review. Mention that in the PR description.

## D. Formatting rules

- Never `Intl.NumberFormat`, `toLocaleString`, or a hard-coded `'en-US'`/`'USD'` in components. Use `useFormatters()`
  (`money`, `number`, `percent`, `date`, `month`, `dateTime`, `symbol`), or the pure helpers in `src/lib/formatting.ts`
  in non-React code.
- `money(amount, account_currency)` for a single transaction, account or loan amount (its account's currency).
  `money(total)` for a cross-account total, which SQL has already converted into the default currency.
- The language is a device preference (`localStorage` `budgetTracker_language`), never `navigator.language`. That's what
  keeps Playwright in English. Don't "fix" it.

## E. Audit

```bash
node .claude/skills/i18n/scripts/audit-diff.mjs            # lines this branch adds vs origin/devel/latest
node .claude/skills/i18n/scripts/audit-diff.mjs --base=HEAD~1 --strict
```

It flags literal JSX text, literal user-facing props (`label=`, `placeholder=`, `title=`, `aria-label=` …), literal
`headerName:`/`label:`/`message:` values, hard-coded locales and currencies, and `console.*` in `src/lib` or `src/contexts`.
These are candidates: read each one in context. Error strings shown through `setError(...)` count as user-facing. A
genuinely non-user-facing literal can carry an `i18n-ignore` comment on its line.

## Verify

```bash
npx vitest run src/locales/locales.test.ts
npx tsc --noEmit -p tsconfig.json
```

Adding locale JSON files while `npm run dev` is running makes Turbopack do a full reload, which drops the database key
(the app comes back at the unlock screen). That's expected and not a bug. Don't add locale files while an e2e run is in progress.
