import { expect, test } from '@playwright/test';

// The 404 page (src/app/not-found.tsx) renders for any unmatched URL and, when
// the browser shares it, names whoever sent the visitor there.

test('404 page shows the flight recorder, the flock and the 💸 favicon', async ({ page }) => {
  const response = await page.goto('/old-link/that-is-gone/?utm_source=newsletter&utm_medium=email', {
    referer: 'https://duckduckgo.com/',
  });
  expect(response?.status()).toBe(404);

  await expect(page.getByRole('heading', { level: 1, name: /404.*This page has been spent/ })).toBeVisible();
  await expect(page).toHaveTitle(/404/);

  await expect(page.getByTestId('not-found-requested')).toHaveText(
    '/old-link/that-is-gone/?utm_source=newsletter&utm_medium=email'
  );
  await expect(page.getByTestId('not-found-sender')).toHaveText('DuckDuckGo');
  await expect(page.getByTestId('not-found-event')).toHaveText('You followed a link');
  await expect(page.getByTestId('not-found-campaign')).toHaveText('utm_source=newsletter · utm_medium=email');
  await expect(page.getByTestId('not-found-quip')).not.toBeEmpty();

  // Background: a painted galaxy and an SVG-animated flock.
  const galaxy = page.getByTestId('pixel-galaxy');
  await expect(galaxy).toBeAttached();
  const paintedPixels = await galaxy.evaluate((canvas: HTMLCanvasElement) => {
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 60) lit += 1;
    return lit;
  });
  expect(paintedPixels).toBeGreaterThan(50);
  expect(await page.getByTestId('flying-bill').count()).toBeGreaterThanOrEqual(4);
  expect(await page.locator('[data-testid="flying-money"] animateMotion').count()).toBeGreaterThanOrEqual(4);

  // The favicon is the winged money in both formats.
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveCount(1);
  const iconHref = await page.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute('href');
  const icon = await page.request.get(iconHref!);
  expect(icon.ok()).toBe(true);
  expect(icon.headers()['content-type']).toContain('image/svg+xml');
  expect((await page.request.get('/favicon.ico')).ok()).toBe(true);
});

test('404 page without a referrer says nobody sent the visitor, and offers a way home', async ({ page }) => {
  await page.goto('/nowhere/');

  await expect(page.getByTestId('not-found-sender')).toHaveText('Nobody');
  await expect(page.getByTestId('not-found-event')).toHaveText('You typed, pasted or bookmarked the address');
  await expect(page.getByTestId('not-found-campaign')).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId('not-found-event')).toHaveText('You reloaded the page');

  await expect(page.getByTestId('not-found-home')).toHaveAttribute('href', '/');
});

test('404 page keeps the bills drifting and flapping, just calmer, when the visitor prefers reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/still-nowhere/');

  const bills = page.getByTestId('flying-bill');
  await expect(bills.first()).toBeAttached();
  const billCount = await bills.count();
  const flock = page.getByTestId('flying-money');
  expect(await flock.locator('animateMotion').count()).toBe(billCount);
  expect(await flock.locator('animate').count()).toBe(billCount * 3);
  // The bob and rock are the extras that get dropped.
  expect(await flock.locator('animateTransform').count()).toBe(0);

  // And they really do travel.
  const positions = () =>
    bills.evaluateAll((nodes) =>
      nodes.map((node) => {
        const { x, y } = node.getBoundingClientRect();
        return [x, y];
      })
    );
  const before = await positions();
  await page.waitForTimeout(2500);
  const after = await positions();
  const travelled = before.map(([x, y], i) => Math.hypot(x - after[i][0], y - after[i][1]));
  expect(Math.max(...travelled)).toBeGreaterThan(20);
});

test('404 page text stays put while the bills move', async ({ page }) => {
  await page.goto('/text-stays-nowhere/');
  await expect(page.getByTestId('flying-bill').first()).toBeAttached();

  const textBoxes = () =>
    Promise.all(
      ['pixel-404', 'not-found-flight-recorder'].map((id) => page.getByTestId(id).boundingBox())
    );
  const before = await textBoxes();
  await page.waitForTimeout(2500);
  expect(await textBoxes()).toEqual(before);
});
