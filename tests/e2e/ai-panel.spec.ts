import { expect, test, type BrowserContext, type Request } from '@playwright/test';

import { bootstrapDatabase, runQueryAndReadFirstCell } from './helpers/bootstrap';

// The AI panel against a cloud profile that points at an OpenAI-compatible
// endpoint mocked with Playwright routes on the app's own origin (so no CORS
// is involved). Covers: provider setup + Test connection, the consent card
// for a write tool (Deny blocks the write), and the pop-out window at /ai/.

// Same origin as the app under test (derived from the page URL at runtime).
const MOCK_PATH = '/__mock-ai/v1';
const MOCK_MODEL = 'mock-model';
const DENIED_REPLY = 'Understood. I did not create the category.';

function sseChunk(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function toolCallStream(): string {
  return (
    sseChunk({
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      created: 1,
      model: MOCK_MODEL,
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          tool_calls: [{
            index: 0,
            id: 'call_1',
            type: 'function',
            function: { name: 'create_category', arguments: JSON.stringify({ name: 'Fuel', type: 'expense' }) },
          }],
        },
        finish_reason: 'tool_calls',
        logprobs: null,
      }],
    }) +
    sseChunk({
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      created: 1,
      model: MOCK_MODEL,
      choices: [],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    }) +
    'data: [DONE]\n\n'
  );
}

function textStream(text: string): string {
  return (
    sseChunk({
      id: 'chatcmpl-2',
      object: 'chat.completion.chunk',
      created: 2,
      model: MOCK_MODEL,
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: 'stop', logprobs: null }],
      usage: { prompt_tokens: 40, completion_tokens: 8, total_tokens: 48 },
    }) +
    'data: [DONE]\n\n'
  );
}

interface MockChatRequest {
  messages: Array<{ role: string; content?: string | null }>;
  tools?: Array<{ function: { name: string } }>;
  stream?: boolean;
}

async function installMockProvider(context: BrowserContext) {
  const chatRequests: MockChatRequest[] = [];

  await context.route('**/__mock-ai/v1/**', async (route) => {
    const request: Request = route.request();
    const url = new URL(request.url());

    if (url.pathname.endsWith('/models') && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ object: 'list', data: [{ id: MOCK_MODEL, object: 'model' }] }),
      });
      return;
    }

    if (url.pathname.endsWith('/chat/completions') && request.method() === 'POST') {
      const body = JSON.parse(request.postData() ?? '{}') as MockChatRequest;
      chatRequests.push(body);
      const hasToolResult = body.messages.some((message) => message.role === 'tool');
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: hasToolResult ? textStream(DENIED_REPLY) : toolCallStream(),
      });
      return;
    }

    await route.fulfill({ status: 404, body: 'not mocked' });
  });

  return chatRequests;
}

test('cloud profile with Test Connection, consent card with Deny, and the pop-out window', async ({ page, context }) => {
  const chatRequests = await installMockProvider(context);

  // Wide enough for the docked sidebar (content keeps >= lg width).
  await page.setViewportSize({ width: 1700, height: 900 });
  await bootstrapDatabase(page);
  const mockBaseUrl = `${new URL(page.url()).origin}${MOCK_PATH}`;

  // Open the panel from the header launcher.
  await page.getByTestId('ai-launcher-button').click();
  await expect(page.getByTestId('ai-panel')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Local AI' })).toBeVisible();
  await expect(page.getByTestId('ai-panel-resize-handle')).toBeVisible();

  // Setup → Cloud → add an OpenAI-compatible profile pointing at the mock.
  await page.getByTestId('ai-tab-setup').click();
  await page.getByTestId('ai-setup-tab-cloud').click();
  await page.getByTestId('ai-provider-add').click();

  await page.getByRole('combobox', { name: 'Provider' }).click();
  await page.getByRole('option', { name: 'OpenAI-compatible' }).click();

  await page.getByTestId('ai-provider-label').fill('Mock cloud');
  await page.getByTestId('ai-provider-base-url').fill(mockBaseUrl);
  await page.getByTestId('ai-provider-model').fill(MOCK_MODEL);

  await page.getByTestId('ai-provider-test').click();
  const status = page.getByTestId('ai-provider-test-status');
  await expect(status).toHaveAttribute('data-ok', 'true');
  await expect(status).toContainText('Connected');

  await page.getByTestId('ai-provider-save').click();

  // The first saved profile becomes the active provider; the panel retitles.
  await expect(page.getByTestId('ai-provider-list')).toContainText('Mock cloud');
  await expect(page.getByTestId('ai-panel-title')).toHaveText('Mock cloud');
  await expect(page.getByTestId('ai-panel-caption')).toContainText(MOCK_MODEL);

  // Chat: the mock model calls a write tool, which pauses on the consent card.
  await page.getByTestId('ai-tab-chat').click();
  const prompt = page.getByLabel('Ask about transactions');
  await expect(prompt).toBeEnabled();
  await prompt.fill('Add a Fuel category');
  await prompt.press('Enter');

  const consentCard = page.getByTestId('ai-consent-card');
  await expect(consentCard).toBeVisible();
  await expect(consentCard).toContainText('create_category');
  await expect(page.getByTestId('ai-consent-crud')).toHaveText('Create');
  await expect(consentCard).toContainText('"name": "Fuel"');

  // Deny: the model receives a tool error and answers accordingly.
  await consentCard.getByRole('button', { name: 'Deny' }).click();
  await expect(page.getByTestId('ai-panel')).toContainText(DENIED_REPLY);
  await expect(page.getByTestId('ai-tool-call-create_category')).toHaveAttribute('data-status', 'denied');
  await expect(consentCard).toHaveCount(0);

  expect(chatRequests).toHaveLength(2);
  expect(chatRequests[0].tools?.map((tool) => tool.function.name)).toContain('create_category');
  expect(chatRequests[0].tools?.map((tool) => tool.function.name)).not.toContain('delete_transaction');
  const toolMessage = chatRequests[1].messages.find((message) => message.role === 'tool');
  expect(toolMessage?.content).toContain('denied');

  // Nothing was written.
  const fuelCount = await runQueryAndReadFirstCell(page, "SELECT COUNT(*) AS n FROM categories WHERE name = 'Fuel'");
  expect(fuelCount).toBe('0');

  // Pop-out: opens /ai/ in a new window that shares the database and transcript.
  const popupPromise = context.waitForEvent('page');
  await page.getByTestId('ai-mode-popout').click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  expect(new URL(popup.url()).pathname).toBe('/ai/');

  await expect(popup.getByTestId('ai-popout-page')).toBeVisible({ timeout: 120_000 });
  await expect(popup.getByTestId('ai-panel-title')).toHaveText('Mock cloud', { timeout: 60_000 });
  await expect(popup.getByTestId('ai-panel')).toContainText('Add a Fuel category');
  await expect(popup.getByTestId('ai-panel')).toContainText(DENIED_REPLY);

  // The in-app panel is parked while the pop-out is open.
  await expect(page.getByTestId('ai-panel')).toHaveCount(0);

  await popup.close();
  // Closing the pop-out returns the launcher to sidebar mode.
  await page.getByTestId('ai-launcher-button').click();
  await expect(page.getByTestId('ai-panel')).toBeVisible();
});
