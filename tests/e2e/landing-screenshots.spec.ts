import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { navigateToPage, seedBrowserCompatibility, TEST_PASSWORD } from './helpers/bootstrap';
import {
  addStatementFiles,
  chooseImportAccount,
  confirmReadingSettings,
  nextWizardStep,
  openImportWizard,
  runImport,
  startImport,
} from './helpers/importFlow';

// Captures the screenshots the ptbudget.com landing site shows (a separate
// repo, ptbudget-site), from this app's own sample data (the Parker household).
// It is not a test of the app: it is skipped unless LANDING_SHOTS_DIR is set,
// so the normal suites never run it. Use `node scripts/landing-site.mjs capture`
// (the `landing-site` skill), which sets the variables, uses the worktree's
// Playwright config and cleans up afterwards.
//
//   LANDING_SHOTS_DIR   where the PNGs go (the site's src/assets/screenshots)
//   LANDING_SHOTS_ONLY  optional comma-separated shot names: the whole flow
//                       still runs, so app state matches a full capture, but
//                       only these files are written
//
// Feature shots are 1280x800 at 2x with the navigation rail collapsed; the hero
// is 1440x900 with it expanded; phone shots are 390x844. Every step is wrapped
// so one failed step does not lose the rest, and the run fails at the end if
// any step did, or if a name in LANDING_SHOTS_ONLY was never produced.
//
// The AI chat shot uses a scripted stand-in for a local model (the reply text
// below); the tool call it makes runs for real against the sample database.
//
// Adding a shot: add a `step(...)` that drives the UI and calls `shot(page,
// 'kebab-name')`, then reference that name in the site's src/data/features.ts.

