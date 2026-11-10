---
name: landing-site
description: Updates the ptbudget.com landing site — a separate Astro repo (ptbudget-site, a sibling folder of this checkout) that markets this app — from an app checkout. Retakes its screenshots from the app's own sample data, adds or expands features in its scrolling tour, edits its copy, FAQ and pricing page, checks the result at desktop and phone sizes, and prepares the commit. Use it whenever the user wants the website, landing page, marketing site, home page or pricing page changed; asks to refresh, retake or update screenshots; wants a new or changed app feature shown on the site ("put this on the website", "the site still shows the old UI"); or right after a user-visible app change ships and the site's screenshots are now stale.
argument-hint: "[screenshots [names] | feature <name> | copy | pricing]"
---

# Landing site: update ptbudget.com from the app

The landing site is its **own repo** (`ptbudget-site`: Astro, static, deployed by Cloudflare from `main`). It shows
the app through screenshots of this repo's sample household, so it can only be updated properly from an app checkout.
Two things for it live here; everything else lives there.

| Here (app repo) | There (site repo) |
|---|---|
| `tests/e2e/landing-screenshots.spec.ts`: drives the app and takes every screenshot (skipped in normal test runs) | `src/data/features.ts`: the feature tour (copy + which screenshots) |
| `.claude/skills/landing-site/scripts/landing-site.mjs`: `where`, `shots`, `capture`, `qa` | `src/data/pricing.ts`, `faq.ts`, `src/config.ts`: plans, questions, URLs |
| this skill | `src/pages/`, `src/components/`, `src/styles/global.css`: layout and design |

Read `references/site-guide.md` before adding a feature, writing a capture step or changing copy: it has the file map,
the feature template, the capture helpers, the icon format and the copy rules.

## 1. Before anything

```bash
node scripts/prepare-worktree.mjs                                   # worktree-ready: deps, fixtures, Playwright port
node .claude/skills/landing-site/scripts/landing-site.mjs where     # finds the site repo, shows its git state
```

- `where` looks for `ptbudget-site` next to the primary checkout (`C:\source\ptbudget-site`); override with
  `--site=<path>` or `PTBUDGET_SITE_DIR`. If the site's `node_modules` is missing, run `npm install` there.
