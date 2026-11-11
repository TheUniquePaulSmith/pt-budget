# Site guide: structure, capture steps, features, copy

Paths under "site" are relative to the landing-site repo (`landing-site.mjs where` prints it).

## Contents

1. Site file map
2. Screenshot conventions
3. Writing a capture step
4. Order of the capture flow (what depends on what)
5. Adding a feature to the tour
6. Pixel icons
7. Pricing data
8. Design rules
9. Copy voice

## 1. Site file map

| Path (site) | What it is |
|---|---|
| `src/config.ts` | Site name, `appUrl` (every "Launch App"), `demoUrl`, nav links |
| `src/data/features.ts` | `CHAPTERS` (Track, Plan, Understand, Own) of `Feature` entries; `PHONE_SHOTS` |
| `src/data/pricing.ts` | `PLANS`, `COMPARISON`, `PRICING_FAQ`, `PRICING_LIVE`, `PRICING_NOTICE` |
| `src/data/faq.ts` | Home page questions |
| `src/pages/index.astro` | Home: hero, pillars, tour (dock + chapters), themes slider, phones, privacy map, pricing teaser, FAQ, finale |
| `src/pages/pricing.astro`, `404.astro` | Pricing page, not-found page |
| `src/components/FeatureBlock.astro` | One feature: text + `ShotWindow` |
| `src/components/ShotWindow.astro` | The pixel "browser window": tabs per screenshot, click for full size |
| `src/components/{GalaxyBackground,MoneyFlock,WingedMoney,PixelIcon,PixelCoin}.astro` | The theme |
| `src/lib/pixelGalaxy.ts`, `pixelMoneySprite.json/.ts`, `flyingMoneyPaths.ts` | Copies of this app's 404-page art. If the sprite changes here, copy the JSON there. |
| `src/lib/pixelIcons.ts` | 12 x 12 icons as ASCII rows |
| `src/scripts/site.ts` | Tabs, dock scroll-spy, lightbox, compare slider, pricing toggles |
| `src/styles/global.css` | Tokens (colours from the galaxy and the sprite), buttons, dither bands |
| `src/assets/screenshots/*.png`, `capture.json` | Captured screenshots and the stamp of the last full capture |
| `public/og.png` | Social card (1200 x 630), a static image |

## 2. Screenshot conventions

- Names are kebab-case, start with the page or feature (`loans`, `loan-detail-promo`, `settings-security`); phone
  shots start with `m-`.
- Feature shots: **1280 x 800 at 2x, navigation rail collapsed** (the content gets the room). The hero
  (`dashboard-hero`) is 1440 x 900 with the rail expanded. Phone shots are 390 x 844.
- Dark theme everywhere except `theme-light` / `budget-light`. English except the `-es`, `-ja`, `-de` shots.
- Dashboard shots use the "This Year" period so the cards and charts are full.
- Nothing hovered, nothing focused, no tooltip, no half-finished animation. `shot()` takes care of the first three.
- The Next.js dev indicator is hidden by the spec's init script. Anything else that only exists in development must
  not appear either.
- The AI chat shot is a **demo**: a scripted local endpoint supplies the reply (`AI_QUESTION` / `AI_ANSWER` in the
  spec) while the tool call runs for real. If the sample data changes, re-check that the scripted figures still match
  what the Subscriptions page shows, and keep the small-print `note` on the AI feature in `features.ts`.

## 3. Writing a capture step

Everything is inside the single test in `tests/e2e/landing-screenshots.spec.ts`. Helpers defined at the top of it:

| Helper | Use |
|---|---|
| `step(name, async () => { … })` | Wrap every group of shots. A throw is logged as `FAIL` and the run continues; the run fails at the end. |
| `shot(page, 'name')` | A desktop screenshot: parks the pointer, blurs focus, waits, saves. |
| `save(page, 'name')` | Saves as-is (phone shots, or when a hover must stay, like the bell preview). |
| `settle(page, ms)` | Wait for charts and transitions. Charts need about 2000 ms after a tab change. |
| `closeDialogs(page)` | Escape until no dialog is left. Call it at the end of a step that opened one. |
| `choosePeriod(page, 'dashboard-filter-button', 'This Year')` | Period filter on the report pages. It resets on navigation. |
| `setRail(page, expanded)` | Expand or collapse the desktop rail. Reloads reset it, so call it after `reopen`. |
| `reopen(page, 'unlock'?)` | Load the app again and unlock it, in any language; optionally captures the lock screen. |
| `setDeviceSetting(page, key, value)` | Set a localStorage preference (theme, language) and `reopen`. |

Use the same locator rules as the rest of the e2e suite (`.claude/skills/e2e/references/writing-specs.md`):
`navigateToPage(page, '<registry id>')`, test ids and accessible names, English text.

```ts
// Example for a page that does not exist: a "Reports" page with two tabs.
await step('reports', async () => {
  await navigateToPage(page, 'reports');
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible({ timeout: 60_000 });
  await settle(page, 2000);
  await shot(page, 'reports');
  await page.getByRole('tab', { name: 'By merchant' }).click();
  await settle(page, 2000);
  await shot(page, 'reports-merchants');
});
```

Rules:

- **Look, don't change.** Open a dialog, take the shot, press Escape. A step that saves anything (a transaction, a
  rule, a setting stored in the database) alters every later screenshot and the totals the site shows side by side.
  When a shot really needs saved data, put the step as late in the flow as possible and do a full capture.
- **Leave the page as the next step expects it**: dialogs closed, viewport back to `DESKTOP`, rail collapsed, English.
- **Insert steps where their state exists.** See the order below.
- Scroll a thing into view with `locator.evaluate((el) => el.scrollIntoView({ block: 'start' }))`, then
  `page.mouse.wheel(0, -70)` to clear the app bar.
- Do not edit source files while a capture is running (Fast Refresh reloads the page mid-step).

## 4. Order of the capture flow

The order is not cosmetic: later shots depend on what earlier steps did.

1. **First run**: welcome, setup (password, recovery phrase, preferences, first account, storage choice). The
   database is created with the whole sample household.
2. **Scans**: open Loans (applies loan rules), Subscriptions rescan.
3. **Subscriptions**: confirms every detected series. From here on the bell shows a payment alert and the dashboard
   gets its "Reminders & alerts" card.
4. **Dashboard** (hero + tabs), **Transactions**, **Import** (the wizard walked to its Summary and discarded, never
   imported), **Budget**, **Accounts**, **Loans**, **Projects**, **Trips**: read-only.
5. **Notifications**: creates three reminders (saved). The bell count changes from here on.
6. **SQL console**, **AI assistant** (adds a local endpoint profile; saved), **Settings**, **Developer console**.
7. **Unlock screen**, **light theme**, **languages** (each needs a `reopen`), back to English.
8. **Phone layout**, then **Import history**: the one step that imports. It writes the statement's rows, takes the
   History shot and undoes the import on the same screen, so no other screenshot ever sees them (a saved format and
   the card's number stay behind). Last of all, the app's **404 page**.

A new read-only page belongs in group 4. A new settings tab goes in the Settings loop. Anything that needs a reload
goes in group 7 or later. A shot that needs imported rows goes into the Import history step, before its undo.

The import shots use a card statement the spec writes at capture time (`writeCardStatement`), dated in the last four
weeks and shaped like a real export: lines above the column names with the card's last four digits (which is why the
account shows as "Assumed"), charges as positive numbers, a category column that is not imported, and one pending row
without a date (the "Needs a decision" finding). Change the statement there, not with a fixture file, and keep it
invented.

## 5. Adding a feature to the tour

In site `src/data/features.ts`, inside the chapter it belongs to:

```ts
{
  id: 'reports',                       // anchor (#reports) and dock target: unique, kebab-case
  icon: 'chart',                       // a key of PIXEL_ICONS
  name: 'Reports',                     // eyebrow, dock chip, lightbox caption: one to three words
  title: 'Answers, not just totals',   // what the user gets, not what the screen is called
  body: 'One or two sentences on what it does and why that matters.',
  bullets: [
    'Three or four concrete capabilities, each true and visible in a screenshot or the app',
  ],
  shots: [
    { file: 'reports', label: 'Overview', alt: 'What the screenshot shows, for someone who cannot see it' },
    { file: 'reports-merchants', label: 'By merchant', alt: '…' },
  ],
  // note: 'Small print, only when a screenshot needs a disclosure.',
},
```

- The first shot is the one shown by default: make it the most recognisable one. `label` is a tab: keep it short.
- Blocks alternate sides automatically. Chapters: **Track** (see what happened), **Plan** (decide what should
  happen), **Understand** (ask questions), **Own** (privacy, storage, languages, themes, mobile).
- The page is long already. Prefer adding a shot to an existing feature over a new block when the capability belongs
  to something already there; add a block when it is a page or a capability a visitor would look for by name.
- Phone screenshots go in `PHONE_SHOTS` (five fit the row).
- Then check the pricing comparison (§7), the FAQ, and the site README's "Screenshots" section if the count changed.

## 6. Pixel icons

Site `src/lib/pixelIcons.ts`: each icon is twelve strings of twelve characters. `#` is the main colour
(`currentColor`), `o` the accent (gold), `.` empty. Draw at whole-pixel thickness (2 px strokes read best), keep one
empty column or row on a side where the shape allows, and render it before trusting it: use the icon in a feature and
look at the `qa` screenshot. Reuse an existing icon when one fits.

## 7. Pricing data

Site `src/data/pricing.ts`. `COMPARISON` is groups of rows; each row has `values` per plan (`true`, `false`, or a
short string), an optional `detail` line and `planned: true` for things not built.

- A feature that exists in the app today is `true` on all three plans unless the user has said otherwise.
- When a planned feature ships, remove `planned: true` and, if it is free, set it to `true` everywhere.
- Prices, plan names and what is paid are the user's decisions. `PRICING_LIVE` stays `false` and `checkout` stays
  `null` until the user provides Stripe links.

## 8. Design rules

- The theme is pixel winged money in space: the galaxy behind everything, solid `--ink-900` bands with dithered
  edges for reading, pixel font (`--font-pixel`) for headings, labels and buttons, Inter for body text.
- Colours come from tokens in `global.css` (galaxy ramps and the sprite palette). Do not add a new accent colour.
- Corners are square or stepped, shadows are hard offsets, transitions use `steps()`. No rounded cards, no blur.
- Every section must work at 390 px wide with no sideways scrolling, and with `prefers-reduced-motion`.
- No third-party requests: fonts are self-hosted, there is no analytics, images are local.
- The site has no JavaScript framework. Behaviour goes in `src/scripts/site.ts`, wired on `astro:page-load` (pages are
  swapped by Astro's client router, so plain `DOMContentLoaded` handlers run only once).

## 9. Copy voice

Plain, specific, second person, a little dry. Short sentences. Say what the user can do.

| Instead of | Write |
|---|---|
| "Powerful analytics to supercharge your finances" | "Income, spending and savings rate on one screen." |
| "Bank-grade security" | "Your database is encrypted before it touches storage." |
| "Seamlessly sync across devices" | "Keep the encrypted file in your own Google Drive or OneDrive." |
| "AI-powered insights" | "Ask a question; the assistant queries your local database." |

- Use the app's own words for things (Subscriptions, Savings funds, Type rules) so a visitor finds them after launch.
- Numbers in copy must come from the app (nine languages, six dashboard views). Recount when the app changes.
- No superlatives without a fact behind them, no urgency, no testimonials unless the user supplies real ones.