const OUT = process.env.LANDING_SHOTS_DIR ?? '';
const ONLY = new Set(
  (process.env.LANDING_SHOTS_ONLY ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
);

/**
 * The statement the import shots are taken with: a card export for the sample
 * household's Travel Mastercard, written at capture time so its dates sit in
 * the last four weeks. It is shaped like a real one on purpose: lines above
 * the column names (one of them the card's last four digits, which is how the
 * wizard ties the file to an account), charges as positive numbers, two date
 * columns, a category column the import leaves out, and one pending row
 * without a date for the wizard to point at. Invented data only.
 */
function writeCardStatement(directory: string): string {
  const today = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const day = (daysAgo: number) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo);
    return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()}`;
  };
  const row = (daysAgo: number, description: string, amount: string, category: string) =>
    `${day(daysAgo)},${day(Math.max(daysAgo - 1, 0))},${description},${amount},${category}`;
  const lines = [
    'Bank: Pine State Bank',
    'Card ending in 7781',
    `Statement period: ${day(28)} to ${day(1)}`,
    '',
    'Trans. Date,Post Date,Description,Amount,Category',
    row(27, 'HARBOR STREET GROCERY', '84.12', 'Supermarkets'),
    row(24, 'CITY TRANSIT PASS', '45.00', 'Travel'),
    row(21, 'LANTERN BOOKS', '23.99', 'Merchandise'),
    row(19, 'NOODLE HOUSE 14', '31.60', 'Restaurants'),
    // Money back on a card is a refund in the app's terms; a card payment would need its other half in checking.
    row(16, 'LANTERN BOOKS REFUND', '-23.99', 'Merchandise'),
    row(13, 'FUEL STOP 2231', '41.10', 'Gasoline'),
    row(9, 'HARDWARE DEPOT 77', '64.20', 'Home Improvement'),
    row(6, 'STREAMING SERVICE', '12.99', 'Services'),
    row(3, 'CITY PARKING GARAGE', '14.00', 'Travel'),
    'Pending,,CORNER BAKERY 0091,8.45,Restaurants',
  ];
  const file = path.join(directory, 'pine-state-card-statement.csv');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(file, `${lines.join('\r\n')}\r\n`);
  return file;
}
const STATEMENT_FILE_NAME = 'pine-state-card-statement.csv';
const STATEMENT_ACCOUNT = 'Travel Mastercard';

type ImportShotNames = Record<'files' | 'account' | 'check' | 'review' | 'summary', string>;

/**
 * Walks the statement from the Files step to the Summary, taking the import
 * shots on the way when `names` is given. Leaves the wizard on the Summary
 * with Import enabled; nothing has been written yet.
 */
async function walkImportToSummary(page: Page, statementPath: string, names?: ImportShotNames) {
  await openImportWizard(page);
  await addStatementFiles(page, statementPath);
  await settle(page, 600);
  // Files: the dropped file and what was recognised in it.
  if (names) await shot(page, names.files);
  expect(await startImport(page), 'a new format starts on the Account step').toBe('account');
  await settle(page, 600);
  // Account: found from the card's last four digits, shown as a guess to confirm.
  if (names) await shot(page, names.account);
  await chooseImportAccount(page, 0, STATEMENT_ACCOUNT);
  await nextWizardStep(page, 'layout');
  await settle(page, 800);
  // Check how we read it: the rows as interpreted, with the worded examples.
  if (names) await shot(page, names.check);
  await confirmReadingSettings(page);
  await nextWizardStep(page, 'review');
  await settle(page, 800);
  // Things to check: the pending row that has no date, what was assumed, what is left out.
  if (names) await shot(page, names.review);
  const leaveOut = page.getByTestId('import-row-skip');
  if ((await leaveOut.count()) > 0) await leaveOut.first().click();
  await nextWizardStep(page, 'summary');
  await expect(page.getByTestId('import-run')).toBeEnabled({ timeout: 30_000 });
  await settle(page, 800);
  // Summary: what pressing Import will do.
  if (names) await shot(page, names.summary);
}

/** Leaves the Import page, discarding a loaded file. Safe to call when it is not open. */
async function leaveImport(page: Page) {
  if (!(await page.getByTestId('import-page').isVisible())) return;
  await page.getByTestId('import-close').click();
  // Asked only while a file is loaded.
  await page.getByTestId('import-leave-discard').click({ timeout: 5_000 }).catch(() => undefined);
  await expect(page.getByTestId('import-page')).toBeHidden();
}

const DESKTOP = { width: 1280, height: 800 };
const HERO = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

test.use({ viewport: DESKTOP, deviceScaleFactor: 2 });
test.skip(!OUT, 'Landing-site capture: runs only through `node scripts/landing-site.mjs capture` (LANDING_SHOTS_DIR).');

const log: string[] = [];
const written: string[] = [];

function note(line: string) {
  log.push(line);
  console.log(`[landing] ${line}`);
}

async function settle(page: Page, ms = 1200) {
  await page.waitForTimeout(ms);
}

/** Writes one screenshot, unless LANDING_SHOTS_ONLY leaves it out. */
async function save(page: Page, name: string) {
  if (ONLY.size > 0 && !ONLY.has(name)) return;
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  written.push(name);
  note(`shot ${name}`);
}

/** A desktop screenshot with nothing hovered or focused. */
async function shot(page: Page, name: string) {
  // Park the pointer on the empty status bar so nothing shows a hover state.
  const viewport = page.viewportSize() ?? DESKTOP;
  await page.mouse.move(Math.round(viewport.width / 2), viewport.height - 3);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await settle(page, 400);
  await save(page, name);
}

/** A failed step must not lose the shots already taken. */
async function step(name: string, run: () => Promise<void>) {
  try {
    await run();
    note(`ok   ${name}`);
  } catch (error) {
    note(`FAIL ${name}: ${(error as Error).message.split('\n')[0]}`);
  }
}

async function closeDialogs(page: Page) {
  for (let i = 0; i < 3; i += 1) {
    if ((await page.getByRole('dialog').count()) === 0) return;
    await page.keyboard.press('Escape');
    await settle(page, 500);
  }
}

/**
 * Loads the app again and unlocks it. Works in any language (no label
 * lookups), and can capture the lock screen on the way through.
 */
async function reopen(page: Page, captureLockScreenAs?: string) {
  await page.goto('/');
  const password = page.locator('input[type="password"]').first();
  const nav = page.getByTestId('nav-dashboard').first();
  await Promise.race([
    password.waitFor({ state: 'visible', timeout: 120_000 }),
    nav.waitFor({ state: 'visible', timeout: 120_000 }),
  ]);
  if (await password.isVisible().catch(() => false)) {
    if (captureLockScreenAs) {
      await settle(page, 1500);
      await shot(page, captureLockScreenAs);
    }
    await password.fill(TEST_PASSWORD);
    await password.press('Enter');
  }
  await nav.waitFor({ state: 'visible', timeout: 120_000 });
  await settle(page, 3000);
}

async function setDeviceSetting(page: Page, key: string, value: string) {
  await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [key, value]);
  await reopen(page);
}

/** Expands or collapses the desktop navigation rail. */
async function setRail(page: Page, expanded: boolean) {
  const rail = page.getByTestId('sidebar-rail');
  if (!(await rail.isVisible().catch(() => false))) return;
  if (((await rail.getAttribute('data-expanded')) === 'true') !== expanded) {
    await page.getByTestId('sidebar-toggle').click();
    await expect(rail).toHaveAttribute('data-expanded', expanded ? 'true' : 'false');
    await settle(page, 700);
  }
}

async function choosePeriod(page: Page, buttonTestId: string, periodName: string) {
  await page.getByTestId(buttonTestId).click();
  await page.getByRole('button', { name: periodName, exact: true }).click();
  await page.keyboard.press('Escape');
  await settle(page, 1500);
}

// --- A local OpenAI-compatible endpoint standing in for a local model. -------
// The model's side of the conversation is scripted; the tool call it makes
// runs for real against the sample database.

const AI_QUESTION = 'Which subscriptions am I paying for every month?';
const AI_ANSWER = [
  'You have **five digital and membership subscriptions** that charge every month:',
  '',
  '| Subscription | Monthly |',
  '| --- | ---: |',
  '| Fitlife Gym Membership | $45.00 |',
  '| Gamestation Online | $19.99 |',
  '| Streamhouse Media | $15.99 |',
  '| Melody Music | $10.99 |',
  '| Cloud Vault Storage | $2.99 |',
  '',
  'That is **$94.96 a month**, or about **$1,139.52 a year**. Fitlife Gym is nearly half of it, so that is the one to look at first if you want to trim.',
].join('\n');

function chunk(model: string, delta: object, finishReason: string | null) {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-demo',
    object: 'chat.completion.chunk',
    created: 1,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }],
    usage: { prompt_tokens: 420, completion_tokens: 96, total_tokens: 516 },
  })}\n\n`;
}