- If the site repo has uncommitted changes you did not make, stop and ask. If it is behind `origin/main`, pull first.
- Stop any dev server running from **this** worktree (the browser pane's `dev-unlocked` included) before capturing:
  the capture starts its own `next dev`, and two of them in one worktree corrupt each other's `dist/`.

## 2. Pick the job

| The user wants | Do |
|---|---|
| Screenshots that match the current app | §3 |
| A feature shown that is not on the site yet, or more of one | §4 |
| Different words, questions, prices, plan features | §5 |
| A different layout or look | Edit the site's pages/components, then §6. Keep the pixel-space theme (`site-guide.md`). |

## 3. Retake screenshots

```bash
node .claude/skills/landing-site/scripts/landing-site.mjs shots                       # names on disk, used, unused, missing
node .claude/skills/landing-site/scripts/landing-site.mjs capture                     # everything (about 4 minutes)
node .claude/skills/landing-site/scripts/landing-site.mjs capture --only=loans,budget # just these files
```

Run it in the background and wait for the completion notice. It writes the PNGs straight into the site repo, restores
`test-results/.last-run.json`, and lists what changed.

- **`--only` still runs the whole flow** (so the app is in the same state as in a full capture: confirmed
  subscriptions, reminders, the bell badge) and writes only the named files. Use it for a cosmetic retake.
- **Do a full capture when the data changed.** The sample fixtures are regenerated relative to today, so totals drift
  from month to month. The helper warns when the fixtures differ from the last full capture (`capture.json` in the
  screenshots folder); a partial retake would then show amounts that disagree with the screenshots around it.
- **A failed step fails the run** but keeps the other shots. Read the `[landing] FAIL` lines: nearly always a label,
  test id or flow changed in the app. Fix that step in the spec (see `site-guide.md`), do not delete it.
- **Look at every changed PNG** (Read the file) before going on. Check for: a hover or focus ring, a half-finished
  animation, an error toast, a dev-only overlay, clipped text, an empty state where data was expected.

If the retake was needed because the app's UI is wrong (clipped, misaligned, broken), fix the app first and say so:
the site must never paper over an app bug.

## 4. Show a new feature, or more of one

1. **Learn the feature from the app**, not from memory: the component, its locale file (`src/locales/en-US/`), and
   what it does with the sample data. Run the capture once and look, if unsure what the screen shows.
2. **Add capture steps** to `tests/e2e/landing-screenshots.spec.ts`: a `step('…', async () => { … })` that navigates,
   sets the screen up and calls `shot(page, 'kebab-name')`. Aim for two to four shots per feature (the page, its most
   convincing detail, a dialog). Rules and helpers are in `site-guide.md`; the two that bite:
   - Prefer looking over changing. A step that **saves data** changes every screenshot taken after it, and then a
     full capture is required. Put such steps as late as their content allows.
   - If the sample household has nothing to show for the feature, extend the household (the `sample-data` skill)
     rather than typing data in during the capture.
3. **Capture** the new names (`capture --only=…`), look at them, repeat until they are right.
4. **Add the feature to the tour** in the site's `src/data/features.ts`: a new entry in the right chapter, or more
   `shots` on an existing one. The dock, the tabs and the full-size viewer follow from the data. A missing PNG fails
   the site build by name.
5. **Keep the rest of the site true**: the pricing comparison (`src/data/pricing.ts`, a row for the feature, and
   remove `planned: true` if it was listed as planned), the FAQ, the hero chips, the README's feature count.
6. Verify (§6).

## 5. Copy, FAQ and pricing

Edit the data files; pages only lay them out. Rules that are not negotiable:

- **Every claim must be true of the app as it is on the branch you captured.** Check the code or the screenshot before
  writing it. No invented numbers, customers, reviews, awards, integrations or guarantees.
- **Not built yet = say so.** Planned things carry `planned: true` or sit behind the "Coming soon" banner
  (`PRICING_LIVE`). Prices and paid features are placeholders until the user supplies real ones: ask, do not invent
  new ones, and never turn `PRICING_LIVE` on or add a checkout link unless the user gave you the link.
- **Privacy claims are the product.** "No account", "nothing uploaded", "no analytics" must stay literally true of
  both the app and the site. If a change makes one false (say, the site gains analytics), change the claim too.
- The reasoning behind the Pro and Lifetime split is internal: do not add it to the site.
- Voice: plain, specific, second person, short sentences, a little dry. Feature titles say what the user gets.

## 6. Verify

```bash
node .claude/skills/landing-site/scripts/landing-site.mjs qa                 # type-check, build, serve, screenshot, audit
node .claude/skills/landing-site/scripts/landing-site.mjs qa --only=loans    # just these features, desktop and phone
```

`qa` fails on type errors, build errors, console errors, broken images, dead in-page links and sideways scrolling at
phone width, and prints the screenshots it took. **Read the screenshots** for every section you touched, at both
sizes: the automated checks cannot see a cramped layout, a wrong tab order or text over the galaxy that is hard to read.

For a new feature also check: its chip is in the feature dock, the tabs switch, the screenshot opens full size.

## 7. Hand over

- **Site repo**: review `git -C <site> status`, then commit there with a message that says what a visitor will see
  differently. `main` deploys on push, so **push only when the user has said to publish**; otherwise leave the commit
  local and say so.
- **App repo**: capture-spec and app fixes are ordinary app changes: they go through this repo's normal flow
  (`/ship`), separately from the site commit. `git status` here must show nothing from the capture itself
  (`test-results/.last-run.json` restored, no stray PNGs or logs).
- Report: which screenshots changed and why, what copy changed, what `qa` checked, and anything you saw in the app
  that looked wrong but did not fix.
