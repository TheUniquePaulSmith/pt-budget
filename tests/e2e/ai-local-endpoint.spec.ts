import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';

import { bootstrapDatabase } from './helpers/bootstrap';

// Setup → Local → "Local endpoint": an OpenAI-compatible server on another
// origin. A real Node HTTP server (not a Playwright route) is used so the
// browser's own CORS rules apply — in particular the credentialed-request
// rules that the "Present my client certificate" switch under Advanced turns
// on. Covers: the Browser (GGUF) / Local endpoint options, Test connection
// validating the server and filling the model drop-down, the PFX/mTLS switch,
// and a chat turn against the endpoint.

const MODELS = ['llama3.1', 'qwen2.5'];
const REPLY = 'Hello from the local endpoint.';

type CorsMode = 'wildcard' | 'credentialed';

interface MockEndpoint {
  baseUrl: string;
  setCorsMode: (mode: CorsMode) => void;
  chatModels: string[];
  close: () => Promise<void>;
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => resolve(body));
  });
}

async function startMockEndpoint(): Promise<MockEndpoint> {
  let corsMode: CorsMode = 'wildcard';
  const chatModels: string[] = [];

  const server = http.createServer((request, response) => {
    const origin = request.headers.origin;
    // A credentialed request needs an explicit origin plus Allow-Credentials;
    // a wildcard origin is rejected by the browser for those.
    const cors: Record<string, string> = corsMode === 'credentialed' && origin
      ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'Origin' }
      : { 'access-control-allow-origin': '*' };

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

    if (pathname === '/v1/models' && request.method === 'GET') {
      response.writeHead(200, { ...cors, 'content-type': 'application/json' });
      response.end(JSON.stringify({ object: 'list', data: MODELS.map((id) => ({ id, object: 'model' })) }));
      return;
    }

    if (pathname === '/v1/chat/completions' && request.method === 'POST') {
      void readBody(request).then((raw) => {
        const body = JSON.parse(raw) as { model?: string };
        chatModels.push(body.model ?? '');
        response.writeHead(200, { ...cors, 'content-type': 'text/event-stream' });
        response.end(
          `data: ${JSON.stringify({
            id: 'chatcmpl-local',
            object: 'chat.completion.chunk',
            created: 1,
            model: body.model,
            choices: [{ index: 0, delta: { role: 'assistant', content: REPLY }, finish_reason: 'stop', logprobs: null }],
            usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 },
          })}\n\ndata: [DONE]\n\n`
        );
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
    setCorsMode: (mode) => { corsMode = mode; },
    chatModels,
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }),
  };
}

test('local endpoint: choose it over the browser model, validate it, pick a discovered model, use the client certificate switch, and chat', async ({ page }) => {
  const endpoint = await startMockEndpoint();
  try {
    // Wide enough for the docked sidebar (content keeps >= lg width).
    await page.setViewportSize({ width: 1700, height: 900 });
    await bootstrapDatabase(page);

    await page.getByTestId('ai-launcher-button').click();
    await expect(page.getByTestId('ai-panel')).toBeVisible();
    await page.getByTestId('ai-tab-setup').click();

    // Local tab: the two options. Nothing is configured, so the browser model is selected.
    await page.getByTestId('ai-setup-tab-local').click();
    await expect(page.getByTestId('ai-local-mode-browser')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Choose GGUF' })).toBeVisible();

    await page.getByTestId('ai-local-mode-endpoint').click();
    await expect(page.getByTestId('ai-local-mode-endpoint')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Choose GGUF' })).toHaveCount(0);
    await page.getByTestId('ai-local-endpoint-add').click();

    // Same fields as an OpenAI-compatible cloud profile, minus the provider picker.
    await expect(page.getByRole('button', { name: 'Ollama' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'LM Studio' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'vLLM' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Provider' })).toHaveCount(0);
    await page.getByTestId('ai-provider-label').fill('Mock local');
    await page.getByTestId('ai-provider-base-url').fill(endpoint.baseUrl);

    // Test connection needs no model: it validates the server and lists the models.
    const status = page.getByTestId('ai-provider-test-status');
    await page.getByTestId('ai-provider-test').click();
    await expect(status).toHaveAttribute('data-ok', 'true');
    await expect(status).toContainText('Connected');
    await expect(page.getByTestId('ai-provider-model')).toHaveValue(MODELS[0]);
    await expect(page.getByText('2 models available')).toBeVisible();

    // PFX / mTLS is an Advanced option. With it on, the browser makes credentialed
    // requests, which a wildcard-CORS server cannot satisfy.
    await expect(page.getByTestId('ai-provider-client-cert')).toHaveCount(0);
    await page.getByTestId('ai-provider-advanced-toggle').click();
    await page.getByTestId('ai-provider-client-cert').check();
    await page.getByTestId('ai-provider-test').click();
    await expect(status).toHaveAttribute('data-ok', 'false');
    await expect(page.getByTestId('ai-provider-test-hint')).toContainText('Access-Control-Allow-Credentials: true');

    // A server that allows credentials passes, and the drop-down offers what it reports.
    endpoint.setCorsMode('credentialed');
    await page.getByTestId('ai-provider-test').click();
    await expect(status).toHaveAttribute('data-ok', 'true');

    await page.getByTestId('ai-provider-form').getByRole('button', { name: 'Open' }).click();
    for (const model of MODELS) {
      await expect(page.getByRole('option', { name: model })).toBeVisible();
    }
    await page.getByRole('option', { name: 'qwen2.5' }).click();
    await expect(page.getByTestId('ai-provider-model')).toHaveValue('qwen2.5');

    await page.getByTestId('ai-provider-save').click();

    // The first saved profile becomes the active provider.
    const list = page.getByTestId('ai-local-endpoint-list');
    await expect(list).toContainText('Mock local');
    await expect(list).toContainText('qwen2.5');
    await expect(list).toContainText('client certificate');
    await expect(page.getByTestId('ai-panel-title')).toHaveText('Mock local');
    await expect(page.getByTestId('ai-panel-caption')).toContainText('Local endpoint · qwen2.5');

    // Chat goes to the endpoint with the model that was picked.
    await page.getByTestId('ai-tab-chat').click();
    const prompt = page.getByLabel('Ask about transactions');
    await expect(prompt).toBeEnabled();
    await prompt.fill('Say hello');
    await prompt.press('Enter');
    await expect(page.getByTestId('ai-panel')).toContainText(REPLY);
    expect(endpoint.chatModels).toEqual(['qwen2.5']);

    // Back on the browser option the active endpoint is called out, and one click returns to the in-browser model.
    await page.getByTestId('ai-tab-setup').click();
    await page.getByTestId('ai-local-mode-browser').click();
    await expect(page.getByText('Chat currently uses the local endpoint "Mock local"')).toBeVisible();
    await page.getByTestId('ai-provider-use-local').click();
    await expect(page.getByTestId('ai-panel-title')).toHaveText('Local AI');
  } finally {
    await endpoint.close();
  }
});