async function startDemoEndpoint() {
  const server = http.createServer((request, response) => {
    const cors = { 'access-control-allow-origin': '*' };
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        ...cors,
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, authorization',
      });
      response.end();
      return;
    }
    const { pathname } = new URL(request.url ?? '/', 'http://mock');
    if (pathname === '/v1/models') {
      response.writeHead(200, { ...cors, 'content-type': 'application/json' });
      response.end(JSON.stringify({ object: 'list', data: [{ id: 'local-demo', object: 'model' }] }));
      return;
    }
    if (pathname === '/v1/chat/completions') {
      let raw = '';
      request.on('data', (part) => { raw += part; });
      request.on('end', () => {
        const body = JSON.parse(raw) as { model?: string; messages?: Array<{ role: string }> };
        const model = body.model ?? 'local-demo';
        const hasToolResult = (body.messages ?? []).some((message) => message.role === 'tool');
        response.writeHead(200, { ...cors, 'content-type': 'text/event-stream' });
        if (hasToolResult) {
          response.end(`${chunk(model, { role: 'assistant', content: AI_ANSWER }, 'stop')}data: [DONE]\n\n`);
        } else {
          response.end(
            `${chunk(
              model,
              {
                role: 'assistant',
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_demo_1',
                    type: 'function',
                    function: { name: 'find_recurring_subscriptions', arguments: '{"minOccurrences":3}' },
                  },
                ],
              },
              'tool_calls'
            )}data: [DONE]\n\n`
          );
        }
      });
      return;
    }
    response.writeHead(404, cors);
    response.end('not found');
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://localhost:${port}/v1`,
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }),
  };
}

