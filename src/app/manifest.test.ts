import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import manifest from './manifest';

const PUBLIC_DIR = path.resolve(__dirname, '../../public');
const APP_DIR = __dirname;

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): [number, number] {
  const data = fs.readFileSync(file);
  expect(data.subarray(1, 4).toString('ascii')).toBe('PNG');
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

describe('web app manifest', () => {
  const value = manifest();

  it('opens the app standalone at the root, within its own scope', () => {
    expect(value.display).toBe('standalone');
    expect(value.start_url).toBe('/');
    expect(value.scope).toBe('/');
    expect(value.id).toBe('/');
    expect(value.name).toBeTruthy();
    expect(value.short_name!.length).toBeLessThanOrEqual(12);
  });

  it('lists install icons that exist at the sizes it claims, including maskable 192 and 512', () => {
    const icons = value.icons ?? [];
    for (const icon of icons) {
      const file = path.join(icon.src === '/icon.svg' ? APP_DIR : PUBLIC_DIR, icon.src);
      expect(fs.existsSync(file), icon.src).toBe(true);
      if (icon.type === 'image/png') {
        const [width, height] = pngSize(file);
        expect(`${width}x${height}`).toBe(icon.sizes);
      }
    }
    const pngs = (purpose: string) =>
      icons.filter((icon) => icon.type === 'image/png' && icon.purpose === purpose).map((icon) => icon.sizes);
    expect(pngs('any')).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(pngs('maskable')).toEqual(expect.arrayContaining(['192x192', '512x512']));
  });

  it('has a 180 px Apple home-screen icon', () => {
    expect(pngSize(path.join(APP_DIR, 'apple-icon.png'))).toEqual([180, 180]);
  });
});