test('capture landing-site screenshots', async ({ page }, testInfo) => {
  test.setTimeout(1_800_000);
  fs.mkdirSync(OUT, { recursive: true });
  const statementPath = writeCardStatement(testInfo.outputPath('statement'));

  await page.addInitScript(() => {
    if (!window.localStorage.getItem('budgetTracker_themePreset')) {
      window.localStorage.setItem('budgetTracker_themePreset', 'dark');
    }
    // The Next.js dev indicator is not part of the product.
    const hide = () => {
      const style = document.createElement('style');
      style.textContent = 'nextjs-portal{display:none!important}';
      document.documentElement.appendChild(style);
    };
    if (document.documentElement) hide();
    else document.addEventListener('DOMContentLoaded', hide);
  });
  await seedBrowserCompatibility(page);

  // --- First run: welcome, setup, storage choice ----------------------------
  await page.goto('/?loadSampleData&sampleDataTransactionLimit=1000000');
  const createDatabaseButton = page.getByRole('button', { name: 'Create New Database' });
  await createDatabaseButton.waitFor({ state: 'visible', timeout: 120_000 });
  await settle(page, 1500);
  await shot(page, 'welcome');

  await createDatabaseButton.click();
  await page.getByLabel('Primary User Name').waitFor({ state: 'visible', timeout: 20_000 });
  await page.getByLabel('Primary User Name').fill('Avery Parker');
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
  await page.getByLabel('Confirm Password').fill(TEST_PASSWORD);
  await settle(page, 600);
  await shot(page, 'setup-password');

  await step('setup recovery phrase', async () => {
    await page.getByTestId('master-type-recovery').click();
    await page.getByTestId('generate-recovery-phrase').click();
    await page.getByTestId('recovery-word-12').waitFor({ state: 'visible', timeout: 10_000 });
    await settle(page, 600);
    await shot(page, 'setup-recovery-phrase');
  });
  // Restart the setup cleanly and carry on with a password.
  await page.goto('/?loadSampleData&sampleDataTransactionLimit=1000000');
  await createDatabaseButton.waitFor({ state: 'visible', timeout: 120_000 });
  await createDatabaseButton.click();
  await page.getByLabel('Primary User Name').waitFor({ state: 'visible', timeout: 20_000 });
  await page.getByLabel('Primary User Name').fill('Avery Parker');
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
  await page.getByLabel('Confirm Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Create Database' }).click();

  await page.getByTestId('skip-preferences').waitFor({ state: 'visible', timeout: 60_000 });
  await settle(page, 600);
  await shot(page, 'setup-preferences');
  await page.getByTestId('skip-preferences').click();

  await page.getByTestId('skip-initial-account').waitFor({ state: 'visible', timeout: 60_000 });
  await settle(page, 600);
  await shot(page, 'setup-first-account');
  await page.getByTestId('skip-initial-account').click();

  await page.getByTestId('storage-choice-local').waitFor({ state: 'visible', timeout: 60_000 });
  await settle(page, 600);
  await shot(page, 'setup-storage-choice');
  await page.getByTestId('storage-choice-local').click();

  await expect(page.getByRole('button', { name: 'SQL Query' })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId('database-status-text')).toHaveText('Connected', { timeout: 180_000 });

  // Feature shots use the collapsed rail so the page content gets the room.
  await setRail(page, false);

  // --- Let the app's own scans run ------------------------------------------
  await navigateToPage(page, 'loans');
  await expect(page.getByTestId('loans-grid')).toBeVisible({ timeout: 60_000 });
  await settle(page, 3000);
  await navigateToPage(page, 'subscriptions');
  await expect(page.getByRole('heading', { name: 'Subscriptions', exact: true, level: 4 })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Rescan' }).click();
  await expect(page.getByText(/Scan complete/)).toBeVisible({ timeout: 120_000 });
  await settle(page, 1500);

  // --- Subscriptions --------------------------------------------------------
  await step('subscriptions', async () => {
    await shot(page, 'subscriptions-review');
    // Confirm every detected series except the two that are really loan / donation-like.
    for (let i = 0; i < 14; i += 1) {
      const confirm = page.getByRole('button', { name: 'Confirm as active' }).first();
      if (!(await confirm.isVisible().catch(() => false))) break;
      await confirm.click();
      await settle(page, 700);
    }
    await settle(page, 1500);
    await page.mouse.wheel(0, -4000);
    await shot(page, 'subscriptions');
    await page.getByRole('button', { name: 'View transactions' }).nth(2).click();
    await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 15_000 });
    await settle(page, 1200);
    await shot(page, 'subscription-detail');
    await closeDialogs(page);
  });

  // --- Dashboard ------------------------------------------------------------
  await step('dashboard', async () => {
    await navigateToPage(page, 'dashboard');
    await expect(page.getByRole('heading', { name: 'Total Income' })).toBeVisible({ timeout: 60_000 });
    await choosePeriod(page, 'dashboard-filter-button', 'This Year');
    await settle(page, 2500);
    await shot(page, 'dashboard');
    // The hero image: a little wider, with the full navigation showing.
    await page.setViewportSize(HERO);
    await setRail(page, true);
    await settle(page, 2000);
    await shot(page, 'dashboard-hero');
    await setRail(page, false);
    await page.setViewportSize(DESKTOP);
    await settle(page, 1500);
    for (const [tabName, file] of [
      ['Spending Breakdown', 'dashboard-spending'],
      ['Budget Health', 'dashboard-budget-health'],
      ['Trends', 'dashboard-trends'],
      ['Commitments', 'dashboard-commitments'],
      ['Income Sources', 'dashboard-income'],
      ['User Analysis', 'dashboard-users'],
    ] as const) {
      const tab = page.getByRole('tab', { name: tabName });
      await tab.click();
      await tab.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.mouse.wheel(0, -70);
      await settle(page, 2200);
      await shot(page, file);
    }
    await page.getByRole('tab', { name: 'Spending Breakdown' }).click();
    await page.mouse.wheel(0, -6000);
  });

  // --- Transactions ---------------------------------------------------------
  await step('transactions', async () => {
    await navigateToPage(page, 'transactions');
    await expect(page.getByRole('heading', { name: 'Transaction Report' })).toBeVisible({ timeout: 60_000 });
    await settle(page, 2500);
    await shot(page, 'transactions-filters');
    await page.getByText('Filters', { exact: true }).click();
    await settle(page, 1200);
    await shot(page, 'transactions');
  });
  await step('transactions type rules', async () => {
    await page.getByTestId('transactions-type-rules').click();
    await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 15_000 });
    await settle(page, 1200);
    await shot(page, 'transactions-type-rules');
    await closeDialogs(page);
  });
  await step('add transaction', async () => {
    await page.getByTestId('rail-add-transaction').click();
    await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 15_000 });
    await settle(page, 1000);
    await shot(page, 'add-transaction');
    await closeDialogs(page);
  });

  // --- Import: the guided import, looked at and discarded --------------------
  await step('import wizard', async () => {
    try {
      await walkImportToSummary(page, statementPath, {
        files: 'import-files',
        account: 'import-account',
        check: 'import-check',
        review: 'import-review',
        summary: 'import-summary',
      });
    } finally {
      // Nothing is imported here: a saved import would change every total shown after it. The
      // Import page is full-screen, so a step that failed half-way must not leave it open either.
      await leaveImport(page);
    }
  });

  // --- Budget ---------------------------------------------------------------
  await step('budget', async () => {
    await navigateToPage(page, 'budget');
    await expect(page.getByTestId('budget-status-panel')).toBeVisible({ timeout: 60_000 });
    await settle(page, 1500);
    await shot(page, 'budget');
    await page.getByTestId('budget-funds-card').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await settle(page, 1000);
    await shot(page, 'budget-funds');
    await page.mouse.wheel(0, -6000);
    await page.getByRole('button', { name: 'Year', exact: true }).click();
    await settle(page, 2000);
    await shot(page, 'budget-year');
    await page.getByRole('button', { name: 'Month', exact: true }).click();
  });
  await step('budget plan editor', async () => {
    await page.getByRole('button', { name: 'Manage Plan' }).click();
    await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 15_000 });
    await settle(page, 1200);
    await shot(page, 'budget-plan');
    await closeDialogs(page);
  });

  // --- Accounts -------------------------------------------------------------
  await step('accounts', async () => {
    await navigateToPage(page, 'accounts');
    await page.getByText('Rewards Visa', { exact: true }).first().click();
    await settle(page, 1500);
    await shot(page, 'accounts');
  });

  // --- Loans ----------------------------------------------------------------
  await step('loans', async () => {
    await navigateToPage(page, 'loans');
    await expect(page.getByTestId('loans-grid')).toBeVisible({ timeout: 60_000 });
    await settle(page, 2000);
    await shot(page, 'loans');
    await page.getByRole('button', { name: 'View Home mortgage' }).click();
    await page.getByTestId('loan-detail-dialog').waitFor({ state: 'visible', timeout: 15_000 });
    await settle(page, 2500);
    await shot(page, 'loan-detail-mortgage');
    await closeDialogs(page);
    await page.getByRole('button', { name: 'View Furnace financing' }).click();
    await page.getByTestId('loan-detail-dialog').waitFor({ state: 'visible', timeout: 15_000 });
    await settle(page, 2500);
    await shot(page, 'loan-detail-promo');
    await closeDialogs(page);
  });

  // --- Projects and trips ---------------------------------------------------
  await step('projects', async () => {
    await navigateToPage(page, 'projects');
    await settle(page, 2000);
    await shot(page, 'projects');
    await page.getByText('Project Details & Transactions').nth(1).click();
    await settle(page, 1500);
    await page.getByText('Furnace Replacement', { exact: true }).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.mouse.wheel(0, -90);
    await settle(page, 800);
    await shot(page, 'project-detail');
  });
  await step('trips', async () => {
    await navigateToPage(page, 'trips');
    await settle(page, 2000);
    await shot(page, 'trips');
  });

  // --- Notifications --------------------------------------------------------
  await step('notifications', async () => {
    await navigateToPage(page, 'notifications');
    await expect(page.getByTestId('notifications-page')).toBeVisible({ timeout: 30_000 });
    const plusDays = (days: number) => {
      const date = new Date();
      date.setDate(date.getDate() + days);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };
    for (const [title, days] of [
      ['Renew car registration', 3],
      ['Book furnace service visit', 6],
      ["Riley's birthday gift", 12],
    ] as const) {
      await page.getByTestId('notifications-new-reminder').click();
      const editor = page.getByRole('dialog', { name: 'New reminder' });
      await editor.getByTestId('reminder-title').fill(title);
      await editor.getByTestId('reminder-date').fill(plusDays(days));
      await editor.getByTestId('reminder-lead-override').check();
      await editor.getByTestId('reminder-lead-days').fill('14');
      if (title.startsWith('Renew')) {
        await settle(page, 500);
        await shot(page, 'notification-reminder-editor');
      }
      await editor.getByTestId('reminder-save').click();
      await expect(editor).toBeHidden({ timeout: 30_000 });
    }
    await page.getByTestId('notifications-rescan').click();
    await expect(page.getByTestId('notifications-rescan')).toBeEnabled({ timeout: 60_000 });
    await settle(page, 2000);
    await shot(page, 'notifications');
    await page.getByTestId('notification-bell-button').hover();
    await page.getByTestId('notification-bell-preview').waitFor({ state: 'visible', timeout: 10_000 });
    await settle(page, 600);
    await save(page, 'notification-bell');
    await page.mouse.move(10, 400);
  });
  await step('dashboard with notifications card', async () => {
    await navigateToPage(page, 'dashboard');
    await expect(page.getByRole('heading', { name: 'Total Income' })).toBeVisible({ timeout: 60_000 });
    await settle(page, 2500);
    await shot(page, 'dashboard-notifications');
  });

  // --- SQL console ----------------------------------------------------------
  await step('sql query', async () => {
    await navigateToPage(page, 'sql-query');
    await page
      .getByTestId('sql-query-input')
      .locator('.cm-content')
      .fill(
        [
          'SELECT c.name AS category,',
          '       COUNT(*) AS purchases,',
          '       ROUND(SUM(-t.amount), 2) AS spent',
          'FROM transactions t',
          'JOIN categories c ON c.id = t.category_id',
          "WHERE t.type = 'expense'",
          "  AND t.date >= date('now', 'start of year')",
          'GROUP BY c.name',
          'ORDER BY spent DESC',
          'LIMIT 12;',
        ].join('\n')
      );
    await page.getByRole('button', { name: 'Execute Query' }).click();
    await expect(page.getByTestId('sql-query-results')).toBeVisible({ timeout: 30_000 });
    await settle(page, 1500);
    await shot(page, 'sql-query');
  });

  // --- AI assistant ---------------------------------------------------------
  const endpoint = await startDemoEndpoint();
  await step('ai assistant', async () => {
    await navigateToPage(page, 'subscriptions');
    await settle(page, 1500);
    await page.getByTestId('ai-launcher-button').click();
    await expect(page.getByTestId('ai-panel')).toBeVisible();
    await page.getByTestId('ai-tab-setup').click();
    await page.getByTestId('ai-setup-tab-local').click();
    await settle(page, 800);
    await shot(page, 'ai-setup-local');
    await page.getByTestId('ai-setup-tab-cloud').click();
    await settle(page, 800);
    await shot(page, 'ai-setup-cloud');
    await page.getByTestId('ai-setup-tab-local').click();
    await page.getByTestId('ai-local-mode-endpoint').click();
    await page.getByTestId('ai-local-endpoint-add').click();
    await page.getByTestId('ai-provider-label').fill('Local model');
    await page.getByTestId('ai-provider-base-url').fill(endpoint.baseUrl);
    await page.getByTestId('ai-provider-test').click();
    await expect(page.getByTestId('ai-provider-test-status')).toHaveAttribute('data-ok', 'true', { timeout: 20_000 });
    await page.getByTestId('ai-provider-save').click();
    await settle(page, 1000);

    await page.getByTestId('ai-tab-tools').click();
    await settle(page, 1000);
    await shot(page, 'ai-tools');

    await page.getByTestId('ai-tab-chat').click();
    const prompt = page.getByLabel('Ask about transactions');
    await expect(prompt).toBeEnabled();
    await prompt.fill(AI_QUESTION);
    await prompt.press('Enter');
    // Tools ask for consent the first time; show the card, then allow.
    const consent = page.getByTestId('ai-consent-card');
    if (await consent.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)) {
      await settle(page, 500);
      await shot(page, 'ai-consent');
      await consent.getByRole('button', { name: /allow/i }).first().click();
    }
    await expect(page.getByTestId('ai-panel')).toContainText('$94.96', { timeout: 30_000 });
    await settle(page, 1500);
    await shot(page, 'ai-chat');
    await step('ai maximized', async () => {
      await page.getByTestId('ai-mode-maximize').click();
      await settle(page, 1200);
      await shot(page, 'ai-chat-maximized');
      await page.getByTestId('ai-mode-sidebar').click();
    });
    await page.getByTestId('ai-panel-close').click();
  });
  await endpoint.close();

  // --- Settings -------------------------------------------------------------
  await step('settings', async () => {
    await closeDialogs(page);
    await navigateToPage(page, 'settings');
    await settle(page, 1500);
    for (const [tabName, file] of [
      ['Preferences', 'settings-preferences'],
      ['Storage', 'settings-storage'],
      ['Database Source', 'settings-database-source'],
      ['Security', 'settings-security'],
      ['Data & Backup', 'settings-data-backup'],
      ['Display', 'settings-display'],
      ['Notifications', 'settings-notifications'],
    ] as const) {
      await step(`settings ${tabName}`, async () => {
        await page.getByRole('tab', { name: tabName, exact: true }).click();
        await settle(page, 1500);
        await shot(page, file);
      });
    }
    await page.getByRole('button', { name: 'Close settings' }).click();
  });

  // --- Developer console ----------------------------------------------------
  await step('developer console', async () => {
    await navigateToPage(page, 'developer-console');
    await settle(page, 2500);
    await shot(page, 'developer-console');
  });

  // --- Lock screen (a fresh load drops the key, so the app asks again) -------
  await step('unlock screen', async () => {
    await reopen(page, 'unlock');
  });

  // --- Light theme ----------------------------------------------------------
  await step('light theme', async () => {
    await setDeviceSetting(page, 'budgetTracker_themePreset', 'light');
    await setRail(page, false);
    await navigateToPage(page, 'dashboard');
    await expect(page.getByRole('heading', { name: 'Total Income' })).toBeVisible({ timeout: 60_000 });
    await choosePeriod(page, 'dashboard-filter-button', 'This Year');
    await settle(page, 2500);
    await shot(page, 'theme-light');
    await navigateToPage(page, 'budget');
    await expect(page.getByTestId('budget-status-panel')).toBeVisible({ timeout: 60_000 });
    await settle(page, 1500);
    await shot(page, 'budget-light');
    await setDeviceSetting(page, 'budgetTracker_themePreset', 'dark');
  });

  // --- Other languages ------------------------------------------------------
  for (const language of ['es', 'ja', 'de']) {
    await step(`language ${language}`, async () => {
      await setDeviceSetting(page, 'budgetTracker_language', language);
      await setRail(page, false);
      await page.getByTestId('nav-budget').first().click();
      await expect(page.getByTestId('budget-status-panel')).toBeVisible({ timeout: 60_000 });
      await settle(page, 1800);
      await shot(page, `budget-${language}`);
      await page.getByTestId('nav-dashboard').first().click();
      await settle(page, 3000);
      await shot(page, `dashboard-${language}`);
    });
  }
  await step('back to English', async () => {
    await setDeviceSetting(page, 'budgetTracker_language', 'en-US');
    await expect(page.getByTestId('database-status-text')).toHaveText('Connected', { timeout: 120_000 });
  });

  // --- Phone layout ---------------------------------------------------------
  await step('mobile', async () => {
    await navigateToPage(page, 'dashboard');
    await expect(page.getByRole('heading', { name: 'Total Income' })).toBeVisible({ timeout: 60_000 });
    await choosePeriod(page, 'dashboard-filter-button', 'This Year');
    await page.setViewportSize(MOBILE);
    await expect(page.getByTestId('mobile-bottom-nav')).toBeVisible({ timeout: 30_000 });
    await settle(page, 2500);
    await save(page, 'm-dashboard');
    await step('mobile charts', async () => {
      const tab = page.getByRole('tab', { name: 'Spending Breakdown' });
      await tab.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.mouse.wheel(0, -70);
      await settle(page, 2000);
      await save(page, 'm-dashboard-spending');
    });
    for (const id of ['budget', 'transactions', 'accounts', 'loans', 'subscriptions'] as const) {
      await step(`mobile ${id}`, async () => {
        await navigateToPage(page, id);
        await settle(page, 2800);
        await save(page, `m-${id}`);
      });
    }
    await step('mobile more sheet', async () => {
      await page.getByTestId('nav-more').click();
      await expect(page.getByTestId('mobile-more-sheet')).toBeVisible();
      // The sheet opens under the pointer, which would leave its last row looking hovered.
      await page.mouse.move(Math.round(MOBILE.width / 2), 40);
      await settle(page, 1000);
      await save(page, 'm-more');
      await page.keyboard.press('Escape');
    });
    await page.setViewportSize(DESKTOP);
  });

  // --- Import history: the one step that imports, kept for last ---------------
  // It writes the statement's rows, takes the History shot and undoes the import through the
  // same screen, so nothing above ever sees them. A saved format and the card number stay behind.
  await step('import history', async () => {
    try {
      await walkImportToSummary(page, statementPath);
      await runImport(page);
      // "Undo" on the Done step opens History & formats with this import on top.
      await page.getByTestId('import-undo').click();
      const newest = page.getByTestId('import-history-row').first();
      await expect(newest.getByTestId('import-history-file')).toHaveText(STATEMENT_FILE_NAME, { timeout: 30_000 });
      await settle(page, 1000);
      await shot(page, 'import-history');
      await newest.getByTestId('import-history-undo').click();
      await page.getByTestId('import-undo-confirm').click();
      await expect(page.getByTestId('import-manage-notice-undone')).toBeVisible({ timeout: 120_000 });
    } finally {
      await leaveImport(page);
    }
  });

  // --- The 404 page ---------------------------------------------------------
  await step('404 page', async () => {
    await page.goto('/this-page-flew-away');
    await page.getByTestId('not-found-page').waitFor({ state: 'visible', timeout: 60_000 });
    await settle(page, 2500);
    await shot(page, 'not-found');
  });

  const missing = [...ONLY].filter((name) => !written.includes(name));
  expect(missing, 'names in LANDING_SHOTS_ONLY that no step produced').toEqual([]);
  expect(log.filter((line) => line.startsWith('FAIL'))).toEqual([]);
});
